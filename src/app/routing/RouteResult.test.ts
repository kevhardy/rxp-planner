// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Journey, JourneyLeg } from "../../routing/journey.ts";
import { summarizeJourney } from "../../routing/result.ts";
import type { TerrainRoute } from "../../routing/search.ts";
import { routeStatus, type RouteStatus } from "./RouteResult.tsx";
import type { SearchView } from "./routeSearch.ts";

const RUN = { name: "Run", speed: 7, activation: 0 };
const ground = (seconds: number): TerrainRoute => ({
  kind: "route",
  points: [
    [0, 0],
    [70, 0],
  ],
  descents: [],
  descentDrop: 0,
  falls: [],
  swims: [],
  swimDistance: 0,
  swimSeconds: 0,
  swimRemounts: [],
  distance: 70,
  terrainSeconds: seconds,
  activation: 0,
  seconds,
});
const straight = (seconds: number): JourneyLeg => ({
  kind: "straight",
  points: [
    [0, 0],
    [30, 0],
  ],
  distance: 30,
  activation: 0,
  seconds,
});
const tiles = (n: number) => Array.from({ length: n }, (_, i) => ({ tile: [i, 0] as [number, number], at: [i, 0] as [number, number] }));
const crossing: JourneyLeg = { kind: "crossing" };
const noPath: JourneyLeg = { kind: "no-path" };

const routed = (legs: JourneyLeg[]): [SearchView, ReturnType<typeof summarizeJourney>] => {
  const journey: Journey = { mode: RUN, legs };
  return [{ kind: "routed", journey }, summarizeJourney(journey)];
};

describe("routeStatus", () => {
  it.each<[string, JourneyLeg[], RouteStatus]>([
    ["only crossings", [crossing, crossing], { text: "No ground route between continents" }],
    ["no legs", [], { text: "No ground route between continents" }],
    ["a complete route", [ground(10), ground(75)], { text: "1 min 25 s · 146 yd" }],
    ["a ground leg and a crossing", [ground(10), crossing], { text: "10 s · 73 yd · not counting 1 crossing between continents" }],
    [
      "a route that skipped tiles without terrain data",
      [{ kind: "missing-coverage", tiles: tiles(3), route: ground(10) }, crossing, crossing],
      { text: "10 s · 73 yd · skipped 3 tiles without terrain data · not counting 2 crossings between continents" },
    ],
    ["a straight estimate", [ground(10), straight(5)], { text: "about 15 s · 103 yd · 1 straight leg", tone: "warn" }],
    ["two straight estimates", [straight(5), straight(5)], { text: "about 10 s · 60 yd · 2 straight legs", tone: "warn" }],
    [
      "failed legs that each keep a route",
      [
        { kind: "missing-coverage", tiles: tiles(1), route: ground(10) },
        { kind: "limit", cells: 9, route: ground(20) },
      ],
      { text: "about 30 s · 146 yd · provisional · no terrain data for 1 nearby tile · search limit", tone: "warn" },
    ],
    ["one leg with no path", [ground(10), noPath], { text: "no route · no path on leg 2", tone: "error" }],
    ["two legs with no path", [noPath, ground(10), noPath], { text: "no route · no path on legs 1, 3", tone: "error" }],
    [
      "no terrain at each end",
      [
        { kind: "no-terrain", endpoint: "start" },
        { kind: "no-terrain", endpoint: "end" },
      ],
      { text: "no route · no terrain at the start of leg 1 · no terrain at the end of leg 2", tone: "error" },
    ],
    [
      "a limit without a route, tiles, and a crossing",
      [{ kind: "limit", cells: 9 }, { kind: "missing-coverage", tiles: tiles(2) }, crossing],
      {
        text: "no route · no terrain data for 2 nearby tiles · search limit · not counting 1 crossing between continents",
        tone: "error",
      },
    ],
  ])("gives %s its chip text and tone", (_, legs, status) => {
    expect(routeStatus(...routed(legs))).toEqual(status);
  });

  it.each<[string, SearchView, RouteStatus]>([
    [
      "a search that runs",
      { kind: "calculating", journey: undefined, phase: "Finding walking paths…", searchingRides: new Map() },
      { text: "Finding walking paths…", busy: true },
    ],
    ["a cancelled search", { kind: "cancelled", journey: { mode: RUN, legs: [ground(10)] } }, { text: "Search cancelled." }],
    ["a failed search", { kind: "failed" }, { text: "The route search failed.", tone: "error" }],
    ["a search with no journey", { kind: "routed", journey: undefined }, { text: "No movement modes to route.", tone: "error" }],
  ])("gives %s its chip text and tone", (_, view, status) => {
    expect(routeStatus(view, summarizeJourney({ mode: RUN, legs: [ground(10)] }))).toEqual(status);
  });

  it("gives a journey without a summary no movement modes", () => {
    expect(routeStatus({ kind: "routed", journey: { mode: RUN, legs: [ground(10)] } }, undefined)).toEqual({
      text: "No movement modes to route.",
      tone: "error",
    });
  });
});
