import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  artifactId,
  floorPath,
  loadArtifact,
  sha256Hex,
  tilePath,
  ZONES_PATH,
  type Hazard,
  type ManifestBody,
  type ReadAsset,
  type RoutingArtifact,
  type Tile,
} from "./artifact.ts";
import { SWIM, decodeFloor, dropByte, encodeFloor, type FloorCell, type FloorLayer, type FloorTile } from "./floor.ts";
import { ARTIFACT_DIR } from "./fixtures/repin.ts";
import { emptyZones, flatArtifact, syntheticScope } from "./fixtures/synthetic.ts";
import {
  CELL_SPACING,
  FLOOR_CELL,
  HAZARD,
  HEAD_BUILDING,
  HEAD_HAZARD,
  HEAD_SWIM,
  HOLE,
  NODE_BURIED,
  NODE_DESCENT,
  NODE_FALL,
  NODE_HAZARD,
  NODE_SWIM,
  NODE_WATER,
  createTerrain,
  floorNode,
  nativeToCell,
  nodeRecord,
  type RegionFloor,
  type TerrainRegion,
} from "./terrain.ts";

interface SyntheticLiquid {
  chunk: [number, number];
  type: number;
  hazard: Hazard;
  surface: number;
  mask: bigint;
}
interface SyntheticTile {
  tile: Tile;
  offset: number;
  scale: number;
  value: (col: number, row: number) => number;
  holes?: [number, number][];
  liquids?: SyntheticLiquid[];
}

const HAZARDS: Hazard[] = ["water", "magma", "slime", "unknown"];

/** Writes a tile in the data producer's routing artifact format. */
function encodeTile(t: SyntheticTile): Uint8Array<ArrayBuffer> {
  const liquids = t.liquids ?? [];
  const bytes = new Uint8Array(35362 + 24 * liquids.length);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RXRT"));
  view.setUint16(4, 1, true);
  view.setUint16(6, t.tile[0], true);
  view.setUint16(8, t.tile[1], true);
  view.setUint16(10, liquids.length, true);
  view.setFloat64(16, t.offset, true);
  view.setFloat64(24, t.scale, true);
  for (let row = 0; row < 129; row++)
    for (let col = 0; col < 129; col++) view.setUint16(32 + (row * 129 + col) * 2, t.value(col, row), true);
  for (const [col, row] of t.holes ?? []) {
    const i = row * 128 + col;
    bytes[33314 + (i >> 3)]! |= 1 << (i & 7);
  }
  liquids.forEach((l, i) => {
    const at = 35362 + i * 24;
    bytes[at] = l.chunk[0];
    bytes[at + 1] = l.chunk[1];
    view.setUint16(at + 2, l.type, true);
    bytes[at + 4] = HAZARDS.indexOf(l.hazard);
    view.setFloat64(at + 8, l.surface, true);
    view.setBigUint64(at + 16, l.mask, true);
  });
  return bytes;
}

