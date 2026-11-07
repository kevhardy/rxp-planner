import { afterEach, describe, expect, it, vi } from "vitest";
import { FlightNodes, type WorldLocation } from "../data/index.ts";
import { worldToMap, type WorldBounds } from "../data/maps.ts";
import { interiorsFixture } from "../data/manifestFixture.ts";
import { fromSurfaces } from "../data/surfaces.ts";
import { parseGuide } from "../guide/index.ts";
import { createProfile, simulateRoute, type SimData, type Standing } from "../rules/index.ts";
import { simQuest, testRules } from "../rules/testing.ts";
import { nativeStop, worldToNative, type NativeFrame, type Point } from "./frame.ts";
import type { JourneyLeg, Journeys } from "./journey.ts";
import { PlaybackRouting, ridesFor, type Playback, type PlaybackInput, type WayRouter } from "./playback.ts";
import type { RoutePlan, WorldStop } from "./plan.ts";
import type { LegStop, TerrainRoute } from "./search.ts";
import type { TransportLink, TransportStop } from "./transport.ts";

const frame: NativeFrame = {
  scope: { map: 0 },
  frame: { origin: [23, 20], size: [23, 42], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
};
const world = (x: number, y: number): WorldLocation => ({ instance: 0, x, y });
const native = (at: WorldLocation) => worldToNative(frame, at) as Point;
const heightsOf = (plan: RoutePlan) => plan.stops.map((stop) => stop.height);
const BASE = world(-250, -8800);
const loc = (x: number, y: number) => world(BASE.x + x, BASE.y + y);
const ELWYNN: WorldBounds = { instance: 0, minX: -10254.166, minY: -1935.4166, maxX: -7939.583, maxY: 1535.4166 };
function elwynn(at: WorldLocation): string {
  const { x, y } = worldToMap(ELWYNN, at);
  return `Elwynn Forest,${x.toFixed(2)},${y.toFixed(2)}`;
}
const worldGoto = (zone: string, at: WorldLocation) => `${zone}/${at.instance},${at.x},${at.y}`;

const input = (...points: WorldLocation[]) => guideInput(points.map((at) => [elwynn(at), at]));

function guideInput(gotos: [string, WorldLocation][]): PlaybackInput {
  const data: SimData = {
    quest: () => undefined,
    npc: () => undefined,
    item: () => undefined,
    rules: testRules,
    entityByName: () => undefined,
    flights: new FlightNodes(),
    uiMapNamed: () => undefined,
    locateGoto: (args) => gotos.find(([text]) => text === args.join(","))?.[1],
  };
  const steps = gotos.map(([text]) => `step\n.goto ${text}\n+Walk\n`).join("");
  const guides = [parseGuide(`#group G\n#name A\n${steps}`)];
  const profile = createProfile({ race: "Human", class: "WARRIOR", level: 1 });
  return { simulation: simulateRoute(guides, 0, profile, data), guides, profile, data, npcs: {} };
}

function terrainRoute(points: WorldLocation[], heights: number[], seconds: number): TerrainRoute {
  return {
    kind: "route",
    points: points.map(native),
    heights,
    descents: [],
    descentDrop: 0,
    falls: [],
    swims: [],
    swimDistance: 0,
    swimSeconds: 0,
    swimRemounts: [],
    distance: 0,
    terrainSeconds: seconds,
    activation: 0,
    seconds,
  };
}

function router(points: WorldLocation[], heights: number[], seconds: number): WayRouter & { calls: number } {
  const route = terrainRoute(points, heights, seconds);
  const fake = {
    frames: [frame],
    calls: 0,
    route: async (): Promise<Journeys> => {
      fake.calls++;
      return { journeys: [{ mode: { name: "Run", speed: 7, activation: 0 }, legs: [route], seconds }] };
    },
  };
  return fake;
}

function detourRouter(ends: WorldLocation[]): WayRouter {
  const end = (at: WorldStop) => ends.find((e) => Math.hypot(e.x - at.x, e.y - at.y) < 2)!;
  return {
    frames: [frame],
    route: (plan, mode, signal, rides) => {
      const [a, b] = plan.stops.map(end) as [WorldLocation, WorldLocation];
      return router([a, world((a.x + b.x) / 2 + 10, (a.y + b.y) / 2), b], [18, 14, 18], 10).route(plan, mode, signal, rides);
    },
  };
}

function withStops(fake: WayRouter, stops: [LegStop, LegStop]): WayRouter {
  return {
    ...fake,
    route: async (...args) => {
      const result = await fake.route(...args);
      const leg = result.journeys[0]!.legs[0]!;
      if (leg.kind === "route") leg.stops = stops;
      return result;
    },
  };
}

const rounded = (place: Standing | undefined, origin: WorldLocation = BASE) =>
  place && [
    Math.round((place.x - origin.x) * 100) / 100,
    Math.round((place.y - origin.y) * 100) / 100,
    place.height === undefined ? null : Math.round(place.height),
  ];

describe("PlaybackRouting", () => {
  it("walks to a pass-by spawn on the way and fights there before it accepts at the camp", async () => {
    const [start, camp, spawn] = [loc(0, 0), loc(200, 0), { ...loc(100, 20), id: "npc:6:1" }];
    const vermin = { index: 1, kind: "monster" as const, ids: [6], count: 2, name: "Kobold Vermin" };
    const data: SimData = {
      quest: (id) =>
        id === 7
          ? simQuest({ name: "Kobold Camp Cleanup", baseXp: 100, objectives: [vermin] })
          : id === 5261
            ? simQuest({ name: "Eagan Peltskinner", baseXp: 100 })
            : undefined,
      npc: () => ({ levels: { min: 1, max: 2 }, elite: false, zoneIds: [] }),
      item: () => undefined,
      rules: testRules,
      entityByName: () => undefined,
      flights: new FlightNodes(),
      uiMapNamed: () => undefined,
      locateGoto: (args) => (args.join(",") === elwynn(start) ? start : camp),
      spawns: () => [spawn],
    };
    const guides = [
      parseGuide(
        "#group G\n#name A\n" +
          `step\n.goto ${elwynn(start)}\n.accept 7\n` +
          "step\n#completewith Camp\n.complete 7,1\n.mob Kobold Vermin::6\n" +
          `step\n#label Camp\n.goto ${elwynn(camp)}\n.accept 5261\n`,
      ),
    ];
    const profile = createProfile({ race: "Human", class: "WARRIOR", level: 1 });
    const simulation = simulateRoute(guides, 0, profile, data);
    const playback = await new PlaybackRouting(null).play(
      { simulation, guides, profile, data, npcs: { spawns: () => [spawn] } },
      Infinity,
      () => 0,
    );
    const step = playback.timeline.steps.find((s) => s.step === 2)!;
    const [kill, travel, accept] = step.activities;

    expect(step.activities.slice(0, 3).map((a) => a.kind)).toEqual(["kill", "travel", "interact"]);
    expect(
      kill?.kind === "kill" &&
        kill.walk?.kills.map((k) => [
          [Number((k.at.x - BASE.x).toFixed(2)), Number((k.at.y - BASE.y).toFixed(2))],
          Number(k.arrive.toFixed(3)),
          Number(k.end.toFixed(3)),
        ]),
    ).toEqual([[[90.19, 18.04], 13.14, 28.14]]);
    expect(travel!.seconds).toBeCloseTo(19.076, 3);
    expect(rounded(playback.at(kill!.start + 20)!.place)).toEqual([90.19, 18.04, null]);
    expect(rounded(playback.at(accept!.start)!.place)).toEqual([200, 0, null]);
    expect(simulation.guides[0]!.steps[2]!.kills.map((k) => k.count)).toEqual([1]);
    expect(playback.at(accept!.start)!.character.log.get(7)!.objectives[0]!.count).toBe(1);
    expect(simulation.guides[0]!.steps[2]!.state.position).toEqual(camp);
  });
  it("clears the cave height when deathskip resurrects at a Spirit Healer", async () => {
    const [from, cave] = [loc(0, 0), loc(30, 60)];
    const healer = { ...world(-179.17, -8944.17), uiMapId: 1429 };
    const base = input(from, cave);
    const guides = [
      parseGuide(
        `#group G\n#name A\nstep\n.goto ${elwynn(from)}\n+Walk\nstep\n.goto ${elwynn(cave)}\n+Enter cave\nstep\n#softcore\n#completewith next\n.deathskip\nstep\n.vendor`,
      ),
    ];
    const data = { ...base.data, nearestSpiritHealer: () => healer };
    const playback = await new PlaybackRouting(router([from, cave], [20, 10], 10), { every: 0 }).play(
      { ...base, guides, data, simulation: simulateRoute(guides, 0, base.profile, data) },
      Infinity,
      () => 0,
    );
    expect(rounded(playback.at(39)!.place)).toEqual([30, 60, 10]);
    expect(playback.at(40)!.place).toEqual(healer);
    expect(playback.at(40)!.character.position).toEqual(healer);
  });

  it("keeps the cave height when the setting ignores the deathskip", async () => {
    const [from, cave] = [loc(0, 0), loc(30, 60)];
    const base = input(from, cave);
    const guides = [
      parseGuide(
        `#group G\n#name A\nstep\n.goto ${elwynn(from)}\n+Walk\nstep\n.goto ${elwynn(cave)}\n+Enter cave\nstep\n#softcore\n#completewith next\n.deathskip\nstep\n.vendor`,
      ),
    ];
    const data = { ...base.data, nearestSpiritHealer: () => ({ ...world(-179.17, -8944.17), uiMapId: 1429 }) };
    const simulation = simulateRoute(guides, 0, base.profile, data, 0, undefined, { ignoreDeathskip: true });
    const playback = await new PlaybackRouting(router([from, cave], [20, 10], 10), { every: 0 }).play(
      { ...base, guides, data, simulation },
      Infinity,
      () => 0,
    );
    expect([20, 40].map((t) => rounded(playback.at(t)!.place))).toEqual([
      [30, 60, 10],
      [30, 60, 10],
    ]);
    expect(playback.at(40)!.character.position).toEqual(cave);
  });

  it("prices with straight travel at once, then places the character along the routed way at each second", async () => {
    const [a, mid, b] = [loc(0, 0), loc(30, 0), loc(30, 60)];
    const routing = new PlaybackRouting(router([a, mid, b], [10, 12, 18], 30), { every: 0 });
    const seen: number[] = [];
    const playback = await routing.play(
      input(a, b),
      Infinity,
      () => 0,
      (p) => seen.push(p.timeline.totals.seconds),
    );
    expect(seen.map(Math.round)).toEqual([11, 30]);
    expect([5, 10, 20, 30].map((t) => rounded(playback.at(t)!.place))).toEqual([
      [15, 0, 11],
      [30, 0, 12],
      [30, 30, 15],
      [30, 60, 18],
    ]);
    expect([playback.at(5)!.doing, playback.ways(1)[0]!.source, playback.ways(1)[0]!.estimate, playback.routing]).toEqual([
      "Traveling to Elwynn Forest,50.58,34.58",
      "routing",
      undefined,
      { asked: 1, routed: 1, pending: 0, straight: {} },
    ]);
  });

  it("runs a straight line between the guide point and the door when a route stops at a door", async () => {
    const [from, door, to] = [loc(0, 0), loc(21, 0), loc(21, 60)];
    const fake = withStops(router([door, to], [10, 18], 10), [{ class: "building", floor: "door", building: 7 }, { class: "ground" }]);
    const playback = await new PlaybackRouting(fake, { every: 0 }).play(input(from, to), Infinity, () => 0);
    expect(playback.timeline.totals.seconds).toBeCloseTo(13);
    expect([1.5, 3, 8].map((t) => rounded(playback.at(t)!.place))).toEqual([
      [10.5, 0, 10],
      [21, 0, 10],
      [21, 30, 14],
    ]);
    expect([playback.ways(1)[0]!.source, playback.ways(1)[0]!.estimate, playback.routing]).toEqual([
      "routing",
      "door-line",
      { asked: 1, routed: 1, pending: 0, straight: {} },
    ]);
  });

  it.each([
    ["head", 21, 0, 33, 13, "zeppelin", "Taking the zeppelin to Dalaran"],
    ["tail", 0, 14, 32, 10, "zeppelin", "Taking the zeppelin to Dalaran"],
    ["head and tail", 21, 14, 35, 13, "zeppelin", "Taking the zeppelin to Dalaran"],
    ["unknown mode", 21, 0, 33, 13, "toString", "Riding to Dalaran"],
    ["transition", 21, 0, 33, 13, "transition", "Riding to Dalaran"],
    ["access", 21, 0, 33, 13, "access", "Riding to Dalaran"],
    ["druid flight", 21, 0, 33, 13, "druid-flight", "Riding to Dalaran"],
  ])("keeps the ride and its timing with a transport door line at the %s", async (_, head, tail, seconds, rideStart, mode, doing) => {
    const [from, door, dock, landing, end, to] = [loc(0, 0), loc(head, 0), loc(70, 0), loc(140, 0), loc(210, 0), loc(210 + tail, 0)];
    const first = terrainRoute([door, dock], [10, 10], 10);
    first.stops = [head ? { class: "building", floor: "door", building: 7 } : { class: "ground" }, { class: "ground" }];
    const last = terrainRoute([landing, end], [20, 20], 10);
    last.stops = [{ class: "ground" }, tail ? { class: "building", floor: "door", building: 8 } : { class: "ground" }];
    const link: TransportLink = {
      service: "ship-zephras-dalaran",
      mode,
      from: { id: "start", name: "Zephras Isle", map: 0, point: native(dock) },
      to: { id: "end", name: "Dalaran", map: 0, point: native(landing) },
      requires: { faction: "Alliance" },
      seconds: { min: 6, average: 10, max: 14 },
    };
    const leg: JourneyLeg = {
      kind: "transport",
      parts: [
        { kind: "ground", map: 0, from: native(from), to: native(dock), result: first },
        { kind: "ride", link },
        { kind: "ground", map: 0, from: native(landing), to: native(to), result: last },
      ],
      seconds: 30,
    };
    const fake: WayRouter = {
      frames: [frame],
      route: async () => ({ journeys: [{ mode: { name: "Run", speed: 7, activation: 0 }, legs: [leg], seconds: 30 }] }),
    };
    const playback = await new PlaybackRouting(fake, { every: 0 }).play(input(from, to), Infinity, () => 0);
    expect(playback.ways(1)[0]!.estimate).toBe("door-line");
    expect(playback.timeline.totals.seconds).toBeCloseTo(seconds);
    expect(playback.at(rideStart + 1)!.doing).toBe(doing);
    expect(rounded(playback.at(rideStart + 1)!.place)).toEqual([70, 0, null]);
    expect(rounded(playback.at(rideStart + 7)!.place)).toEqual([105, 0, null]);
    expect(rounded(playback.at(rideStart + 15)!.place)).toEqual([175, 0, 20]);
  });

  it("runs a straight line from the nearest walkable ground when a route stops short of a steep guide point", async () => {
    const [from, snap, to] = [loc(0, 0), loc(30, 0), loc(37, 0)];
    const fake = withStops(router([from, snap], [10, 12], 10), [{ class: "ground" }, { class: "ground", steep: true }]);
    const playback = await new PlaybackRouting(fake, { every: 0 }).play(input(from, to), Infinity, () => 0);
    expect(playback.timeline.totals.seconds).toBeCloseTo(11);
    expect([5, 10.5, 11].map((t) => rounded(playback.at(t)!.place))).toEqual([
      [15, 0, 11],
      [33.5, 0, 12],
      [37, 0, 12],
    ]);
    expect([playback.ways(1)[0]!.estimate, playback.routing]).toEqual(["steep-line", { asked: 1, routed: 1, pending: 0, straight: {} }]);
  });

  it.each([
    [
      "leaves and enters one building",
      loc(0, 5),
      { class: "target", floor: { index: 1, ground: 0, confirmed: true }, building: 7 } as const,
    ],
    ["stops at a door 80 yd from its guide point", loc(0, -80), { class: "ground" } as const],
  ])("keeps an estimate when a route %s", async (_, door, end) => {
    const [from, to] = [loc(0, 0), loc(30, 60)];
    const fake = withStops(router([door, to], [10, 10], 10), [{ class: "building", floor: "door", building: 7 }, end]);
    const playback = await new PlaybackRouting(fake, { every: 0 }).play(input(from, to), Infinity, () => 0);
    expect(Math.round(playback.timeline.totals.seconds)).toBe(11);
    expect(playback.ways(1)[0]!.estimate).toBe("interior-path-missing");
    expect(rounded(playback.at(playback.timeline.totals.seconds / 2)!.place)).toEqual([15, 30, null]);
    expect(playback.routing).toEqual({ asked: 1, routed: 0, pending: 0, straight: { "interior-path-missing": 1 } });
  });

  describe("when a leg starts where the last leg ended", () => {
    const [a, b, c] = [loc(0, 0), loc(70, 0), loc(70, 70)];
    function caveRouter(
      plain: JourneyLeg,
      pinned: JourneyLeg = terrainRoute([b, c], [0, 0], 12),
      ends: [WorldLocation, WorldLocation] = [a, b],
    ): WayRouter & { heights: (number | null)[][] } {
      const fake = {
        frames: [frame],
        heights: [] as (number | null)[][],
        route: async (plan: RoutePlan): Promise<Journeys> => {
          fake.heights.push(heightsOf(plan));
          const first = plan.stops[0]!.x - ends[0].x < 35;
          const leg = first ? terrainRoute(ends, [0, 0], 10) : plan.stops[0]!.height === 0 ? pinned : plain;
          return { journeys: [{ mode: { name: "Run", speed: 7, activation: 0 }, legs: [leg], seconds: 10 }] };
        },
      };
      return fake;
    }
    const above = (height: number) => terrainRoute([b, c], [height, height], 10);

    it.each([
      ["routes from a storey above it", above(20)],
      ["finds no path", { kind: "no-path", endpoint: "start" } as const],
    ])("takes the leg again from that floor when its route %s", async (_, plain) => {
      const fake = caveRouter(plain);
      const seen: Playback[] = [];
      const playback = await new PlaybackRouting(fake, { every: 0 }).play(
        input(a, b, c),
        Infinity,
        () => 0,
        (p) => seen.push(p),
      );
      expect(seen.map((p) => p.routing.pending)).toEqual([2, 1, 0]);
      expect(playback.timeline.totals.seconds).toBeCloseTo(22);
      expect(rounded(playback.at(16)!.place)).toEqual([70, 35, 0]);
      expect(fake.heights).toEqual([
        [null, null],
        [null, null],
        [0, 0],
      ]);
      expect(playback.routing).toEqual({ asked: 2, routed: 2, pending: 0, straight: {} });
    });

    it("keeps the leg with no path, counted once, when that floor finds no path too", async () => {
      const noPath = { kind: "no-path", endpoint: "end" } as const;
      const fake = caveRouter(noPath, noPath);
      const playback = await new PlaybackRouting(fake, { every: 0 }).play(input(a, b, c), Infinity, () => 0);
      expect(fake.heights).toEqual([
        [null, null],
        [null, null],
        [0, 0],
      ]);
      expect(playback.routing).toEqual({ asked: 2, routed: 1, pending: 0, straight: { "no-path": 1 } });
    });

    it("takes a transport leg again from that floor when its first ground part starts a storey above it, and leaves its far end unpinned", async () => {
      const [stormwind, ironforge] = [world(523.52, -8356.07), world(-1317.71, -4839.53)];
      const square = world(453.52, -8356.07);
      const tram = (height: number): JourneyLeg => {
        const [stop, end] = (
          [
            [stormwind, "TRAM_STORMWIND", "Stormwind City"],
            [ironforge, "TRAM_IRONFORGE", "Ironforge"],
          ] as const
        ).map(([at, id, name]): TransportStop => ({ id, name, map: 0, point: native(at) }));
        const link: TransportLink = {
          service: "tram-stormwind-ironforge",
          mode: "tram",
          from: stop!,
          to: end!,
          requires: { faction: "Alliance" },
          seconds: { min: 2, average: 2, max: 2 },
        };
        const ground = terrainRoute([stormwind, stormwind], [height, height], 1);
        return {
          kind: "transport",
          parts: [
            { kind: "ground", map: 0, from: native(stormwind), to: native(stormwind), result: ground },
            { kind: "ride", link },
          ],
          seconds: 3,
        };
      };
      const fake = caveRouter(tram(20), tram(0), [square, stormwind]);
      const gotos: [string, WorldLocation][] = [
        [worldGoto("Stormwind City", square), square],
        [worldGoto("Stormwind City", stormwind), stormwind],
        [worldGoto("Ironforge", ironforge), ironforge],
      ];
      const playback = await new PlaybackRouting(fake, { every: 0 }).play(guideInput(gotos), Infinity, () => 0);
      expect(fake.heights).toEqual([
        [null, null],
        [null, null],
        [0, null],
      ]);
      expect(rounded(playback.at(10.5)!.place, stormwind)).toEqual([0, 0, 0]);
      expect(playback.routing).toEqual({ asked: 2, routed: 2, pending: 0, straight: {} });
    });

    it("keeps a route that starts within a storey of that floor", async () => {
      const fake = caveRouter(above(3));
      const playback = await new PlaybackRouting(fake, { every: 0 }).play(input(a, b, c), Infinity, () => 0);
      expect(playback.timeline.totals.seconds).toBeCloseTo(20);
      expect(rounded(playback.at(15)!.place)).toEqual([70, 35, 3]);
      expect(fake.heights).toEqual([
        [null, null],
        [null, null],
      ]);
    });
  });

  it("routes nothing new when it plays the same input again", async () => {
    const fake = router([loc(0, 0), loc(30, 60)], [0, 0], 30);
    const routing = new PlaybackRouting(fake, { every: 0 });
    const route = input(loc(0, 0), loc(30, 60));
    await routing.play(route, Infinity, () => 0);
    const again = await routing.play(route, Infinity, () => 0);
    expect([fake.calls, again.timeline.totals.seconds]).toEqual([1, 30]);
  });

  it("routes nearby endpoints independently of earlier playback inputs", async () => {
    let calls = 0;
    const fake: WayRouter = {
      frames: [frame],
      route: async (plan) => {
        calls++;
        const [a, b] = plan.stops.map((stop) => nativeStop(frame, stop).point);
        const seconds = Math.hypot(b![0] - a![0], b![1] - a![1]);
        const route = terrainRoute(plan.stops, [0, 0], seconds);
        return { journeys: [{ mode: { name: "Run", speed: 1, activation: 0 }, legs: [route], seconds }] };
      },
    };
    const routing = new PlaybackRouting(fake, { every: 0 });
    const first = await routing.play(input(loc(0, 0), loc(30, 0)), Infinity, () => 0);
    const changed = input(loc(0, 0), loc(32, 0));
    const warm = await routing.play(changed, Infinity, () => 0);
    const fresh = await new PlaybackRouting(fake, { every: 0 }).play(changed, Infinity, () => 0);
    const repeated = await routing.play(changed, Infinity, () => 0);
    expect([first, warm, fresh, repeated].map((p) => p.timeline.totals.seconds)).toEqual([29, 31, 31, 31]);
    expect(calls).toBe(3);
  });

  it("keeps the ways of the legs that a route still takes after a step before them", async () => {
    const fake = router([loc(0, 0), loc(30, 0)], [0, 0], 30);
    const routing = new PlaybackRouting(fake, { every: 0 });
    await routing.play(input(loc(0, 0), loc(30, 0), loc(60, 0)), Infinity, () => 0);
    const shifted = await routing.play(input(loc(-30, 0), loc(0, 0), loc(30, 0), loc(60, 0)), Infinity, () => 0);
    expect([fake.calls, shifted.routing]).toEqual([3, { asked: 3, routed: 3, pending: 0, straight: {} }]);
  });

  it("prices exact door tails even when endpoints share a native pixel", async () => {
    const from = loc(0, 0);
    const fake = withStops(router([from, loc(21, 0)], [0, 0], 10), [
      { class: "ground" },
      { class: "building", floor: "door", building: 7 },
    ]);
    const routing = new PlaybackRouting(fake, { every: 0 });
    const first = await routing.play(input(from, loc(30, 0)), Infinity, () => 0);
    const changed = input(from, loc(30.2, 0));
    const warm = await routing.play(changed, Infinity, () => 0);
    const fresh = await new PlaybackRouting(fake, { every: 0 }).play(changed, Infinity, () => 0);
    expect([first, warm, fresh].map((p) => Number(p.timeline.totals.seconds.toFixed(6)))).toEqual([11.285714, 11.314286, 11.314286]);
    expect(rounded(warm.at(warm.timeline.totals.seconds)!.place)).toEqual([30.2, 0, 0]);
  });

  it("keeps the routed ways for a new router of the same frames", async () => {
    const route = input(loc(0, 0), loc(30, 60));
    const first = new PlaybackRouting(router([loc(0, 0), loc(30, 60)], [0, 0], 30), { every: 0 });
    await first.play(route, Infinity, () => 0);
    const next = router([loc(0, 0), loc(30, 60)], [0, 0], 99);
    const again = await new PlaybackRouting(next, { every: 0, from: first }).play(route, Infinity, () => 0);
    const horde = Object.assign(router([loc(0, 0), loc(30, 60)], [0, 0], 99), { rides: { links: [], faction: "Horde" as const } });
    const other = await new PlaybackRouting(horde, { every: 0, from: first }).play(route, Infinity, () => 0);
    expect([next.calls, again.timeline.totals.seconds, horde.calls, other.timeline.totals.seconds]).toEqual([0, 30, 1, 99]);
  });

  it("starts no search after a stop, also for a play that waited on another leg", async () => {
    let searches = 0;
    const hanging: WayRouter = {
      frames: [frame],
      route: (_plan, _mode, signal) => {
        searches++;
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("stop", "AbortError"))));
      },
    };
    const route = input(loc(0, 0), loc(30, 0), loc(60, 0));
    const routing = new PlaybackRouting(hanging, { every: 0 });
    const first = routing.play(route, Infinity, () => 0).catch((e: unknown) => (e as Error).name);
    await new Promise((r) => setTimeout(r));
    const second = routing.play(route, Infinity, () => 5).catch((e: unknown) => (e as Error).name);
    await new Promise((r) => setTimeout(r));
    routing.stop();
    expect([await first, await second, searches]).toEqual(["AbortError", "AbortError", 1]);
  });

  it("finishes a play that needs more ways than it keeps", async () => {
    const fake = router([loc(0, 0), loc(30, 0)], [0, 0], 30);
    const guarded: WayRouter = {
      ...fake,
      route: (...args) => {
        if (fake.calls >= 20) routing.stop();
        return fake.route(...args);
      },
    };
    const routing = new PlaybackRouting(guarded, { every: 0, kept: 2 });
    const playback = await routing.play(input(...[0, 1, 2, 3, 4, 5, 6].map((i) => loc(i * 30, 0))), Infinity, () => 0);
    expect([fake.calls, playback.routing]).toEqual([6, { asked: 6, routed: 6, pending: 0, straight: {} }]);
  });

  it("routes a leg that takes no time, so no leg stays pending", async () => {
    const fake = router([loc(0, 0), loc(0, 0)], [0, 0], 0);
    const playback = await new PlaybackRouting(fake, { every: 0 }).play(input(loc(0, 0), loc(0, 0)), Infinity, () => 0);
    expect([fake.calls, playback.routing]).toEqual([1, { asked: 1, routed: 1, pending: 0, straight: {} }]);
  });

  it("routes the first missing leg at or after the playhead, then the earlier legs, and a leg with no time last", async () => {
    const fake = router([loc(0, 0), loc(70, 0)], [0, 0], 10);
    const order: number[][] = [];
    const recording: WayRouter = {
      ...fake,
      route: (plan, ...rest) => (order.push(plan.stops.map((stop) => Math.round(stop.x - BASE.x))), fake.route(plan, ...rest)),
    };
    const route = input(loc(0, 0), loc(70, 0), loc(140, 0), loc(140, 0));
    await new PlaybackRouting(recording, { every: 0 }).play(route, Infinity, () => 1);
    expect(order).toEqual([
      [70, 140],
      [0, 70],
      [140, 140],
    ]);
  });

  it("counts only the current timeline's legs after routing makes a Hearthstone ready", async () => {
    const [home, away] = [loc(0, 0), loc(-700, 0)];
    const route = input(home, away);
    route.guides = [
      parseGuide(
        `#group G\n#name A\nstep\n.goto ${elwynn(home)}\n.home\nstep\n.goto ${elwynn(away)}\n.hs\nstep\n.goto ${elwynn(away)}\n.hs\n`,
      ),
    ];
    route.simulation = simulateRoute(route.guides, 0, route.profile, route.data);
    const routing = new PlaybackRouting(router([home, away], [0, 0], 4000), { every: 0 });
    const cold = await routing.play(route, Infinity, () => 0);
    const cached = await routing.play(route, Infinity, () => 0);
    expect([cold, cached].map((p) => p.timeline.steps.slice(1).map((s) => s.activities.map((a) => a.kind)))).toEqual([
      [
        ["travel", "hearth"],
        ["travel", "hearth"],
      ],
      [
        ["travel", "hearth"],
        ["travel", "hearth"],
      ],
    ]);
    expect([cold.routing, cached.routing]).toEqual([
      { asked: 1, routed: 1, pending: 0, straight: {} },
      { asked: 1, routed: 1, pending: 0, straight: {} },
    ]);
  });

  describe("when a price runs longer than a slice", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    function slowClock(onYield = () => {}) {
      let now = 0;
      vi.spyOn(performance, "now").mockImplementation(() => (now += 20));
      vi.stubGlobal("scheduler", {
        yield: () => {
          onYield();
          return new Promise((resolve) => setTimeout(resolve, 0));
        },
      });
    }

    it("gives the event loop a turn before it shows the playback", async () => {
      slowClock();
      const order: string[] = [];
      setTimeout(() => order.push("timer"), 0);
      await new PlaybackRouting(null).play(
        input(loc(0, 0), loc(30, 0)),
        Infinity,
        () => 0,
        () => order.push("playback"),
      );
      expect(order).toEqual(["timer", "playback"]);
    });

    it("stops pricing a replaced play at its next pause", async () => {
      slowClock();
      const route = input(loc(0, 0), loc(30, 0), loc(60, 0), loc(90, 0));
      const routing = new PlaybackRouting(null);
      const places = (counter: { n: number }): PlaybackInput => ({ ...route, npcs: { placeName: () => void counter.n++ } });
      const [replaced, latest] = [{ n: 0 }, { n: 0 }];
      const first = routing.play(places(replaced), Infinity, () => 0).catch((e: unknown) => (e as Error).name);
      const second = await routing.play(places(latest), Infinity, () => 0);
      expect([await first, replaced.n, latest.n, second.timeline.steps.length]).toEqual(["AbortError", 0, 4, 4]);
    });

    it("prices again when a search that it kept finishes while the price yields", async () => {
      let release = () => {};
      const kept = new Promise<void>((resolve) => (release = resolve));
      const fake = router([loc(0, 0), loc(30, 0)], [0, 0], 99);
      const gated: WayRouter = {
        ...fake,
        route: async (...args) => {
          await kept;
          return fake.route(...args);
        },
      };
      const route = input(loc(0, 0), loc(30, 0));
      route.guides = [
        parseGuide(`#group G\n#name A\nstep\n.goto ${elwynn(loc(0, 0))}\n+Walk\nstep\n.goto ${elwynn(loc(30, 0))}\n+Walk\nstep\n+Done\n`),
      ];
      route.simulation = simulateRoute(route.guides, 0, route.profile, route.data);
      const routing = new PlaybackRouting(gated, { every: 0 });
      const first = routing.play(route, Infinity, () => 0).catch((e: unknown) => (e as Error).name);
      await new Promise((r) => setTimeout(r));
      let pauses = 0;
      slowClock(() => {
        if (++pauses === 3) release();
      });
      const second = await routing.play(route, Infinity, () => 0);
      expect([await first, second.timeline.steps.map((s) => s.seconds.total), second.routing]).toEqual([
        "AbortError",
        [0, 99, 0],
        { asked: 1, routed: 1, pending: 0, straight: {} },
      ]);
    });
  });

  describe("a chain of guides", () => {
    function chain(...guides: [string, (WorldLocation | string)[]][]): PlaybackInput {
      const route = input(loc(0, 0));
      const step = (s: WorldLocation | string) => (typeof s === "string" ? `step\n${s}\n` : `step\n.goto ${elwynn(s)}\n+Walk\n`);
      const places = guides.flatMap(([, steps]) => steps.filter((s) => typeof s !== "string"));
      route.data = { ...route.data, locateGoto: (args) => places.find((at) => elwynn(at) === args.join(",")) };
      route.guides = guides.map(([name, steps], i) => {
        const next = guides[i + 1] ? `#next ${guides[i + 1]![0]}\n` : "";
        return parseGuide(`#group G\n#name ${name}\n${next}${steps.map(step).join("")}`);
      });
      route.simulation = simulateRoute(route.guides, 0, route.profile, route.data);
      return route;
    }
    const abc = () => chain(["A", [loc(0, 0), loc(70, 0)]], ["B", [loc(140, 0)]], ["C", [loc(210, 0)]]);
    const hanging: WayRouter = {
      frames: [frame],
      route: (_plan, _mode, signal) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("stop", "AbortError")))),
    };
    const progress = (playback: Playback) => [playback.routing, ...playback.chain.map((g) => [g.name, g.priced?.routing, g.priced?.done])];
    async function first(route: PlaybackInput) {
      const routing = new PlaybackRouting(hanging, { every: 0 });
      const shown = new Promise<Playback>((resolve) => void routing.play(route, Infinity, () => 0, resolve).catch(() => {}));
      const playback = await shown;
      routing.stop();
      return playback;
    }

    it("prices and routes only the reach, and lists the later guides with no time", async () => {
      const playback = await new PlaybackRouting(router([loc(0, 0), loc(70, 0)], [0, 0], 30), { every: 0 }).play(abc(), 1, () => 0);
      expect(playback.timeline.steps.map((s) => s.source)).toEqual([0, 0]);
      expect(playback.chain.map((g) => [g.name, g.through, g.priced?.start, g.priced?.seconds, g.priced?.done])).toEqual([
        ["A", 1, 0, 30, true],
        ["B", 2, undefined, undefined, undefined],
        ["C", 3, undefined, undefined, undefined],
      ]);
    });

    it("routes only the new guide's legs when the reach grows", async () => {
      const fake = router([loc(0, 0), loc(70, 0)], [0, 0], 30);
      const routing = new PlaybackRouting(fake, { every: 0 });
      await routing.play(abc(), 1, () => 0);
      const calls = fake.calls;
      const grown = await routing.play(abc(), 2, () => 0);
      expect([calls, fake.calls, grown.chain[1]!.priced]).toEqual([
        1,
        2,
        { first: 2, count: 1, start: 30, seconds: 30, routing: { asked: 1, routed: 1, pending: 0, straight: {} }, done: true },
      ]);
    });

    it("counts the legs of each guide while they route", async () => {
      const pending = (n: number) => ({ asked: n, routed: 0, pending: n, straight: {} });
      expect(progress(await first(abc()))).toEqual([
        pending(3),
        ["A", pending(1), false],
        ["B", pending(1), false],
        ["C", pending(1), false],
      ]);
    });

    it("counts a leg of two guides in both, and once in the route", async () => {
      const shared = chain(["A", [loc(0, 0), loc(70, 0), loc(0, 0)]], ["B", [loc(70, 0), loc(0, 0)]]);
      const pending = { asked: 2, routed: 0, pending: 2, straight: {} };
      expect(progress(await first(shared))).toEqual([pending, ["A", pending, false], ["B", pending, false]]);
    });

    it("counts a walk that the Hearthstone only compares with the guide that asks for it", async () => {
      const [home, mid, away] = [loc(0, 0), loc(-350, 0), loc(-700, 0)];
      const hearth = chain(
        ["A", [`.goto ${elwynn(home)}\n.home`, `.goto ${elwynn(away)}\n.hs`]],
        ["B", [mid, `.goto ${elwynn(away)}\n.hs`]],
      );
      hearth.data = { ...hearth.data, locateGoto: (args) => [home, mid, away].find((at) => elwynn(at) === args.join(",")) };
      hearth.simulation = simulateRoute(hearth.guides, 0, hearth.profile, hearth.data);
      const playback = await new PlaybackRouting(router([home, away], [0, 0], 1300), { every: 0 }).play(hearth, Infinity, () => 0);
      expect(playback.timeline.steps[3]!.activities.map((a) => a.kind)).toEqual(["travel", "wait", "hearth", "update"]);
      const routed = (n: number) => ({ asked: n, routed: n, pending: 0, straight: {} });
      expect(progress(playback)).toEqual([routed(4), ["A", routed(1), true], ["B", routed(3), true]]);
    });
  });

  it("keeps straight travel with its reason when no router is available", async () => {
    const playback = await new PlaybackRouting(null).play(input(loc(0, 0), loc(30, 60)), Infinity, () => 0);
    expect([playback.ways(1)[0]!.source, playback.ways(1)[0]!.estimate, playback.routing.straight, rounded(playback.at(0)!.place)]).toEqual(
      ["straight (unavailable)", "unavailable", { unavailable: 1 }, [0, 0, null]],
    );
  });

  it.each([
    ["the search fails", { frames: [frame], route: () => Promise.reject(new Error("search failed")) }, "failed"],
    ["an end is off the loaded maps", { frames: [], route: () => Promise.reject(new Error("not asked")) }, "off-map"],
  ] as const)("keeps straight travel as pending, then with its reason when %s", async (_, fake: WayRouter, reason) => {
    const seen: Playback[] = [];
    await new PlaybackRouting(fake, { every: 0 }).play(
      input(loc(0, 0), loc(30, 60)),
      Infinity,
      () => 0,
      (p) => seen.push(p),
    );
    expect(seen.map((p) => [p.ways(1)[0]!.source, p.ways(1)[0]!.estimate, p.routing])).toEqual([
      ["straight (pending)", "pending", { asked: 1, routed: 0, pending: 1, straight: {} }],
      [`straight (${reason})`, reason, { asked: 1, routed: 0, pending: 0, straight: { [reason]: 1 } }],
    ]);
  });

  it("walks a known flight at walking time when the router finds no flight there", async () => {
    const [stormwind, thelsamar] = [world(478.62, -8832.77), world(-2930.01, -5421.91)];
    const flights = new FlightNodes({
      "2": { name: "Stormwind, Elwynn", faction: "Alliance", world: stormwind },
      "8": { name: "Thelsamar, Loch Modan", faction: "Alliance", world: thelsamar },
    });
    const land = { ...thelsamar, x: thelsamar.x + 30 };
    const [take, landing] = ["Stormwind City,66.27,62.13", "Loch Modan,32.86,50.79"];
    const text = `step\n-- @sim state={"flightPaths": {"Thelsamar": true}}\n.goto ${take}\n.fly Thelsamar\nstep\n.goto ${landing}\n+Land\n`;
    const walk = guideInput([
      [take, stormwind],
      [landing, land],
    ]);
    const fly: PlaybackInput = { ...walk, data: { ...walk.data, flights }, guides: [parseGuide(`#group G\n#name A\n${text}`)] };
    fly.simulation = simulateRoute(fly.guides, 0, fly.profile, fly.data);
    const seen: Playback[] = [];
    const routing = new PlaybackRouting(router([stormwind, thelsamar], [0, 0], 40), { every: 0 });
    const playback = await routing.play(
      fly,
      Infinity,
      () => 0,
      (p) => seen.push(p),
    );
    expect(seen[0]!.ways(0).map((w) => [w.source, w.estimate])).toEqual([["flight (pending)", "pending"]]);
    expect(playback.ways(0).map((w) => [w.to, w.seconds, w.source, w.estimate])).toEqual([[thelsamar, 40, "routing", "flight-unknown"]]);
    expect(playback.timeline.warnings.map((w) => w.message)).toEqual([
      ".fly Thelsamar with no known flight to Thelsamar, Loch Modan; walked",
    ]);
  });

  it("prices a known flight at its routed time when the router flies it", async () => {
    const [stormwind, thelsamar] = [world(478.62, -8832.77), world(-2930.01, -5421.91)];
    const flights = new FlightNodes({
      "2": { name: "Stormwind, Elwynn", faction: "Alliance", world: stormwind },
      "8": { name: "Thelsamar, Loch Modan", faction: "Alliance", world: thelsamar },
    });
    const take = "Stormwind City,66.27,62.13";
    const walk = guideInput([[take, stormwind]]);
    const text = `step\n-- @sim state={"flightPaths": {"Thelsamar": true}}\n.goto ${take}\n.fly Thelsamar\n`;
    const fly: PlaybackInput = { ...walk, data: { ...walk.data, flights }, guides: [parseGuide(`#group G\n#name A\n${text}`)] };
    fly.simulation = simulateRoute(fly.guides, 0, fly.profile, fly.data);
    const link: TransportLink = {
      service: "flight-test",
      mode: "flight",
      from: { id: "FLIGHT_2", name: "Stormwind", map: 0, point: native(stormwind) },
      to: { id: "FLIGHT_8", name: "Thelsamar", map: 0, point: native(thelsamar) },
      requires: { faction: "Alliance" },
      seconds: { min: 40, average: 40, max: 40 },
    };
    const leg: JourneyLeg = { kind: "transport", parts: [{ kind: "ride", link }], seconds: 40 };
    const fake: WayRouter = {
      frames: [frame],
      route: async () => ({ journeys: [{ mode: { name: "Run", speed: 7, activation: 0 }, legs: [leg], seconds: 40 }] }),
    };
    const playback = await new PlaybackRouting(fake, { every: 0 }).play(fly, Infinity, () => 0);
    // The flight model prices this trip at far more than 40 seconds, so 40 can only come from the routed journey.
    expect(playback.ways(0).map((w) => [w.seconds, w.source])).toEqual([[40, "routing"]]);
    expect(playback.timeline.warnings).toEqual([]);
  });

  it("walks the character through the spawns while it kills, on the line until each run routes", async () => {
    const [start, area] = [loc(0, 0), loc(30, 60)];
    const vermin = { index: 1, kind: "monster" as const, ids: [6], count: 2, name: "Kobold Vermin" };
    const data: SimData = {
      quest: (id) => (id === 7 ? simQuest({ name: "Kobold Camp Cleanup", baseXp: 100, objectives: [vermin] }) : undefined),
      npc: () => ({ levels: { min: 1, max: 2 }, elite: false, zoneIds: [] }),
      item: () => undefined,
      rules: testRules,
      entityByName: () => undefined,
      flights: new FlightNodes(),
      uiMapNamed: () => undefined,
      locateGoto: (args) => [start, area].find((at) => elwynn(at) === args.join(",")),
    };
    const guides = [parseGuide(`#group G\n#name A\nstep\n.goto ${elwynn(start)}\n.accept 7\nstep\n.goto ${elwynn(area)}\n.complete 7,1\n`)];
    const profile = createProfile({ race: "Human", class: "WARRIOR", level: 1 });
    const spawns = () => [loc(30, 77), loc(30, 147)].map((p) => ({ ...p, id: `${p.y}` }));
    const route = { simulation: simulateRoute(guides, 0, profile, data), guides, profile, data, npcs: { spawns } };
    const routing = new PlaybackRouting(detourRouter([start, area, loc(30, 67), loc(30, 137), ...spawns()]), { every: 0 });
    const seen: Playback[] = [];
    const last = await routing.play(
      route,
      Infinity,
      () => 0,
      (p) => seen.push(p),
    );
    const places = (playback: Playback, times: number[]) => times.map((t) => rounded(playback.at(t)!.place));
    const first = seen[0]!;
    const kills = first.timeline.steps[1]!.activities.find((a) => a.kind === "kill")!.start;
    expect(
      places(
        first,
        [0.5, 10, 21, 30].map((t) => kills + t),
      ),
    ).toEqual([
      [30, 63.5, null],
      [30, 67, null],
      [30, 102, null],
      [30, 137, null],
    ]);
    expect(places(last, [20, 30, 45, 47.5, 60, 100])).toEqual([
      [40, 63.5, 14],
      [30, 67, 18],
      [40, 102, 14],
      [35, 119.5, 16],
      [30, 137, 18],
      [30, 137, 18],
    ]);
    expect(last.routing).toEqual({ asked: 3, routed: 3, pending: 0, straight: {} });
  });

  it("routes the travel of a character at the mount level mounted, and its kill runs and floor probes on foot", async () => {
    const [start, area] = [loc(0, 0), loc(30, 60)];
    const vermin = { index: 1, kind: "monster" as const, ids: [6], count: 2, name: "Kobold Vermin" };
    const data: SimData = {
      quest: (id) => (id === 7 ? simQuest({ name: "Kobold Camp Cleanup", baseXp: 100, objectives: [vermin] }) : undefined),
      npc: () => ({ levels: { min: 1, max: 2 }, elite: false, zoneIds: [] }),
      item: () => undefined,
      rules: testRules,
      entityByName: () => undefined,
      flights: new FlightNodes(),
      uiMapNamed: () => undefined,
      locateGoto: (args) => [start, area].find((at) => elwynn(at) === args.join(",")),
    };
    const guides = [parseGuide(`#group G\n#name A\nstep\n.goto ${elwynn(start)}\n.accept 7\nstep\n.goto ${elwynn(area)}\n.complete 7,1\n`)];
    const profile = createProfile({ race: "Human", class: "WARRIOR", level: 40 });
    const spawns = () => [loc(30, 77), loc(30, 147)].map((p) => ({ ...p, id: `${p.y}` }));
    const route = { simulation: simulateRoute(guides, 0, profile, data), guides, profile, data, npcs: { spawns } };
    const inner = detourRouter([start, area, loc(30, 67), loc(30, 137), ...spawns()]);
    const modes: string[] = [];
    const recording: WayRouter = { ...inner, route: (plan, mode, ...rest) => (modes.push(mode), inner.route(plan, mode, ...rest)) };
    await new PlaybackRouting(recording, { every: 0 }).play(route, Infinity, () => 0);
    expect(modes).toEqual(["Mount", "Run", "Run", "Run", "Run"]);
  });

  it("stands a kill run within one cell at its spawn's height, and starts the next leg there", async () => {
    const [start, area, next] = [loc(0, 0), loc(30, 60), loc(30, 130)];
    const vermin = { index: 1, kind: "monster" as const, ids: [6], count: 1, name: "Kobold Vermin" };
    const data: SimData = {
      quest: (id) => (id === 7 ? simQuest({ name: "Kobold Camp Cleanup", baseXp: 100, objectives: [vermin] }) : undefined),
      npc: () => ({ levels: { min: 1, max: 2 }, elite: false, zoneIds: [] }),
      item: () => undefined,
      rules: testRules,
      entityByName: () => undefined,
      flights: new FlightNodes(),
      uiMapNamed: () => undefined,
      locateGoto: (args) => [start, area, next].find((at) => elwynn(at) === args.join(",")),
    };
    const guides = [
      parseGuide(
        `#group G\n#name A\nstep\n.goto ${elwynn(start)}\n.accept 7\nstep\n.goto ${elwynn(area)}\n.complete 7,1\nstep\n.goto ${elwynn(next)}\n+Walk\n`,
      ),
    ];
    const profile = createProfile({ race: "Human", class: "WARRIOR", level: 1 });
    const spawns = () => [{ ...loc(30, 72), id: "npc:6:1", z: 40 }];
    const route = { simulation: simulateRoute(guides, 0, profile, data), guides, profile, data, npcs: { spawns } };
    const fake = {
      frames: [frame],
      heights: [] as (number | null)[][],
      route: async (plan: RoutePlan): Promise<Journeys> => {
        fake.heights.push(heightsOf(plan));
        const leg = terrainRoute(
          plan.stops,
          plan.stops.map((stop) => stop.height ?? 0),
          10,
        );
        return { journeys: [{ mode: { name: "Run", speed: 7, activation: 0 }, legs: [leg], seconds: 10 }] };
      },
    };
    const playback = await new PlaybackRouting(fake, { every: 0 }).play(route, Infinity, () => 0);
    const kill = playback.timeline.steps[1]!.activities.find((a) => a.kind === "kill")!;
    expect([kill.start, rounded(playback.at(kill.start + 5)!.place)]).toEqual([15, [30, 62, 40]]);
    expect(fake.heights).toEqual([
      [null, null],
      [null, null],
      [40, 40],
    ]);
    expect(playback.at(kill.start + kill.seconds + 1)!.place!.height).toBe(40);
  });

  it("asks a routed kill run to end at its spawn's height, with no floor probe", async () => {
    const [start, area] = [loc(0, 0), loc(30, 60)];
    const vermin = { index: 1, kind: "monster" as const, ids: [6], count: 1, name: "Kobold Vermin" };
    const data: SimData = {
      quest: (id) => (id === 7 ? simQuest({ name: "Kobold Camp Cleanup", baseXp: 100, objectives: [vermin] }) : undefined),
      npc: () => ({ levels: { min: 1, max: 2 }, elite: false, zoneIds: [] }),
      item: () => undefined,
      rules: testRules,
      entityByName: () => undefined,
      flights: new FlightNodes(),
      uiMapNamed: () => undefined,
      locateGoto: (args) => [start, area].find((at) => elwynn(at) === args.join(",")),
    };
    const guides = [parseGuide(`#group G\n#name A\nstep\n.goto ${elwynn(start)}\n.accept 7\nstep\n.goto ${elwynn(area)}\n.complete 7,1\n`)];
    const profile = createProfile({ race: "Human", class: "WARRIOR", level: 1 });
    const spawns = () => [{ ...loc(30, 100), id: "npc:6:1", z: 40 }];
    const route = { simulation: simulateRoute(guides, 0, profile, data), guides, profile, data, npcs: { spawns } };
    const heights: (number | null)[][] = [];
    const fake: WayRouter = {
      frames: [frame],
      route: async (plan) => {
        heights.push(heightsOf(plan));
        const leg = terrainRoute(
          plan.stops,
          plan.stops.map((stop) => stop.height ?? 0),
          10,
        );
        return { journeys: [{ mode: { name: "Run", speed: 7, activation: 0 }, legs: [leg], seconds: 10 }] };
      },
    };
    await new PlaybackRouting(fake, { every: 0 }).play(route, Infinity, () => 0);
    expect(heights).toEqual([
      [null, null],
      [null, 40],
    ]);
  });

  it("keeps the height that a routed travel ends at through the kills with no spawn there", async () => {
    const [start, area] = [loc(0, 0), loc(30, 60)];
    const vermin = { index: 1, kind: "monster" as const, ids: [6], count: 2, name: "Kobold Vermin" };
    const base = input(start, area);
    const data: SimData = {
      ...base.data,
      quest: (id) => (id === 7 ? simQuest({ name: "Kobold Camp Cleanup", baseXp: 100, objectives: [vermin] }) : undefined),
      npc: () => ({ levels: { min: 1, max: 2 }, elite: false, zoneIds: [] }),
    };
    const guides = [parseGuide(`#group G\n#name A\nstep\n.goto ${elwynn(start)}\n.accept 7\nstep\n.goto ${elwynn(area)}\n.complete 7,1\n`)];
    const route = { ...base, guides, data, simulation: simulateRoute(guides, 0, base.profile, data) };
    const playback = await new PlaybackRouting(router([start, area], [20, 10], 10), { every: 0 }).play(route, Infinity, () => 0);
    const kill = playback.timeline.steps[1]!.activities.find((a) => a.kind === "kill")!;
    expect(kill.kind === "kill" && kill.walk?.kills.length).toBe(2);
    expect([kill.start + 1, kill.start + kill.seconds - 1].map((t) => rounded(playback.at(t)!.place))).toEqual([
      [30, 60, 10],
      [30, 60, 10],
    ]);
  });

  it("asks a travel to end at the height of the NPC that its step targets", async () => {
    const [start, area] = [loc(0, 0), loc(30, 60)];
    const data: SimData = {
      quest: () => undefined,
      npc: () => undefined,
      item: () => undefined,
      rules: testRules,
      entityByName: (name) => (name === "Bixi Wobblebonk" ? { kind: "npc", id: 13084 } : undefined),
      flights: new FlightNodes(),
      uiMapNamed: () => undefined,
      locateGoto: (args) => [start, area].find((at) => elwynn(at) === args.join(",")),
    };
    const guides = [
      parseGuide(`#group G\n#name A\nstep\n.goto ${elwynn(start)}\n+Walk\nstep\n.target +Bixi Wobblebonk\n.goto ${elwynn(area)}\n+Walk\n`),
    ];
    const profile = createProfile({ race: "Human", class: "WARRIOR", level: 1 });
    const spawns = (npcId: number) => (npcId === 13084 ? [{ ...loc(30.1, 60.1), id: "npc:13084:1", z: 509 }] : []);
    const route = { simulation: simulateRoute(guides, 0, profile, data), guides, profile, data, npcs: { spawns } };
    const heights: (number | null)[][] = [];
    const fake: WayRouter = {
      frames: [frame],
      route: async (plan) => {
        heights.push(heightsOf(plan));
        const leg = terrainRoute(
          plan.stops,
          plan.stops.map((stop) => stop.height ?? 0),
          10,
        );
        return { journeys: [{ mode: { name: "Run", speed: 7, activation: 0 }, legs: [leg], seconds: 10 }] };
      },
    };
    await new PlaybackRouting(fake, { every: 0 }).play(route, Infinity, () => 0);
    expect(heights).toEqual([[null, 509]]);
  });

  it("selects the level of a stacked interior from the route's heights between the stops", async () => {
    const fixture = interiorsFixture();
    const surfaces = fromSurfaces(fixture.interiors.interiors[0]!, fixture.surfaces);
    const pixel = (col: number, row: number) => world(1516.5 - (col + 0.5) / 2, -11093 - (row + 0.5) / 2);
    const [door, upper, lower] = [world(1509.32, -11052.1), pixel(2, 1), pixel(1, 0)];
    const routing = new PlaybackRouting(router([door, upper, lower], [43, 49, 20], 20), { every: 0 });
    const playback = await routing.play(guideInput([door, lower].map((at) => [worldGoto("Westfall", at), at])), Infinity, () => 0);
    const level = (t: number) => {
      const place = playback.at(t)!.place!;
      const found = surfaces.nearest(place, place.height!);
      return found && `${found.place} ${found.rank + 1}/${found.of}`;
    };
    expect([level(19.6), level(20)]).toEqual(["The Deadmines 2/2", "Defias Hideout 1/2"]);
  });
});

