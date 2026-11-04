// The cell values follow the data producer's routing prototype, with its
// float32 arrays, so a search ported from it gives the same results.

import { CELLS, TILE_PIXELS, TILE_WORLD_UNITS, floorPath, heightAt, type HeightTile, type RoutingArtifact, type Tile } from "./artifact.ts";
import { loadCoarse, type CoarseLayer } from "./coarse.ts";
import { SIDES, SWIM, readFloor, type FloorTile } from "./floor.ts";
import type { NativeFrame, Point } from "./frame.ts";

/** Native pixels to a cell side. */
export const CELL_PIXELS = TILE_PIXELS / CELLS;
/** The prototype's `grid.spacing`. */
export const CELL_SPACING = TILE_WORLD_UNITS / CELLS;

/** Blocked by a hole, or a cell without loaded ground. */
export const HOLE = 1;
/** Blocked by magma, slime, or an unknown liquid. */
export const HAZARD = 2;

/**
 * `present`: the cell's tile is loaded. `missing-coverage`: the tile has
 * terrain upstream, but the artifact does not include it or it failed to
 * load. `no-terrain`: the tile has no terrain upstream.
 */
export type Coverage = "present" | "missing-coverage" | "no-terrain";
const COVERAGES: readonly Coverage[] = ["present", "missing-coverage", "no-terrain"];

/** `[x, y]` cells of a region, from its north-west corner. */
export type CellPoint = [number, number];

/** The cells of one tile, 128 × 128 row by row, in the prototype's `Grid` arrays. */
export interface TileCells {
  /** Mean height of the four corners. */
  elevation: Float32Array;
  /** Degrees: the steeper of the cell's two triangles. */
  slope: Float32Array;
  /** 0 open, `HOLE`, or `HAZARD`. */
  blocked: Uint8Array;
  /** Water surface over a submerged cell; NaN elsewhere. */
  water: Float32Array;
}

/**
 * A dense grid over whole tiles, with the fields of the prototype's `Grid`.
 * Cells outside present tiles have NaN elevation, slope 90, and `HOLE`, as
 * the prototype's `createGrid` fills them.
 */
export interface TerrainRegion extends TileCells {
  /** The tile of cell [0, 0], from the frame origin. */
  tile: Tile;
  width: number;
  height: number;
  spacing: number;
  coverage(cell: CellPoint): Coverage | undefined;
  /** Tiles that the manifest lists as present but that failed to load or verify. */
  failed: { tile: Tile; reason: string }[];
  floor?: RegionFloor;
}

/** Head bit 7 in `RegionFloor.head`: the cell is in a chunk of a floor tile. */
export const FLOOR_CELL = 0x80;
/**
 * Yards between two layers of a cell that are separate floors. On the Stormwind and Ironforge points of the built-in guides,
 * gaps of 3 yd or less were steps, ramps, and rugs, and storeys were 6.4 yd or more apart.
 */
export const STOREY = 4;
/** Head bits 0 to 3: the layer count `L`. */
export const HEAD_LAYERS = 0x0f;
/** Head bit 4: the cell has a swim node (WMO water). */
export const HEAD_SWIM = 0x10;
/** Head bit 5: the cell is in a building footprint. Its layers are outdoor ground, and it has no swim node. */
export const HEAD_BUILDING = 0x20;
/** Head bit 6: the swim node is magma or slime. */
export const HEAD_HAZARD = 0x40;
/** Node flag bit 0: the layer joins the swim node of its cell. */
export const NODE_WATER = 1;
/** Node flag bit 1: the last link of the layer drops to a lower layer or to the swim node of its cell. */
export const NODE_FALL = 2;
/** Node flag bit 3: the layer or swim node is in magma or slime. */
export const NODE_HAZARD = 8;
/** Node flag bit 4: the node is the swim node of its cell. */
export const NODE_SWIM = 0x10;
/** Node flag bit 5: the layer is a descent layer, the only layer of its cell (floor.ts `FloorLayer.descent`). */
export const NODE_DESCENT = 0x20;
/** Node flag bit 6: a normal layer is below the decoded corner bound in a cell without a terrain hole. */
export const NODE_BURIED = 0x40;

