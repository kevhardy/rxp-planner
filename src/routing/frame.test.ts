import { expect, it } from "vitest";
import { canvasToWorld, type CanvasPoint } from "../data/index.ts";
import { worldMap } from "../data/terrainFixture.ts";
import { nativePlan, nativeStop, nativeToCanvas, nativeToWorld, worldToNative, type NativeFrame, type NativePosition } from "./frame.ts";
import { createPlan } from "./plan.ts";

const RELEASE_MAP_0: NativeFrame = {
  scope: { map: 0 },
  frame: { origin: [23, 20], size: [23, 42], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
};

// The client keeps map 0 terrain in one ADT file a tile, Azeroth_<column>_<row>.adt, on a grid of 1600 / 3 world
// units a tile. Grid position (column, row) has a HereBeDragons x (world Y, west) of (32 - column) * 1600 / 3 and a y
// (world X, north) of (32 - row) * 1600 / 3, and a whole position is a tile's north-west corner. So these world
// positions come from the grid, not from frame.ts. A sign or scale error grows with the distance from world zero or
// from the frame origin, so no point is on their rows or columns. The last point is inside its tile, so a conversion
// that rounds to a tile or a pixel fails it.
const ADT_POINTS: { column: number; row: number; native: NativePosition; canvas: CanvasPoint }[] = [
  { column: 33, row: 42, native: [5120, 11264], canvas: { x: 37888, y: 19456 } },
  { column: 28, row: 26, native: [2560, 3072], canvas: { x: 35328, y: 11264 } },
  { column: 40.1, row: 55.7, native: [8755.2, 18278.4], canvas: { x: 41523.2, y: 26470.4 } },
];

it.each(ADT_POINTS)(
  "converts ADT column $column, row $row between world, native pixels, and the atlas",
  ({ column, row, native, canvas }) => {
    const world = { instance: 0, x: (32 - column) * (1600 / 3), y: (32 - row) * (1600 / 3) };
    const at = worldToNative(RELEASE_MAP_0, world)!;
    expect(at[0]).toBeCloseTo(native[0], 2);
    expect(at[1]).toBeCloseTo(native[1], 2);
    const back = nativeToWorld(RELEASE_MAP_0, native);
    expect(back.instance).toBe(0);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
    const onAtlas = nativeToCanvas(worldMap, RELEASE_MAP_0, native)!;
    expect(onAtlas.x).toBeCloseTo(canvas.x, 2);
    expect(onAtlas.y).toBeCloseTo(canvas.y, 2);
    const fromAtlas = worldToNative(RELEASE_MAP_0, canvasToWorld(worldMap, canvas)!)!;
    expect(fromAtlas[0]).toBeCloseTo(native[0], 2);
    expect(fromAtlas[1]).toBeCloseTo(native[1], 2);
  },
);

it("places native pixel [0, 0] at the frame origin's north-west corner", () => {
  expect(nativeToWorld(RELEASE_MAP_0, [0, 0])).toEqual({ instance: 0, x: 9 * (1600 / 3), y: 12 * (1600 / 3) });
});

it("gives no native position on another map", () => {
  expect(worldToNative(RELEASE_MAP_0, { instance: 0, x: 9 * (1600 / 3), y: 12 * (1600 / 3) })).toEqual([0, 0]);
  expect(worldToNative(RELEASE_MAP_0, { instance: 1, x: 9 * (1600 / 3), y: 12 * (1600 / 3) })).toBeUndefined();
  expect(worldToNative(RELEASE_MAP_0, canvasToWorld(worldMap, { x: 20000, y: 16000 })!)).toBeUndefined();
});

it("resolves a world stop to the nearest native pixel, and the world position of a pixel back to that pixel", () => {
  expect(nativeStop(RELEASE_MAP_0, { instance: 0, x: 4798.9, y: 6398.9, height: null })).toEqual({ map: 0, point: [1, 1] });
  expect(nativeStop(RELEASE_MAP_0, { ...nativeToWorld(RELEASE_MAP_0, [5120, 11264]), height: 385.125 })).toEqual({
    map: 0,
    point: [5120, 11264],
    height: 385.125,
  });
});

it("refuses a stop on another map, or outside native pixels 0 to 32767", () => {
  const onOrigin = nativeToWorld(RELEASE_MAP_0, [0, 0]);
  expect(() => nativeStop(RELEASE_MAP_0, { ...onOrigin, instance: 1, height: null })).toThrow("Expected a stop on map 0, found map 1");
  expect(() => nativeStop(RELEASE_MAP_0, { ...nativeToWorld(RELEASE_MAP_0, [-1, 0]), height: null })).toThrow(
    "Expected a stop inside native pixels 0 to 32767 of map 0, found -1, 0",
  );
  expect(() => nativeStop(RELEASE_MAP_0, { ...nativeToWorld(RELEASE_MAP_0, [32768, 5]), height: null })).toThrow(
    "Expected a stop inside native pixels 0 to 32767 of map 0, found 32768, 5",
  );
});

it("resolves one world plan to other pixels on a frame with another origin, and names a map without a frame", () => {
  const plan = createPlan(
    { ...nativeToWorld(RELEASE_MAP_0, [512, 1024]), height: null },
    { ...nativeToWorld(RELEASE_MAP_0, [700, 900]), height: 12 },
  );
  const later: NativeFrame = { ...RELEASE_MAP_0, frame: { ...RELEASE_MAP_0.frame, origin: [22, 21] } };
  expect(nativePlan(plan, () => RELEASE_MAP_0)).toMatchObject({
    stops: [
      [512, 1024],
      [700, 900],
    ],
    maps: [0, 0],
    heights: [null, 12],
  });
  expect(nativePlan(plan, () => later).stops).toEqual([
    [1024, 512],
    [1212, 388],
  ]);
  expect(() => nativePlan(plan, () => undefined)).toThrow("No routing artifact is loaded for map 0.");
});
