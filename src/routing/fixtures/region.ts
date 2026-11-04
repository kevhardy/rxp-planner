import { nativeToWorld, type NativeFrame, type Point } from "../frame.ts";
import type { Tile } from "../artifact.ts";
import { dropByte, type FloorTile } from "../floor.ts";
import {
  FLOOR_CELL,
  HEAD_BUILDING,
  HEAD_HAZARD,
  HEAD_SWIM,
  NODE_BURIED,
  NODE_DESCENT,
  NODE_FALL,
  NODE_HAZARD,
  NODE_SWIM,
  NODE_WATER,
  type CellPoint,
  type FloorRecords,
  type Terrain,
  type TerrainRegion,
} from "../terrain.ts";
import { withHeight, type WorldStop } from "../plan.ts";

/** Map `map` from tile [0, 0], 64 by 64 tiles, so a region at tile [0, 0] has the native pixels of this frame. */
export const testFrame = (map: number): NativeFrame => ({
  scope: { map },
  frame: { origin: [0, 0], size: [64, 64], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
});
export const TEST_FRAME = testFrame(0);
/** The stop at native pixel `p` of `frame`. The engine resolves it back to `p`. */
export const at = (p: Point, height: number | null = null, frame: NativeFrame = TEST_FRAME): WorldStop =>
  withHeight(nativeToWorld(frame, p), height);

/** A flat region of present cells at tile [0, 0] that is the whole frame. */
export function flat(width: number, height: number, spacing = 7): TerrainRegion {
  const n = width * height;
  return {
    tile: [0, 0],
    width,
    height,
    spacing,
    elevation: new Float32Array(n),
    slope: new Float32Array(n),
    blocked: new Uint8Array(n),
    water: new Float32Array(n).fill(Number.NaN),
    failed: [],
    coverage: ([x, y]) => (x >= 0 && y >= 0 && x < width && y < height ? "present" : undefined),
  };
}
/** Blocks the square ring of cells at `radius` around `centre`, which closes the cells inside it. */
export function blockRing(region: TerrainRegion, [cx, cy]: CellPoint, radius: number): TerrainRegion {
  for (let y = cy - radius; y <= cy + radius; y++)
    for (let x = cx - radius; x <= cx + radius; x++)
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) === radius) region.blocked[y * region.width + x] = 1;
  return region;
}
/** Terrain that gives `region` for every request. */
export const whole = (region: TerrainRegion, frame: NativeFrame = TEST_FRAME): Terrain => ({
  frame,
  bounds: () => ({ tile: [0, 0], cols: 1, rows: 1 }),
  region: async () => region,
});
/** Native pixels of a cell's centre in a region at tile [0, 0]. A ground stop there snaps only to its own cell in 7-unit cells. */
export const native = ([x, y]: CellPoint): Point => [x * 4 + 2, y * 4 + 2];

/** Heights and drops are in yards. */
export interface LayerSpec {
  height: number;
  walk?: number;
  drop?: number;
  fall?: boolean;
  water?: boolean;
  hazard?: boolean;
  /** A descent layer: give it no links, and no other layer in its cell. */
  descent?: boolean;
  buried?: boolean;
  /** One for each walk bit, drop bit, then the fall link; layer 0 by default. */
  masks?: number[];
  /** One for each drop bit, then the fall link. */
  drops?: number[];
}
export interface CellSpec {
  layers?: LayerSpec[];
  /** The surface of the swim node; absent without one. */
  surface?: number;
  hazard?: boolean;
  building?: boolean;
}
export const W = 1,
  S = 2,
  E = 4,
  N = 8;
const bits = (n: number) => [0, 1, 2, 3].filter((b) => n & (1 << b)).length;

/** The records of floor tile `tile`, with none by default. */
export const records = (tile: Tile, values: Partial<Omit<FloorTile, "tile" | "chunks">> = {}): FloorRecords => ({
  tile,
  buildings: [],
  doorRefs: [],
  hints: [],
  ...values,
});

/** Gives `region` the floor cells `cells`, keyed by cell index, and the records of its floor tiles. */
export function withFloor(region: TerrainRegion, cells: Record<number, CellSpec>, tiles: FloorRecords[] = []): TerrainRegion {
  const n = region.width * region.height;
  const head = new Uint8Array(n),
    layerStart = new Uint32Array(n);
  const nodes: { height: number; sides: number; flags: number; cell: number; masks: number[]; drops: number[] }[] = [];
  for (const [key, { layers = [], surface, hazard = false, building = false }] of Object.entries(cells)) {
    const i = Number(key);
    head[i] = FLOOR_CELL | layers.length | (surface === undefined ? 0 : HEAD_SWIM) | (hazard ? HEAD_HAZARD : 0) | (building ? HEAD_BUILDING : 0);
    layerStart[i] = nodes.length;
    for (const { height, walk = 0, drop = 0, fall = false, water = false, hazard = false, descent = false, buried = false, masks, drops = [] } of layers)
      nodes.push({
        height,
        sides: walk | (drop << 4),
        flags: (water ? NODE_WATER : 0) | (fall ? NODE_FALL : 0) | (hazard ? NODE_HAZARD : 0) | (descent ? NODE_DESCENT : 0) | (buried ? NODE_BURIED : 0),
        cell: i,
        masks: masks ?? Array.from({ length: bits(walk) + bits(drop) + Number(fall) }, () => 1),
        drops: [...Array.from({ length: bits(walk) }, () => 0), ...drops.map((yd) => dropByte(yd * 8))],
      });
    if (surface !== undefined)
      nodes.push({ height: surface, sides: 0, flags: NODE_SWIM | (hazard ? NODE_HAZARD : 0), cell: i, masks: [], drops: [] });
  }
  const links = new Uint32Array(nodes.length + 1);
  nodes.forEach((r, j) => (links[j + 1] = (links[j] ?? 0) + r.masks.length));
  region.floor = {
    head,
    layerStart,
    height: Float32Array.from(nodes, (r) => r.height),
    sides: Uint8Array.from(nodes, (r) => r.sides),
    flags: Uint8Array.from(nodes, (r) => r.flags),
    cell: Uint32Array.from(nodes, (r) => r.cell),
    links,
    mask: Uint16Array.from(nodes.flatMap((r) => r.masks)),
    drop: Uint8Array.from(nodes.flatMap((r) => r.drops)),
    tiles: new Map(tiles.map((t) => [t.tile.join(), t])),
  };
  return region;
}