/**
 * The floor tiles of a region, in flat arrays. A floor cell (`FLOOR_CELL` in
 * `head`) has a record for each layer, in ascending height, then one for its
 * swim node. Other cells keep the terrain rule, with one node each.
 *
 * Node ids: node `i` is cell `i` of the region: its terrain node, or layer 0
 * of a floor cell. Node `cells + r` is record `r`, for the other layers and
 * the swim nodes. The ids of the layer 0 records are not used. `floorNode`
 * and `nodeRecord` convert.
 */
export interface RegionFloor {
  /** For each cell: 0 outside a floor chunk, else `FLOOR_CELL` and bits 0 to 6 of the stored head. */
  head: Uint8Array;
  /** For each floor cell: its first record. */
  layerStart: Uint32Array;
  /** For each record: the height of the layer, or the surface of the swim node, in world units. */
  height: Float32Array;
  /** For each record: walk links in bits 0 to 3 and drop links in bits 4 to 7, in the order of `SIDES`. */
  sides: Uint8Array;
  /** For each record: `NODE_WATER`, `NODE_FALL`, `NODE_HAZARD`, `NODE_SWIM`, `NODE_DESCENT`, and `NODE_BURIED`. */
  flags: Uint8Array;
  /** For each record: its cell. */
  cell: Uint32Array;
  /** The links of record `r` are `links[r]` to `links[r + 1]`: the walk links, the drop links, then the fall link. */
  links: Uint32Array;
  /** For each link: the target mask. Bit `k` is layer `k` of the target cell, and `SWIM` its swim node. */
  mask: Uint16Array;
  /** For each link: the drop height byte (see `dropByte`); 0 for a walk link. */
  drop: Uint8Array;
  /** The buildings, door references, and hints of each floor tile, by `tile.join()`. */
  tiles: Map<string, FloorRecords>;
}

export type FloorRecords = Pick<FloorTile, "tile" | "buildings" | "doorRefs" | "hints">;

/** The node of layer `k` of floor cell `i`, or of its swim node when `k` is the layer count. */
export function floorNode(region: Pick<TerrainRegion, "width" | "height">, floor: RegionFloor, i: number, k: number): number {
  return k === 0 && (floor.head[i] ?? 0) & HEAD_LAYERS ? i : region.width * region.height + (floor.layerStart[i] ?? 0) + k;
}

export function nodeRecord(region: Pick<TerrainRegion, "width" | "height">, floor: RegionFloor, node: number): number {
  const cells = region.width * region.height;
  return node < cells ? (floor.layerStart[node] ?? 0) : node - cells;
}

/** Under solid terrain, the lowest non-descent buried layer is the ground; the terrain is its roof. */
export function groundHeight(region: TerrainRegion, i: number): number {
  const { floor, elevation } = region;
  if (floor)
    for (let k = 0; k < ((floor.head[i] ?? 0) & HEAD_LAYERS); k++) {
      const r = floor.layerStart[i]! + k;
      if ((floor.flags[r]! & (NODE_BURIED | NODE_DESCENT)) === NODE_BURIED) return floor.height[r]!;
    }
  return elevation[i] ?? Number.NaN;
}

/**
 * Why a cell is not walkable ground. `no-terrain`: no loaded ground.
 * `hole`: a hole in the terrain. `hazard`: under magma, slime, or an unknown
 * liquid. `water`: under water. `steep`: steeper than the limit, by `slope`
 * degrees.
 */
export type GroundIssue = { kind: "no-terrain" | "hole" | "hazard" | "water" } | { kind: "steep"; slope: number };

/** Undefined when the cell is walkable ground. The route search can still cross a cell with an issue on a floor, by swimming, or by a downhill step. */
export function groundIssue(cells: TileCells, i: number, maxSlope: number): GroundIssue | undefined {
  if (!Number.isFinite(cells.elevation[i])) return { kind: "no-terrain" };
  if (cells.blocked[i] === HAZARD) return { kind: "hazard" };
  if (cells.blocked[i] !== 0) return { kind: "hole" };
  if (Number.isFinite(cells.water[i])) return { kind: "water" };
  const slope = cells.slope[i] ?? 90;
  return slope <= maxSlope ? undefined : { kind: "steep", slope };
}

