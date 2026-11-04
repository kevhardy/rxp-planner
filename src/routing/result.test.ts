import type { Point } from "./frame.ts";
import { describe, expect, it } from "vitest";
import type { Journey } from "./journey.ts";
import type { MovementMode } from "./plan.ts";
import { fallLines, floorLines, floorName, groundLabel, rideKinds, rideLabel, rideTime, summarizeJourney, summarizeLeg } from "./result.ts";
import type { LegResult, TerrainRoute } from "./search.ts";
import type { TransportLink } from "./transport.ts";

const run: MovementMode = { name: "Run", speed: 7, activation: 0 };

const terrainRoute = (points: Point[], seconds: number): TerrainRoute => ({
  kind: "route",
  points,
  descents: [],
  descentDrop: 0,
  falls: [],
  swims: [],
  swimDistance: 0,
  swimSeconds: 0,
  swimRemounts: [],
  distance: 999,
  terrainSeconds: seconds,
  activation: 0,
  seconds,
});
const straight: LegResult = {
  kind: "straight",
  points: [
    [0, 0],
    [0, 96],
  ],
  distance: 100,
  activation: 0,
  seconds: 20,
};
const route = terrainRoute(
  [
    [0, 0],
    [96, 0],
    [96, 96],
  ],
  30,
);
const journey = (...legs: LegResult[]): Journey => ({ mode: run, legs });
const rideLink = (mode: string): TransportLink => ({
  service: "ride",
  mode,
  from: { id: "A", name: "A", map: 0, point: [0, 0] },
  to: { id: "B", name: "B", map: 0, point: [96, 0] },
  requires: {},
  seconds: { min: 10, average: 10, max: 10 },
});

describe("leg results", () => {
  it.each([
    ["toString", "toString to B", "Run to toString", "ToString"],
    ["ship", "Ship to B", "Run to the ship", "Ship"],
    ["transition", "Portal to B", "Run to the portal", "Portal"],
    ["flight", "Fly to B", "Run to the flight master", "Flight"],
  ])("labels ride mode %s without inherited names", (mode, label, ground, kinds) => {
    const link = rideLink(mode);
    expect([
      rideLabel([link]),
      groundLabel("Run", link, "destination"),
      rideKinds({ kind: "transport", parts: [{ kind: "ride", link }], seconds: 10 }),
    ]).toEqual([label, ground, kinds]);
  });

  it("names each kind of ride once, after a transition reads as a portal", () => {
    const parts = ["portal", "transition", "portal"].map((mode) => ({ kind: "ride" as const, link: rideLink(mode) }));
    expect(rideKinds({ kind: "transport", parts, seconds: 30 })).toBe("Portal");
  });

  const at: Point = [0, 0];

  it("gives each result kind its own label, measure, and source", () => {
    const provisional = terrainRoute([at, [96, 0]], 12);
    const cases: [LegResult, object][] = [
      [
        route,
        {
          label: "Terrain route",
          measure: { seconds: 30, distance: 200, basis: "complete" },
          source: "terrain",
          provenance: "Terrain only",
        },
      ],
      [straight, { label: "Straight-line estimate", measure: { seconds: 20, distance: 100, basis: "estimate" }, source: "straight" }],
      [
        { kind: "no-path", endpoint: "end" },
        { label: "No path: the end is blocked, too steep, or in water", source: "none" },
      ],
      [
        { kind: "missing-coverage", tiles: [{ tile: [1, 2], at }], route: provisional },
        {
          label:
            "Missing coverage: terrain data unavailable for 1 nearby tile; the route is provisional because a faster one may pass through them",
          measure: { basis: "provisional" },
          source: "terrain",
        },
      ],
      [
        { kind: "limit", cells: 5_000_000 },
        { label: "Search limit: needs 5,000,000 cells", source: "none" },
      ],
      [
        { kind: "limit", cells: 9, route: provisional },
        {
          label: "Search limit: needs 9 cells; provisional route shown",
          measure: { seconds: 12, distance: 100, basis: "provisional" },
          source: "terrain",
        },
      ],
      [
        { kind: "no-terrain", endpoint: "start" },
        { label: "No terrain at the start", source: "none", provenance: "No route" },
      ],
    ];
    for (const [result, expected] of cases) expect(summarizeLeg(result)).toMatchObject(expected);
    expect(summarizeLeg({ kind: "no-path" }).measure).toBeUndefined();
    expect(summarizeLeg(straight).provenance).toBe("Straight line, not checked against terrain");
  });

  it("times a ride at its average wait, with the spread from its shortest to its longest wait", () => {
    const ship = (min: number, average: number, max: number): TransportLink => ({
      service: "ship",
      mode: "ship",
      from: { id: "A", name: "A", map: 0, point: [0, 0] },
      to: { id: "B", name: "B", map: 0, point: [96, 0] },
      requires: {},
      seconds: { min, average, max },
    });
    expect(rideTime([ship(40, 150, 260)])).toEqual({ cost: "2 min 30 s", spread: "40 s to 4 min 20 s" });
    expect(rideTime([ship(30, 30, 30)])).toEqual({ cost: "30 s" });
  });
});

