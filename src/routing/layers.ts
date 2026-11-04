import { CELLS, TILE_PIXELS, type Tile } from "./artifact.ts";
import { attachCell, regionBuildings } from "./indoor.ts";
import { withHomes } from "./search.ts";
import {
  HAZARD,
  HEAD_BUILDING,
  HEAD_HAZARD,
  HEAD_LAYERS,
  HEAD_SWIM,
  NODE_DESCENT,
  NODE_HAZARD,
  groundIssue,
  type Terrain,
  type TerrainRegion,
} from "./terrain.ts";

/** An RGBA color, each part 0 to 255. */
export type Rgba = readonly [number, number, number, number];
/** `colors[k]` is the color of class `k + 1`. Class 0 draws nothing. */
export interface LayerStyle {
  classes: readonly string[];
  colors?: readonly Rgba[];
}

/** A `shading` class is a gray level from 1 to 255. */
export const ROUTER_LAYERS = {
  shading: { classes: ["none", ...Array.from({ length: 255 }, (_, k) => `gray ${k + 1}`)] },
  steep: { classes: ["none", "too steep"], colors: [[220, 30, 30, 150]] },
  water: {
    classes: ["none", "water", "hazard"],
    colors: [
      [30, 110, 240, 150],
      [255, 110, 0, 200],
    ],
  },
  floors: {
    classes: ["none", "one layer", "two or more layers", "no walkable layer", "descent"],
    colors: [
      [40, 200, 90, 130],
      [170, 70, 235, 180],
      [120, 65, 20, 220],
      [250, 200, 0, 180],
    ],
  },
  buildings: {
    classes: ["none", "building", "door"],
    colors: [
      [245, 245, 245, 140],
      [255, 0, 200, 255],
    ],
  },
  reachable: { classes: ["none", "reachable"], colors: [[0, 230, 230, 110]] },
  explored: { classes: ["none", "expanded"], colors: [[255, 120, 180, 140]] },
} as const satisfies Record<string, LayerStyle>;
export type RouterLayer = keyof typeof ROUTER_LAYERS;
export type SearchLayer = "reachable" | "explored";
export type TerrainLayer = Exclude<RouterLayer, SearchLayer>;
export const isSearchLayer = (layer: RouterLayer): layer is SearchLayer => layer === "reachable" || layer === "explored";

/** Region y grows to the south. */
const NORTH_WEST_LIGHT = { x: -0.5, y: -0.5, z: Math.SQRT1_2 };

function cellRules(region: TerrainRegion, maxSlope: number): Record<TerrainLayer, (i: number) => number> {
  const { width, height, elevation, spacing, blocked, water, floor } = region;
  const head = (i: number) => floor?.head[i] ?? 0;
  const layers = (i: number) => head(i) & HEAD_LAYERS;
  const flags = (i: number, k: number) => floor?.flags[(floor.layerStart[i] ?? 0) + k] ?? 0;
  const descent = (i: number) => layers(i) === 1 && (flags(i, 0) & NODE_DESCENT) !== 0;
  return {
    shading: (i) => {
      const z = elevation[i] ?? Number.NaN;
      if (!Number.isFinite(z)) return 0;
      const x = i % width,
        y = Math.floor(i / width);
      const near = (dx: number, dy: number) => {
        const inside = x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height;
        const v = inside ? elevation[i + dy * width + dx] : undefined;
        return v !== undefined && Number.isFinite(v) ? v : undefined;
      };
      const rise = (dx: number, dy: number) => {
        const ahead = near(dx, dy),
          behind = near(-dx, -dy);
        const n = Number(ahead !== undefined) + Number(behind !== undefined);
        return n ? ((ahead ?? z) - (behind ?? z)) / (n * spacing) : 0;
      };
      const dzdx = rise(1, 0),
        dzdy = rise(0, 1);
      const lit = (-dzdx * NORTH_WEST_LIGHT.x - dzdy * NORTH_WEST_LIGHT.y + NORTH_WEST_LIGHT.z) / Math.hypot(dzdx, dzdy, 1);
      return 1 + Math.round(Math.min(1, Math.max(0, lit)) * 254);
    },
    steep: (i) => (head(i) ? Number(descent(i)) : Number(groundIssue(region, i, maxSlope)?.kind === "steep")),
    water: (i) => {
      const h = head(i);
      if (!h) return blocked[i] === HAZARD ? 2 : Number.isFinite(water[i]) ? 1 : 0;
      if (h & HEAD_HAZARD) return 2;
      for (let k = 0; k < layers(i); k++) if (flags(i, k) & NODE_HAZARD) return 2;
      return h & HEAD_SWIM ? 1 : 0;
    },
    floors: (i) => {
      if (!head(i)) return 0;
      if (descent(i)) return 4;
      const n = layers(i);
      return n === 0 ? 3 : n === 1 ? 1 : 2;
    },
    buildings: (i) => (head(i) & HEAD_BUILDING ? 1 : 0),
  };
}