/** The cell can be outside the region. */
export const nativeToCell = (region: Pick<TerrainRegion, "tile">, [x, y]: Point): CellPoint => [
  Math.floor(x / CELL_PIXELS) - region.tile[0] * CELLS,
  Math.floor(y / CELL_PIXELS) - region.tile[1] * CELLS,
];

/** The native pixel at the center of a region cell. */
export const cellToNative = (region: Pick<TerrainRegion, "tile">, [x, y]: CellPoint): Point => [
  (region.tile[0] * CELLS + x) * CELL_PIXELS + CELL_PIXELS / 2,
  (region.tile[1] * CELLS + y) * CELL_PIXELS + CELL_PIXELS / 2,
];

/** The prototype's `addTile`, then `applyWater`. */
function tileCells(tile: HeightTile): TileCells {
  const n = CELLS * CELLS;
  const cells = {
    elevation: new Float32Array(n),
    slope: new Float32Array(n),
    blocked: new Uint8Array(n),
    water: new Float32Array(n).fill(Number.NaN),
  };
  for (let row = 0; row < CELLS; row++)
    for (let col = 0; col < CELLS; col++) {
      const i = row * CELLS + col;
      // Only this tile's corners: column and row 128 are its own copy of the next tile's edge.
      const a = heightAt(tile, col, row),
        b = heightAt(tile, col + 1, row);
      const c = heightAt(tile, col, row + 1),
        d = heightAt(tile, col + 1, row + 1);
      cells.elevation[i] = (a + b + c + d) / 4;
      cells.slope[i] = (Math.atan(Math.max(Math.hypot(b - a, c - a), Math.hypot(d - c, d - b)) / CELL_SPACING) * 180) / Math.PI;
      cells.blocked[i] = tile.holes[i] ?? HOLE;
    }
  // A tile has at most one liquid for each chunk, so no surface replaces another.
  for (const { chunk, surface, mask, hazard } of tile.liquids)
    for (let bit = 0; bit < 64; bit++) {
      if (!((mask >> BigInt(bit)) & 1n)) continue;
      const i = (chunk[1] * 8 + (bit >> 3)) * CELLS + chunk[0] * 8 + (bit & 7);
      // The float32 elevation is compared with the float64 surface, as in the prototype.
      if (cells.blocked[i] !== 0 || !((cells.elevation[i] ?? Infinity) < surface)) continue;
      if (hazard === "water") cells.water[i] = surface;
      else cells.blocked[i] = HAZARD;
    }
  return cells;
}

interface TileFloor extends Omit<RegionFloor, "cell" | "tiles"> {
  chunks: Tile[];
  cell: Uint16Array;
  records: FloorRecords;
}

const links = (walk: number, drop: number, fall: boolean) => bitCount(walk) + bitCount(drop) + (fall ? 1 : 0);
const bitCount = (n: number) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1);

// The buried rule approximates the producer's lower terrain bound. The
// artifact omits the centre vertex of a cell, so a centre below all four
// corners can refuse a valid floor contact. Corner quantization can also move
// the bound. A buried layer is refused as a contact for terrain descent, not
// replaced by another layer; its stored links and stop snapping still use it.
function buried(tile: HeightTile, i: number, height8: number, climb8: number): boolean {
  if (tile.holes[i]) return false;
  const col = i % CELLS,
    row = Math.floor(i / CELLS);
  const low = Math.min(
    heightAt(tile, col, row),
    heightAt(tile, col + 1, row),
    heightAt(tile, col, row + 1),
    heightAt(tile, col + 1, row + 1),
  );
  return height8 < Math.round(low * 8) - climb8;
}

