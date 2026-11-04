// These tests copy the data producer's floor tile tests with only format
// changes, so they make the same decoder checks. The `readFloor` tests are
// planner code.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadArtifact, type ReadAsset } from "./artifact.ts";
import {
  type Building,
  type Door,
  decodeFloor,
  dropByte,
  encodeFloor,
  type FloorCell,
  type FloorLayer,
  type FloorTile,
  readFloor,
  SWIM,
} from "./floor.ts";
import { ARTIFACT_DIR, fixturePin } from "./fixtures/repin.ts";
import { flatArtifact } from "./fixtures/synthetic.ts";

const readFixture = (path: string) => new Uint8Array(readFileSync(`${ARTIFACT_DIR}${path}`));
const message = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return "accepted";
};

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
const cellOf = (layers: FloorLayer[], more: Partial<FloorCell> = {}) => ({
  layers,
  building: false,
  hazard: false,
  ...more,
});
const ground = (): FloorCell => cellOf([layer(0)]);
/**
 * The tile of `valid/artifact-v3/floors/9_22.bin`. Side bits are W, S, E, N.
 * Chunk (0, 0) has a water cell 4 without layers, cell 5 with two layers of
 * equal height and a ledge, and a hazard water layer in the hazard swim node
 * of cell 12. Chunk (1, 0) holds the footprint of a building with colocated
 * targets on floors 0 and 2. Door 1 has no path to a target, and a
 * door-to-door path joins doors 0 and 1.
 */
function floorFixture(): FloorTile {
  const near = Array.from({ length: 64 }, ground);
  near[4] = cellOf([], { surface: 96 });
  near[5] = cellOf([
    layer(80, { walk: 0b0010 }),
    layer(80, { walk: 0b0100, masks: [0b1] }),
    // The ledge: a W drop into the swim node of cell 4, then a 20 yd drop
    // to layer 0 of this cell.
    layer(240, {
      drop: 0b0001,
      fall: true,
      masks: [SWIM, 0b1],
      drops: [0, dropByte(160)],
    }),
  ]);
  near[6] = cellOf([layer(80, { walk: 0b0001, masks: [0b10] })]);
  near[12] = cellOf([layer(40, { water: true, hazard: true })], {
    surface: 96,
    hazard: true,
  });
  near[13] = cellOf([layer(80, { walk: 0b1000 })]);
  const hall = Array.from({ length: 64 }, (_, c): FloorCell => {
    const x = c & 7,
      y = c >> 3;
    return x >= 1 && x <= 6 && y >= 1 && y <= 6 ? cellOf([], { building: true }) : ground();
  });
  return {
    tile: [9, 22],
    chunks: [
      { chunk: [0, 0], cells: near },
      { chunk: [1, 0], cells: hall },
    ],
    buildings: [
      {
        placement: 123456,
        box: [520, 8, 1000, 500],
        ground: 0,
        floors: [0, 200, 400],
        doors: [
          { tile: [0, 0], cell: 7, layer: 0, point: [500, 10, 0] },
          { tile: [0, 0], cell: 527, layer: 0, point: [1010, 300, 0] },
        ],
        targets: [
          { point: [700, 100], floor: 0, kind: 0 },
          { point: [700, 100], floor: 2, kind: 0 },
          { point: [800, 300], floor: 255, kind: 1 },
        ],
        paths: [
          [
            [500, 10, 0],
            [600, 50, 0],
            [700, 100, 0],
          ],
          [
            [500, 10, 0],
            [650, 80, 200],
            [700, 100, 400],
          ],
          [
            [500, 10, 0],
            [800, 300, 0],
          ],
          [],
          [],
          [],
          [
            [700, 100, 0],
            [720, 120, 200],
            [700, 100, 400],
          ],
          [],
          [],
          [
            [500, 10, 0],
            [800, 200, 0],
            [1010, 300, 0],
          ],
        ],
      },
    ],
    doorRefs: [{ home: [-1, 0], building: 2, door: 0 }],
    hints: [
      [330, 10, 80],
      [340, 20, 240],
    ],
  };
}

