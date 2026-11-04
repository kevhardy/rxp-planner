import { describe, expect, it } from "vitest";
import type { Point } from "./frame.ts";
import { createPlan, insertWaypoint, moveStop, setLeg, type Leg, type RoutePlan } from "./plan.ts";
import type { TerrainRoute } from "./search.ts";
import { legReport, readRoute, writeRoute } from "./share.ts";

const route: TerrainRoute = {
  kind: "route",
  points: [
    [9000, 15000],
    [9000, 15030],
  ],
  descents: [],
  descentDrop: 0,
  falls: [],
  swims: [],
  swimDistance: 0,
  swimSeconds: 0,
  swimRemounts: [],
  distance: 31.25,
  terrainSeconds: 4.46,
  activation: 0,
  seconds: 4.4642,
};

function sample(): RoutePlan {
  let plan = createPlan(
    { instance: 0, x: -5604.1667, y: -395.8333, height: null },
    { instance: 1, x: 1234.5, y: -4321.25, height: null },
    "2026-10-06T00:00:00.000Z",
  );
  plan = insertWaypoint(plan, 0, { instance: 0, x: -5604.1667, y: -427.0833, height: 385.125 });
  plan = setLeg(plan, 1, {
    followTerrain: false,
    fatalFalls: true,
    hazards: true,
    otherFaction: true,
    flightPaths: false,
    shipPaths: false,
  });
  return {
    ...plan,
    settings: { swimming: { enabled: false, speed: 5 }, modes: plan.settings.modes.with(1, { name: "Mount", speed: 12, activation: 1.5 }) },
  };
}

const text = writeRoute(sample(), {
  artifacts: { 0: "routing-forever-1.60.1.70124-m0-test" },
  maxSlope: 50,
  mode: "Run",
  results: [legReport(route), legReport({ kind: "limit", cells: 250_000, route })],
});
const edited = (change: (route: Record<string, unknown>) => void) => {
  const value = JSON.parse(text) as Record<string, unknown>;
  change(value);
  return JSON.stringify(value);
};
const withStop = (stop: unknown) => edited((r) => ((r.stops as unknown[])[1] = stop));