function tileFloor({ tile, chunks, buildings, doorRefs, hints }: FloorTile, heights: HeightTile, climb8: number): TileFloor {
  let records = 0,
    count = 0;
  for (const { cells } of chunks)
    for (const cell of cells) {
      records += cell.layers.length + (cell.surface === undefined ? 0 : 1);
      for (const l of cell.layers) count += links(l.walk, l.drop, l.fall);
    }
  const f: TileFloor = {
    chunks: chunks.map((c) => c.chunk),
    head: new Uint8Array(chunks.length * 64),
    layerStart: new Uint32Array(chunks.length * 64),
    height: new Float32Array(records),
    sides: new Uint8Array(records),
    flags: new Uint8Array(records),
    cell: new Uint16Array(records),
    links: new Uint32Array(records + 1),
    mask: new Uint16Array(count),
    drop: new Uint8Array(count),
    records: { tile, buildings, doorRefs, hints },
  };
  let r = 0,
    k = 0;
  for (const [n, { chunk, cells }] of chunks.entries())
    for (const [c, { layers, surface, building, hazard }] of cells.entries()) {
      const i = (chunk[1] * 8 + (c >> 3)) * CELLS + chunk[0] * 8 + (c & 7);
      f.head[n * 64 + c] =
        FLOOR_CELL | layers.length | (surface === undefined ? 0 : HEAD_SWIM) | (building ? HEAD_BUILDING : 0) | (hazard ? HEAD_HAZARD : 0);
      f.layerStart[n * 64 + c] = r;
      for (const l of layers) {
        f.height[r] = l.height / 8;
        f.sides[r] = l.walk | (l.drop << 4);
        f.flags[r] =
          (l.water ? NODE_WATER : 0) |
          (l.fall ? NODE_FALL : 0) |
          (l.hazard ? NODE_HAZARD : 0) |
          (l.descent ? NODE_DESCENT : buried(heights, i, l.height, climb8) ? NODE_BURIED : 0);
        f.cell[r] = i;
        f.links[r] = k;
        const walks = bitCount(l.walk);
        for (let j = 0; j < links(l.walk, l.drop, l.fall); j++, k++) {
          // Without masks, each link goes to layer 0 of its target cell.
          f.mask[k] = l.masks?.[j] ?? 1;
          f.drop[k] = j < walks ? 0 : (l.drops[j - walks] ?? 0);
        }
        r++;
      }
      if (surface === undefined) continue;
      f.height[r] = surface / 8;
      f.flags[r] = NODE_SWIM | (hazard ? NODE_HAZARD : 0);
      f.cell[r] = i;
      f.links[r] = k;
      r++;
    }
  f.links[records] = k;
  return f;
}

function regionFloor(width: number, height: number, cols: number, floors: (TileFloor | undefined)[]): RegionFloor | undefined {
  let records = 0,
    count = 0;
  for (const f of floors) {
    records += f?.height.length ?? 0;
    count += f?.mask.length ?? 0;
  }
  if (!floors.some(Boolean)) return undefined;
  const out: RegionFloor = {
    head: new Uint8Array(width * height),
    layerStart: new Uint32Array(width * height),
    height: new Float32Array(records),
    sides: new Uint8Array(records),
    flags: new Uint8Array(records),
    cell: new Uint32Array(records),
    links: new Uint32Array(records + 1),
    mask: new Uint16Array(count),
    drop: new Uint8Array(count),
    tiles: new Map(),
  };
  let r = 0,
    k = 0;
  for (const [t, f] of floors.entries()) {
    if (!f) continue;
    const x0 = (t % cols) * CELLS,
      y0 = Math.floor(t / cols) * CELLS;
    const at = (c: number) => (y0 + Math.floor(c / CELLS)) * width + x0 + (c % CELLS);
    for (const [n, [cx, cy]] of f.chunks.entries())
      for (let c = 0; c < 64; c++) {
        const i = at((cy * 8 + (c >> 3)) * CELLS + cx * 8 + (c & 7));
        out.head[i] = f.head[n * 64 + c] ?? 0;
        out.layerStart[i] = r + (f.layerStart[n * 64 + c] ?? 0);
      }
    out.height.set(f.height, r);
    out.sides.set(f.sides, r);
    out.flags.set(f.flags, r);
    for (let j = 0; j < f.height.length; j++) {
      out.cell[r + j] = at(f.cell[j] ?? 0);
      out.links[r + j] = k + (f.links[j] ?? 0);
    }
    out.mask.set(f.mask, k);
    out.drop.set(f.drop, k);
    out.tiles.set(f.records.tile.join(), f.records);
    r += f.height.length;
    k += f.mask.length;
  }
  out.links[records] = k;
  return out;
}