async function syntheticArtifact(present: SyntheticTile[], missing: Tile[] = [], corrupt: Tile[] = [], floors: FloorTile[] = []) {
  const files = new Map<string, Uint8Array<ArrayBuffer>>([[ZONES_PATH, emptyZones(present.length)]]);
  for (const t of present) files.set(tilePath(t.tile), encodeTile(t));
  for (const floor of floors) files.set(floorPath(floor.tile), Uint8Array.from(encodeFloor(floor)));
  const order = (a: Tile, b: Tile) => a[1] - b[1] || a[0] - b[0];
  const tiles = [
    ...present.map((t) => ({ tile: t.tile, state: "present" as const })),
    ...missing.map((tile) => ({ tile, state: "missing" as const })),
  ].sort((a, b) => order(a.tile, b.tile));
  const assets = await Promise.all(
    [...files].map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await sha256Hex(bytes) })),
  );
  assets.sort((a, b) => (a.path < b.path ? -1 : 1));
  const input = { path: "synthetic", sha256: "0".repeat(64) };
  const rest: ManifestBody = {
    schema: "restedxp-routing-artifact",
    version: 4,
    scope: syntheticScope(),
    frame: { origin: [23, 20], size: [8, 8], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
    tiles,
    zones: [],
    assets,
    ...(floors.length && { floors: { dataset: input, spawns: input, liquidTypes: input }, floorClimb: 1.0666664 }),
  };
  const manifest = new TextEncoder().encode(JSON.stringify({ ...rest, id: await artifactId(rest) }));
  const pin = { map: 0, id: await artifactId(rest), manifestSha256: await sha256Hex(manifest) };
  for (const tile of corrupt) files.get(tilePath(tile))![40]! ^= 1;
  const reads: string[] = [];
  const read: ReadAsset = async (path) => {
    if (path === "manifest.json") return manifest;
    reads.push(path);
    return files.get(path);
  };
  const load = await loadArtifact(read, pin);
  if (!load.ok) throw new Error(load.reason);
  return { artifact: load.artifact, reads };
}

async function tileRegion(artifact: RoutingArtifact, [x, y]: Tile): Promise<TerrainRegion> {
  return createTerrain(artifact).region([[x * 512 + 256, y * 512 + 256]], 0);
}

const at = (region: TerrainRegion, x: number, y: number) => {
  const i = y * region.width + x;
  return { elevation: region.elevation[i], slope: region.slope[i], blocked: region.blocked[i], water: region.water[i] };
};
const degrees = (rise: number) => (Math.atan(rise / CELL_SPACING) * 180) / Math.PI;

describe("cells", () => {
  it("averages the corners, takes the steeper triangle, and marks holes", async () => {
    const { artifact } = await syntheticArtifact([
      { tile: [2, 3], offset: 0, scale: 0.5, value: (col, row) => (col === 11 && row === 11 ? 60 : col * 2), holes: [[5, 7]] },
    ]);
    const region = await tileRegion(artifact, [2, 3]);
    expect(region).toMatchObject({ tile: [2, 3], width: 128, height: 128, spacing: 1600 / 3 / 128 });
    expect(at(region, 4, 0)).toEqual({ elevation: 4.5, slope: Math.fround(degrees(1)), blocked: 0, water: Number.NaN });
    expect(at(region, 5, 7).blocked).toBe(HOLE);
    expect(at(region, 10, 10)).toMatchObject({ elevation: 15.25, slope: Math.fround(degrees(Math.hypot(20, 19))) });
  });

  it("uses each tile's own copy of a seam, and blocks the edge of the covered area", async () => {
    const { artifact } = await syntheticArtifact([
      { tile: [1, 1], offset: 100, scale: 0.01, value: (col) => (col === 128 ? 4 : 0) },
      { tile: [2, 1], offset: 100, scale: 0.01, value: (col) => (col === 0 ? 2 : 0) },
    ]);
    const region = await createTerrain(artifact).region([[600, 600]], 600);
    expect(region.tile).toEqual([0, 0]);
    expect(at(region, 2 * 128 - 1, 130).elevation).toBe(Math.fround(100.02));
    expect(at(region, 2 * 128, 130).elevation).toBe(Math.fround(100.01));
    expect(at(region, 5, 130)).toEqual({ elevation: Number.NaN, slope: 90, blocked: HOLE, water: Number.NaN });
  });

  it("applies liquids to masked open cells below the surface", async () => {
    const ground = (row: number) => (row >= 25 ? 1000 : 0);
    const mask = (...cells: [number, number][]) => cells.reduce((m, [x, y]) => m | (1n << BigInt(y * 8 + x)), 0n);
    const { artifact } = await syntheticArtifact([
      {
        tile: [0, 0],
        offset: 10,
        scale: 0.01,
        value: (_, row) => ground(row),
        holes: [[9, 17]],
        liquids: [
          { chunk: [1, 2], type: 5, hazard: "water", surface: 10.1, mask: mask([0, 0], [1, 1], [7, 7]) },
          { chunk: [0, 3], type: 7, hazard: "magma", surface: 17, mask: mask([0, 0], [0, 1]) },
          { chunk: [1, 3], type: 20, hazard: "slime", surface: 25, mask: mask([0, 0]) },
          { chunk: [2, 3], type: 9999, hazard: "unknown", surface: 25, mask: mask([0, 0]) },
        ],
      },
    ]);
    const region = await tileRegion(artifact, [0, 0]);
    expect(at(region, 8, 16)).toMatchObject({ blocked: 0, water: Math.fround(10.1) });
    expect(at(region, 15, 23)).toMatchObject({ blocked: 0, water: Math.fround(10.1) });
    expect(at(region, 9, 16)).toMatchObject({ blocked: 0, water: Number.NaN });
    expect(at(region, 9, 17)).toMatchObject({ blocked: HOLE, water: Number.NaN });
    expect(at(region, 0, 24)).toMatchObject({ blocked: HAZARD, water: Number.NaN });
    expect(at(region, 0, 25)).toMatchObject({ blocked: 0, water: Number.NaN });
    expect(at(region, 8, 24).blocked).toBe(HAZARD);
    expect(at(region, 16, 24)).toMatchObject({ blocked: HAZARD, water: Number.NaN });
  });

  it("compares the float32 elevation with the float64 surface", async () => {
    // float32(334.81) is 334.80999755859375: below a surface of 334.81, and equal to a surface of float32(334.81).
    const magma = (chunk: [number, number], surface: number): SyntheticLiquid => ({ chunk, type: 7, hazard: "magma", surface, mask: 1n });
    const { artifact } = await syntheticArtifact([
      { tile: [0, 0], offset: 334.81, scale: 0, value: () => 0, liquids: [magma([0, 0], 334.81), magma([1, 0], Math.fround(334.81))] },
    ]);
    const region = await tileRegion(artifact, [0, 0]);
    expect([at(region, 0, 0).blocked, at(region, 8, 0).blocked]).toEqual([HAZARD, 0]);
  });
});

