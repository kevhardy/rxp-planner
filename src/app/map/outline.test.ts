import { beforeEach, describe, expect, it, vi } from "vitest";
import { surfaceOutline, type HeightMap, type PixelLoop } from "../../data/heightMap.ts";
import type { LoadedInteriors } from "../../data/index.ts";
import { interiorsFixture } from "../../data/manifestFixture.ts";
import { fromSurfaces } from "../../data/surfaces.ts";
import { plannerData } from "../../data/plannerFixture.ts";
import { terrainFixture } from "../../data/terrainFixture.ts";
import { groundPath, outline, stackMasks, type OutlineReply } from "./outline.ts";
import { terrainSurface } from "./surfaces.ts";
import { canvasSize } from "./viewport.ts";

const ground = (width: number, height: number, filled: (x: number, y: number) => boolean): HeightMap => ({
  width,
  height,
  values: Uint16Array.from({ length: width * height }, (_, i) => (filled(i % width, Math.floor(i / width)) ? 1 : 0)),
});

function pathLoops(path: string): PixelLoop[] {
  return Array.from(path.matchAll(/M([^Z]+)Z/g), ([, points]) =>
    points!.split("L").map((point): [number, number] => {
      const [x, y] = point.split(",").map(Number);
      return [x!, y!];
    }),
  );
}

it("draws a staircase diagonal with at most four corners", () => {
  const loops = pathLoops(groundPath(ground(64, 64, (x, y) => x + y < 64)));
  expect(loops).toHaveLength(1);
  expect(loops[0]!.length).toBeLessThanOrEqual(4);
});

function distanceToLoop([x, y]: PixelLoop[number], loop: PixelLoop): number {
  return Math.min(
    ...loop.map(([ax, ay], i) => {
      const [bx, by] = loop[(i + 1) % loop.length]!;
      const dx = bx - ax;
      const dy = by - ay;
      if ((x - ax) * dx + (y - ay) * dy <= 0) return Math.hypot(x - ax, y - ay);
      if ((x - bx) * dx + (y - by) * dy >= 0) return Math.hypot(x - bx, y - by);
      return Math.abs(dx * (y - ay) - dy * (x - ax)) / Math.hypot(dx, dy);
    }),
  );
}

function edgeDeviation(from: PixelLoop, to: PixelLoop): number {
  let largest = 0;
  for (const [i, a] of from.entries()) {
    const b = from[(i + 1) % from.length]!;
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 4);
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      largest = Math.max(largest, distanceToLoop([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], to));
    }
  }
  return largest;
}

function filledAt([x, y]: PixelLoop[number], loops: readonly PixelLoop[]): boolean {
  let winding = 0;
  for (const loop of loops)
    for (const [i, [ax, ay]] of loop.entries()) {
      const [bx, by] = loop[(i + 1) % loop.length]!;
      const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      if (ay <= y && by > y && cross > 0) winding++;
      if (ay > y && by <= y && cross < 0) winding--;
    }
  return winding !== 0;
}

const notchedGround = ground(
  32,
  32,
  (x, y) => x >= 3 || y < 24 || ["#..", "#.#", "#..", ".#.", "...", "###", "###", ".##"][y - 24]![x] === "#",
);

it("keeps the ground edge within the opaque border at maximum terrain zoom", () => {
  const exact = surfaceOutline(notchedGround);
  const drawn = pathLoops(groundPath(notchedGround));
  expect(drawn).toHaveLength(1);
  const deviation = Math.max(edgeDeviation(exact[0]!, drawn[0]!), edgeDeviation(drawn[0]!, exact[0]!));
  const surface = terrainSurface(plannerData(), terrainFixture, new WeakMap());
  const width = 1080;
  const scale = (width * surface.maxZoom(width)) / canvasSize(terrainFixture).width;
  const cssPixelsPerHeightPixel = (scale * terrainFixture.pxPerChunk) / terrainFixture.yardsPerChunk / 2;
  expect(deviation * cssPixelsPerHeightPixel).toBeLessThanOrEqual(2);
});

