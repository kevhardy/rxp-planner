// A HereBeDragons `WorldLocation` x runs along the game's world Y axis (west)
// and its y along world X (north). See packages/data-contract/geometry.ts.

import { worldToCanvas, type CanvasPoint, type InstanceId, type TerrainGeometry, type WorldLocation } from "../data/index.ts";
import type { ArtifactManifest, ArtifactScope } from "./artifact.ts";
import type { Leg, PlanSettings, RoutePlan, WorldStop } from "./plan.ts";

/** What a conversion needs from the manifest: the map and where native pixel [0, 0] is. */
export interface NativeFrame {
  scope: Pick<ArtifactScope, "map">;
  frame: ArtifactManifest["frame"];
}

/** `[x, y]` integer native pixels, from 0 to 32767. Plans never hold one. */
export type Point = [number, number];

/** A stop resolved onto the routing artifact of `map`. */
export interface MapPoint {
  map: InstanceId;
  point: Point;
  /** World yards: the surface that the stop is on, inside an interior. */
  height?: number;
}

/** A plan resolved onto artifact frames, as the search reads it. `nativePlan` is its only constructor, so the lengths agree. */
export interface NativePlan {
  stops: Point[];
  maps: InstanceId[];
  heights: (number | null)[];
  legs: Leg[];
  settings: PlanSettings;
}

/** The frame of `map` among the frames of several artifacts, one for each map; undefined when none is for `map`. */
export const frameOf = <F extends NativeFrame>(frames: readonly F[], map: InstanceId): F | undefined =>
  frames.find((f) => f.scope.map === map);

/** `[x, y]` native pixels. A converted world position can be fractional. */
export type NativePosition = [number, number];

/** The formula comes from the data producer's routing artifact format. */
export function nativeToWorld({ scope, frame }: NativeFrame, [x, y]: NativePosition): WorldLocation {
  return {
    instance: scope.map,
    x: (32 - frame.origin[0] - x / frame.tilePixels) * frame.tileWorldUnits,
    y: (32 - frame.origin[1] - y / frame.tilePixels) * frame.tileWorldUnits,
  };
}

export function worldToNative({ scope, frame }: NativeFrame, world: WorldLocation): NativePosition | undefined {
  if (world.instance !== scope.map) return undefined;
  return [
    (32 - frame.origin[0] - world.x / frame.tileWorldUnits) * frame.tilePixels,
    (32 - frame.origin[1] - world.y / frame.tileWorldUnits) * frame.tilePixels,
  ];
}

// The canvas conversions go through world positions, so the atlas keeps one conversion. In Eastern Kingdoms the canvas is
// about native plus [32768, 8192], but the atlas uses 533.33333 yd a tile in place of 1600 / 3, so that sum is not exact.
/** Where a native position is on the atlas canvas, or undefined where the atlas does not show it. */
export function nativeToCanvas(map: TerrainGeometry, native: NativeFrame, at: NativePosition): CanvasPoint | undefined {
  return worldToCanvas(map, nativeToWorld(native, at));
}

const MAX_PIXEL = 32767;

const pixelOf = (frame: NativeFrame, at: WorldLocation) => worldToNative(frame, at)?.map(Math.round) as Point | undefined;

/** Whether `at` rounds to a pixel inside `frame`, the frame of its map. */
export function insideFrame(frame: NativeFrame, at: WorldLocation): boolean {
  const point = pixelOf(frame, at);
  const sides = frame.frame.size.map((tiles) => tiles * frame.frame.tilePixels);
  return !!point && point.every((n, i) => n >= 0 && n < sides[i]!);
}

/**
 * The pixel of `stop` on `frame`, which must be the frame of its map. Frame
 * origins are whole tiles, so a stop that `nativeToWorld` gives for pixel p
 * of any frame of its map rounds to that same pixel. Throws for a pixel
 * outside 0 to 32767.
 */
export function nativeStop(frame: NativeFrame, stop: WorldStop): MapPoint {
  const point = pixelOf(frame, stop);
  if (!point) throw new RangeError(`Expected a stop on map ${frame.scope.map}, found map ${stop.instance}`);
  if (!point.every((n) => n >= 0 && n <= MAX_PIXEL))
    throw new RangeError(`Expected a stop inside native pixels 0 to ${MAX_PIXEL} of map ${stop.instance}, found ${point.join(", ")}`);
  return { map: stop.instance, point, ...(stop.height !== null && { height: stop.height }) };
}

export const noArtifact = (map: InstanceId) => new Error(`No routing artifact is loaded for map ${map}.`);

/** Resolves each stop with the frame that `frames` gives for its map. Throws `noArtifact` for a map without one. */
export function nativePlan({ stops, legs, settings }: RoutePlan, frames: (map: InstanceId) => NativeFrame | undefined): NativePlan {
  const points = stops.map((stop) => {
    const frame = frames(stop.instance);
    if (!frame) throw noArtifact(stop.instance);
    return nativeStop(frame, stop).point;
  });
  return { stops: points, maps: stops.map((s) => s.instance), heights: stops.map((s) => s.height), legs, settings };
}

/** `plan` resolved on `frames`, or undefined when a stop is on a map without a frame or outside native pixels. */
export function resolvedOn(frames: readonly NativeFrame[], plan: RoutePlan): NativePlan | undefined {
  try {
    return nativePlan(plan, (map) => frameOf(frames, map));
  } catch {
    return undefined;
  }
}
