import type { InstanceId, UiMapId } from "./shared.ts";
import type { TerrainGeometry, WorldMapArea, WorldMapAreaKey } from "./worldMap.ts";

/** A UI map's extent in WoW world coordinates (yards). */
export interface WorldBounds {
  instance: InstanceId;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * A position in HereBeDragons world coordinates, as written in
 * `.goto <uiMapId>/<instance>,<x>,<y>`. HBD's x runs along the game's world Y
 * axis and its y along world X; both grow toward the map's top left.
 */
export interface WorldPoint {
  x: number;
  y: number;
}

/** A world position with its instance, such as 1 for Kalimdor or 2991 for Zephras Isle. */
export interface WorldLocation extends WorldPoint {
  instance: InstanceId;
}

/**
 * JSON-compatible UI map bounds. Each table describes one client's maps.
 * Keys are UI map IDs, typed `number` because a `UiMapId` key rejects an
 * object literal such as `{ 1413: bounds }`.
 */
export type MapBoundsRecords = Readonly<Record<number, WorldBounds>>;

function sameBounds(a: WorldBounds, b: WorldBounds): boolean {
  return a.instance === b.instance && a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}

/**
 * Reconstructs a map table after JSON parsing. Equal bounds for the same UI
 * map reuse the shared table's object, preserving pointer-based placement
 * shortcuts. Different bounds remain distinct. This does not inherit missing
 * rows: each input is a complete table. It accepts typed data, not untrusted JSON.
 */
export function restoreMapBounds(rows: MapBoundsRecords, shared?: ReadonlyMap<UiMapId, WorldBounds>): ReadonlyMap<UiMapId, WorldBounds> {
  return new Map(
    Object.entries(rows).map(([id, bounds]) => {
      const uiMapId = Number(id);
      const previous = shared?.get(uiMapId);
      return [uiMapId, previous && sameBounds(previous, bounds) ? previous : bounds];
    }),
  );
}

/**
 * Converts HBD world coordinates to map percentages (0 to 100 inside the
 * map), as HereBeDragons' GetZoneCoordinatesFromWorld does.
 */
export function worldToMap(bounds: WorldBounds, world: WorldPoint): { x: number; y: number } {
  return {
    x: ((bounds.maxY - world.x) / (bounds.maxY - bounds.minY)) * 100,
    y: ((bounds.maxX - world.y) / (bounds.maxX - bounds.minX)) * 100,
  };
}

/** Converts map percentages to HBD world coordinates; the inverse of `worldToMap`. */
export function mapToWorld(bounds: WorldBounds, x: number, y: number): WorldPoint {
  return {
    x: bounds.maxY - (x / 100) * (bounds.maxY - bounds.minY),
    y: bounds.maxX - (y / 100) * (bounds.maxX - bounds.minX),
  };
}

/**
 * Why a source's map percentages name no one world position: no client has
 * bounds for the map, or the source does not say which client's map it read
 * and the clients' maps differ.
 */
export type WorldFailure = "no-bounds" | "ambiguous-map";

export type WorldResult = { ok: true; world: WorldLocation; bounds: WorldBounds } | { ok: false; reason: WorldFailure };

/**
 * Resolves percentages against the supplied clients' bounds for one UI map.
 * Equal numeric bounds name one place even when JSON parsing made separate
 * objects. Missing clients are ignored; no bounds and differing bounds retain
 * their distinct failures. The first available bounds object is returned.
 */
export function percentToWorld(candidates: readonly (WorldBounds | undefined)[], x: number, y: number): WorldResult {
  const bounds = candidates.find((candidate) => candidate !== undefined);
  if (!bounds) return { ok: false, reason: "no-bounds" };
  if (candidates.some((other) => other !== undefined && !sameBounds(bounds, other))) return { ok: false, reason: "ambiguous-map" };
  return { ok: true, world: { instance: bounds.instance, ...mapToWorld(bounds, x, y) }, bounds };
}

/** A pixel on the terrain map's canvas at its native zoom. */
export interface CanvasPoint {
  x: number;
  y: number;
}

// The game divides each instance into a 64 by 64 grid of terrain chunks whose
// world coordinates fall from +32 chunks at chunk 0 to -32 at chunk 64. The
// terrain art starts at chunk (originCol, originRow): columns run along HBD x
// and rows along HBD y.

/** Where a world position sits on the terrain canvas, or undefined when its instance's art does not show it. */
export function worldToCanvas(map: TerrainGeometry, world: WorldLocation): CanvasPoint | undefined {
  const area = map.areas.find((a) => a.map === world.instance);
  if (!area) return undefined;
  const at = {
    x: area.canvasX + (32 - world.x / map.yardsPerChunk - area.originCol) * map.pxPerChunk,
    y: area.canvasY + (32 - world.y / map.yardsPerChunk - area.originRow) * map.pxPerChunk,
  };
  return shows(area, at) ? at : undefined;
}

/**
 * The world position under a canvas pixel. Kalimdor's and Zephras Isle's
 * rectangles overlap. The areas draw in order, and only their stored tiles,
 * so the pixel belongs to the last area with a tile there, or else the last
 * area whose rectangle holds it.
 */
export function canvasToWorld(map: TerrainGeometry, at: CanvasPoint): WorldLocation | undefined {
  const holding = map.areas.filter((a) => shows(a, at));
  const area = holding.findLast((a) => hasTile(map, a, at)) ?? holding.at(-1);
  return area && areaToWorld(map, area, at);
}

/**
 * Why a canvas pixel that a source declares in an area names no world position:
 * the area's art does not show it but another area's does (`wrong-instance`),
 * no area's art shows it (`off-map`), or the area stores no tile there but
 * another area does, so the art under it is another instance's (`ambiguous`).
 */
export type CanvasFailure = "wrong-instance" | "off-map" | "ambiguous";
export const CANVAS_FAILURES: readonly CanvasFailure[] = ["wrong-instance", "off-map", "ambiguous"];

/**
 * The world position of a pixel in the area its source declares. Unlike
 * `canvasToWorld`, which finds the area the viewer draws on top, it reads
 * only the declared area's geometry, so a pixel where areas overlap keeps
 * its source's instance. A pixel in an atlas gap, where no area stores a
 * tile, still takes its declared area's position.
 */
export function locateCanvas(
  map: TerrainGeometry,
  key: WorldMapAreaKey,
  at: CanvasPoint,
): { ok: true; world: WorldLocation } | { ok: false; reason: CanvasFailure } {
  const area = map.areas.find((a) => a.key === key);
  if (!area) throw new Error(`The terrain geometry has no ${key}`);
  const others = map.areas.filter((a) => a !== area && shows(a, at));
  if (!shows(area, at)) return { ok: false, reason: others.length ? "wrong-instance" : "off-map" };
  if (!hasTile(map, area, at) && others.some((a) => hasTile(map, a, at))) return { ok: false, reason: "ambiguous" };
  return { ok: true, world: areaToWorld(map, area, at) };
}

function areaToWorld(map: TerrainGeometry, area: WorldMapArea, at: CanvasPoint): WorldLocation {
  return {
    instance: area.map,
    x: (32 - area.originCol - (at.x - area.canvasX) / map.pxPerChunk) * map.yardsPerChunk,
    y: (32 - area.originRow - (at.y - area.canvasY) / map.pxPerChunk) * map.yardsPerChunk,
  };
}

function shows(area: WorldMapArea, at: CanvasPoint): boolean {
  const x = at.x - area.canvasX;
  const y = at.y - area.canvasY;
  return x >= area.cropLeft && x <= area.width && y >= 0 && y <= area.height;
}

function hasTile(map: TerrainGeometry, area: WorldMapArea, at: CanvasPoint): boolean {
  const row = Math.floor((at.y - area.canvasY) / map.tileSize);
  const col = Math.floor((at.x - area.canvasX) / map.tileSize);
  return (area.tiles[map.nativeZoom] ?? []).some(([r, first, last]) => r === row && col >= first && col <= last);
}
