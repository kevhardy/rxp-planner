import type { Point } from "../../src/routing/frame.ts";
import { describe, expect, it } from "vitest";
import { calibrate } from "../../src/routing/calibration.ts";
import { whole } from "../../src/routing/fixtures/region.ts";
import { syntheticScope } from "../../src/routing/fixtures/synthetic.ts";
import { CELL_SPACING, type Terrain, type TerrainRegion } from "../../src/routing/terrain.ts";
import { routeCorridors } from "./corridors.ts";

function ground(): Terrain {
  const width = 40,
    height = 40,
    n = width * height;
  const region: TerrainRegion = {
    tile: [0, 0],
    width,
    height,
    spacing: CELL_SPACING,
    elevation: new Float32Array(n),
    slope: new Float32Array(n),
    blocked: new Uint8Array(n),
    water: new Float32Array(n).fill(Number.NaN),
    failed: [],
    coverage: ([x, y]) => (x >= 0 && y >= 0 && x < width && y < height ? "present" : undefined),
  };
  return whole(region);
}

describe("calibration corridors", () => {
  it("routes a corridor and compares it with the matching observation", async () => {
    const corridor = { name: "Flat", from: [10, 10] as Point, to: [150, 10] as Point, mode: "run" };
    const routed = await routeCorridors(ground(), { corridors: [corridor] });
    const observed = {
      id: "flat-run",
      scope: syntheticScope(),
      from: [12, 10] as Point,
      to: [148, 12] as Point,
      mode: "run" as const,
      conditions: "Level 10.",
      seconds: 20,
      source: "test",
    };
    const { entries } = calibrate({ artifact: "routing-test", scope: syntheticScope(), ...routed, observations: [observed] });
    const seconds = entries[0]!.estimate.seconds!;
    expect(seconds).toBeCloseTo((140 * 1600) / 3 / 512 / 7, 0);
    expect(entries).toMatchObject([
      {
        corridor: "Flat",
        mode: "run",
        estimate: { kind: "route" },
        status: "calibrated",
        observations: [{ id: "flat-run", error: { seconds: Math.round((seconds - 20) * 100) / 100 } }],
      },
    ]);
  });
});
