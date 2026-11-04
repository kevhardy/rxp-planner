// The zone grid gives the zone UiMap under each chunk of 32 × 32 native
// pixels, as `/way` names it. The producer rolls subzones up to their zone.
// An indoor city takes the zone of the ground above it. Distant open sea, Gilneas,
// Gillijim's Isle, GM Island, and the Gates of Ahn'Qiraj have no zone.

import { CHUNKS, decodeZones, ZONES_PATH, type ArtifactManifest, type HeightTile, type RoutingArtifact, type Tile } from "./artifact.ts";
import type { UiMapId } from "../data/index.ts";
import type { NativeFrame, NativePosition, Point } from "./frame.ts";

const SIDE = Math.sqrt(CHUNKS);

/** The LiquidType of the open sea in the pinned dataset release. Lakes and rivers have other types. */
export const OCEAN = 1250;

const HALF_CHUNK = 32;

const REACH = 3;

/** One map's zone grid, on the native frame of its artifact. */
export interface ZoneGrid extends NativeFrame {
  /** The UiMap ID of each zone index; index 0 is 0, no zone. */
  zones: readonly UiMapId[];
  /** The 256 zone indexes of each tile of the frame, row by row; undefined for a tile that is not present. */
  tiles: readonly (Uint8Array | undefined)[];
  /** Reads a tile for the ocean under the borders. `loadZoneGrid` sets it. */
  read?: RoutingArtifact["tile"];
}

/** The grid of `zones.bin`, which `decodeZones` checks against the manifest. */
export function zoneGrid(manifest: Pick<ArtifactManifest, "scope" | "frame" | "tiles" | "zones">, bytes: Uint8Array): ZoneGrid {
  const present = manifest.tiles.filter((t) => t.state === "present");
  const blocks = decodeZones(bytes, present.length, manifest.zones.length);
  const [width, height] = manifest.frame.size;
  const tiles = Array.from<Uint8Array | undefined>({ length: width * height });
  for (const [i, { tile }] of present.entries()) tiles[tile[1] * width + tile[0]] = blocks[i];
  return { scope: manifest.scope, frame: manifest.frame, zones: [0, ...manifest.zones], tiles };
}

/** The zone grid of an opened artifact, which reads its tiles. */
export async function loadZoneGrid(artifact: RoutingArtifact): Promise<ZoneGrid> {
  return { ...zoneGrid(artifact.manifest, await artifact.read(ZONES_PATH)), read: artifact.tile };
}

/** The zone UiMap ID at a native position: 0 for no zone, undefined outside the frame or on a tile that is not present. */
export function gridZone(grid: ZoneGrid, [x, y]: NativePosition): UiMapId | undefined {
  const pixels = grid.frame.tilePixels / SIDE;
  const index = chunkIndex(grid, Math.floor(x / pixels), Math.floor(y / pixels));
  return index === undefined ? undefined : grid.zones[index];
}

function chunkIndex(grid: ZoneGrid, cx: number, cy: number): number | undefined {
  const [width, height] = grid.frame.size;
  if (cx < 0 || cy < 0 || cx >= width * SIDE || cy >= height * SIDE) return undefined;
  return grid.tiles[Math.floor(cy / SIDE) * width + Math.floor(cx / SIDE)]?.[(cy % SIDE) * SIDE + (cx % SIDE)];
}

/** Whether chunk (cx, cy) of the frame is open sea. */
export type Ocean = (cx: number, cy: number) => boolean;

/** A straight border, from one native pixel to another. */
export type Border = [Point, Point];

function zoneEdges(grid: ZoneGrid, edge: (ax: number, ay: number, bx: number, by: number) => void) {
  const [width, height] = grid.frame.size.map((tiles) => tiles * SIDE) as [number, number];
  const differ = (ax: number, ay: number, bx: number, by: number) => {
    const a = chunkIndex(grid, ax, ay);
    const b = chunkIndex(grid, bx, by);
    if (a && b && a !== b) edge(ax, ay, bx, by);
  };
  for (let cy = 1; cy < height; cy++) for (let cx = 0; cx < width; cx++) differ(cx, cy - 1, cx, cy);
  for (let cx = 1; cx < width; cx++) for (let cy = 0; cy < height; cy++) differ(cx - 1, cy, cx, cy);
}

