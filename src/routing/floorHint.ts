// RXP gives a guide point as x and y only, because the addon cannot read the player's height. So in a building or a city
// with stacked floors, a player can look for an NPC on the wrong floor.

import type { Point } from "./frame.ts";
import { classifyStop } from "./indoor.ts";
import { HEAD_LAYERS, NODE_BURIED, NODE_DESCENT, STOREY, groundHeight, nativeToCell, type TerrainRegion } from "./terrain.ts";

/**
 * `floors` are heights in yards from the ground floor, ascending. In a building, the ground floor is the producer's: the
 * floor at the doors. It can be above other floors, as in Anvilmar. Elsewhere it is the layer of the cell nearest the
 * terrain height, or the lowest layer under solid terrain.
 *
 * - `single`: one walkable floor, or none.
 * - `stacked`: several floors, and nothing tells which one holds the point.
 * - `known`: several floors, and the producer matched the point to `floors[floor]`.
 */
export type FloorHint = { kind: "single" } | { kind: "stacked"; floors: number[] } | { kind: "known"; floors: number[]; floor: number };

const tenth = (yards: number) => Math.round(yards * 10) / 10;
const snapFloor = (heights: readonly number[], to: number) =>
  heights.reduce((best, h, k) => (Math.abs(h - to) < Math.abs(heights[best]! - to) ? k : best), 0);

interface WalkableLayer {
  height: number;
  buried: boolean;
}

function walkableLayers(region: TerrainRegion, point: Point): WalkableLayer[] {
  const floor = region.floor!;
  const [x, y] = nativeToCell(region, point);
  const i = y * region.width + x;
  const out: WalkableLayer[] = [];
  for (let k = 0; k < ((floor.head[i] ?? 0) & HEAD_LAYERS); k++) {
    const r = floor.layerStart[i]! + k;
    const height = floor.height[r]!,
      last = out.at(-1);
    if (!(floor.flags[r]! & NODE_DESCENT) && (!last || height - last.height >= STOREY))
      out.push({ height, buried: !!(floor.flags[r]! & NODE_BURIED) });
  }
  return out;
}

/** The region must hold the tiles around the tile of `point`: `terrain.region([point], TILE_PIXELS)`. */
export function floorHint(region: TerrainRegion, point: Point): FloorHint {
  const stop = classifyStop(region, point);
  if (stop.class === "target" || stop.class === "building") {
    const { floors, ground, targets } = stop.building.record;
    if (floors.length < 2) return { kind: "single" };
    const heights = floors.map((h) => tenth((h - floors[ground]!) / 8));
    const target = stop.class === "target" ? targets[stop.target]! : undefined;
    return target?.kind === 0 ? { kind: "known", floors: heights, floor: target.floor } : { kind: "stacked", floors: heights };
  }
  if (!region.floor) return { kind: "single" };
  const walkable = walkableLayers(region, point);
  const underRoof = walkable.filter((l) => l.buried);
  const layers = underRoof.length ? underRoof : walkable;
  if (layers.length < 2) return { kind: "single" };
  const [x, y] = nativeToCell(region, point);
  const heights = layers.map((l) => l.height);
  const ground = heights[snapFloor(heights, groundHeight(region, y * region.width + x))]!;
  const floors = heights.map((h) => tenth(h - ground));
  return stop.class === "hint" ? { kind: "known", floors, floor: snapFloor(heights, stop.height) } : { kind: "stacked", floors };
}

/** The note for a guide step, or undefined for a single floor. */
export function floorHintText(hint: FloorHint): string | undefined {
  if (hint.kind === "single") return undefined;
  const floors = `Floors: ${hint.floors.join(", ")} yd from the ground floor.`;
  if (hint.kind === "stacked") {
    const up = hint.floors.some((h) => h > 0),
      down = hint.floors.some((h) => h < 0);
    return `Stacked floors here: the NPC may be ${up && down ? "upstairs or downstairs" : up ? "upstairs" : "downstairs"}. ${floors}`;
  }
  const h = hint.floors[hint.floor]!;
  return `The NPC is ${h > 0 ? `upstairs, ${h} yd up` : h < 0 ? `downstairs, ${-h} yd down` : "on the ground floor"}. ${floors}`;
}