describe("floor tiles", () => {
  const floorBytes = () => readFixture("floors/9_22.bin") ?? new Uint8Array();
  const cell = (tile: FloorTile, chunk: number, c: number) => {
    const found = tile.chunks[chunk]?.cells[c];
    if (!found) throw new Error("Missing fixture cell");
    return found;
  };
  const layerOf = (tile: FloorTile, c: number, l: number) => {
    const found = cell(tile, 0, c).layers[l];
    if (!found) throw new Error("Missing fixture layer");
    return found;
  };
  const building = (tile: FloorTile) => {
    const found = tile.buildings[0];
    if (!found) throw new Error("Missing fixture building");
    return found;
  };

  it("encodes equal bytes each time and decodes the input", () => {
    expect(encodeFloor(floorFixture())).toEqual(floorBytes());
    expect(decodeFloor(floorBytes(), [9, 22])).toEqual(floorFixture());
  });

  it("drops from a ledge into the swim node of a cell without layers", () => {
    const tile = decodeFloor(floorBytes(), [9, 22]);
    const ledge = layerOf(tile, 5, 2);
    expect([ledge.drop, ledge.masks?.[0], ledge.drops[0]]).toEqual([0b0001, SWIM, 0]);
    expect(cell(tile, 0, 4)).toEqual(cellOf([], { surface: 96 }));
    const dry = floorFixture();
    delete cell(dry, 0, 4).surface;
    expect(message(() => encodeFloor(dry))).toBe("floors/9_22.bin chunk 0 cell 5 layer 2: swim target without water");
  });

  // The head of cell 12 and the flags of its layer 0 in the fixture file.
  const hazardHead = 104,
    hazardFlags = 108;
  it("marks a hazard swim node and layer with head bit 6 and flag bit 3", () => {
    const tile = decodeFloor(floorBytes(), [9, 22]);
    expect([cell(tile, 0, 12).hazard, layerOf(tile, 12, 0).hazard]).toEqual([true, true]);
    // Without the marks, only the two bits change. Thus a tile without
    // hazards keeps the bytes of the format before the hazard bits.
    const plain = floorFixture();
    cell(plain, 0, 12).hazard = false;
    layerOf(plain, 12, 0).hazard = false;
    const bytes = encodeFloor(plain),
      marked = floorBytes();
    expect(bytes.length).toBe(marked.length);
    expect([...bytes.keys()].flatMap((i) => (bytes[i] === marked[i] ? [] : [[i, (bytes[i] ?? 0) ^ (marked[i] ?? 0)]]))).toEqual([
      [hazardHead, 0x40],
      [hazardFlags, 0x08],
    ]);
  });

  it.each([
    ["head bit 7", hazardHead, 0x80, "chunk 0 cell 12: expected head bit 7 zero"],
    ["flag bit 5", hazardFlags, 0x20, "chunk 0 cell 12 layer 0: expected flag bits 5 to 7 zero"],
  ])("rejects %s", (_, at, bit, error) => {
    const bytes = Uint8Array.from(floorBytes());
    bytes[at] = (bytes[at] ?? 0) | bit;
    expect(message(() => decodeFloor(bytes, [9, 22]))).toBe(`floors/9_22.bin ${error}`);
  });

  it("decodes a descent layer with flag bit 4", () => {
    const tile = floorFixture();
    cell(tile, 0, 20).layers = [layer(300, { descent: true })];
    const bytes = encodeFloor(tile);
    expect(decodeFloor(bytes, [9, 22])).toEqual(tile);
    // The first changed byte is the height of the layer in cell 20. The
    // flags of the layer are 3 bytes after it.
    const plain = encodeFloor(floorFixture());
    const at = [...bytes.keys()].find((i) => bytes[i] !== plain[i]) ?? 0;
    expect(bytes[at + 3]).toBe(0x10);
  });

  it("decodes an outdoor layer in a building cell", () => {
    const tile = floorFixture();
    cell(tile, 1, 9).layers = [layer(80, { walk: 0b0001 })];
    expect(decodeFloor(encodeFloor(tile), [9, 22])).toEqual(tile);
  });

  it.each([
    [
      "a swim node in a building cell",
      (t: FloorTile) => {
        cell(t, 1, 9).surface = 0;
      },
      "chunk 1 cell 9: expected no swim node in a building cell",
    ],
    [
      "a hazard swim node in a cell without a swim node",
      (t: FloorTile) => {
        cell(t, 0, 13).hazard = true;
      },
      "chunk 0 cell 13: hazard swim node without a swim node",
    ],
    [
      "a descent layer with a walk link",
      (t: FloorTile) => {
        cell(t, 0, 20).layers = [layer(300, { descent: true, walk: 0b0001 })];
      },
      "chunk 0 cell 20 layer 0: expected a descent layer without links, water, or masks",
    ],
    [
      "a descent layer with water",
      (t: FloorTile) => {
        layerOf(t, 12, 0).descent = true;
      },
      "chunk 0 cell 12 layer 0: expected a descent layer without links, water, or masks",
    ],
    [
      "a descent layer with another layer",
      (t: FloorTile) => {
        cell(t, 0, 20).layers.push(layer(300, { descent: true }));
      },
      "chunk 0 cell 20: expected a descent layer alone in its cell",
    ],
    [
      "a hazard layer that is not a water layer",
      (t: FloorTile) => {
        layerOf(t, 12, 0).water = false;
      },
      "chunk 0 cell 12 layer 0: hazard layer that is not a water layer",
    ],
    [
      "a walk mask with bit 15",
      (t: FloorTile) => {
        layerOf(t, 6, 0).masks = [0b10 | SWIM];
      },
      "chunk 0 cell 6 layer 0: swim target on a walk link",
    ],
    [
      "a link without masks into a cell without layers",
      (t: FloorTile) => {
        layerOf(t, 5, 0).walk = 0b0001;
      },
      "chunk 0 cell 5 layer 0: link without masks into a cell without layers",
    ],
    [
      "a swim drop with a drop height",
      (t: FloorTile) => {
        layerOf(t, 5, 2).drops = [139, dropByte(160)];
      },
      "chunk 0 cell 5 layer 2: swim target with a drop height other than 0",
    ],
    [
      "16 layers in a cell",
      (t: FloorTile) => {
        cell(t, 0, 5).layers.push(...Array.from({ length: 13 }, () => layer(400)));
      },
      "chunk 0: expected at most 15 layers in a cell",
    ],
    [
      "a fraction of a side bit",
      (t: FloorTile) => {
        layerOf(t, 5, 0).walk = 0.5;
      },
      "chunk 0: expected walk links and drop links from 0 to 15",
    ],
    [
      "a mask with no bit",
      (t: FloorTile) => {
        layerOf(t, 5, 1).masks = [0];
      },
      "chunk 0 cell 5 layer 1: empty mask",
    ],
    [
      "a mask bit at the layer count of the target cell",
      (t: FloorTile) => {
        layerOf(t, 5, 1).masks = [0b10];
      },
      "chunk 0 cell 5 layer 1: mask bit 1 at or above the layer count 1 of the target cell",
    ],
    [
      "a layer 1/8 yd below the layer before it",
      (t: FloorTile) => {
        layerOf(t, 5, 1).height = 79;
      },
      "chunk 0 cell 5 layer 1: expected layers in ascending height",
    ],
    [
      "colocated targets on floors 2 then 0",
      (t: FloorTile) => {
        const { targets } = building(t);
        targets.splice(0, 2, ...targets.slice(0, 2).reverse());
      },
      "building 0 target 1: expected targets in wire order, without repeats",
    ],
    [
      "two equal targets",
      (t: FloorTile) => {
        building(t).targets[1] = { point: [700, 100], floor: 0, kind: 0 };
      },
      "building 0 target 1: expected targets in wire order, without repeats",
    ],
    [
      "two equal doors",
      (t: FloorTile) => {
        const b = building(t);
        b.doors.splice(1, 0, structuredClone(b.doors[0] as Door));
        b.paths = Array.from({ length: 15 }, () => []);
      },
      "building 0 door 1: expected doors in wire order, without repeats",
    ],
    [
      "a building without its door-to-door path",
      (t: FloorTile) => {
        building(t).paths.pop();
      },
      "building 0: expected one path for each door and target, then for each target pair, then for each door pair",
    ],
    [
      "a door attached to a layer of a building cell",
      (t: FloorTile) => {
        cell(t, 1, 9).layers = [layer(80)];
        Object.assign(building(t).doors[0] as Door, {
          tile: [0, 0],
          cell: 137,
          layer: 0,
        });
      },
      "building 0 door 0: expected an attach cell that is not a building cell",
    ],
    [
      "two buildings of one placement with equal boxes",
      (t: FloorTile) => {
        t.buildings.push(structuredClone(building(t)));
      },
      "building 1: expected buildings in wire order, without repeats",
    ],
    [
      "two equal hints",
      (t: FloorTile) => {
        t.hints[1] = [330, 10, 80];
      },
      "hint 1: expected hints in wire order, without repeats",
    ],
  ])("rejects %s", (_, change, error) => {
    const tile = floorFixture();
    change(tile);
    expect(message(() => encodeFloor(tile))).toBe(`floors/9_22.bin ${error}`);
  });

  it("orders the buildings of one placement by box y0, then x0, then doors", () => {
    const tile = floorFixture();
    tile.doorRefs = [];
    const [door] = building(tile).doors;
    const copy = (change: Partial<Building>): Building => ({
      ...structuredClone(building(tile)),
      doors: [door as Door],
      targets: [],
      paths: [],
      ...change,
    });
    tile.buildings.push(
      copy({ box: [400, 9, 1100, 500] }),
      copy({
        box: [400, 9, 1100, 500],
        doors: [{ ...(door as Door), point: [500, 11, 0] }],
      }),
    );
    expect(decodeFloor(encodeFloor(tile), [9, 22]).buildings).toHaveLength(3);
    tile.buildings.reverse();
    expect(message(() => encodeFloor(tile))).toBe("floors/9_22.bin building 1: expected buildings in wire order, without repeats");
  });

  it.each([
    ["a short file", (b: Uint8Array) => b.subarray(0, -1), "expected more bytes after byte 718"],
    ["bytes after the last hint", (b: Uint8Array) => Uint8Array.of(...b, 0), "expected the file to end after the last hint, at byte 720"],
  ])("rejects %s", (_, change, error) => {
    expect(message(() => decodeFloor(change(floorBytes()), [9, 22]))).toBe(`floors/9_22.bin: ${error}`);
  });

  // The x of the last point of the door-to-door path: the file ends with
  // that point, one door reference of 6 bytes, and two hints of 6 bytes.
  const doorToDoorEnd = 720 - 6 - 18;
  it.each([
    ["version 1", (b: Uint8Array) => Uint8Array.of(...b.subarray(0, 4), 1, ...b.subarray(5)), ": expected version 3"],
    [
      "a door-to-door path that does not end at its end door",
      (b: Uint8Array) => {
        const changed = Uint8Array.from(b);
        changed[doorToDoorEnd] = (b[doorToDoorEnd] ?? 0) ^ 1;
        return changed;
      },
      " building 0 path 9: expected the end door point last",
    ],
    // Without its door-to-door path (a count byte and 3 points), the
    // building is the building of version 1. The decoder reads the door
    // reference as the path.
    [
      "a building without its door-to-door path",
      (b: Uint8Array) => Uint8Array.of(...b.subarray(0, doorToDoorEnd - 13), ...b.subarray(doorToDoorEnd + 6)),
      ": expected more bytes after byte 700",
    ],
  ])("rejects bytes with %s", (_, change, error) => {
    expect(message(() => decodeFloor(change(floorBytes()), [9, 22]))).toBe(`floors/9_22.bin${error}`);
  });

  it("stores drop heights in 0.5 yd steps, rounded up", () => {
    expect([104, 105, 552, 553, 2000].map(dropByte)).toEqual([26, 27, 138, 139, 255]);
  });
});

describe("readFloor", () => {
  const reader =
    (dir: string): ReadAsset =>
    async (path) => {
      try {
        return new Uint8Array(readFileSync(`${dir}${path}`));
      } catch {
        return undefined;
      }
    };

  it("reads the floor tile of a present tile, and nothing for a tile without one", async () => {
    const fixture = await fixturePin();
    const load = await loadArtifact(reader(ARTIFACT_DIR), fixture);
    if (!load.ok) throw new Error(load.reason);
    expect(await readFloor(load.artifact, [9, 22])).toEqual(floorFixture());
    const { files, pin } = await flatArtifact(0, [23, 20], [23, 42], [[9, 22]]);
    const plain = await loadArtifact(async (path) => files.get(path), pin);
    if (!plain.ok) throw new Error(plain.reason);
    expect(await readFloor(plain.artifact, [9, 22])).toBeUndefined();
  });
});
