import type { Point } from "./frame.ts";
import { describe, expect, it, vi } from "vitest";
import { at, flat, testFrame, whole } from "./fixtures/region.ts";
import { routeTrip, type LegUpdate } from "./journey.ts";
import { createPlan, DEFAULT_LEG, DEFAULT_MAX_SLOPE, type RoutePlan } from "./plan.ts";
import { noPathKey, recentRecords, searchKey } from "./reuse.ts";
import { routeLeg, type LegRequest, type LegResult } from "./search.ts";
import type { Rides, TransportLink } from "./transport.ts";

vi.mock("./search.ts", async (original) => {
  const actual = await original<typeof import("./search.ts")>();
  return { ...actual, routeLeg: vi.fn(actual.routeLeg) };
});

const WALL = 4;
const region = flat(9, 3);
for (let y = 0; y < 3; y++) region.blocked[y * 9 + WALL] = 1;
const terrain = whole(region);

const FRAMES = [testFrame(0), testFrame(1)];
const plan = (...stops: Point[]): RoutePlan => {
  const p = createPlan(at(stops[0]!), at(stops[1]!));
  return { ...p, stops: stops.map((s) => at(s)), legs: stops.slice(1).map(() => p.legs[0]!) };
};
const S: Point = [0, 0],
  T: Point = [8, 8],
  D: Point = [12, 0],
  E: Point = [0, 8];
const ship: TransportLink = {
  service: "ship-bootybay-ratchet",
  mode: "ship",
  from: { id: "DOCK_BOOTYBAY", name: "Booty Bay Harbor", map: 0, point: [12, 4] },
  to: { id: "DOCK_RATCHET", name: "Ratchet Harbor", map: 1, point: [24, 4] },
  requires: {},
  seconds: { min: 0, average: 10, max: 20 },
};

const trip = (p: RoutePlan, options: Omit<Parameters<typeof routeTrip>[2], "maxSlope"> = {}) =>
  routeTrip(p, (map) => ({ terrain: { ...terrain, frame: testFrame(map) }, groundKey: `map ${map}` }), {
    maxSlope: DEFAULT_MAX_SLOPE,
    ...options,
  });

function routeLikePage() {
  const records = recentRecords(256);
  return async (p: RoutePlan, rides?: Rides) => {
    vi.mocked(routeLeg).mockClear();
    const reports: LegUpdate[][] = [];
    const known = new Map(records.atStops(p, FRAMES, rides));
    const onLegs = (updates: LegUpdate[]) => (reports.push(updates), records.keepUpdates(updates));
    const journeys = await trip(p, { known, onLegs, ...(rides && { rides }) });
    const first = [...new Set(reports[0]?.map((u) => u.leg))];
    return { journeys, searched: vi.mocked(routeLeg).mock.calls.length, first };
  };
}

describe("ground result keys", () => {
  const leg = { ...DEFAULT_LEG, hazards: true };
  const request: LegRequest = {
    maxSlope: 50,
    swimming: { enabled: false, speed: 3.5 },
    mode: { name: "Run", speed: 7, activation: 0 },
    active: true,
    continues: true,
  };

  it("keys a search by its ends, its map, the leg's ground settings, and the whole request", () => {
    expect(searchKey([0, 0], [8, 8], leg, request, "map 0")).toBe(
      '0,0>8,8|["map 0",[true,true,true,false,true],{"maxSlope":50,"swimming":{"enabled":false,"speed":3.5},"mode":{"name":"Run","speed":7,"activation":0},"active":true,"continues":true}]',
    );
  });

  it("keys a missing path without the mode, so every mode of a trip shares it", () => {
    expect(noPathKey([0, 0], [8, 8], leg, request, "map 0")).toBe(
      '0,0>8,8|["map 0",[true,true,true,false,true],{"maxSlope":50,"swimming":{"enabled":false,"speed":3.5}}]',
    );
  });
});

