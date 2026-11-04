import { describe, expect, it } from "vitest";
import { E, N, S, W, flat, native, whole, withFloor, type CellSpec } from "./fixtures/region.ts";
import type { MovementMode } from "./plan.ts";
import { routeLeg, type LegRequest, type TerrainRoute } from "./search.ts";
import { nativeToCell, type CellPoint, type TerrainRegion } from "./terrain.ts";

const run: MovementMode = { name: "Run", speed: 7, activation: 0 };

async function go(region: TerrainRegion, from: CellPoint, to: CellPoint, request: Partial<LegRequest> & { downhill?: boolean } = {}) {
  const { downhill = false, ...rest } = request;
  const result = await routeLeg(
    whole(region),
    native(from),
    native(to),
    { followTerrain: true, downhill },
    { maxSlope: 35, mode: run, swimming: { enabled: false, speed: 4.7 }, ...rest },
  );
  if (result.kind !== "route") throw new Error(`Expected a route, got ${result.kind}`);
  return result;
}
const cells = (route: TerrainRoute) => route.points.map((p) => nativeToCell({ tile: [0, 0] }, p));

describe("route smoothing", () => {
  it("gives one straight line along a diagonal street", async () => {
    const street = flat(11, 6);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 11; x++) if (Math.abs(2 * y - x) > 2) street.blocked[y * 11 + x] = 1;
    const route = await go(street, [0, 0], [10, 5]);
    expect(cells(route)).toEqual([
      [0, 0],
      [10, 5],
    ]);
    expect(route.distance).toBeCloseTo(7 * Math.hypot(10, 5), 9);
    expect(route.seconds).toBeCloseTo(Math.hypot(10, 5), 9);
  });

  it("gives one straight line across a diagonal bridge, and bends where a cell has no link along it", async () => {
    const bridge = (cut?: number) => {
      const region = flat(9, 5);
      region.water.fill(5);
      region.elevation.fill(0);
      const deck: Record<number, CellSpec> = {};
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < 9; x++) {
          const walk = (x > 0 ? W : 0) | (x < 8 ? E : 0) | (y > 0 ? N : 0) | (y < 4 ? S : 0);
          deck[y * 9 + x] = { layers: [{ height: 10, walk: y * 9 + x === cut ? walk & ~E : walk }] };
        }
      return withFloor(region, deck);
    };
    const straight = await go(bridge(), [0, 0], [8, 4]);
    expect(cells(straight)).toEqual([
      [0, 0],
      [8, 4],
    ]);
    expect(straight.distance).toBeCloseTo(7 * Math.hypot(8, 4), 9);
    const cut = await go(bridge(2 * 9 + 4), [0, 0], [8, 4]);
    expect(cells(cut)).toEqual([
      [0, 0],
      [5, 3],
      [8, 4],
    ]);
  });

  it("keeps the point of a fall, and straightens the walks before and after it", async () => {
    const ledge = withFloor(flat(9, 5), {
      0: { layers: [{ height: 10, walk: E }] },
      1: { layers: [{ height: 10, walk: W | E }] },
      2: { layers: [{ height: 10, walk: W, drop: S, drops: [10] }] },
    });
    const route = await go(ledge, [0, 0], [8, 4], { downhill: true });
    expect(cells(route)).toEqual([
      [0, 0],
      [2, 0],
      [2, 1],
      [8, 4],
    ]);
    expect(route.falls).toEqual([{ point: 1, height: 10 }]);
    expect(route.distance).toBeCloseTo(14 + Math.hypot(7, 10) + 7 * Math.hypot(6, 3), 9);
  });

  it("does not cut the corner of a blocked cell", async () => {
    const region = flat(3, 3);
    region.blocked[1] = 1;
    const route = await go(region, [0, 0], [2, 2]);
    expect(cells(route)).toEqual([
      [0, 0],
      [0, 1],
      [2, 2],
    ]);
    expect(route.distance).toBeCloseTo(7 + 7 * Math.hypot(2, 1), 9);
  });

  it("does not take a straight line over a rise that the steps went around", async () => {
    const region = flat(7, 2);
    for (const x of [2, 3, 4]) region.elevation[7 + x] = 10;
    const route = await go(region, [0, 1], [6, 1], { maxSlope: 60 });
    expect(cells(route)).toEqual([
      [0, 1],
      [3, 0],
      [6, 1],
    ]);
    expect(route.distance).toBeCloseTo(2 * 7 * Math.hypot(3, 1), 9);
  });
});
