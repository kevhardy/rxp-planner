import type { WorldLocation } from "../../packages/data-contract/geometry.ts";
import type { Interior } from "../../packages/data-contract/interiors.ts";

export interface HeightMap {
  width: number;
  height: number;
  values: Uint16Array;
}

const area = ({ bounds: b }: Interior) => (b.north - b.south) * (b.west - b.east);

const holds = ({ map, bounds: b }: Interior, at: WorldLocation) =>
  map === at.instance && b.south <= at.y && at.y <= b.north && b.east <= at.x && at.x <= b.west;

export const interiorAt = (interiors: readonly Interior[], at: WorldLocation): Interior | undefined =>
  interiors
    .filter((interior) => holds(interior, at))
    .reduce<Interior | undefined>((best, i) => (best && area(best) <= area(i) ? best : i), undefined);

export type PixelLoop = readonly (readonly [x: number, y: number])[];

const minPartPixels = 512;

const [TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT] = [8, 4, 2, 1];
const [EAST, SOUTH, WEST, NORTH] = [0, 1, 2, 3];
const pixelsBeside = [TOP_RIGHT | BOTTOM_RIGHT, BOTTOM_LEFT | BOTTOM_RIGHT, TOP_LEFT | BOTTOM_LEFT, TOP_LEFT | TOP_RIGHT];
const surfaceOnRight = [BOTTOM_RIGHT, BOTTOM_LEFT, TOP_LEFT, TOP_RIGHT];
const nextDirection = Int8Array.from({ length: 64 }, (_, i) => {
  const [corner, d] = [i >> 2, i & 3];
  const [left, straight, right] = [(d + 3) & 3, d, (d + 1) & 3];
  return [left, straight, right].find((n) => (corner & pixelsBeside[n]!) === surfaceOnRight[n]) ?? -1;
});

export function surfaceOutline({ width, height, values }: HeightMap): PixelLoop[] {
  const stride = width + 2;
  const padded = new Uint8Array(stride * (height + 2));
  for (let y = 0; y < height; y++)
    for (let x = 0, from = y * width, to = (y + 1) * stride + 1; x < width; x++) padded[to + x] = values[from + x]! > 0 ? 1 : 0;
  const step = [1, stride, -1, -stride];
  const tracedEast = new Uint8Array(padded.length);
  let corners = new Int32Array(1 << 12);
  const loops: PixelLoop[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const start = y * stride + x;
      if (!padded[start + stride + 1] || padded[start + 1] || tracedEast[start]) continue;
      let [k, d, cx, cy, n, clockwiseArea] = [start, EAST, x, y, 2, 0];
      corners[0] = x;
      corners[1] = y;
      for (;;) {
        if (d === EAST) {
          tracedEast[k] = 1;
          clockwiseArea -= cy;
        } else if (d === WEST) clockwiseArea += cy;
        k += step[d]!;
        cx += d === EAST ? 1 : d === WEST ? -1 : 0;
        cy += d === SOUTH ? 1 : d === NORTH ? -1 : 0;
        const corner =
          (padded[k]! * TOP_LEFT) |
          (padded[k + 1]! * TOP_RIGHT) |
          (padded[k + stride]! * BOTTOM_LEFT) |
          (padded[k + stride + 1]! * BOTTOM_RIGHT);
        const next = nextDirection[corner * 4 + d]!;
        if (k === start && next === EAST) break;
        if (next !== d) {
          if (n + 2 > corners.length) {
            const grown = new Int32Array(corners.length * 2);
            grown.set(corners);
            corners = grown;
          }
          corners[n++] = cx;
          corners[n++] = cy;
        }
        d = next;
      }
      if (clockwiseArea < minPartPixels) continue;
      const loop: (readonly [number, number])[] = [];
      for (let i = 0; i < n; i += 2) loop.push([corners[i]!, corners[i + 1]!]);
      loops.push(loop);
    }
  return loops;
}
