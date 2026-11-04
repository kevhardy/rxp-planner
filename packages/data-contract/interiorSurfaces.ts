import { requireValid } from "./checks.ts";
import type { WorldLocation, WorldPoint } from "./geometry.ts";
import type { Interior } from "./interiors.ts";

/**
 * The walkable surfaces of one interior, in pixels of the interior's `size`,
 * row by row from the top. A height value v of 1 or more is the height
 * `heightBase + (v - 1) / 8` yards. A place value p of 1 or more names
 * `places[p - 1]`, and 0 is no name. At one pixel, heights rise strictly from
 * the ground up.
 */
export interface InteriorSurfaces {
  width: number;
  height: number;
  /** The lowest surface at each pixel. 0 is no surface. */
  groundHeight: Uint16Array;
  /** 0 where the ground height is 0. */
  groundPlace: Uint8Array;
  /** The pixels with 2 or more surfaces, ascending. */
  stacked: Uint32Array;
  /**
   * The surfaces above the ground at `stacked[s]` occupy `upperHeight` and `upperPlace` indices from
   * `upperStart[s]`, inclusive, to `upperStart[s + 1]`, exclusive.
   */
  upperStart: Uint32Array;
  upperHeight: Uint16Array;
  upperPlace: Uint8Array;
}

/** The most surfaces at one pixel, because one byte holds the count. */
export const MAX_PIXEL_SURFACES = 255;
const MAX_STEP_BYTES = 5;
const UPPER_SURFACE_BYTES = 3;
const MAX_RECORD_BYTES = MAX_STEP_BYTES + 1 + UPPER_SURFACE_BYTES * (MAX_PIXEL_SURFACES - 1);

/**
 * The most raw bytes that valid surfaces of an interior of `size` can have,
 * with `stacked` stacked pixels, which is at most every pixel.
 */
export function interiorSurfacesLimit([width, height]: [number, number], stacked = width * height): number {
  return width * height * 3 + 4 + Math.min(stacked, width * height) * MAX_RECORD_BYTES;
}

// Byte layout, big-endian, N = width * height:
//   u16 x N  ground height
//   u8 x N   ground place
//   u32      S, the number of stacked pixels
//   S records, ascending: varint pixel step from the record before (from 0 for the first),
//   u8 k, the number of surfaces at the pixel, then (k - 1) x { u16 height, u8 place }.

/** The raw bytes of `surfaces`. The same input gives the same bytes. A producer gzips them. */
export function encodeInteriorSurfaces(surfaces: InteriorSurfaces): Uint8Array<ArrayBuffer> {
  const { groundHeight, groundPlace, stacked, upperStart, upperHeight, upperPlace } = surfaces;
  const n = groundHeight.length;
  const tail: number[] = [];
  let last = 0;
  for (let s = 0; s < stacked.length; s++) {
    for (let step = stacked[s]! - last; ; step >>>= 7) {
      if (step < 0x80) {
        tail.push(step);
        break;
      }
      tail.push((step & 0x7f) | 0x80);
    }
    last = stacked[s]!;
    const [from, to] = [upperStart[s]!, upperStart[s + 1]!];
    requireValid(to - from < MAX_PIXEL_SURFACES, `surfaces at pixel ${stacked[s]}, ${to - from + 1} of at most ${MAX_PIXEL_SURFACES}`);
    tail.push(to - from + 1);
    for (let u = from; u < to; u++) tail.push(upperHeight[u]! >> 8, upperHeight[u]! & 0xff, upperPlace[u]!);
  }
  const bytes = new Uint8Array(n * 3 + 4 + tail.length);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < n; i++) view.setUint16(i * 2, groundHeight[i]!);
  bytes.set(groundPlace, n * 2);
  view.setUint32(n * 3, stacked.length);
  bytes.set(tail, n * 3 + 4);
  return bytes;
}

/** Checks every byte of `raw`, the unzipped bytes of `interior`'s surfaces, and returns them parsed. */
export function decodeInteriorSurfaces(raw: Uint8Array, interior: Pick<Interior, "id" | "size" | "places">): InteriorSurfaces {
  const where = `interior ${interior.id} surfaces`;
  const [width, height] = interior.size;
  const n = width * height;
  const places = interior.places.length;
  requireValid(raw.length >= n * 3 + 4, `${where} size`);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const groundHeight = new Uint16Array(n);
  const groundPlace = raw.slice(n * 2, n * 3);
  for (let i = 0; i < n; i++) {
    groundHeight[i] = view.getUint16(i * 2);
    requireValid(groundPlace[i]! <= places && (groundHeight[i]! > 0 || groundPlace[i] === 0), `${where} place`);
  }
  const count = view.getUint32(n * 3);
  requireValid(count <= n, `${where} size`);
  const stacked = new Uint32Array(count);
  const upperStart = new Uint32Array(count + 1);
  const heights: number[] = [];
  const upperPlaces: number[] = [];
  let at = n * 3 + 4;
  const byte = () => {
    requireValid(at < raw.length, `${where} size`);
    return raw[at++]!;
  };
  let pixel = 0;
  for (let s = 0; s < count; s++) {
    let step = 0;
    for (let shift = 0, b = 0x80; b & 0x80; shift += 7) {
      requireValid(shift < 7 * MAX_STEP_BYTES, `${where} stacked pixel`);
      b = byte();
      step += (b & 0x7f) * 2 ** shift;
    }
    pixel += step;
    requireValid((s === 0 || step > 0) && pixel < n && groundHeight[pixel]! > 0, `${where} stacked pixel`);
    stacked[s] = pixel;
    const k = byte();
    requireValid(k >= 2, `${where} stacked pixel`);
    let below = groundHeight[pixel]!;
    for (let u = 1; u < k; u++) {
      const value = (byte() << 8) | byte();
      const place = byte();
      requireValid(value > below, `${where} height order`);
      requireValid(place <= places, `${where} place`);
      heights.push(value);
      upperPlaces.push(place);
      below = value;
    }
    upperStart[s + 1] = heights.length;
  }
  requireValid(at === raw.length, `${where} size`);
  return {
    width,
    height,
    groundHeight,
    groundPlace,
    stacked,
    upperStart,
    upperHeight: Uint16Array.from(heights),
    upperPlace: Uint8Array.from(upperPlaces),
  };
}

