import type { Interior } from "../../../packages/data-contract/interiors.ts";
import { surfaceOutline, type HeightMap, type PixelLoop } from "../../data/heightMap.ts";
import type { LoadedInteriors } from "../../data/index.ts";
import { TERRAIN_ASPECT_ZOOM } from "./viewport.ts";

export type StackMask = "two" | "more" | "twoEdge" | "moreEdge";

export const eachMask = <A, B>(masks: Record<StackMask, A>, f: (mask: A) => B): Record<StackMask, B> => ({
  two: f(masks.two),
  more: f(masks.more),
  twoEdge: f(masks.twoEdge),
  moreEdge: f(masks.moreEdge),
});

export interface InteriorOutline<Image = string> {
  width: number;
  height: number;
  path: string;
  masks: Record<StackMask, Image>;
}

export type OutlineReply = InteriorOutline<Blob> | { error: string };

export interface OutlineRequest {
  ground: HeightMap;
  stacks: Uint8Array;
}

export const groundPath = (ground: HeightMap): string =>
  surfaceOutline(ground)
    .map((loop) => `M${simplifyLoop(loop).join("L")}Z`)
    .join("");

// The stroke-width of `.interior-outline-border` in map.css.
const OUTLINE_BORDER_PX = 4;
// The dataset's terrain chunk is 512 px across 533.33333 yards, and its height maps hold 2 px per yard.
const TERRAIN_PX_PER_YARD = 512 / 533.33333;
const HEIGHT_PX_PER_YARD = 2;
const screenPxPerHeightPxAtMaxZoom = (TERRAIN_ASPECT_ZOOM * TERRAIN_PX_PER_YARD) / HEIGHT_PX_PER_YARD;
const outlineTolerance = OUTLINE_BORDER_PX / 2 / screenPxPerHeightPxAtMaxZoom;

function simplifyLoop(loop: PixelLoop): PixelLoop {
  const keep = new Uint8Array(loop.length);
  keep[0] = 1;
  const pending: [number, number][] = [[0, loop.length]];
  while (pending.length) {
    const [from, to] = pending.pop()!;
    const a = loop[from]!;
    const b = loop[to % loop.length]!;
    let split = -1;
    let largestSquared = outlineTolerance ** 2;
    for (let i = from + 1; i < to; i++) {
      const squared = segmentDistanceSquared(loop[i]!, a, b);
      if (squared > largestSquared) {
        split = i;
        largestSquared = squared;
      }
    }
    if (split < 0) continue;
    keep[split] = 1;
    pending.push([from, split], [split, to]);
  }
  const simplified = loop.filter((_, i) => keep[i]);
  if (simplified.length < 3) return loop;
  let twiceArea = 0;
  for (let i = 0; i < simplified.length; i++) {
    const a = simplified[i]!;
    const b = simplified[(i + 1) % simplified.length]!;
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  return twiceArea > 0 ? simplified : loop;
}

function segmentDistanceSquared(p: PixelLoop[number], a: PixelLoop[number], b: PixelLoop[number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
}

export function stackMasks(stacks: Uint8Array, width: number): Record<StackMask, Uint8ClampedArray<ArrayBuffer>> {
  const height = stacks.length / width;
  const blank = () => new Uint8ClampedArray(stacks.length * 4);
  const masks = { two: blank(), more: blank(), twoEdge: blank(), moreEdge: blank() };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const n = stacks[i]!;
      if (n === 0) continue;
      const other = (dx: number, dy: number) => {
        const [nx, ny] = [x + dx, y + dy];
        return nx < 0 || ny < 0 || nx >= width || ny >= height || stacks[ny * width + nx] !== n;
      };
      const edge = other(1, 0) || other(-1, 0) || other(0, 1) || other(0, -1);
      const mask = n === 2 ? (edge ? masks.twoEdge : masks.two) : edge ? masks.moreEdge : masks.more;
      mask.fill(255, i * 4, i * 4 + 4);
    }
  return masks;
}

function traceInWorker(request: OutlineRequest): Promise<InteriorOutline> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./outline.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<OutlineReply>) => {
      worker.terminate();
      if ("error" in data) reject(new Error(data.error));
      else resolve({ ...data, masks: eachMask(data.masks, (blob) => URL.createObjectURL(blob)) });
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage(request);
  });
}

const outlines = new WeakMap<LoadedInteriors, Map<string, Promise<InteriorOutline>>>();

export function outline(interiors: LoadedInteriors, interior: Interior): Promise<InteriorOutline> {
  let traced = outlines.get(interiors);
  if (!traced) outlines.set(interiors, (traced = new Map<string, Promise<InteriorOutline>>()));
  let found = traced.get(interior.id);
  if (!found) {
    found = interiors.surfaces(interior).then(({ ground, stackMask }) => traceInWorker({ ground, stacks: stackMask() }));
    traced.set(interior.id, found);
    found.catch(() => traced.delete(interior.id));
  }
  return found;
}