it.each([
  ["both arcs of a staircase diamond", ground(64, 64, (x, y) => Math.abs(x - 31.5) + Math.abs(y - 31.5) <= 31.5), 1],
  ["a one-pixel diagonal spur", ground(64, 64, (x, y) => (x < 24 && y < 24) || x === y), 1],
  ["a folded diagonal spur", ground(64, 64, (x, y) => (x < 24 && y < 24) || x === y || x === y + 2), 1],
  ["a notch beside a chord endpoint", notchedGround, 1],
  ["a corner pinch", ground(46, 46, (x, y) => (x < 23 && y < 23) || (x >= 23 && y >= 23)), 1],
  [
    "a diagonal island inside a gap",
    ground(64, 64, (x, y) => x < 4 || y < 4 || x >= 60 || y >= 60 || (x >= 16 && y >= 16 && x + y < 68)),
    2,
  ],
])("bounds the edge and fill differences for %s", (_, map, count) => {
  const before = structuredClone(map);
  const exact = surfaceOutline(map);
  const drawn = pathLoops(groundPath(map));
  expect(drawn).toHaveLength(count);
  expect(drawn).toHaveLength(exact.length);
  for (const [i, loop] of drawn.entries()) {
    const original = exact[i]!;
    expect(loop.length).toBeGreaterThanOrEqual(3);
    expect(
      loop.reduce((area, [x, y], j) => {
        const [nextX, nextY] = loop[(j + 1) % loop.length]!;
        return area + x * nextY - nextX * y;
      }, 0),
    ).toBeGreaterThan(0);
    let after = 0;
    for (const point of loop) {
      const index = original.findIndex(([x, y], j) => j >= after && x === point[0] && y === point[1]);
      expect(index).toBeGreaterThanOrEqual(after);
      after = index + 1;
    }
    expect(edgeDeviation(original, loop)).toBeLessThanOrEqual(1 + 1e-9);
    expect(edgeDeviation(loop, original)).toBeLessThanOrEqual(1 + 1e-9);
  }
  for (let y = 0.25; y < map.height; y += 0.5)
    for (let x = 0.25; x < map.width; x += 0.5)
      if (filledAt([x, y], exact) !== filledAt([x, y], drawn))
        expect(Math.min(...drawn.map((loop) => distanceToLoop([x, y], loop)))).toBeLessThanOrEqual(1 + 1e-9);
  expect(map).toEqual(before);
});

it("keeps a rectangle exact and an empty ground path empty", () => {
  expect(groundPath(ground(24, 32, () => true))).toBe("M0,0L24,0L24,32L0,32Z");
  expect(groundPath(ground(24, 32, () => false))).toBe("");
});

it("keeps the exact loop when a one-pixel diagonal would collapse to two corners", () => {
  const map = ground(512, 512, (x, y) => x === y);
  const loops = pathLoops(groundPath(map));
  expect(loops).toHaveLength(1);
  expect(loops).toEqual(surfaceOutline(map));
});

it("puts each stacked pixel in the mask of its count, and on the edge mask where a pixel beside it or the border has another count", () => {
  expect(stackMasks(Uint8Array.of(2, 2, 2, 0, 3, 2, 2, 2, 0, 0, 2, 2, 2, 0, 0), 5)).toEqual({
    two: "M1,1h1v1h-1z",
    twoEdge: "M0,0h3v1h-3zM0,1h1v1h-1zM2,1h1v1h-1zM0,2h3v1h-3z",
    more: "",
    moreEdge: "M4,0h1v1h-1z",
  });
});

it("draws a run of pixels that repeats in the rows below as one rectangle", () => {
  expect(stackMasks(Uint8Array.of(0, 3, 3, 0, 3, 3, 0, 3, 3), 3).moreEdge).toBe("M1,0h2v3h-2z");
});

describe("the outline of an interior", () => {
  const f = interiorsFixture();
  const cave = f.interiors.interiors[0]!;
  const surfaces = fromSurfaces(cave, f.surfaces);
  const posted: unknown[] = [];
  beforeEach(() => {
    posted.length = 0;
    vi.stubGlobal(
      "Worker",
      class {
        onmessage?: (event: { data: OutlineReply }) => void;
        postMessage(request: unknown) {
          posted.push(request);
          queueMicrotask(() =>
            this.onmessage?.({
              data: { width: 4, height: 2, path: "", masks: { two: "", more: "", twoEdge: "", moreEdge: "" } },
            }),
          );
        }
        terminate() {}
      },
    );
    return () => vi.unstubAllGlobals();
  });
  const interiors: LoadedInteriors = {
    list: [cave],
    image: async (path) => `blob:${path}`,
    surfaces: async () => surfaces,
    loadedSurfaces: () => surfaces,
  };

  it("sends an interior's decoded ground and stack counts to the worker", async () => {
    await outline(interiors, cave);
    expect(posted).toEqual([{ ground: surfaces.ground, stacks: Uint8Array.of(0, 2, 2, 0, 2, 2, 2, 0) }]);
  });
});