function linkFaults(region: TerrainRegion, floor: RegionFloor, cols: number, present: (t: number) => boolean): Map<number, string> {
  const { width, height } = region;
  const tileOf = (x: number, y: number) => Math.floor(y / CELLS) * cols + Math.floor(x / CELLS);
  const faults = new Map<number, string>();
  for (let r = 0; r < floor.height.length; r++) {
    const i = floor.cell[r] ?? 0,
      sides = floor.sides[r] ?? 0;
    const x = i % width,
      y = Math.floor(i / width);
    const localX = x % CELLS,
      localY = y % CELLS;
    if (localX > 0 && localX < CELLS - 1 && localY > 0 && localY < CELLS - 1) continue;
    let j = floor.links[r] ?? 0;
    for (let s = 0; s < 8; s++) {
      if (!(sides & (1 << s))) continue;
      const mask = floor.mask[j++] ?? 0;
      const [dx, dy] = SIDES[s % 4] ?? [0, 0];
      const tx = x + dx,
        ty = y + dy;
      const from = tileOf(x, y),
        to = tileOf(tx, ty);
      if (tx < 0 || ty < 0 || tx >= width || ty >= height || to === from || !present(to) || faults.has(from)) continue;
      const head = floor.head[ty * width + tx] ?? 0;
      const layers = head ? head & HEAD_LAYERS : 1;
      if (31 - Math.clz32(mask & ~SWIM) < layers && !(mask & SWIM && head && !(head & HEAD_SWIM))) continue;
      const tile: Tile = [region.tile[0] + Math.floor(x / CELLS), region.tile[1] + Math.floor(y / CELLS)];
      faults.set(
        from,
        `${floorPath(tile)}: the link from cell ${x % CELLS}, ${y % CELLS} names a layer or swim node that cell ${tx % CELLS}, ${ty % CELLS} of tile ${region.tile[0] + Math.floor(tx / CELLS)}_${region.tile[1] + Math.floor(ty / CELLS)} does not have`,
      );
    }
  }
  return faults;
}

type Loaded = { ok: true; cells: TileCells; floor?: TileFloor } | { ok: false; reason: string };

/** Whole tiles from `tile`, `cols` × `rows`. */
export interface TileBounds {
  tile: Tile;
  cols: number;
  rows: number;
}

/** Tiles stay in the terrain's `TileCache`, so a later region reads a cached tile again only after the cache drops it. */
export interface Terrain {
  /** The frame of the artifact that the terrain reads. The search resolves plan stops with it. */
  readonly frame: NativeFrame;
  bounds: (points: readonly Point[], margin: number) => TileBounds;
  /** A tile that fails to load or verify gives `missing-coverage`, and a later region reads it again. */
  region: (points: readonly Point[], margin: number) => Promise<TerrainRegion>;
  coarse?(): Promise<CoarseLayer | undefined>;
}

/**
 * The loaded tiles, in the order of last use, by artifact id and tile. A tile
 * load costs far more than a cache hit, mostly in `decodeFloor`. Past `keep`
 * tiles, a load drops the tile used longest ago. Terrains can share a cache,
 * so that `keep` limits the tiles of all of them.
 */
export interface TileCache {
  readonly keep: number;
  readonly tiles: Map<string, Promise<Loaded>>;
}