describe("coverage", () => {
  it("reports present, missing, unlisted, and unverified tiles", async () => {
    const flat = { offset: 0, scale: 1, value: () => 0 };
    const { artifact } = await syntheticArtifact(
      [
        { tile: [0, 0], ...flat },
        { tile: [2, 0], ...flat },
      ],
      [[1, 0]],
      [[2, 0]],
    );
    const region = await createTerrain(artifact).region(
      [
        [0, 0],
        [3 * 512 - 1, 511],
      ],
      0,
    );
    expect(region.width).toBe(3 * 128);
    expect([0, 1, 2].map((t) => region.coverage([t * 128 + 5, 5]))).toEqual(["present", "missing-coverage", "missing-coverage"]);
    expect(region.failed).toEqual([{ tile: [2, 0], reason: expect.stringMatching(/^tiles\/2_0.bin: expected SHA-256/) }]);
    expect(at(region, 2 * 128 + 5, 5).blocked).toBe(HOLE);
    expect(at(region, 5, 5).blocked).toBe(0);
    const below = await createTerrain(artifact).region([[0, 600]], 0);
    expect(below.coverage([0, 0])).toBe("no-terrain");
    expect(below.coverage([128, 0])).toBeUndefined();
  });
});

describe("floors", () => {
  const CELL_COUNT = 128 * 128;
  const fixtureFloor = (): FloorTile => decodeFloor(readFileSync(`${ARTIFACT_DIR}floors/9_22.bin`), [9, 22]);
  const layer = (height: number, more: Partial<FloorLayer> = {}): FloorLayer => ({
    height,
    walk: 0,
    drop: 0,
    water: false,
    fall: false,
    hazard: false,
    descent: false,
    drops: [],
    ...more,
  });
  const cellOf = (layers: FloorLayer[]): FloorCell => ({ layers, building: false, hazard: false });
  const chunkOf = (chunk: Tile, cells: Record<number, FloorCell>) => ({
    chunk,
    cells: Array.from({ length: 64 }, (_, c) => cells[c] ?? cellOf([layer(0)])),
  });

  async function floored(present: Tile[], floors: FloorTile[], corrupt?: string) {
    const { files, pin } = await flatArtifact(0, [23, 20], [23, 42], present, floors);
    if (corrupt) files.get(corrupt)![30]! ^= 1;
    const load = await loadArtifact(async (path) => files.get(path), pin);
    if (!load.ok) throw new Error(load.reason);
    return load.artifact;
  }
  const terrainOf = ({ tile, width, height, elevation, slope, blocked, water, failed }: TerrainRegion) => ({
    tile,
    width,
    height,
    elevation,
    slope,
    blocked,
    water,
    failed,
  });
  const nodes = (floor: RegionFloor, x: number, y: number) => {
    const i = y * 128 + x,
      head = floor.head[i]!;
    const region = { width: 128, height: 128 };
    return Array.from({ length: (head & 15) + (head & HEAD_SWIM ? 1 : 0) }, (_, k) => {
      const node = floorNode(region, floor, i, k),
        r = nodeRecord(region, floor, node);
      const links = Array.from({ length: floor.links[r + 1]! - floor.links[r]! }, (_, j) => floor.links[r]! + j);
      return {
        node,
        height: floor.height[r],
        sides: floor.sides[r],
        flags: floor.flags[r],
        cell: floor.cell[r],
        masks: links.map((j) => floor.mask[j]),
        drops: links.map((j) => floor.drop[j]),
      };
    });
  };

  it("derives buried layers from decoded corner minima with holes, climb, rounding, and descent exceptions", async () => {
    const tile: Tile = [2, 3];
    const source: SyntheticTile = {
      tile,
      offset: 100.0624,
      scale: 0.01,
      value: (col, row) => (row >= 2 && row <= 3 ? (col === 1 ? 2000 : col === 2 || col === 3 ? 1 : 0) : 0),
      holes: [[4, 0]],
    };
    const floor: FloorTile = {
      tile,
      chunks: [
        chunkOf([0, 0], {
          0: cellOf([layer(790)]),
          2: cellOf([layer(792)]),
          4: cellOf([layer(0)]),
          6: cellOf([layer(0, { descent: true })]),
          16: cellOf([layer(800)]),
          18: cellOf([layer(792)]),
        }),
      ],
      buildings: [],
      doorRefs: [],
      hints: [],
    };
    const { artifact } = await syntheticArtifact([source], [], [], [floor]);
    const region = await tileRegion(artifact, tile);
    expect(
      [
        [0, 0],
        [2, 0],
        [4, 0],
        [6, 0],
        [0, 2],
        [2, 2],
      ].map(([x, y]) => nodes(region.floor!, x!, y!).map((n) => n.flags)),
    ).toEqual([[NODE_BURIED], [0], [0], [NODE_DESCENT], [0], [NODE_BURIED]]);
    const plain = await tileRegion((await syntheticArtifact([source])).artifact, tile);
    expect(terrainOf(region)).toEqual(terrainOf(plain));
  });

  it("marks the descent layer of a version 3 floor tile", async () => {
    const tile = fixtureFloor();
    tile.chunks[0]!.cells[20] = cellOf([layer(40, { descent: true })]);
    const floor = (await tileRegion(await floored([[9, 22]], [tile]), [9, 22])).floor!;
    expect(nodes(floor, 4, 2)).toEqual([
      { node: 2 * 128 + 4, height: 5, sides: 0, flags: NODE_DESCENT, cell: 2 * 128 + 4, masks: [], drops: [] },
    ]);
    expect(nodes(floor, 5, 2).map((n) => n.flags)).toEqual([0]);
  });

  it("gives each chunk cell its layers and swim node, and keeps one terrain node in other cells", async () => {
    const region = await tileRegion(await floored([[9, 22]], [fixtureFloor()]), [9, 22]);
    const floor = region.floor!;
    // Cells outside the chunks (0, 0) and (1, 0).
    expect([floor.head[8 * 128], floor.head[127 * 128 + 127]]).toEqual([0, 0]);
    expect(floor.head[0]).toBe(FLOOR_CELL | 1);
    // Cell 5: two layers of equal height, then a ledge with a drop W into the
    // swim node of cell 4 and a 20 yd fall. Layer 0 keeps the id of the cell.
    const start = CELL_COUNT + floor.layerStart[5]!;
    expect(nodes(floor, 5, 0)).toEqual([
      { node: 5, height: 10, sides: 0b0010, flags: 0, cell: 5, masks: [1], drops: [0] },
      { node: start + 1, height: 10, sides: 0b0100, flags: 0, cell: 5, masks: [1], drops: [0] },
      { node: start + 2, height: 30, sides: 0b0001_0000, flags: NODE_FALL, cell: 5, masks: [SWIM, 1], drops: [0, dropByte(160)] },
    ]);
    // Cell 4 has WMO water and no layer: a swim node and no ground node.
    expect(floor.head[4]).toBe(FLOOR_CELL | HEAD_SWIM);
    expect(nodes(floor, 4, 0)).toEqual([
      { node: CELL_COUNT + floor.layerStart[4]!, height: 12, sides: 0, flags: NODE_SWIM, cell: 4, masks: [], drops: [] },
    ]);
    // Cell 12: a hazard water layer in a hazard swim node.
    expect(floor.head[1 * 128 + 4]).toBe(FLOOR_CELL | HEAD_SWIM | HEAD_HAZARD | 1);
    expect(nodes(floor, 4, 1).map((n) => n.flags)).toEqual([NODE_WATER | NODE_HAZARD, NODE_SWIM | NODE_HAZARD]);
    const { buildings, doorRefs, hints } = fixtureFloor();
    expect(floor.tiles.get("9,22")).toEqual({ tile: [9, 22], buildings, doorRefs, hints });
    const plain = await tileRegion(await floored([[9, 22]], []), [9, 22]);
    expect(terrainOf(region)).toEqual(terrainOf(plain));
  });

  it("keeps the outdoor layers of a building cell, without a swim node", async () => {
    const tile = fixtureFloor();
    tile.chunks[1]!.cells[9]!.layers = [layer(80, { walk: 0b0001 })];
    const floor = (await tileRegion(await floored([[9, 22]], [tile]), [9, 22])).floor!;
    expect(floor.head[128 + 9]).toBe(FLOOR_CELL | HEAD_BUILDING | 1);
    expect(nodes(floor, 9, 1)).toEqual([{ node: 128 + 9, height: 10, sides: 0b0001, flags: 0, cell: 128 + 9, masks: [1], drops: [0] }]);
    expect(floor.head[128 + 10]).toBe(FLOOR_CELL | HEAD_BUILDING);
  });

  it("makes a tile with a damaged floor tile missing coverage", async () => {
    const region = await tileRegion(await floored([[9, 22]], [fixtureFloor()], "floors/9_22.bin"), [9, 22]);
    expect(region.coverage([5, 5])).toBe("missing-coverage");
    expect(region.failed).toEqual([{ tile: [9, 22], reason: expect.stringMatching(/^floors\/9_22.bin: expected SHA-256/) }]);
    expect(region.floor).toBeUndefined();
    expect(at(region, 5, 5).blocked).toBe(HOLE);
  });

  it.each([
    { side: 0, x: 0, y: 65, dx: -1, dy: 0 },
    { side: 1, x: 65, y: 127, dx: 0, dy: 1 },
    { side: 2, x: 127, y: 65, dx: 1, dy: 0 },
    { side: 3, x: 65, y: 0, dx: 0, dy: -1 },
  ])("validates walk masks and passes valid drop masks across side $side inside a larger region", async ({ side, x, y, dx, dy }) => {
    const source: Tile = [1, 1];
    const target: Tile = [1 + dx, 1 + dy];
    const tx = (x + dx + 128) % 128,
      ty = (y + dy + 128) % 128;
    const floorAt = (tile: Tile, cx: number, cy: number, cell: FloorCell): FloorTile => ({
      tile,
      chunks: [chunkOf([Math.floor(cx / 8), Math.floor(cy / 8)], { [(cy % 8) * 8 + (cx % 8)]: cell })],
      buildings: [],
      doorRefs: [],
      hints: [],
    });
    const from = floorAt(
      source,
      x,
      y,
      cellOf([
        layer(80, {
          walk: 15,
          drop: 1 << side,
          masks: [...Array.from({ length: 4 }, (_, s) => (s === side ? 2 : 1)), SWIM],
          drops: [0],
        }),
      ]),
    );
    const tiles: SyntheticTile[] = Array.from({ length: 9 }, (_, i) => ({
      tile: [i % 3, Math.floor(i / 3)],
      offset: 0,
      scale: 1,
      value: () => 0,
    }));
    for (const valid of [true, false]) {
      const to = floorAt(target, tx, ty, {
        ...cellOf(valid ? [layer(0), layer(0)] : [layer(0)]),
        surface: 8,
      });
      const { artifact } = await syntheticArtifact(tiles, [], [], [from, to]);
      const terrain = createTerrain(artifact);
      const alone = await terrain.region([[768, 768]], 0);
      expect(alone.failed).toEqual([]);
      expect(alone.coverage([x, y])).toBe("present");
      const region = await terrain.region([[768, 768]], 512);
      expect([region.width, region.height]).toEqual([384, 384]);
      expect(region.coverage([128 + x, 128 + y])).toBe(valid ? "present" : "missing-coverage");
      expect(region.failed.map((failure) => failure.tile)).toEqual(valid ? [] : [[1, 1]]);
      expect(region.coverage([target[0] * 128 + tx, target[1] * 128 + ty])).toBe("present");
      if (!valid) {
        let unavailable = true;
        const retrying = createTerrain({
          ...artifact,
          tile: async (tile) => {
            if (unavailable && tile[0] === target[0] && tile[1] === target[1]) throw new Error("unavailable neighbor");
            return artifact.tile(tile);
          },
        });
        const missing = await retrying.region([[768, 768]], 512);
        expect(missing.failed).toEqual([{ tile: target, reason: "unavailable neighbor" }]);
        expect(missing.coverage([128 + x, 128 + y])).toBe("present");
        unavailable = false;
        const retried = await retrying.region([[768, 768]], 512);
        expect(retried.failed.map((failure) => failure.tile)).toEqual([[1, 1]]);
        expect(retried.coverage([128 + x, 128 + y])).toBe("missing-coverage");
        expect(retried.coverage([target[0] * 128 + tx, target[1] * 128 + ty])).toBe("present");
      }
    }
  });

  it("makes a tile missing coverage when it links to a layer that the next tile does not have", async () => {
    const west = (): FloorTile => ({
      tile: [9, 22],
      chunks: [chunkOf([15, 0], { 7: cellOf([layer(0, { walk: 0b0100, masks: [0b10] })]) })],
      buildings: [],
      doorRefs: [],
      hints: [],
    });
    const east = (layers: number): FloorTile => ({
      tile: [10, 22],
      chunks: [chunkOf([0, 0], { 0: cellOf(Array.from({ length: layers }, () => layer(0, { walk: 0b0001 }))) })],
      buildings: [],
      doorRefs: [],
      hints: [],
    });
    const both = (artifact: RoutingArtifact) =>
      createTerrain(artifact).region(
        [
          [9 * 512 + 500, 22 * 512 + 10],
          [10 * 512 + 10, 22 * 512 + 10],
        ],
        0,
      );
    const good = await both(
      await floored(
        [
          [9, 22],
          [10, 22],
        ],
        [west(), east(2)],
      ),
    );
    expect([good.failed, good.coverage([5, 5]), good.floor?.tiles.size]).toEqual([[], "present", 2]);

    const bad = await both(
      await floored(
        [
          [9, 22],
          [10, 22],
        ],
        [west(), east(1)],
      ),
    );
    expect(bad.failed).toEqual([
      {
        tile: [9, 22],
        reason: "floors/9_22.bin: the link from cell 127, 0 names a layer or swim node that cell 0, 0 of tile 10_22 does not have",
      },
    ]);
    expect([bad.coverage([5, 5]), bad.coverage([133, 5]), at(bad, 5, 5).blocked]).toEqual(["missing-coverage", "present", HOLE]);
    expect([bad.floor?.head[127], bad.floor?.head[128], [...bad.floor!.tiles.keys()]]).toEqual([0, FLOOR_CELL | 1, ["10,22"]]);
  });
});