describe("ground records", () => {
  const request: LegRequest = {
    maxSlope: DEFAULT_MAX_SLOPE,
    swimming: { enabled: false, speed: 3.5 },
    mode: { name: "Run", speed: 7, activation: 0 },
  };
  const key = (from: Point, to: Point) => searchKey(from, to, DEFAULT_LEG, request, "g");
  const straight = (seconds: number): LegResult => ({ kind: "straight", points: [S, T], distance: 0, activation: 0, seconds });
  const everywhere = plan(S, T, D, E, ship.from.point);

  it("keeps the newest results up to its limit, and keeping a result again makes it the newest", () => {
    const records = recentRecords(2);
    records.keep(key(S, T), straight(1));
    records.keep(key(T, D), straight(2));
    records.keep(key(S, T), straight(3));
    records.keep(key(D, E), straight(4));
    expect(records.atStops(everywhere, FRAMES)).toEqual([
      [key(S, T), straight(3)],
      [key(D, E), straight(4)],
    ]);
  });

  it("keeps the keyed results of leg updates and the keyed ground parts of their rides", () => {
    const records = recentRecords(8);
    const part = (from: Point, to: Point, seconds: number, keyed = true) => ({
      kind: "ground" as const,
      map: 0,
      from,
      to,
      result: straight(seconds),
      ...(keyed && { key: key(from, to) }),
    });
    records.keepUpdates([
      { mode: "Run", leg: 0, result: straight(1), key: key(S, T) },
      { mode: "Run", leg: 1, result: straight(2) },
      { mode: "Run", leg: 2, result: { kind: "crossing" } },
      {
        mode: "Run",
        leg: 3,
        result: { kind: "transport", parts: [part(D, ship.from.point, 3), { kind: "ride", link: ship }, part(E, S, 4, false)], seconds: 7 },
      },
    ]);
    expect(records.atStops(everywhere, FRAMES)).toEqual([
      [key(S, T), straight(1)],
      [key(D, ship.from.point), straight(3)],
    ]);
  });

  it("selects the records whose two ends are stops of the plan or of its rides", () => {
    const records = recentRecords(8);
    for (const [i, [from, to]] of (
      [
        [S, T],
        [T, D],
        [D, E],
        [D, ship.from.point],
      ] as const
    ).entries())
      records.keep(key(from, to), straight(i));
    const keys = (p: RoutePlan, rides?: Rides) => records.atStops(p, FRAMES, rides).map(([k]) => k);
    expect(keys(plan(T, D, E))).toEqual([key(T, D), key(D, E)]);
    expect(keys(plan(E, D, T))).toEqual([key(T, D), key(D, E)]);
    expect(keys(plan(S, D))).toEqual([]);
    expect(keys(plan(S, D), { links: [ship] })).toEqual([key(D, ship.from.point)]);
  });

  it("gives every record with `known` in place of the records of the same keys", () => {
    const records = recentRecords(8);
    records.keep(key(S, T), straight(1));
    records.keep(key(T, D), straight(2));
    expect([...records.merged(new Map([[key(S, T), straight(3)]]))]).toEqual([
      [key(S, T), straight(3)],
      [key(T, D), straight(2)],
    ]);
  });
});

describe("reuse of ground records in a later search", () => {
  it("searches again only the leg next to a stop whose height changed, or the leg whose ground setting changed", async () => {
    const route = routeLikePage();
    const p = plan(S, T, D, E);
    await route(p);
    const high = { ...p, stops: p.stops.with(3, at(E, 5)) };
    const raised = await route(high);
    expect([raised.searched, raised.first]).toEqual([1, [0, 1]]);
    expect(raised.journeys).toEqual(await trip(high));

    const hazards = { ...p, legs: p.legs.map((leg, i) => (i === 2 ? { ...leg, hazards: !leg.hazards } : leg)) };
    const set = await route(hazards);
    expect([set.searched, set.first]).toEqual([1, [0, 1]]);
    expect(set.journeys).toEqual(await trip(hazards));
    const rides = { ...p, legs: p.legs.map((leg, i) => (i === 1 ? { ...leg, otherFaction: !leg.otherFaction } : leg)) };
    expect(await route(rides)).toMatchObject({ searched: 0, first: [0, 1, 2] });
  });

  it("takes the ground parts of a ride without a search", async () => {
    const route = routeLikePage();
    const p = { ...plan([0, 4], [32, 4]), stops: [at([0, 4]), at([32, 4], null, testFrame(1))] };
    const rides = { links: [ship] };
    const first = await route(p, rides);
    expect(first.searched).toBe(5);
    expect(first.journeys.fastest?.legs.map((leg) => leg.kind)).toEqual(["transport"]);
    expect(await route(p, rides)).toEqual({ ...first, searched: 0 });
  });
});