describe("ridesFor", () => {
  const stop = (id: string, name: string, at: WorldLocation): TransportStop => ({
    id,
    name,
    map: 0,
    point: native(at),
    ...(id.endsWith(":air") && { air: true }),
  });
  const link = (service: string, mode: string, from: TransportStop, to: TransportStop): TransportLink => ({
    service,
    mode,
    from,
    to,
    requires: { faction: "Alliance" },
    seconds: { min: 1, average: 1, max: 1 },
  });
  const flight = (id: string, name: string, at: WorldLocation) => [stop(id, name, at), stop(`${id}:air`, name, at)];
  const [hill, hillAir] = flight("FLIGHT_4", "Sentinel Hill", world(1036.68, -10628.89));
  const [lake, lakeAir] = flight("FLIGHT_5", "Lakeshire", world(-2231.4, -9429.1));
  const [city, cityAir] = flight("FLIGHT_2", "Stormwind", world(478.62, -8832.77));
  const links = [
    link("FLIGHT_4", "flight", hill!, hillAir!),
    link("FLIGHT_PATH_249", "flight", hillAir!, lakeAir!),
    link("FLIGHT_PATH_8", "flight", lakeAir!, cityAir!),
    link("FLIGHT_2", "flight", cityAir!, city!),
    link("FLIGHT_5", "flight", lakeAir!, lake!),
    link(
      "ship-southshore-loop",
      "ship",
      stop("DOCK_MENETHIL", "Menethil Harbor", world(-577.08, -3722.92)),
      stop("DOCK_SOUTHSHORE", "Southshore Harbor", world(-556.25, -1089.58)),
    ),
  ];

  it("keeps the flights that take off and land at the nodes the character knows", () => {
    const kept = ridesFor({ kind: "flight", learned: [4, 2] }, { links })!.links.map((l) => l.service);
    expect(kept).toEqual(["FLIGHT_4", "FLIGHT_PATH_249", "FLIGHT_PATH_8", "FLIGHT_2"]);
  });
});
