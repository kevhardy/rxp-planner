import type { Point } from "./frame.ts";
import { CELLS, TILE_PIXELS, TILE_WORLD_UNITS, type Tile } from "./artifact.ts";
import type { Building, FloorPoint } from "./floor.ts";
import { HEAD_BUILDING, STOREY, cellToNative, nativeToCell, type CellPoint, type FloorRecords, type TerrainRegion } from "./terrain.ts";

const FLOOR_UNITS_PER_PIXEL = 16;
const MATCH_PIXELS = 3;
const YARDS_PER_FLOOR_UNIT = TILE_WORLD_UNITS / TILE_PIXELS / FLOOR_UNITS_PER_PIXEL;

export type StopClass = "target" | "building" | "hint" | "ground";

/** A building record of a region, with its home tile and its index in that tile. */
export interface PlacedBuilding {
  home: Tile;
  index: number;
  record: Building;
}

/**
 * The class of a stop, first match first:
 *
 * - `target`: within `MATCH_PIXELS` of a target of a building in the stop
 *   tile or its 8 side tiles. The nearest target wins, then the lowest home
 *   tile y, x, building index, and target index. Targets are sorted by floor,
 *   so of colocated targets the lowest known floor wins.
 * - `building`: the stop cell has `HEAD_BUILDING`. The building is the one
 *   whose footprint box holds the stop (else the stop cell centre), the
 *   smallest box first, then the lowest index.
 * - `hint`: within `MATCH_PIXELS` of an endpoint hint; `height` is its z in
 *   yards. `ambiguous` when another hint within reach is a storey or more from it.
 * - `ground`: any other stop.
 *
 * With a requested height `asked` in yards, a building matches only when one of
 * its floors is within a storey of it, and a target of kind 0 only when its
 * floor is. So a stop in a cave under a building, or on a floor above a
 * colocated target, keeps its height.
 */
export type Stop =
  | { class: "target"; building: PlacedBuilding; target: number }
  | { class: "building"; building: PlacedBuilding }
  | { class: "hint"; height: number; ambiguous?: true }
  | { class: "ground" };

export function regionBuildings(region: Pick<TerrainRegion, "floor">): PlacedBuilding[] {
  const out: PlacedBuilding[] = [];
  for (const { tile, buildings } of region.floor?.tiles.values() ?? [])
    for (const [index, record] of buildings.entries()) out.push({ home: tile, index, record });
  return out;
}

/** The cell of `point` must be in `region`. */
export function classifyStop(region: TerrainRegion, point: Point, asked?: number): Stop {
  const floor = region.floor;
  if (!floor) return { class: "ground" };
  const [tx, ty] = [Math.floor(point[0] / TILE_PIXELS), Math.floor(point[1] / TILE_PIXELS)];
  const near: FloorRecords[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const records = floor.tiles.get(`${tx + dx},${ty + dy}`);
      if (records) near.push(records);
    }
  const local = (home: Tile, at = point): Point => [
    (at[0] - home[0] * TILE_PIXELS) * FLOOR_UNITS_PER_PIXEL,
    (at[1] - home[1] * TILE_PIXELS) * FLOOR_UNITS_PER_PIXEL,
  ];
  const reach = (MATCH_PIXELS * FLOOR_UNITS_PER_PIXEL) ** 2;
  const onFloor = (z: number | undefined) => asked === undefined || z === undefined || Math.abs(z / 8 - asked) < STOREY;

  let target: { distance: number; building: PlacedBuilding; target: number } | undefined;
  for (const { tile, buildings } of near) {
    const [x, y] = local(tile);
    for (const [index, record] of buildings.entries())
      for (const [t, { point: at, floor: f, kind }] of record.targets.entries()) {
        const distance = (at[0] - x) ** 2 + (at[1] - y) ** 2;
        if (distance <= reach && (!target || distance < target.distance) && (kind === 1 || onFloor(record.floors[f])))
          target = { distance, building: { home: tile, index, record }, target: t };
      }
  }
  if (target) return { class: "target", building: target.building, target: target.target };

  const cell = nativeToCell(region, point);
  if ((floor.head[cell[1] * region.width + cell[0]] ?? 0) & HEAD_BUILDING) {
    const centre = cellToNative(region, cell);
    for (const at of [point, centre]) {
      let found: { area: number; building: PlacedBuilding } | undefined;
      for (const { tile, buildings } of near) {
        const [x, y] = local(tile, at);
        for (const [index, record] of buildings.entries()) {
          const [x0, y0, x1, y1] = record.box;
          const area = (x1 - x0) * (y1 - y0);
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && (!found || area < found.area) && record.floors.some(onFloor))
            found = { area, building: { home: tile, index, record } };
        }
      }
      if (found) return { class: "building", building: found.building };
    }
  }

  let hint: { distance: number; height: number } | undefined;
  const heights: number[] = [];
  for (const { tile, hints } of near) {
    const [x, y] = local(tile);
    for (const [hx, hy, hz] of hints) {
      const distance = (hx - x) ** 2 + (hy - y) ** 2;
      if (distance > reach) continue;
      heights.push(hz / 8);
      if (!hint || distance < hint.distance) hint = { distance, height: hz / 8 };
    }
  }
  if (!hint) return { class: "ground" };
  const { height } = hint;
  return { class: "hint", height, ...(heights.some((h) => Math.abs(h - height) >= STOREY) && { ambiguous: true }) };
}

