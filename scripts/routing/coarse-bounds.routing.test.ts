import type { Point } from "../../src/routing/frame.ts";
import { describe, expect, it } from "vitest";
import { TILE_PIXELS } from "../../src/routing/artifact.ts";
import { withoutCoarse } from "../../src/routing/fixtures/coarse.ts";
import { DEFAULT_LEG } from "../../src/routing/plan.ts";
import { coarseBound, routeLeg, type LegRequest, type LegResult } from "../../src/routing/search.ts";
import { openInstalled } from "./installed.ts";
import { installedMaps } from "../dataset/local.ts";

const maps = await installedMaps();

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const REQUESTS: LegRequest[] = [
  { maxSlope: 50, mode: { name: "Run", speed: 7, activation: 0 }, swimming: { enabled: true, speed: 4.7 } },
  { maxSlope: 50, mode: { name: "Mount", speed: 11.2, activation: 3 }, swimming: { enabled: false, speed: 4.7 } },
  { maxSlope: 70, mode: { name: "Run", speed: 7, activation: 0 }, swimming: { enabled: true, speed: 9 }, fatalFalls: true, hazards: true },
];

const seconds = (result: LegResult) => (result.kind === "route" ? result.seconds : undefined);

const sameOutcomeOrProvedNoPath = (withLayer: LegResult, without: LegResult) =>
  withLayer.kind === without.kind || (withLayer.kind === "no-path" && without.kind === "limit");

describe("the coarse layer on the installed artifacts", () => {
  it("bounds each route from below and keeps each result", { timeout: 600_000 }, async () => {
    const next = mulberry32(15);
    let routes = 0;
    for (const map of maps) {
      const { artifact, terrain } = await openInstalled(map);
      expect(await terrain.coarse?.()).toBeDefined();
      const plain = withoutCoarse(terrain);
      const present = artifact.manifest.tiles.filter((t) => t.state === "present");
      for (let i = 0; i < 24; i++) {
        const { tile } = present[Math.floor(next() * present.length)]!;
        const from: Point = [Math.floor((tile[0] + next()) * TILE_PIXELS), Math.floor((tile[1] + next()) * TILE_PIXELS)];
        const to: Point = [from[0] + Math.floor((next() - 0.5) * 2 * TILE_PIXELS), from[1] + Math.floor((next() - 0.5) * 2 * TILE_PIXELS)];
        const request = REQUESTS[i % REQUESTS.length]!;
        const [withLayer, without] = [
          await routeLeg(terrain, from, to, DEFAULT_LEG, request),
          await routeLeg(plain, from, to, DEFAULT_LEG, request),
        ];
        const leg = `map ${map} ${from} > ${to} ${JSON.stringify(request)}`;
        expect(sameOutcomeOrProvedNoPath(withLayer, without), `${leg}: ${withLayer.kind} with the layer, ${without.kind} without`).toBe(
          true,
        );
        const time = seconds(without);
        if (time === undefined) continue;
        expect(seconds(withLayer), leg).toBeCloseTo(time, 9);
        const least = await coarseBound(terrain, { point: from }, { point: to }, DEFAULT_LEG, request);
        if (least !== undefined) expect(least, leg).toBeLessThanOrEqual(time + 1e-9);
        routes++;
      }
    }
    expect(routes).toBeGreaterThan(20);
  });
});