type SurfaceGrid = Pick<InteriorSurfaces, "width" | "height" | "groundHeight">;

// A stop sits on a whole native pixel of 1.04 yd, so a stop on a surface's edge can be up to 1.09 yd from the center
// of a surface pixel. The smallest surface pixel in the data is 0.487 yd, so that is 2.24 surface pixels.
const REACH_PIXELS = 2.25;

/**
 * The index of the pixel under `at` when it has ground. Otherwise the index of
 * the ground pixel whose center is nearest `at`, up to `REACH_PIXELS`. Of
 * pixels at the same distance, the one in the top row wins, then the one in
 * the left column. -1 when no ground pixel is that near. A point outside the
 * bounds counts as on the nearest edge pixel. `insideInterior` and the planner's surface map (`src/data/surfaces.ts`) both
 * pick the pixel here, so they agree on a spawn's floor.
 */
export function surfacePixelAt(interior: Pick<Interior, "bounds">, surfaces: SurfaceGrid, at: WorldPoint): number {
  const { width, height, groundHeight } = surfaces;
  const { north, south, west, east } = interior.bounds;
  const clamp = (fraction: number, n: number) => Math.min(n, Math.max(0, fraction * n));
  const [fx, fy] = [clamp((west - at.x) / (west - east), width), clamp((north - at.y) / (north - south), height)];
  const [cx, cy] = [Math.min(width - 1, Math.floor(fx)), Math.min(height - 1, Math.floor(fy))];
  if (groundHeight[cy * width + cx]! > 0) return cy * width + cx;
  let [best, bestD2] = [-1, REACH_PIXELS ** 2];
  for (let r = 1; r < Math.max(width, height) && (r - 0.5) ** 2 <= bestD2; r++)
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        const edge = Math.abs(y - cy) === r || Math.abs(x - cx) === r;
        if (!edge || x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = y * width + x;
        const d2 = (x + 0.5 - fx) ** 2 + (y + 0.5 - fy) ** 2;
        if (groundHeight[i]! > 0 && (d2 < bestD2 || (d2 === bestD2 && i < best))) [best, bestD2] = [i, d2];
      }
  return best;
}

/** The height and place values of the surfaces at `pixel`, bottom first. None where the pixel has no ground. */
export function pixelSurfaces(surfaces: InteriorSurfaces, pixel: number): { height: number; place: number }[] {
  const { groundHeight, groundPlace, stacked, upperStart, upperHeight, upperPlace } = surfaces;
  if (!(groundHeight[pixel]! > 0)) return [];
  let [lo, hi] = [0, stacked.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (stacked[mid]! < pixel) lo = mid + 1;
    else hi = mid;
  }
  const [from, to] = stacked[lo] === pixel ? [upperStart[lo]!, upperStart[lo + 1]!] : [0, 0];
  const all = [{ height: groundHeight[pixel]!, place: groundPlace[pixel]! }];
  for (let u = from; u < to; u++) all.push({ height: upperHeight[u]!, place: upperPlace[u]! });
  return all;
}

/** The heights in world yards of the surfaces at `at`, bottom first, read at `surfacePixelAt`'s pixel. */
export function surfaceHeightsAt(interior: Pick<Interior, "bounds" | "heightBase">, surfaces: InteriorSurfaces, at: WorldPoint): number[] {
  const pixel = surfacePixelAt(interior, surfaces, at);
  return pixel < 0 ? [] : pixelSurfaces(surfaces, pixel).map((s) => interior.heightBase + (s.height - 1) / 8);
}

/**
 * Whether a spawn at `at`, at height `z` in world yards, is in `interior`:
 * on its map, within its bounds, and from 2 yd below its lowest surface at
 * that point to 8 yd above its highest. The margins take a spawn that stands
 * on a ledge the surfaces omit, and leave out one on the rim far above.
 */
export function insideInterior(
  interior: Pick<Interior, "map" | "bounds" | "heightBase">,
  surfaces: InteriorSurfaces,
  at: WorldLocation,
  z: number,
): boolean {
  const { north, south, west, east } = interior.bounds;
  if (at.instance !== interior.map || at.y > north || at.y < south || at.x > west || at.x < east) return false;
  const heights = surfaceHeightsAt(interior, surfaces, at);
  return heights.length > 0 && heights[0]! - 2 <= z && z <= heights.at(-1)! + 8;
}