export const sameBuilding = (a: PlacedBuilding, b: PlacedBuilding) => a.home.join() === b.home.join() && a.index === b.index;

/** The attach cell of door `door`, in region cells. It can be outside the region. */
export function attachCell(region: Pick<TerrainRegion, "tile">, { home, record }: PlacedBuilding, door: number): CellPoint {
  const { tile, cell } = record.doors[door]!;
  return [
    (home[0] + tile[0] - region.tile[0]) * CELLS + (cell % CELLS),
    (home[1] + tile[1] - region.tile[1]) * CELLS + Math.floor(cell / CELLS),
  ];
}

const doorPath = (b: Building, door: number, target: number): FloorPoint[] => b.paths[door * b.targets.length + target] ?? [];

/** Needs `i` ≠ `j`. Empty when the pair is not eligible. */
export function pairPath(b: Building, i: number, j: number): FloorPoint[] {
  const [a, c] = i < j ? [i, j] : [j, i];
  const n = b.targets.length;
  const path = b.paths[b.doors.length * n + a * (n - 1) - (a * (a - 1)) / 2 + c - a - 1] ?? [];
  return i < j ? path : path.toReversed();
}

/** Needs `i` < `j`. */
export function doorsPath(b: Building, i: number, j: number): FloorPoint[] {
  const n = b.doors.length,
    t = b.targets.length;
  return b.paths[n * t + (t * (t - 1)) / 2 + i * (n - 1) - (i * (i - 1)) / 2 + j - i - 1] ?? [];
}

/** The 3D length of a stored path, in yards. */
export function pathLength(path: readonly FloorPoint[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay, az] = path[i - 1]!,
      [bx, by, bz] = path[i]!;
    length += Math.hypot((bx - ax) * YARDS_PER_FLOOR_UNIT, (by - ay) * YARDS_PER_FLOOR_UNIT, (bz - az) / 8);
  }
  return length;
}

/** The 2D points of a stored path of a building in tile `home`, in native pixels. */
export const pathLine = (home: Tile, path: readonly FloorPoint[]): Point[] =>
  path.map(([x, y]) => [home[0] * TILE_PIXELS + x / FLOOR_UNITS_PER_PIXEL, home[1] * TILE_PIXELS + y / FLOOR_UNITS_PER_PIXEL]);

/**
 * The doors where a route meets a stop in a building, each with the stored
 * path from the door to the stop. An empty path means that the route ends at
 * the door.
 */
export function stopDoors(stop: Extract<Stop, { building: PlacedBuilding }>): { door: number; path: FloorPoint[] }[] {
  const { record } = stop.building;
  if (stop.class === "building") return record.doors.map((_, door) => ({ door, path: [] }));
  const all = record.doors.map((_, door) => ({ door, path: doorPath(record, door, stop.target) }));
  return all.some(({ path }) => path.length) ? all.filter(({ path }) => path.length) : all;
}