describe("regions", () => {
  it("reads only the tiles that cover the points and margin, once", async () => {
    const tiles: SyntheticTile[] = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) tiles.push({ tile: [x, y], offset: 0, scale: 1, value: () => 0 });
    const { artifact, reads } = await syntheticArtifact(tiles, [], [[7, 7]]);
    const terrain = createTerrain(artifact);
    const first = await terrain.region(
      [
        [1100, 1650],
        [1200, 1950],
      ],
      100,
    );
    expect(first.tile).toEqual([1, 3]);
    expect([first.width, first.height]).toEqual([2 * 128, 128 * 2]);
    expect(reads.toSorted()).toEqual(["tiles/1_3.bin", "tiles/1_4.bin", "tiles/2_3.bin", "tiles/2_4.bin"]);
    reads.length = 0;
    const second = await terrain.region([[1200, 1950]], 4096);
    expect([second.tile, second.width, second.height]).toEqual([[0, 0], 8 * 128, 8 * 128]);
    expect(reads).toHaveLength(64 - 4);
    expect(nativeToCell(second, [1200, 1950])).toEqual([300, 487]);
    reads.length = 0;
    await terrain.region([[0, 0]], 4096);
    expect(reads).toEqual(["tiles/7_7.bin"]);
  });
});

describe("prototype parity", () => {
  // The data producer's routing prototype, reduced to the cell values. The
  // prototype read heights from PNG channels with the tile's min and max.
  interface Grid {
    width: number;
    elevation: Float32Array;
    slope: Float32Array;
    blocked: Uint8Array;
    water: Float32Array;
  }
  function addTile(grid: Grid, x: number, y: number, rgba: Uint8ClampedArray, min: number, max: number) {
    const height = (col: number, row: number) => {
      const i = (row * 129 + col) * 4;
      return min + ((rgba[i]! * 256 + rgba[i + 1]!) / 65535) * (max - min);
    };
    for (let row = 0; row < 128; row++)
      for (let col = 0; col < 128; col++) {
        const i = (y * 128 + row) * grid.width + x * 128 + col;
        const a = height(col, row),
          b = height(col + 1, row);
        const c = height(col, row + 1),
          d = height(col + 1, row + 1);
        grid.elevation[i] = (a + b + c + d) / 4;
        grid.slope[i] =
          (Math.atan(Math.max(Math.hypot(b - a, c - a), Math.hypot(d - c, d - b)) / (533.3333333333334 / 128)) * 180) / Math.PI;
        grid.blocked[i] = rgba[(row * 129 + col) * 4 + 2]! & 1;
      }
  }
  const waterTypes = new Set([5, 1240, 1250, 1288, 1297, 1313, 1319, 1325]);
  function applyWater(grid: Grid, tiles: [number, number, [number, number, number, number, string][]][]) {
    for (const [tx, ty, chunks] of tiles)
      for (const [cx, cy, level, type, bits] of chunks) {
        const coverage = BigInt(`0x${bits}`);
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            if (!((coverage >> BigInt(y * 8 + x)) & 1n)) continue;
            const index = (ty * 128 + cy * 8 + y) * grid.width + tx * 128 + cx * 8 + x;
            if (grid.blocked[index] !== 0 || !((grid.elevation[index] ?? Infinity) < level)) continue;
            if (waterTypes.has(type)) {
              const previous = grid.water[index]!;
              grid.water[index] = Number.isFinite(previous) ? Math.max(previous, level) : level;
            } else {
              grid.blocked[index] = 2;
              grid.water[index] = Number.NaN;
            }
          }
      }
  }

  it("gives the prototype's cells for a two-tile window", async () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const ranges = [
      [-12.34, 87.65],
      [40.5, 41.02],
    ] as const;
    const sources = ranges.map(() => {
      const values = Uint16Array.from({ length: 129 * 129 }, () => Math.floor(random() * 65536));
      const holes = Uint8Array.from({ length: 128 * 128 }, () => Number(random() < 0.05));
      return { values, holes };
    });
    const liquids: SyntheticLiquid[][] = [
      [
        { chunk: [0, 0], type: 5, hazard: "water", surface: 50.17, mask: 0xffffffffffffffffn },
        { chunk: [4, 9], type: 7, hazard: "magma", surface: 60, mask: 0xf0f0f0f0f0f0f0f0n },
      ],
      [{ chunk: [15, 15], type: 1240, hazard: "water", surface: 40.81, mask: 0x8000000000000001n }],
    ];
    const tiles: SyntheticTile[] = sources.map(({ values, holes }, x) => ({
      tile: [x, 0],
      offset: ranges[x]![0],
      // As the producer's exporter derives them from the upstream min and max.
      scale: (ranges[x]![1] - ranges[x]![0]) / 65535,
      value: (col, row) => values[row * 129 + col]!,
      holes: [...holes.keys()].flatMap((i) => (holes[i] ? [[i % 128, Math.floor(i / 128)]] : [])),
      liquids: liquids[x]!,
    }));
    const { artifact } = await syntheticArtifact(tiles);
    const region = await createTerrain(artifact).region(
      [
        [0, 0],
        [1023, 511],
      ],
      0,
    );

    const grid: Grid = {
      width: 256,
      elevation: new Float32Array(256 * 128).fill(Number.NaN),
      slope: new Float32Array(256 * 128).fill(90),
      blocked: new Uint8Array(256 * 128).fill(1),
      water: new Float32Array(256 * 128).fill(Number.NaN),
    };
    sources.forEach(({ values, holes }, x) => {
      const rgba = new Uint8ClampedArray(129 * 129 * 4);
      values.forEach((v, i) => {
        rgba[i * 4] = v >> 8;
        rgba[i * 4 + 1] = v & 255;
        // Blue bit 0 of vertex (col, row) marks cell (col, row).
        const col = i % 129,
          row = Math.floor(i / 129);
        rgba[i * 4 + 2] = col < 128 && row < 128 ? holes[row * 128 + col]! : 0;
      });
      addTile(grid, x, 0, rgba, ranges[x]![0], ranges[x]![1]);
    });
    applyWater(
      grid,
      liquids.map((chunks, x) => [x, 0, chunks.map((l) => [l.chunk[0], l.chunk[1], l.surface, l.type, l.mask.toString(16)])]),
    );

    expect(region.blocked.filter((b) => b === HAZARD).length).toBeGreaterThan(0);
    expect(region.water.filter(Number.isFinite).length).toBeGreaterThan(0);
    expect(region.elevation).toEqual(grid.elevation);
    expect(region.slope).toEqual(grid.slope);
    expect(region.blocked).toEqual(grid.blocked);
    expect(region.water).toEqual(grid.water);
  });
});