export function createTerrain(
  artifact: Pick<RoutingArtifact, "manifest" | "tile" | "read">,
  cache: TileCache = { keep: Infinity, tiles: new Map() },
): Terrain {
  const { id, frame, tiles, floorClimb } = artifact.manifest;
  const listed = new Map(tiles.map((t) => [t.tile.join(), t.state]));
  const load = (tile: Tile): Promise<Loaded> => {
    const key = `${id}/${tile.join()}`;
    const cached = cache.tiles.get(key);
    cache.tiles.delete(key);
    const entry =
      cached ??
      Promise.all([artifact.tile(tile), readFloor(artifact, tile)]).then(
        ([decoded, floor]): Loaded => ({
          ok: true,
          cells: tileCells(decoded),
          // A floor tile is a floor asset, so the manifest has `floorClimb`.
          ...(floor && { floor: tileFloor(floor, decoded, floorClimb! * 8) }),
        }),
        (error: unknown): Loaded => {
          if (cache.tiles.get(key) === entry) cache.tiles.delete(key);
          return { ok: false, reason: error instanceof Error ? error.message : String(error) };
        },
      );
    cache.tiles.set(key, entry);
    for (const old of cache.tiles.keys()) {
      if (cache.tiles.size <= cache.keep) break;
      cache.tiles.delete(old);
    }
    return entry;
  };

  const bounds = (points: readonly Point[], margin: number): TileBounds => {
    if (!points.length || !(margin >= 0)) throw new RangeError("A region needs at least one point and a margin of at least 0");
    const tileOf = (pixel: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(pixel / TILE_PIXELS)));
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    const x0 = tileOf(Math.min(...xs) - margin, frame.size[0]),
      x1 = tileOf(Math.max(...xs) + margin, frame.size[0]);
    const y0 = tileOf(Math.min(...ys) - margin, frame.size[1]),
      y1 = tileOf(Math.max(...ys) + margin, frame.size[1]);
    return { tile: [x0, y0], cols: x1 - x0 + 1, rows: y1 - y0 + 1 };
  };

  let coarse: Promise<CoarseLayer | undefined> | undefined;
  return {
    frame: artifact.manifest,
    bounds,
    coarse: () => (coarse ??= loadCoarse(artifact)),
    async region(points, margin) {
      const {
        tile: [x0, y0],
        cols,
        rows,
      } = bounds(points, margin);
      const width = cols * CELLS,
        height = rows * CELLS;
      const coverage = new Uint8Array(cols * rows).fill(2);
      const floors: (TileFloor | undefined)[] = [];
      const region: TerrainRegion = {
        tile: [x0, y0],
        width,
        height,
        spacing: CELL_SPACING,
        elevation: new Float32Array(width * height).fill(Number.NaN),
        slope: new Float32Array(width * height).fill(90),
        blocked: new Uint8Array(width * height).fill(HOLE),
        water: new Float32Array(width * height).fill(Number.NaN),
        failed: [],
        coverage: ([x, y]) => {
          if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) return undefined;
          return COVERAGES[coverage[Math.floor(y / CELLS) * cols + Math.floor(x / CELLS)] ?? 2];
        },
      };
      await Promise.all(
        Array.from({ length: cols * rows }, async (_, t) => {
          const tile: Tile = [x0 + (t % cols), y0 + Math.floor(t / cols)];
          const state = listed.get(tile.join());
          if (!state) return;
          coverage[t] = 1;
          if (state === "missing") return;
          const loaded = await load(tile);
          if (!loaded.ok) {
            region.failed.push({ tile, reason: loaded.reason });
            return;
          }
          coverage[t] = 0;
          const { cells } = loaded;
          floors[t] = loaded.floor;
          for (let row = 0; row < CELLS; row++) {
            const from = row * CELLS,
              to = (Math.floor(t / cols) * CELLS + row) * width + (t % cols) * CELLS;
            region.elevation.set(cells.elevation.subarray(from, from + CELLS), to);
            region.slope.set(cells.slope.subarray(from, from + CELLS), to);
            region.blocked.set(cells.blocked.subarray(from, from + CELLS), to);
            region.water.set(cells.water.subarray(from, from + CELLS), to);
          }
        }),
      );
      let floor = regionFloor(width, height, cols, floors);
      const faults = floor ? linkFaults(region, floor, cols, (t) => coverage[t] === 0) : new Map<number, string>();
      for (const [t, reason] of faults) {
        coverage[t] = 1;
        floors[t] = undefined;
        region.failed.push({ tile: [x0 + (t % cols), y0 + Math.floor(t / cols)], reason });
        for (let row = 0; row < CELLS; row++) {
          const from = (Math.floor(t / cols) * CELLS + row) * width + (t % cols) * CELLS;
          region.elevation.fill(Number.NaN, from, from + CELLS);
          region.slope.fill(90, from, from + CELLS);
          region.blocked.fill(HOLE, from, from + CELLS);
          region.water.fill(Number.NaN, from, from + CELLS);
        }
      }
      if (faults.size) floor = regionFloor(width, height, cols, floors);
      if (floor) region.floor = floor;
      region.failed.sort((a, b) => a.tile[1] - b.tile[1] || a.tile[0] - b.tile[0]);
      return region;
    },
  };
}