describe("route text", () => {
  it("reads back as a new plan with the same stops, legs, and settings, and gives each leg's result to a reader", () => {
    expect(readRoute(text, "new")).toEqual({ ...sample(), id: "new" });
    expect(JSON.parse(text).context.results).toEqual([
      { status: "route", distance: 31.3, seconds: 4.5 },
      { status: "limit", distance: 31.3, seconds: 4.5, cells: 250_000 },
    ]);
  });

  it("keeps the ride choices of each leg", () => {
    expect(
      (JSON.parse(text).legs as Leg[]).map(({ otherFaction, flightPaths, shipPaths }) => [otherFaction, flightPaths, shipPaths]),
    ).toEqual([
      [false, true, true],
      [true, false, false],
    ]);
  });

  it("writes each stop as world yards on its map with its height, one stop on a line", () => {
    expect(text).toContain(
      [
        '"stops": [',
        '    {"instance":0,"x":-5604.1667,"y":-395.8333,"height":null},',
        '    {"instance":0,"x":-5604.1667,"y":-427.0833,"height":385.125},',
        '    {"instance":1,"x":1234.5,"y":-4321.25,"height":null}',
        "  ],",
        '  "legs"',
      ].join("\n"),
    );
    const placed = moveStop(sample(), 1, { instance: 0, x: -5604.1667, y: -427.0833, height: 496.125 });
    const copied = writeRoute(placed, { artifacts: {}, maxSlope: 50, results: [] });
    expect(readRoute(copied, "new").stops[1]).toEqual({ instance: 0, x: -5604.1667, y: -427.0833, height: 496.125 });
  });

  it("gives a reader the stop without terrain, the blocked stop, and the tiles without terrain data of a failed leg", () => {
    expect(legReport({ kind: "no-terrain", endpoint: "start" })).toEqual({ status: "no-terrain", endpoint: "start" });
    expect(legReport({ kind: "no-path", endpoint: "end" })).toEqual({ status: "no-path", endpoint: "end" });
    expect(legReport({ kind: "no-path" })).toEqual({ status: "no-path" });
    const tiles = [
      { tile: [3, 5] as [number, number], at: [1536, 2600] as Point },
      { tile: [4, 5] as [number, number], at: [2048, 2600] as Point },
    ];
    expect(legReport({ kind: "missing-coverage", tiles })).toEqual({
      status: "missing-coverage",
      tiles: [
        [3, 5],
        [4, 5],
      ],
    });
    expect(legReport({ kind: "missing-coverage", tiles, route })).toEqual({
      status: "missing-coverage",
      distance: 31.3,
      seconds: 4.5,
      tiles: [
        [3, 5],
        [4, 5],
      ],
    });
  });

  it("gives a reader each part of a leg with rides", () => {
    const stop = (id: string, point: [number, number]) => ({ id, name: id, map: 0, point });
    const link = {
      service: "ship",
      mode: "ship",
      from: stop("A", [1, 1]),
      to: stop("B", [2, 2]),
      requires: {},
      seconds: { min: 1, average: 2, max: 3 },
    };
    const parts = [
      { kind: "ground" as const, map: 0, from: [9000, 15000] as Point, to: [9000, 15030] as Point, result: route },
      { kind: "ride" as const, link },
      { kind: "ride" as const, link: { ...link, placeholder: true as const } },
    ];
    expect(legReport({ kind: "transport", parts, seconds: 10.4642 })).toEqual({
      status: "transport",
      distance: 31.3,
      seconds: 10.5,
      parts: [
        { kind: "ground", status: "route", distance: 31.3, seconds: 4.5 },
        { kind: "ride", service: "ship", from: "A", to: "B", seconds: { min: 1, average: 2, max: 3 } },
        { kind: "ride", service: "ship", from: "A", to: "B", seconds: { min: 1, average: 2, max: 3 }, placeholder: true },
      ],
    });
  });

  it.each([
    ["empty text", "  \n", "Paste the text of a copied route."],
    ["text that is not JSON", "Route 1: A → B", /^Not valid JSON/],
    ["another format", edited((r) => (r.format = "wow-routing-plan")), 'route.format: expected "restedxp-route"'],
    [
      "version 2, with native pixel stops",
      edited((r) => {
        r.version = 2;
        r.stops = [
          [9000, 15000],
          [9100, 15100],
        ];
      }),
      "route.version: this planner no longer reads version 2 route text. It reads version 3",
    ],
    ["a later version", edited((r) => (r.version = 4)), "route.version: expected 3, the version that this planner reads"],
    [
      "a height that is not a number",
      withStop({ instance: 0, x: 1, y: 2, height: "385" }),
      "route.stops[1].height: expected a number of yards or null",
    ],
    ["a stop with a floor", withStop({ instance: 0, x: 1, y: 2, height: null, floor: "upper" }), "route.stops[1].floor: unknown field"],
    ["the old heights list", edited((r) => (r.heights = [null, 385.125, null])), "route.heights: unknown field"],
    [
      "a leg without a ride choice",
      edited((r) => delete (r.legs as Record<string, unknown>[])[0]!.shipPaths),
      "route.legs[0].shipPaths: missing",
    ],
    ["a native pixel pair", withStop([9000, 15030]), "route.stops[1]: expected a world stop { instance, x, y, height }"],
    ["a fractional map", withStop({ instance: 0.5, x: 1, y: 2, height: null }), "route.stops[1].instance: expected a map ID from 0"],
    ["text for a coordinate", withStop({ instance: 0, x: "1", y: 2, height: null }), "route.stops[1].x: expected finite world yards"],
    [
      "too many stops",
      edited((r) => (r.stops = Array.from({ length: 101 }, () => ({ instance: 0, x: 1, y: 2, height: null })))),
      "route.stops: expected at most 100 entries",
    ],
    [
      "a leg setting that is not true or false",
      edited((r) => ((r.legs as Record<string, unknown>[])[0]!.hazards = "no")),
      "route.legs[0].hazards: expected true or false",
    ],
    [
      "an other faction's rides choice that is not true or false",
      edited((r) => ((r.legs as Record<string, unknown>[])[0]!.otherFaction = 1)),
      "route.legs[0].otherFaction: expected true or false",
    ],
  ])("rejects %s", (_, input, error) => {
    expect(() => readRoute(input, "new")).toThrow(error);
  });
});