describe("journey totals", () => {
  it("is complete only when every leg is a terrain route", () => {
    const { total } = summarizeJourney(journey(route, route));
    expect(total).toEqual({ kind: "complete", seconds: 60, distance: 400 });
  });

  it("labels a total with a straight leg as an estimate", () => {
    const { total } = summarizeJourney(journey(route, straight));
    expect(total).toEqual({ kind: "estimate", seconds: 50, distance: 300, straight: [1] });
  });

  it("gives no total after a failed leg, and names the failed legs", () => {
    const failed = summarizeJourney(journey(route, { kind: "limit", cells: 9, route }, straight, { kind: "no-terrain", endpoint: "end" }));
    expect(failed.total).toEqual({
      kind: "none",
      failed: [
        { leg: 1, kind: "limit" },
        { leg: 3, kind: "no-terrain" },
      ],
    });
    expect(failed.legs.map((leg) => leg.measure?.basis)).toEqual(["complete", "provisional", "estimate", undefined]);
  });
});

describe("floors and falls", () => {
  it("names a floor from the ground floor of its building", () => {
    const names = [-2, -1, 0, 1, 3].map((index) => floorName(index, 0));
    expect(names).toEqual(["lower level", "lower level", "ground floor", "upper level", "upper level"]);
    expect(floorName(0, 3)).toBe("lower level");
  });

  it("gives the floor of the end, and the door where a stop's floor is not known", () => {
    const lines = (stops?: TerrainRoute["stops"]) => floorLines({ ...route, ...(stops && { stops }) });
    expect(lines()).toEqual([]);
    expect(
      lines([
        { class: "target", floor: { index: 2, ground: 1, confirmed: true } },
        { class: "target", floor: { index: 0, ground: 1, confirmed: true } },
      ]),
    ).toEqual([{ text: "Inside: lower level", side: 1, warn: false }]);
    expect(
      lines([
        { class: "building", floor: "door" },
        { class: "target", floor: "door" },
      ]),
    ).toEqual([
      { text: "Start inside: floor not known. The route starts at the door.", side: 0, warn: true },
      { text: "Inside: floor not known. The route stops at the door.", side: 1, warn: true },
    ]);
    expect(lines([{ class: "hint" }, { class: "ground" }])).toEqual([]);
  });

  it("warns at each stop whose floor is not confirmed", () => {
    expect(
      floorLines({
        ...route,
        stops: [
          { class: "target", floor: { index: 0, ground: 1, confirmed: false } },
          { class: "target", floor: { index: 2, ground: 1, confirmed: false } },
        ],
      }),
    ).toEqual([
      { text: "Start inside: lower level. The floor is not confirmed.", side: 0, warn: true },
      { text: "Inside: upper level. The floor is not confirmed.", side: 1, warn: true },
    ]);
  });

  it("gives each fall that deals damage, and the fatal ones", () => {
    const falls = (...heights: number[]) => fallLines({ ...route, falls: heights.map((height, point) => ({ point, height })) });
    expect(falls(13, 31.5, 70)).toEqual([
      { height: "31.5 yd", damage: "~32% HP", fatal: false },
      { height: "70.0 yd", damage: "Fatal", fatal: true },
    ]);
  });
});