/**
 * An edge between two nonzero zones is a border when each zone has land
 * within `REACH` chunks of it. So a border crosses a river, a lake, or a
 * narrow inlet, but not the open sea, which the producer gives to the nearest
 * zone. Touching borders on one line join.
 */
export function zoneBorders(grid: ZoneGrid, ocean: Ocean = () => false): Border[] {
  const pixels = grid.frame.tilePixels / SIDE;
  const bothLand = (a: number, b: number, x0: number, y0: number, x1: number, y1: number) => {
    let landA = false;
    let landB = false;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const zone = chunkIndex(grid, x, y);
        if ((zone !== a && zone !== b) || ocean(x, y)) continue;
        if (zone === a) landA = true;
        else landB = true;
        if (landA && landB) return true;
      }
    return false;
  };
  const runs: { line: string; at: number; from: Point; to: Point }[] = [];
  zoneEdges(grid, (ax, ay, bx, by) => {
    if (!bothLand(chunkIndex(grid, ax, ay)!, chunkIndex(grid, bx, by)!, ax - REACH, ay - REACH, bx + REACH, by + REACH)) return;
    const west = ay === by;
    const from: Point = [bx * pixels, by * pixels];
    const to: Point = west ? [bx * pixels, (by + 1) * pixels] : [(bx + 1) * pixels, by * pixels];
    runs.push({ line: west ? `x${bx}` : `y${by}`, at: west ? by : bx, from, to });
  });
  const borders: Border[] = [];
  for (const [i, run] of runs.entries()) {
    const last = runs[i - 1];
    if (last && last.line === run.line && last.at + 1 === run.at) borders.at(-1)![1] = run.to;
    else borders.push([run.from, run.to]);
  }
  return borders;
}

function borderTiles(grid: ZoneGrid): Tile[] {
  const [width] = grid.frame.size;
  const found = new Set<number>();
  const add = (cx: number, cy: number) => {
    const tile = Math.floor(cy / SIDE) * width + Math.floor(cx / SIDE);
    if (cx >= 0 && cy >= 0 && cx < width * SIDE && grid.tiles[tile]) found.add(tile);
  };
  zoneEdges(grid, (ax, ay, bx, by) => {
    for (const x of [ax - REACH, bx + REACH]) for (const y of [ay - REACH, by + REACH]) add(x, y);
  });
  return [...found].sort((a, b) => a - b).map((tile) => [tile % width, Math.floor(tile / width)]);
}

function oceanChunks(tile: HeightTile): number[] {
  return tile.liquids
    .filter((l) => l.type === OCEAN && l.mask.toString(2).replaceAll("0", "").length >= HALF_CHUNK)
    .map((l) => l.chunk[1] * SIDE + l.chunk[0]);
}

/**
 * The zone borders of `grid`, with the open sea that its `borderTiles`
 * hold. A grid without `read` has no sea, so each edge between two zones
 * other than zone 0 is a border.
 */
export async function loadZoneBorders(grid: ZoneGrid): Promise<Border[]> {
  const { read } = grid;
  if (!read) return zoneBorders(grid);
  const [width] = grid.frame.size;
  const sea = new Set<number>();
  await Promise.all(
    borderTiles(grid).map(async (tile) => {
      for (const chunk of oceanChunks(await read(tile)))
        sea.add((tile[1] * SIDE + Math.floor(chunk / SIDE)) * width * SIDE + tile[0] * SIDE + (chunk % SIDE));
    }),
  );
  return zoneBorders(grid, (cx, cy) => sea.has(cy * width * SIDE + cx));
}