/**
 * The side of a layer's tile image, in cells. Two images that only meet at an
 * edge each blend that edge with the map's background, which shows as a line.
 * So a shading image also holds the first column and row of the tiles east
 * and south of it, and covers the edges that it shares with them.
 */
export const layerCells = (layer: RouterLayer): number => (layer === "shading" ? CELLS + 1 : CELLS);

/**
 * Loads the tile as the search does, with the buildings of each home tile that
 * their doors name. Shading also loads the 8 tiles around it, for the heights
 * next to the tile's edges.
 */
export async function layerTile(terrain: Terrain, tile: Tile, layer: TerrainLayer, maxSlope: number): Promise<Uint8Array> {
  const centre: [number, number] = [(tile[0] + 0.5) * TILE_PIXELS, (tile[1] + 0.5) * TILE_PIXELS];
  const region = await withHomes(terrain, await terrain.region([centre], layer === "shading" ? TILE_PIXELS : 0));
  return cellClasses(region, tile, layer, maxSlope);
}

/**
 * The class of each cell of tile `tile` of `region`, `layerCells(layer)` square
 * row by row, in layer `layer` with the walkable slope `maxSlope`. A cell
 * outside the region has class 0.
 */
export function cellClasses(region: TerrainRegion, tile: Tile, layer: TerrainLayer, maxSlope: number): Uint8Array {
  const x0 = (tile[0] - region.tile[0]) * CELLS,
    y0 = (tile[1] - region.tile[1]) * CELLS;
  const rule = cellRules(region, maxSlope)[layer];
  const n = layerCells(layer);
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (x0 + x < region.width && y0 + y < region.height) out[y * n + x] = rule((y0 + y) * region.width + x0 + x);
  if (layer === "buildings") markDoors(region, x0, y0, out);
  return out;
}

function markDoors(region: TerrainRegion, x0: number, y0: number, out: Uint8Array): void {
  for (const building of regionBuildings(region))
    for (const door of building.record.doors.keys()) {
      const [cx, cy] = attachCell(region, building, door);
      for (let y = cy - y0 - 1; y <= cy - y0 + 1; y++)
        for (let x = cx - x0 - 1; x <= cx - x0 + 1; x++) if (x >= 0 && y >= 0 && x < CELLS && y < CELLS) out[y * CELLS + x] = 2;
    }
}

/** The RGBA pixels of `classes`, one pixel for each cell, in the colors of `layer`. */
export function classColors(classes: Uint8Array, layer: RouterLayer): Uint8ClampedArray<ArrayBuffer> {
  const style: LayerStyle = ROUTER_LAYERS[layer];
  const rgba = new Uint8ClampedArray(classes.length * 4);
  for (const [i, c] of classes.entries()) if (c) rgba.set(style.colors?.[c - 1] ?? [c, c, c, 255], i * 4);
  return rgba;
}
