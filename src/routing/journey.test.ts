import { nativeStop, nativeToWorld, type MapPoint, type Point } from "./frame.ts";
import { loadArtifact, type Tile } from "./artifact.ts";
import { flatArtifact } from "./fixtures/synthetic.ts";
import { describe, expect, it } from "vitest";
import {
  keptLegs,
  routeJourney,
  rideWalks,
  routeTrip,
  tripLegRequest,
  type Journey,
  type JourneyLeg,
  type JourneyOptions,
  type LegUpdate,
} from "./journey.ts";
import { DEFAULT_LEG, DEFAULT_MAX_SLOPE, reverse, setLeg, type Leg, type MovementMode, type RoutePlan, type WorldStop } from "./plan.ts";
import { routeLeg, type LegResult } from "./search.ts";
import { E, N, S, W, at, blockRing, testFrame, whole, withFloor } from "./fixtures/region.ts";
import { CELL_SPACING, createTerrain, type CellPoint, type Terrain, type TerrainRegion } from "./terrain.ts";
import type { TransportLeg, TransportLink, TransportStop } from "./transport.ts";

const run: MovementMode = { name: "Run", speed: 7, activation: 0 };
const mount: MovementMode = { name: "Mount", speed: 14, activation: 3 };

function flat(width: number, height: number): TerrainRegion {
  const n = width * height;
  return {
    tile: [0, 0],
    width,
    height,
    spacing: 7,
    elevation: new Float32Array(n),
    slope: new Float32Array(n),
    blocked: new Uint8Array(n),
    water: new Float32Array(n).fill(Number.NaN),
    failed: [],
    coverage: ([x, y]) => (x >= 0 && y >= 0 && x < width && y < height ? "present" : undefined),
  };
}
const native = ([x, y]: CellPoint): Point => [x * 4, y * 4];
const FRAMES = [0, 1, 2].map(testFrame);
const pixels = (points: Point[]): WorldStop[] => points.map((p) => at(p));
const pixelOf = (stop: WorldStop): Point => nativeStop(testFrame(stop.instance), stop).point;
const onMaps = (p: RoutePlan, maps: number[]): RoutePlan => ({ ...p, stops: p.stops.map((stop, i) => ({ ...stop, instance: maps[i]! })) });
const withHeights = (p: RoutePlan, heights: (number | null)[]): RoutePlan => ({
  ...p,
  stops: p.stops.map((stop, i) => ({ ...stop, height: heights[i]! })),
});

const normal: Leg = { ...DEFAULT_LEG, downhill: false };
const straight: Leg = { ...DEFAULT_LEG, followTerrain: false, downhill: false };
const downhill: Leg = { ...DEFAULT_LEG };

function plan(stops: CellPoint[], legs: Leg[] = stops.slice(1).map(() => normal), swimming = false): RoutePlan {
  return {
    id: "plan",
    stops: pixels(stops.map(native)),
    legs,
    settings: { swimming: { enabled: swimming, speed: 3.5 }, modes: [run, mount] },
  };
}
type Options = Partial<JourneyOptions>;
const journey = (region: TerrainRegion, p: RoutePlan, mode = mount, options: Options = {}) =>
  routeJourney(whole(region), p, mode, { maxSlope: DEFAULT_MAX_SLOPE, ...options });
const only = (terrain: Terrain) => (map: number) => (map === terrain.frame.scope.map ? { terrain } : undefined);
const journeys = (region: TerrainRegion, p: RoutePlan, options: Options = {}) =>
  routeTrip(p, only(whole(region)), { maxSlope: DEFAULT_MAX_SLOPE, ...options });

function walled(): TerrainRegion {
  const grid = flat(9, 3);
  for (let y = 0; y < 3; y++) grid.blocked[y * 9 + 4] = 1;
  return grid;
}
const activations = (j: Journey) => j.legs.map((leg) => ("activation" in leg ? leg.activation : undefined));

describe("journeys through waypoints", () => {
  it("charges one activation when stops split the route", async () => {
    const grid = flat(9, 3);
    const split = await journey(
      grid,
      plan([
        [0, 1],
        [0, 1],
        [3, 1],
        [5, 1],
        [5, 1],
        [8, 1],
      ]),
    );
    expect(split.seconds).toBeCloseTo(3 + 4);
    expect(activations(split)).toEqual([0, 3, 0, 0, 0]);
    const direct = await journey(
      grid,
      plan([
        [0, 1],
        [8, 1],
      ]),
    );
    expect(direct.seconds).toBeCloseTo(3 + 4);
  });

  it("times straight legs by horizontal distance within the journey's activation", async () => {
    const across = (grid: TerrainRegion, stops: CellPoint[], legs: Leg[]) => journey(grid, plan(stops, legs));
    const ends: CellPoint[] = [
      [0, 1],
      [8, 1],
    ];
    expect((await across(walled(), ends, [normal])).seconds).toBeUndefined();
    const line = await across(walled(), ends, [straight]);
    expect(line.seconds).toBeCloseTo(3 + (8 * CELL_SPACING) / 14);
    expect(line.legs[0]).toMatchObject({ kind: "straight", activation: 3 });
    expect(line.legs[0]?.kind === "straight" && line.legs[0].distance).toBeCloseTo(8 * CELL_SPACING);
    const opened = await across(
      flat(9, 3),
      [
        [0, 1],
        [3, 1],
        [8, 1],
        [8, 1],
      ],
      [straight, normal, straight],
    );
    expect(opened.seconds).toBeCloseTo(3 + (3 * CELL_SPACING) / 14 + 2.5);
    expect(activations(opened)).toEqual([3, 0, 0]);
    const still = await across(
      flat(9, 3),
      [
        [3, 1],
        [3, 1],
        [5, 1],
      ],
      [straight, normal],
    );
    expect(activations(still)).toEqual([0, 3]);
    expect(still.seconds).toBeCloseTo(3 + 1);
  });

  it("keeps a failed leg and its neighbours, with no complete total", async () => {
    const grid = flat(9, 1);
    grid.elevation.set([100, 100, 60, 60, 60, 60, 20, 20, 20]);
    const stops: CellPoint[] = [
      [0, 0],
      [4, 0],
      [8, 0],
    ];
    const first = await journey(grid, plan(stops, [downhill, normal]), run);
    expect(first.seconds).toBeUndefined();
    expect(first.legs[0]).toMatchObject({ kind: "route", descents: [1], descentDrop: 40 });
    expect(first.legs[1]).toEqual({ kind: "no-path" });
    const both = plan(stops, [downhill, downhill]);
    expect((await journey(grid, both, run)).seconds).toBeCloseTo((6 * 7 + 2 * Math.hypot(7, 40)) / 7);
    expect((await journey(grid, reverse(both), run)).legs).toEqual([{ kind: "no-path" }, { kind: "no-path" }]);
  });

  it("counts a failed leg as movement, so the next leg does not activate again", async () => {
    const grid = walled();
    const p = plan([
      [0, 1],
      [8, 1],
      [8, 2],
      [7, 2],
    ]);
    const blocked = await journey(grid, p);
    expect(blocked.legs.map((leg) => leg.kind)).toEqual(["no-path", "route", "route"]);
    expect(activations(blocked)).toEqual([undefined, 0, 0]);
    expect(blocked.seconds).toBeUndefined();
    const limited = await journey(
      grid,
      plan(
        [
          [0, 1],
          [3, 1],
          [3, 2],
        ],
        [normal, straight],
      ),
      mount,
      { cellBudget: 1 },
    );
    expect(limited.legs.map((leg) => leg.kind)).toEqual(["limit", "straight"]);
    expect(activations(limited)).toEqual([undefined, 0]);
    expect(limited.seconds).toBeUndefined();
  });
});

function channel(): TerrainRegion {
  const grid = flat(7, 1);
  grid.water.set([Number.NaN, Number.NaN, 0, 0, 0]);
  grid.elevation.set([0, 0, -30, -80, -10, 0, 0]);
  grid.slope.set([0, 0, 80, 80, 80, 0, 0]);
  return grid;
}

describe("stops in one cell", () => {
  it("neither use up the activation nor count as onward movement", async () => {
    const near = { ...plan([]), stops: pixels([[0, 0], [1, 0], native([8, 0])]), legs: [normal, normal] };
    const waypoint = await journey(flat(9, 1), near);
    expect(activations(waypoint)).toEqual([0, 3]);
    expect(waypoint.seconds).toBeCloseTo(3 + 56 / 14);
  });

  const nudge = ([x, y]: Point): Point => [x + 1, y];
  const nudged = (j: Journey) => (j.legs[1]?.kind === "straight" ? j.legs[1].distance : NaN) / 14;

  it("remounts after a swim when a straight leg moves on in the shore's cell", async () => {
    const shore = native([5, 0]);
    const p = { ...plan([], [], true), stops: pixels([native([2, 0]), shore, nudge(shore)]), legs: [normal, straight] };
    const j = await journey(channel(), p);
    expect(j.legs[0]).toMatchObject({ swimRemounts: [{ seconds: 3 }] });
    expect(activations(j)).toEqual([0, 0]);
    expect(j.seconds).toBeCloseTo(6 + 3 + nudged(j));
  });
});

describe("journeys through water", () => {
  it("charges activation again on land after a water waypoint", async () => {
    const grid = channel();
    const split = await journey(
      grid,
      plan(
        [
          [0, 0],
          [2, 0],
          [2, 0],
          [5, 0],
          [5, 0],
          [6, 0],
        ],
        undefined,
        true,
      ),
    );
    expect(split.seconds).toBe(15);
    expect(activations(split)).toEqual([3, 0, 0, 0, 0]);
    expect(split.legs[2]).toMatchObject({ swimRemounts: [{ seconds: 3 }] });
    const swim = (stops: CellPoint[], legs?: Leg[]) => journey(grid, plan(stops, legs, true));
    expect(
      (
        await swim([
          [2, 0],
          [5, 0],
          [5, 0],
        ])
      ).seconds,
    ).toBe(6);
    const line = await swim(
      [
        [2, 0],
        [4, 0],
        [6, 0],
      ],
      [normal, straight],
    );
    expect(activations(line)).toEqual([0, 3]);
    expect(line.seconds).toBeCloseTo(4 + 3 + (2 * CELL_SPACING) / 14);
  });
});

describe("one search for all modes", () => {
  async function searches(region: TerrainRegion, p: RoutePlan, modes: MovementMode[]) {
    let count = 0;
    const terrain: Terrain = { ...whole(region), region: async (points) => ((count += points.length > 1 ? 1 : 0), region) };
    const q = { ...p, settings: { ...p.settings, modes } };
    const { journeys: found } = await routeTrip(q, only(terrain), { maxSlope: DEFAULT_MAX_SLOPE, groundKey: "g" });
    for (const j of found) {
      const own = await journey(region, q, j.mode);
      expect(j.legs.map((leg) => ({ ...leg, seconds: 0 }))).toEqual(own.legs.map((leg) => ({ ...leg, seconds: 0 })));
      expect(j.seconds).toBeCloseTo(own.seconds!, 9);
    }
    return { count, found };
  }
  const count = async (...args: Parameters<typeof searches>) => (await searches(...args)).count;
  const wet = (region: TerrainRegion, at: number[]) => {
    for (const i of at) {
      region.water[i] = 0;
      region.elevation[i] = -10;
      region.slope[i] = 80;
    }
    return region;
  };

  it("times the slowest mode's route in a faster mode", async () => {
    const p = plan([
      [1, 1],
      [7, 1],
    ]);
    const once = await count(flat(9, 3), p, [run]);
    expect(await count(flat(9, 3), p, [run, mount])).toBe(once);
    expect(await count(flat(9, 3), p, [mount, run])).toBe(once);
  });

  it("searches each mode when the slowest mode's route swims", async () => {
    const river = wet(flat(9, 3), [3, 4, 5, 12, 13, 14, 21, 22, 23]);
    const p = plan(
      [
        [1, 1],
        [7, 1],
      ],
      undefined,
      true,
    );
    const { count: both, found } = await searches(river, p, [run, mount]);
    expect(found.map((j) => (j.legs[0] as { swims: number[] }).swims.length > 0)).toEqual([true, true]);
    expect(both).toBe((await count(river, p, [run])) + (await count(river, p, [mount])));
  });

  it("searches a faster mode that can skip its activation with a swim from the start", async () => {
    const pond = wet(flat(6, 4), [14, 15]);
    const p = plan(
      [
        [1, 2],
        [4, 2],
      ],
      undefined,
      true,
    );
    const slowCast: MovementMode = { ...mount, activation: 10 };
    const { count: both, found } = await searches(pond, p, [run, slowCast]);
    expect(found.map((j) => (j.legs[0] as { swims: number[] }).swims.length > 0)).toEqual([false, true]);
    expect(both).toBe((await count(pond, p, [run])) + (await count(pond, p, [slowCast])));
  });

  it("searches a faster mode that loses less time to each activation", async () => {
    const wall = wet(flat(7, 7), [10]);
    for (const y of [0, 2, 3, 4, 5]) wall.blocked[y * 7 + 3] = 1;
    const p = plan(
      [
        [1, 1],
        [5, 1],
      ],
      undefined,
      true,
    );
    const modes: MovementMode[] = [
      { name: "Slow", speed: 7, activation: 10 },
      { name: "Fast", speed: 14, activation: 0 },
    ];
    const { count: both, found } = await searches(wall, p, modes);
    expect(found.map((j) => (j.legs[0] as { swims: number[] }).swims.length > 0)).toEqual([false, true]);
    expect(both).toBe((await count(wall, p, modes.slice(0, 1))) + (await count(wall, p, modes.slice(1))));
  });
});

describe("leg settings", () => {
  it("routes each leg with its own fall and hazard settings", async () => {
    const region = withFloor(flat(3, 3), {
      0: { layers: [{ height: 31.5, drop: S, drops: [31.5] }] },
      6: { layers: [{ height: 0, walk: N | E }] },
      7: { layers: [{ height: 0, walk: W | E, water: true, hazard: true }], surface: 0.5, hazard: true },
      8: { layers: [{ height: 0, walk: W }] },
    });
    const stops: Point[] = [
      [2, 2],
      [2, 6],
      [2, 10],
      [10, 10],
    ];
    const legs = (...settings: Partial<Leg>[]) =>
      journey(
        region,
        {
          ...plan(
            [],
            settings.map((s) => ({ ...DEFAULT_LEG, ...s })),
          ),
          stops: pixels(stops),
        },
        run,
      ).then((j) => j.legs.map((leg) => (leg.kind === "route" ? leg.falls.map((f) => f.height) : leg.kind)));
    expect(await legs({}, {}, {})).toEqual([[31.5], [], "no-path"]);
    expect(await legs({ damagingFalls: false }, {}, { hazards: true })).toEqual(["no-path", [], []]);
  });
});

describe("stop heights", () => {
  const stacked = () =>
    withFloor(flat(3, 1), {
      0: {
        layers: [
          { height: 0, walk: E },
          { height: 10, walk: E, masks: [2] },
        ],
      },
      1: {
        layers: [
          { height: 0, walk: W | E },
          { height: 10, walk: W, masks: [2], drop: E, drops: [10] },
        ],
      },
      2: { layers: [{ height: 0, walk: W }] },
    });
  const centre = ([x, y]: CellPoint): Point => [x * 4 + 2, y * 4 + 2];
  const onFloors = (stops: CellPoint[], heights: (number | null)[]): RoutePlan => ({
    ...plan(
      [],
      stops.slice(1).map(() => DEFAULT_LEG),
    ),
    stops: stops.map((cell, i) => at(centre(cell), heights[i])),
  });

  it("starts and ends each leg on the floor at the height of its stop", async () => {
    const falls = async (heights: (number | null)[]) =>
      (
        await journey(
          stacked(),
          onFloors(
            [
              [0, 0],
              [2, 0],
              [0, 0],
            ],
            heights,
          ),
          run,
        )
      ).legs.map((leg) => (leg.kind === "route" ? leg.falls.map((f) => f.height) : leg.kind));
    expect(await falls([null, null, null])).toEqual([[], []]);
    expect(await falls([10, null, 10])).toEqual([[10], "no-path"]);
  });

  it("moves on a leg between two heights at one pixel", async () => {
    const legs = await journey(
      stacked(),
      onFloors(
        [
          [0, 0],
          [0, 0],
          [2, 0],
        ],
        [10, 0, null],
      ),
    );
    expect(legs.legs.map((leg) => (leg.kind === "route" ? [Math.round(leg.distance * 10) / 10, leg.activation] : leg.kind))).toEqual([
      [33.2, 3],
      [14, 0],
    ]);
  });
});

describe("routed modes", () => {
  it("routes only the given modes and selects the fastest complete journey", async () => {
    const open = flat(9, 3);
    const p = plan([
      [0, 1],
      [8, 1],
    ]);
    const all = await journeys(open, p);
    expect(all.journeys.map((j) => [j.mode.name, j.seconds])).toEqual([
      ["Run", 8],
      ["Mount", 7],
    ]);
    expect(all.fastest?.mode).toBe(mount);
    const walking = await journeys(open, p, { modes: ["Run"] });
    expect(walking.journeys.map((j) => j.mode.name)).toEqual(["Run"]);
    expect(walking.fastest?.mode).toBe(run);
    const none = await journeys(walled(), p, { modes: ["Run"] });
    expect(none.journeys.map((j) => [j.mode.name, j.seconds])).toEqual([["Run", undefined]]);
    expect(none.fastest).toBeUndefined();
  });

  it("times a faster mode from the slowest mode's earlier result, and does not search the slowest mode for it", async () => {
    const region = flat(9, 3);
    let count = 0;
    const terrain: Terrain = { ...whole(region), region: async (points) => ((count += points.length > 1 ? 1 : 0), region) };
    const p = plan([
      [1, 1],
      [7, 1],
    ]);
    const route = (modes: string[], known?: Map<string, LegResult>) => {
      const found = new Map<string, LegResult>();
      const options = { maxSlope: DEFAULT_MAX_SLOPE, groundKey: "g", modes, found: (key: string, r: LegResult) => found.set(key, r) };
      return routeTrip(p, only(terrain), { ...options, ...(known && { known }) }).then((j) => ({ ...j, found }));
    };
    const own = await journey(region, p, mount);

    const walked = await route(["Run"]);
    expect([count, walked.found.size]).toEqual([1, 1]);
    const mounted = await route(["Mount"], walked.found);
    expect([count, mounted.found.size]).toEqual([1, 1]);
    expect(mounted.journeys[0]!.seconds).toBeCloseTo(own.seconds!, 9);

    count = 0;
    const alone = await route(["Mount"]);
    expect([count, alone.found.size]).toEqual([1, 1]);
    expect(alone.journeys[0]!.seconds).toBeCloseTo(own.seconds!, 9);
  });
});

describe("walkable slope", () => {
  it("walks only ground up to the slope of the options, whatever an older plan saved", async () => {
    const ridge = flat(9, 3);
    for (const y of [0, 1, 2]) ridge.slope[y * 9 + 4] = y === 1 ? 40 : 30;
    const across = plan([
      [0, 1],
      [8, 1],
    ]);
    const path = async (maxSlope: number) => {
      const leg = (await journey(ridge, across, run, { maxSlope })).legs[0]!;
      return leg.kind === "route" ? leg.distance : leg.kind;
    };
    const [direct, around, none] = [await path(45), await path(35), await path(25)];
    expect(direct).toBeCloseTo(8 * 7);
    expect(around).toBeGreaterThan(8 * 7 + 1);
    expect(none).toBe("no-path");
    const saved = { ...across, settings: { ...across.settings, maxSlope: 89 } } as RoutePlan;
    expect((await journey(ridge, saved, run, { maxSlope: 25 })).legs[0]!.kind).toBe("no-path");
  });
});

describe("trips across maps", () => {
  const detour = () => {
    const grid = flat(9, 3);
    grid.blocked[9 + 4] = 1;
    return grid;
  };
  const ground = (map: number) => ({ terrain: whole(map === 0 ? flat(9, 3) : detour(), testFrame(map)) });
  const options = { maxSlope: DEFAULT_MAX_SLOPE };

  it("routes each map's legs on its ground, and a leg between maps is a crossing that adds no time", async () => {
    const stops: CellPoint[] = [
      [0, 1],
      [8, 1],
      [0, 1],
      [8, 1],
    ];
    const trip = await routeTrip(onMaps(plan(stops), [0, 0, 1, 1]), ground, options);
    const east = await journeys(flat(9, 3), plan(stops.slice(0, 2)));
    const west = await journeys(detour(), plan(stops.slice(2)));
    for (const [m, j] of trip.journeys.entries()) {
      expect(j.legs.map((leg) => leg.kind)).toEqual(["route", "crossing", "route"]);
      expect(j.legs[2]).toEqual(west.journeys[m]!.legs[0]);
      expect(j.seconds).toBeCloseTo(east.journeys[m]!.seconds! + west.journeys[m]!.seconds!);
    }
    expect(trip.fastest?.seconds).toBe(Math.min(...trip.journeys.map((j) => j.seconds!)));
  });

  it("has a crossing for each leg of a plan that only changes maps", async () => {
    const p = onMaps(
      plan([
        [0, 1],
        [8, 1],
      ]),
      [0, 1],
    );
    const trip = await routeTrip(p, ground, options);
    expect(trip.journeys.map((j) => [j.legs, j.seconds])).toEqual([
      [[{ kind: "crossing" }], 0],
      [[{ kind: "crossing" }], 0],
    ]);
  });

  it("gives the request with which the trip searches a leg, and none for a crossing", async () => {
    const stops: CellPoint[] = [
      [0, 1],
      [8, 1],
      [0, 1],
      [8, 1],
      [0, 1],
    ];
    const p = onMaps(plan(stops), [0, 0, 1, 1, 1]);
    const requests = await Promise.all([0, 1, 2, 3].map((leg) => tripLegRequest(p, (map) => ground(map).terrain, mount, options, leg)));
    expect(requests.map((r) => r && [r.request.active, r.request.continues])).toEqual([
      [false, false],
      undefined,
      [false, true],
      [true, false],
    ]);
    expect(requests[3]).toMatchObject({ from: native([8, 1]), to: native([0, 1]) });
    expect(requests[3]!.request).toEqual({
      maxSlope: DEFAULT_MAX_SLOPE,
      swimming: { enabled: false, speed: 3.5 },
      mode: mount,
      active: true,
      continues: false,
      damagingFalls: normal.damagingFalls,
      fatalFalls: normal.fatalFalls,
      hazards: normal.hazards,
    });
    const trip = await routeTrip(p, ground, options);
    const leg3 = await routeLeg(whole(detour()), native([8, 1]), native([0, 1]), normal, requests[3]!.request);
    expect(trip.journeys.find((j) => j.mode === mount)?.legs[3]).toEqual(leg3);
  });
});

describe("trips with rides", () => {
  const ground = (map: number) => ({ terrain: whole(flat(9, 3), testFrame(map)), groundKey: `map ${map}` });
  const options = { maxSlope: DEFAULT_MAX_SLOPE };
  type Stop = Pick<TransportStop, "id" | "name">;
  type Place = Omit<TransportStop, "id" | "name">;
  const service =
    ({ service, mode, requires }: Pick<TransportLink, "service" | "mode" | "requires">, ends: [Stop, Stop]) =>
    (from: Place, to: Place, average: number): TransportLink => ({
      service,
      mode,
      from: { ...ends[0], ...from },
      to: { ...ends[1], ...to },
      requires,
      seconds: { min: 0, average, max: 2 * average },
    });
  const alliance = { faction: "Alliance" } as const,
    horde = { faction: "Horde" } as const;
  const ride = service({ service: "ship-bootybay-ratchet", mode: "ship", requires: {} }, [
    { id: "DOCK_BOOTYBAY", name: "Booty Bay Harbor" },
    { id: "DOCK_RATCHET", name: "Ratchet Harbor" },
  ]);
  const gromgol = service({ service: "zeppelin-orgrimmar-gromgol", mode: "zeppelin", requires: horde }, [
    { id: "ZEPPELIN_GROMGOL_ORGRIMMAR", name: "Grom'gol" },
    { id: "ZEPPELIN_ORGRIMMAR_GROMGOL", name: "Orgrimmar" },
  ]);
  const theramore = service({ service: "ship-menethil-theramore", mode: "ship", requires: alliance }, [
    { id: "DOCK_THERAMORE", name: "Theramore Isle Harbor" },
    { id: "DOCK_MENETHIL_THERAMORE", name: "Menethil Harbor" },
  ]);
  const southshore = service({ service: "ship-southshore-loop", mode: "ship", requires: alliance }, [
    { id: "DOCK_MENETHIL", name: "Menethil Harbor" },
    { id: "DOCK_SOUTHSHORE", name: "Southshore Harbor" },
  ]);
  const tirisfal = service({ service: "zeppelin-undercity-gromgol", mode: "zeppelin", requires: horde }, [
    { id: "ZEPPELIN_GROMGOL_TIRISFAL", name: "Grom'gol" },
    { id: "ZEPPELIN_TIRISFAL_GROMGOL", name: "Tirisfal Glades" },
  ]);
  const tram = service({ service: "tram-stormwind-ironforge", mode: "tram", requires: alliance }, [
    { id: "TRAM_IRONFORGE", name: "Ironforge" },
    { id: "TRAM_STORMWIND", name: "Stormwind City" },
  ]);
  const request = (mode: MovementMode, active: boolean, continues: boolean) => ({
    maxSlope: DEFAULT_MAX_SLOPE,
    swimming: { enabled: false, speed: 3.5 },
    mode,
    active,
    continues,
    damagingFalls: normal.damagingFalls,
    fatalFalls: normal.fatalFalls,
    hazards: normal.hazards,
  });

  it("routes a leg between maps through a ride, and each ground part activates the mode again", async () => {
    const p: RoutePlan = onMaps(
      plan([
        [0, 1],
        [8, 1],
      ]),
      [0, 1],
    );
    const ship = ride({ map: 0, point: native([8, 1]) }, { map: 1, point: native([0, 1]) }, 100);
    const updates: LegUpdate[] = [];
    const trip = await routeTrip(p, ground, { ...options, rides: { links: [ship] }, onLegs: (u) => updates.push(...u) });
    const walk = (mode: MovementMode) => routeLeg(whole(flat(9, 3)), native([0, 1]), native([8, 1]), normal, request(mode, false, false));
    for (const j of trip.journeys) {
      const leg = j.legs[0]!;
      const part = await walk(j.mode);
      expect(leg).toMatchObject({
        kind: "transport",
        parts: [
          { kind: "ground", map: 0, result: part, key: expect.stringContaining('"map 0"') },
          { kind: "ride", link: ship },
          { kind: "ground", map: 1, result: part },
        ],
      });
      expect(j.seconds).toBeCloseTo(2 * (part as { seconds: number }).seconds + 100);
    }
    expect(updates.map((u) => [u.mode, u.result.kind, !!u.searching, u.trying])).toEqual([
      ["Run", "crossing", true, undefined],
      ["Mount", "crossing", true, undefined],
      ["Run", "crossing", true, "ship"],
      ["Run", "transport", false, undefined],
      ["Mount", "crossing", true, "ship"],
      ["Mount", "transport", false, undefined],
    ]);
    const none = await routeTrip(p, ground, {
      ...options,
      rides: { links: [southshore({ map: 0, point: native([8, 1]) }, { map: 0, point: native([0, 1]) }, 100)] },
    });
    expect(none.journeys.map((j) => j.legs[0]!.kind)).toEqual(["crossing", "crossing"]);
  });

  it("takes the other faction's rides only on a leg whose choice is on, and rides without a faction on every leg", async () => {
    const p: RoutePlan = onMaps(
      plan([
        [0, 1],
        [8, 1],
        [0, 1],
      ]),
      [0, 1, 0],
    );
    const there = gromgol({ map: 0, point: native([8, 1]) }, { map: 1, point: native([0, 1]) }, 100);
    const back: TransportLink = { ...there, from: there.to, to: there.from };
    const kinds = async (q: RoutePlan, links: TransportLink[]) =>
      (await routeTrip(q, ground, { ...options, rides: { links, faction: "Alliance" } })).journeys[0]!.legs.map((leg) => leg.kind);
    expect(await kinds(p, [there, back])).toEqual(["crossing", "crossing"]);
    const chosen = setLeg(p, 1, { otherFaction: true });
    expect(await kinds(chosen, [there, back])).toEqual(["crossing", "transport"]);
    expect(
      await kinds(p, [
        ride({ map: 0, point: native([8, 1]) }, { map: 1, point: native([0, 1]) }, 100),
        theramore({ map: 1, point: native([0, 1]) }, { map: 0, point: native([8, 1]) }, 100),
      ]),
    ).toEqual(["transport", "transport"]);
    const before = await routeTrip(p, ground, { ...options, rides: { links: [there, back], faction: "Alliance" } });
    expect(keptLegs(p, before.journeys[0]!.legs, chosen, FRAMES).flatMap((leg, i) => (leg ? [i] : []))).toEqual([0]);
  });

  describe("a leg's flight and ship paths", () => {
    const p = plan([
      [0, 1],
      [8, 1],
      [0, 1],
    ]);
    const first = { map: 0, point: native([0, 1]) },
      second = { map: 0, point: native([8, 1]) };
    const rides = async (q: RoutePlan, links: TransportLink[]) =>
      (await routeTrip(q, ground, { ...options, rides: { links } })).journeys[0]!.legs.map((leg) =>
        leg.kind === "transport" ? leg.parts.flatMap((part) => (part.kind === "ride" ? [part.link.mode] : [])) : leg.kind,
      );
    const keptAfter = async (links: TransportLink[], changed: RoutePlan) =>
      keptLegs(p, (await routeTrip(p, ground, { ...options, rides: { links } })).journeys[0]!.legs, changed, FRAMES).flatMap((leg, i) =>
        leg ? [i] : [],
      );

    it("takes flights only on a leg that allows flight paths", async () => {
      const flight = (id: string, from: Stop, to: Stop) => service({ service: id, mode: "flight", requires: alliance }, [from, to]);
      const stormwind = { id: "FLIGHT_2", name: "Stormwind" },
        ironforge = { id: "FLIGHT_6", name: "Ironforge" };
      const air = (stop: Stop): Stop => ({ ...stop, id: `${stop.id}:air` });
      const [up, down] = [
        { ...first, air: true as const },
        { ...second, air: true as const },
      ];
      const links = [
        flight("FLIGHT_2", stormwind, air(stormwind))(first, up, 0),
        flight("FLIGHT_PATH_13", air(stormwind), air(ironforge))(up, down, 0),
        flight("FLIGHT_6", air(ironforge), ironforge)(down, second, 0),
        flight("FLIGHT_6", ironforge, air(ironforge))(second, down, 0),
        flight("FLIGHT_PATH_12", air(ironforge), air(stormwind))(down, up, 0),
        flight("FLIGHT_2", air(stormwind), stormwind)(up, first, 0),
      ];
      const shut = setLeg(p, 1, { flightPaths: false });
      const flown = ["flight", "flight", "flight"];
      expect(await rides(p, links)).toEqual([flown, flown]);
      expect(await rides(shut, links)).toEqual([flown, "route"]);
      expect(await keptAfter(links, shut)).toEqual([]);
    });

    it("takes ships and zeppelins only on a leg that allows them, and other rides with both paths off", async () => {
      const links = [southshore(first, second, 0), tirisfal(second, first, 0)];
      const shut = setLeg(p, 1, { shipPaths: false });
      expect(await rides(p, links)).toEqual([["ship"], ["zeppelin"]]);
      expect(await rides(setLeg(shut, 0, { shipPaths: false }), links)).toEqual(["route", "route"]);
      expect(await rides(setLeg(shut, 1, { flightPaths: false }), [...links, tram(second, first, 0)])).toEqual([["ship"], ["tram"]]);
      expect(await keptAfter(links, shut)).toEqual([]);
    });
  });

  it("takes a ride on one map only when it beats the ground route", async () => {
    const p = plan([
      [0, 1],
      [29, 1],
    ]);
    const long = () => ({ terrain: whole(flat(30, 3)) });
    const kinds = async (seconds: number) => {
      const ship = southshore({ map: 0, point: native([1, 1]) }, { map: 0, point: native([28, 1]) }, seconds);
      const trip = await routeTrip(p, long, { ...options, rides: { links: [ship] } });
      return trip.journeys.map((j) => j.legs[0]!.kind);
    };
    expect(await kinds(0)).toEqual(["transport", "transport"]);
    expect(await kinds(60)).toEqual(["route", "route"]);
  });

  it("activates the mode again on the next leg after a ride that arrives at a waypoint", async () => {
    const p = plan([
      [0, 1],
      [30, 1],
      [35, 1],
    ]);
    const ship = southshore({ map: 0, point: native([0, 1]) }, { map: 0, point: native([30, 1]) }, 1);
    const trip = await routeTrip(p, () => ({ terrain: whole(flat(40, 3)), groundKey: "flat" }), { ...options, rides: { links: [ship] } });
    const mounted = trip.journeys.find((j) => j.mode === mount)!;
    expect(mounted.legs.map((leg) => leg.kind)).toEqual(["transport", "route"]);
    expect(mounted.seconds).toBeCloseTo(6.5);
    expect(mounted.legs[1]).toMatchObject({ activation: 3 });
    const kept = (after: RoutePlan) => keptLegs(p, mounted.legs, after, FRAMES).flatMap((leg, i) => (leg ? [i] : []));
    expect(kept(p)).toEqual([0, 1]);
    expect(kept(setLeg(p, 0, { shipPaths: false }))).toEqual([]);
  });

  it("gives a debug search after a ride the movement state of the selected trip", async () => {
    const p = plan([
      [0, 1],
      [30, 1],
      [35, 1],
    ]);
    const land = whole(flat(40, 3));
    const ship = southshore({ map: 0, point: native([0, 1]) }, { map: 0, point: native([30, 1]) }, 1);
    const trip = await routeTrip(p, () => ({ terrain: land, groundKey: "flat" }), { ...options, rides: { links: [ship] } });
    const mounted = trip.journeys.find((j) => j.mode === mount)!;
    const walks = [{ before: false, after: false }, undefined];
    const asked = await tripLegRequest(p, () => land, mount, options, 1, walks);
    expect(asked).toEqual({ terrain: land, request: request(mount, false, false), from: native([30, 1]), to: native([35, 1]) });
    expect(mounted.legs.map(rideWalks)).toEqual(walks);
    expect(await routeLeg(land, native([30, 1]), native([35, 1]), normal, asked!.request)).toEqual(mounted.legs[1]);
  });

  it("remounts after a leg's last swim only when the trip moves before its next ride", async () => {
    const shore = flat(40, 1);
    shore.water.set([0, 0, 0], 2);
    shore.elevation.set([-30, -80, -10], 2);
    shore.slope.set([80, 80, 80], 2);
    const ground = (map: number) => ({ terrain: whole(shore, testFrame(map)), groundKey: "shore" });
    const dock = southshore({ map: 0, point: native([0, 0]) }, { map: 0, point: native([2, 0]) }, 0);
    const onward = tirisfal({ map: 0, point: native([5, 0]) }, { map: 0, point: native([39, 0]) }, 1);
    const times = async (q: RoutePlan, links: TransportLink[]) => {
      const j = (await routeTrip(q, ground, { ...options, rides: { links } })).journeys.find((j) => j.mode === mount)!;
      return j.legs.map((leg) => [leg.kind, "seconds" in leg && leg.seconds]);
    };
    const swim = plan(
      [
        [2, 0],
        [5, 0],
        [39, 0],
      ],
      undefined,
      true,
    );
    expect(await times(swim, [onward])).toEqual([
      ["route", 6],
      ["transport", 1],
    ]);
    const walks = [undefined, { before: false, after: false }];
    expect(await tripLegRequest(swim, () => whole(shore), mount, options, 0, walks)).toMatchObject({
      request: { active: false, continues: false },
    });
    expect(await times({ ...swim, stops: [at(native([0, 0])), ...swim.stops.slice(1)] }, [dock, onward])).toEqual([
      ["transport", 6],
      ["transport", 1],
    ]);
    const landing = ride({ map: 0, point: native([0, 0]) }, { map: 1, point: native([2, 0]) }, 1);
    expect(await times(onMaps({ ...swim, stops: [at(native([0, 0])), ...swim.stops.slice(1)] }, [0, 1, 1]), [landing])).toEqual([
      ["transport", 10],
      ["route", 17],
    ]);
  });

  it("drops a found swim leg when the next leg can switch between a ride and the ground", async () => {
    const shore = flat(40, 1);
    shore.water.set([0, 0, 0], 2);
    shore.elevation.set([-30, -80, -10], 2);
    shore.slope.set([80, 80, 80], 2);
    const ground = (map: number) => ({ terrain: whole(shore, testFrame(map)), groundKey: "shore" });
    const links = [tirisfal({ map: 0, point: native([5, 0]) }, { map: 0, point: native([39, 0]) }, 1)];
    const p = plan(
      [
        [2, 0],
        [5, 0],
        [39, 0],
      ],
      undefined,
      true,
    );
    const mounted = async (q: RoutePlan) =>
      (await routeTrip(q, ground, { ...options, rides: { links } })).journeys.find((j) => j.mode === mount)!;
    const times = (j: Journey) => j.legs.map((leg) => [leg.kind, "seconds" in leg && leg.seconds]);
    const before = await mounted(p);
    const shut = setLeg(p, 1, { shipPaths: false });
    const walked = await mounted(shut);
    expect(times(before)).toEqual([
      ["route", 6],
      ["transport", 1],
    ]);
    expect(times(walked)).toEqual([
      ["route", 9],
      ["route", 17],
    ]);
    const kept = (from: RoutePlan, j: Journey, after: RoutePlan) =>
      keptLegs(from, j.legs, after, FRAMES).flatMap((leg, i) => (leg ? [i] : []));
    expect(kept(p, before, p)).toEqual([0, 1]);
    expect(kept(p, before, shut)).toEqual([]);
    expect(kept(shut, walked, shut)).toEqual([0, 1]);
    expect(kept(shut, walked, p)).toEqual([]);
  });

  it("drops a found swim leg when a later leg can switch the next leg, found or not, between a ride and the ground", async () => {
    const shore = flat(40, 1);
    for (const water of [2, 30]) {
      shore.water.set([0, 0, 0], water);
      shore.elevation.set([-30, -80, -10], water);
      shore.slope.set([80, 80, 80], water);
    }
    const ground = (map: number) => ({ terrain: whole(shore, testFrame(map)), groundKey: "shore" });
    const links = [tirisfal({ map: 0, point: native([5, 0]) }, { map: 0, point: native([33, 0]) }, 21)];
    const p = plan(
      [
        [2, 0],
        [5, 0],
        [33, 0],
        [39, 0],
      ],
      undefined,
      true,
    );
    const mounted = async (q: RoutePlan) =>
      (await routeTrip(q, ground, { ...options, rides: { links } })).journeys.find((j) => j.mode === mount)!;
    const times = (j: Journey) => j.legs.map((leg) => [leg.kind, "seconds" in leg && leg.seconds]);
    const before = await mounted(p);
    const stays: RoutePlan = { ...p, stops: [...p.stops.slice(0, 3), p.stops[2]!] };
    const held = await mounted(stays);
    expect(times(before)).toEqual([
      ["route", 6],
      ["transport", 21],
      ["route", 6],
    ]);
    expect(times(held)).toEqual([
      ["route", 9],
      ["route", 20],
      ["route", 0],
    ]);
    const kept = (from: RoutePlan, legs: readonly (JourneyLeg | undefined)[], after: RoutePlan) =>
      keptLegs(from, legs, after, FRAMES).flatMap((leg, i) => (leg ? [i] : []));
    expect(kept(p, before.legs, p)).toEqual([0, 1, 2]);
    expect(kept(p, before.legs, stays)).toEqual([]);
    expect(kept(stays, held.legs, stays)).toEqual([0, 1, 2]);
    expect(kept(stays, held.legs, p)).toEqual([]);
    const unfound = [held.legs[0], undefined, held.legs[2]];
    expect(kept(stays, unfound, stays)).toEqual([0, 2]);
    expect(kept(stays, unfound, p)).toEqual([]);
  });

  it("settles remounts for tied ride legs with different approach movement", async () => {
    const shore = flat(40, 1);
    shore.water.set([0, 0, 0], 2);
    shore.elevation.set([-30, -80, -10], 2);
    shore.slope.set([80, 80, 80], 2);
    const p = plan(
      [
        [2, 0],
        [5, 0],
        [39, 0],
      ],
      undefined,
      true,
    );
    const dock = southshore({ map: 0, point: native([5, 0]) }, { map: 0, point: native([39, 0]) }, 2);
    const walk = tirisfal({ map: 0, point: native([6, 0]) }, { map: 0, point: native([39, 0]) }, 1.5);
    for (const [links, seconds, before] of [
      [[dock], 8, false],
      [[walk], 11, true],
    ] as const) {
      const trip = await routeTrip(p, () => ({ terrain: whole(shore) }), { ...options, modes: [mount.name], rides: { links } });
      expect(trip.journeys[0]).toMatchObject({
        seconds,
        legs: [
          { kind: "route", seconds: seconds - 2 },
          { kind: "transport", seconds: 2 },
        ],
      });
      expect(rideWalks(trip.journeys[0]!.legs[1])).toEqual({ before, after: false });
      expect(trip.fastest?.seconds).toBe(seconds);
    }
    for (const links of [
      [dock, walk],
      [walk, dock],
    ]) {
      const trip = await routeTrip(p, () => ({ terrain: whole(shore) }), { ...options, modes: [mount.name], rides: { links } });
      const j = trip.journeys[0]!;
      expect([
        [8, 6, false],
        [11, 9, true],
      ]).toContainEqual([j.seconds, "seconds" in j.legs[0]! ? j.legs[0].seconds : undefined, rideWalks(j.legs[1])?.before]);
      expect(j.legs).toMatchObject([{ kind: "route" }, { kind: "transport", seconds: 2 }]);
    }
  });

  it("charges the next activation after tied rides with different exit movement and keeps the earlier mode on equal totals", async () => {
    const p = plan([
      [0, 0],
      [30, 0],
      [35, 0],
    ]);
    p.settings.modes = [mount, { ...mount, name: "Same speed" }];
    const dock = southshore({ map: 0, point: native([0, 0]) }, { map: 0, point: native([30, 0]) }, 4);
    const walk = tirisfal({ map: 0, point: native([0, 0]) }, { map: 0, point: native([28, 0]) }, 0);
    for (const [links, seconds, activation, after] of [
      [[dock], 9.5, 3, false],
      [[walk], 6.5, 0, true],
    ] as const) {
      const trip = await routeTrip(p, () => ({ terrain: whole(flat(40, 1)) }), { ...options, rides: { links } });
      for (const j of trip.journeys) {
        expect(j).toMatchObject({
          seconds,
          legs: [
            { kind: "transport", seconds: 4 },
            { kind: "route", activation, seconds: seconds - 4 },
          ],
        });
        expect(rideWalks(j.legs[0])).toEqual({ before: false, after });
      }
      expect(trip.fastest?.mode).toBe(mount);
    }
  });

  it("does not walk through a ride stop without a ride, even when rounding makes that split faster", async () => {
    const p: RoutePlan = {
      ...plan([], [straight, straight]),
      stops: pixels([
        [4237, 15537],
        [4105, 14166],
        [4105, 10000],
      ]),
    };
    const stop = { map: 0, point: [4149, 14623] as Point };
    const far = { map: 0, point: [0, 0] as Point };
    const out = southshore(stop, far, 1000);
    const links = [
      out,
      { ...out, from: out.to, to: out.from },
      tirisfal({ map: 0, point: [4105, 14166] }, { map: 0, point: [4105, 10000] }, 1),
    ];
    const trip = await routeTrip(p, () => ({ terrain: whole(flat(9, 3)), groundKey: "flat" }), { ...options, rides: { links } });
    const walked = trip.journeys.find((j) => j.mode === run)!;
    expect(walked.legs.map((leg) => [leg.kind, "seconds" in leg && Math.round(leg.seconds * 1000) / 1000])).toEqual([
      ["straight", 204.961],
      ["transport", 1],
    ]);
  });

  it("keeps no later leg when an earlier ride change makes an unchanged leg between them choose the ground", async () => {
    const p = plan([
      [0, 1],
      [30, 1],
      [60, 1],
      [65, 1],
    ]);
    const links = [
      southshore({ map: 0, point: native([0, 1]) }, { map: 0, point: native([30, 1]) }, 1),
      tirisfal({ map: 0, point: native([30, 1]) }, { map: 0, point: native([60, 1]) }, 16),
    ];
    const mounted = async (q: RoutePlan) =>
      (await routeTrip(q, () => ({ terrain: whole(flat(80, 3)), groundKey: "flat" }), { ...options, rides: { links } })).journeys.find(
        (j) => j.mode === mount,
      )!;
    const times = (j: Journey) =>
      j.legs.map((leg) => [leg.kind, "activation" in leg ? leg.activation : undefined, "seconds" in leg && leg.seconds]);
    const before = await mounted(p);
    const shut = setLeg(p, 0, { shipPaths: false });
    expect(times(before)).toEqual([
      ["transport", undefined, 1],
      ["transport", undefined, 16],
      ["route", 3, 5.5],
    ]);
    expect(times(await mounted(shut))).toEqual([
      ["route", 3, 18],
      ["route", 0, 15],
      ["route", 0, 2.5],
    ]);
    const kept = (after: RoutePlan) => keptLegs(p, before.legs, after, FRAMES).flatMap((leg, i) => (leg ? [i] : []));
    expect(kept(p)).toEqual([0, 1, 2]);
    expect(kept(shut)).toEqual([]);
  });

  it("keeps the mode active on the next leg after a ride between maps whose last ground part moves", async () => {
    const p: RoutePlan = onMaps(
      plan([
        [0, 1],
        [4, 1],
        [8, 1],
      ]),
      [0, 1, 1],
    );
    const ship = ride({ map: 0, point: native([8, 1]) }, { map: 1, point: native([0, 1]) }, 100);
    const trip = await routeTrip(p, ground, { ...options, rides: { links: [ship] } });
    const mounted = trip.journeys.find((j) => j.mode === mount)!;
    expect(mounted.legs.map((leg) => leg.kind)).toEqual(["transport", "route"]);
    expect(mounted.seconds).toBeCloseTo(114);
    expect(mounted.legs[1]).toMatchObject({ activation: 0 });
  });

  it("marks a ground result as searching until the leg's rides are searched", async () => {
    const ship = southshore({ map: 0, point: native([0, 1]) }, { map: 0, point: native([2, 1]) }, 1);
    const updates: LegUpdate[] = [];
    const cut = whole(walled());
    const trip = await routeTrip(
      plan([
        [0, 1],
        [8, 1],
      ]),
      () => ({ terrain: cut, groundKey: "cut" }),
      { ...options, rides: { links: [ship] }, onLegs: (u) => updates.push(...u) },
    );
    expect(trip.journeys.map((j) => j.legs[0]!.kind)).toEqual(["no-path", "no-path"]);
    expect(updates.map((u) => [u.mode, u.result.kind, !!u.searching, u.trying])).toEqual([
      ["Run", "no-path", true, undefined],
      ["Mount", "no-path", true, undefined],
      ["Run", "no-path", true, "ship"],
      ["Run", "no-path", false, undefined],
      ["Mount", "no-path", true, "ship"],
      ["Mount", "no-path", false, undefined],
    ]);
  });

  it("gives no terrain at once for a leg whose end is off the terrain, without trying a ride", async () => {
    const ship = southshore({ map: 0, point: native([1, 1]) }, { map: 0, point: native([8, 1]) }, 1);
    const updates: LegUpdate[] = [];
    const trip = await routeTrip(
      plan([
        [0, 1],
        [12, 1],
      ]),
      () => ({ terrain: whole(flat(9, 3)), groundKey: "flat" }),
      { ...options, modes: ["Run"], rides: { links: [ship] }, onLegs: (u) => updates.push(...u) },
    );
    expect(trip.journeys.map((j) => j.legs)).toEqual([[{ kind: "no-terrain", endpoint: "end" }]]);
    expect(updates.map((u) => [u.mode, u.result.kind, !!u.searching, u.trying])).toEqual([
      ["Run", "no-terrain", true, undefined],
      ["Run", "no-terrain", false, undefined],
    ]);
  });

  it("searches a ground part with no path once for all modes", async () => {
    const p: RoutePlan = onMaps(
      plan([
        [0, 1],
        [8, 1],
      ]),
      [0, 1],
    );
    const ship = ride({ map: 0, point: native([8, 1]) }, { map: 1, point: native([0, 1]) }, 100);
    const searches = async (modes: MovementMode[]) => {
      let calls = 0;
      const cut: Terrain = { ...whole(walled(), testFrame(1)), region: async () => (calls++, walled()) };
      const trip = await routeTrip(
        { ...p, settings: { ...p.settings, modes } },
        (map) => (map ? { terrain: cut, groundKey: "cut" } : ground(map)),
        {
          ...options,
          rides: { links: [ship] },
        },
      );
      expect(trip.journeys.map((j) => j.legs[0]!.kind)).toEqual(modes.map(() => "crossing"));
      return calls;
    };
    expect(await searches([run, mount])).toBe(await searches([run]));
  });

  it("times each ground part of the slowest mode in a faster mode", async () => {
    const p: RoutePlan = onMaps(
      plan([
        [1, 2],
        [7, 2],
      ]),
      [0, 1],
    );
    const ship = ride({ map: 0, point: native([7, 2]) }, { map: 1, point: native([1, 2]) }, 100);
    const searches = async (modes: MovementMode[]) => {
      let calls = 0;
      const land = flat(9, 5);
      const terrain: Terrain = { ...whole(land), region: async (points) => ((calls += points.length > 1 ? 1 : 0), land) };
      const trip = await routeTrip(
        { ...p, settings: { ...p.settings, modes } },
        (map) => ({ terrain: { ...terrain, frame: testFrame(map) }, groundKey: `map ${map}` }),
        {
          ...options,
          rides: { links: [ship] },
        },
      );
      for (const j of trip.journeys) {
        const own = await routeLeg(whole(land), native([1, 2]), native([7, 2]), normal, request(j.mode, false, false));
        const parts = (j.legs[0] as TransportLeg).parts.filter((part) => part.kind === "ground");
        expect(parts.map((part) => ({ ...part.result, seconds: 0 }))).toEqual([own, own].map((r) => ({ ...r, seconds: 0 })));
        for (const part of parts) expect((part.result as { seconds: number }).seconds).toBeCloseTo((own as { seconds: number }).seconds, 9);
      }
      return calls;
    };
    expect(await searches([run, mount])).toBe(await searches([run]));
  });
});

describe("trips into or out of a closed area", () => {
  const pocket = () => {
    const grid = flat(12, 7);
    for (let y = 2; y <= 4; y++) for (let x = 8; x <= 10; x++) if (x !== 9 || y !== 3) grid.blocked[y * 12 + x] = 1;
    return grid;
  };
  const inside: CellPoint = [9, 3],
    outside: CellPoint = [0, 3];
  const ship = (id: string, from: MapPoint, to: MapPoint): TransportLink => ({
    service: id,
    mode: "ship",
    from: { id: `${id} from`, name: id, ...from },
    to: { id: `${id} to`, name: id, ...to },
    requires: {},
    seconds: { min: 0, average: 50, max: 100 },
  });
  const on = (map: number, cell: CellPoint): MapPoint => ({ map, point: native(cell) });
  const away = [ship("out", on(0, [1, 3]), on(1, [0, 1])), ship("back", on(1, [8, 1]), on(0, [5, 3]))];
  const trip = (p: RoutePlan, links: TransportLink[]) => {
    const terrain = whole(pocket());
    return routeTrip(p, (map) => (map ? undefined : { terrain, groundKey: "pocket" }), { maxSlope: DEFAULT_MAX_SLOPE, rides: { links } });
  };
  const kinds = async (p: RoutePlan, links: TransportLink[]) => (await trip(p, links)).journeys.map((j) => j.legs[0]);

  it("gives no path at once into or out of a closed area that no ride reaches", async () => {
    expect(await kinds(plan([outside, inside]), away)).toEqual([
      { kind: "no-path", endpoint: "end" },
      { kind: "no-path", endpoint: "end" },
    ]);
    expect(await kinds(plan([inside, outside]), away)).toEqual([{ kind: "no-path" }, { kind: "no-path" }]);
  });

  it("still routes through a ride that reaches the closed area", async () => {
    const portal = ship("portal", on(0, [1, 3]), on(0, inside));
    for (const leg of await kinds(plan([outside, inside]), [...away, portal]))
      expect(leg).toMatchObject({ kind: "transport", parts: [{ kind: "ground" }, { kind: "ride", link: portal }, { kind: "ground" }] });
  });

  describe("with a stop in a cell without a node", () => {
    const centre: CellPoint = [9, 3];
    const room = (floors: CellPoint[]) => {
      return withFloor(blockRing(flat(13, 7), centre, 2), Object.fromEntries(floors.map(([x, y]) => [y * 13 + x, {}])));
    };
    const mid = ([x, y]: Point): Point => [x + 2, y + 2];
    const roomTrip = async (p: RoutePlan, links: TransportLink[], floors = [centre]) => {
      const land = room(floors);
      let searches = 0;
      const terrain: Terrain = { ...whole(land), region: async (points) => ((searches += points.length > 1 ? 1 : 0), land) };
      const middle = { ...p, stops: p.stops.map((stop) => at(mid(pixelOf(stop)))) };
      const { journeys: found } = await routeTrip(middle, (map) => (map ? undefined : { terrain, groundKey: "room" }), {
        maxSlope: DEFAULT_MAX_SLOPE,
        rides: { links },
      });
      return { legs: found.map((j) => j.legs[0]), searches };
    };

    it("gives no path into or out of the room after one ground search", async () => {
      const end = { kind: "no-path", endpoint: "end" };
      expect(await roomTrip(plan([outside, centre]), away)).toEqual({ legs: [end, end], searches: 1 });
      expect(await roomTrip(plan([centre, outside]), away)).toEqual({ legs: [{ kind: "no-path" }, { kind: "no-path" }], searches: 1 });
    });

    it("still routes through a ride into the room", async () => {
      const portal = ship("portal", on(0, [1, 3]), on(0, [8, 3]));
      const { legs } = await roomTrip(plan([outside, centre]), [...away, portal]);
      for (const leg of legs)
        expect(leg).toMatchObject({ kind: "transport", parts: [{ kind: "ground" }, { kind: "ride", link: portal }, { kind: "ground" }] });
    });

    it("routes through a ride that leaves or reaches the stop when its side cells have no node either", async () => {
      const floors: CellPoint[] = [centre, [8, 3], [10, 3], [9, 2], [9, 4]];
      const stop: MapPoint = { map: 0, point: mid(native(centre)) };
      const leaving = ship("leaving", stop, on(0, [1, 3])),
        reaching = ship("reaching", on(0, [1, 3]), stop);
      for (const [p, portal] of [
        [plan([centre, outside]), leaving],
        [plan([outside, centre]), reaching],
      ] as const) {
        const { legs } = await roomTrip(p, [...away, portal], floors);
        for (const leg of legs)
          expect(leg).toMatchObject({ kind: "transport", parts: [{ kind: "ground" }, { kind: "ride", link: portal }, { kind: "ground" }] });
      }
    });
  });

  it("reports each mode of ride that it tries in turn while it cannot prove that the end is closed", async () => {
    const flight = (id: string, from: CellPoint, to: CellPoint) => ({ ...ship(id, on(0, from), on(0, to)), mode: "flight" });
    const links = [...away, flight("up", [2, 1], [6, 1]), flight("down", [2, 5], [6, 5])];
    const updates: LegUpdate[] = [];
    const terrain = whole({
      ...pocket(),
      coverage: ([x, y]) => (x >= 0 && y >= 0 && y < 7 ? (x < 12 ? "present" : "missing-coverage") : undefined),
    });
    const { journeys: found } = await routeTrip(plan([outside, [20, 3]]), () => ({ terrain, groundKey: "pocket" }), {
      maxSlope: DEFAULT_MAX_SLOPE,
      modes: [run.name],
      rides: { links },
      onLegs: (u) => updates.push(...u),
    });
    expect(updates.map((u) => u.trying ?? (u.searching ? "searching" : "done"))).toEqual([
      "searching",
      "flight",
      "ship",
      "flight",
      "ship",
      "flight",
      "ship",
      "done",
    ]);
    expect(found[0]!.legs[0]!.kind).toBe("missing-coverage");
  });

  it("stops a search from another map once a ground part proves that the end is closed", async () => {
    const p = onMaps(plan([[0, 1], inside]), [2, 0]);
    const links = [ship("there", on(2, [8, 1]), on(0, [1, 3])), ...away];
    const terrains = [whole(pocket()), undefined, whole(flat(9, 3), testFrame(2))];
    const ground = (map: number) => {
      const terrain = terrains[map];
      return terrain && { terrain, groundKey: `map ${map}` };
    };
    const { journeys: found } = await routeTrip(p, ground, { maxSlope: DEFAULT_MAX_SLOPE, rides: { links } });
    expect(found.map((j) => j.legs[0]!.kind)).toEqual(["crossing", "crossing"]);
  });
});

describe("known legs", () => {
  async function routeKnown(p: RoutePlan, known = new Map<string, LegResult>()) {
    const calls: LegUpdate[][] = [];
    const options = { maxSlope: DEFAULT_MAX_SLOPE, groundKey: "flat", known, onLegs: (updates: LegUpdate[]) => calls.push(updates) };
    const result = await routeJourney(whole(flat(9, 1)), p, mount, options);
    for (const update of calls.flat()) if ("key" in update && update.key) known.set(update.key, update.result);
    return { result, calls, known };
  }

  it("takes known legs before any search, and searches an unchanged leg whose activation state changed", async () => {
    const { known } = await routeKnown(
      plan([
        [0, 0],
        [4, 0],
        [8, 0],
      ]),
    );
    const moved = plan([
      [0, 0],
      [4, 0],
      [7, 0],
    ]);
    const { result, calls } = await routeKnown(moved, known);
    expect(calls.map((updates) => updates.map((u) => u.leg))).toEqual([[0], [1]]);
    expect(result).toEqual(await journey(flat(9, 1), moved));

    const near = { ...moved, stops: pixels([[17, 0], native([4, 0]), native([8, 0])]) };
    const again = await routeKnown(near, known);
    expect(activations(again.result)).toEqual([0, 3]);
    expect(again.result).toEqual(await journey(flat(9, 1), near));
  });
});

describe("kept legs", () => {
  async function kept(before: RoutePlan, after: RoutePlan) {
    const legs = keptLegs(before, (await journey(flat(9, 1), before)).legs, after, FRAMES);
    const fresh = await journey(flat(9, 1), after);
    for (const [i, leg] of legs.entries()) if (leg) expect(leg).toEqual(fresh.legs[i]);
    return legs.flatMap((leg, i) => (leg ? [i] : []));
  }
  const move = (p: RoutePlan, stop: number, to: Point): RoutePlan => ({
    ...p,
    stops: p.stops.with(stop, { ...p.stops[stop]!, ...at(to) }),
  });
  const three = plan([
    [0, 0],
    [4, 0],
    [8, 0],
  ]);

  it("keeps the legs whose stops, setting, and activation state stay the same", async () => {
    expect(await kept(three, three)).toEqual([0, 1]);
    const four = plan([
      [0, 0],
      [2, 0],
      [4, 0],
      [8, 0],
    ]);
    expect(await kept(four, move(four, 3, native([6, 0])))).toEqual([0, 1]);
    expect(await kept(three, { ...three, settings: { ...three.settings, modes: [run, { ...mount, speed: 20 }] } })).toEqual([]);
  });

  it("keeps no leg next to a stop whose height changed", async () => {
    expect(await kept(three, withHeights(three, [null, 385, null]))).toEqual([]);
    expect(await kept(three, withHeights(three, [null, null, 385]))).toEqual([0]);
  });

  it("keeps a found leg that ends on land while a changed later leg can stay", async () => {
    expect(await kept(three, move(three, 2, native([6, 0])))).toEqual([0]);
    expect(await kept(three, move(three, 2, [18, 0]))).toEqual([0]);
  });

  it("keeps a found leg that ends swimming only while each later leg moves in both plans or in neither", async () => {
    const shore = native([5, 0]);
    const swim = plan(
      [
        [2, 0],
        [5, 0],
        [6, 0],
      ],
      undefined,
      true,
    );
    const found = (await journey(channel(), swim)).legs.slice(0, 1);
    expect(found[0]).toMatchObject({ swimRemounts: [{ seconds: 3 }] });
    const indices = (legs: unknown[]) => legs.flatMap((leg, i) => (leg ? [i] : []));
    expect(indices(keptLegs(swim, found, { ...swim }, FRAMES))).toEqual([0]);
    const after = move(swim, 2, [shore[0] + 2, 0]);
    expect(found[0]).not.toEqual((await journey(channel(), after)).legs[0]);
    expect(indices(keptLegs(swim, found, after, FRAMES))).toEqual([]);
  });

  it("drops a found leg when a later leg that may stay leaves the decision to a changed leg", async () => {
    const shore = native([5, 0]);
    const trip = (end: Point): RoutePlan => ({
      ...plan(
        [
          [2, 0],
          [5, 0],
          [5, 0],
          [6, 0],
        ],
        undefined,
        true,
      ),
      stops: pixels([native([2, 0]), shore, [shore[0] + 1, 0], end]),
    });
    const before = trip(native([6, 0]));
    const after = trip([shore[0] + 2, 0]);
    const found = (await journey(channel(), before)).legs.slice(0, 1);
    expect(found[0]).not.toEqual((await journey(channel(), after)).legs[0]);
    expect(keptLegs(before, found, after, FRAMES).flatMap((leg, i) => (leg ? [i] : []))).toEqual([]);
  });

  it.each(["downhill", "damagingFalls", "fatalFalls", "hazards"] as const)(
    "routes a leg again when %s changes, and the leg after it, whose activation state the changed leg decides",
    async (name) => {
      const toggled = (leg: number) => ({ ...three, legs: three.legs.with(leg, { ...normal, [name]: !normal[name] }) });
      expect(await kept(three, toggled(1))).toEqual([0]);
      expect(await kept(three, toggled(0))).toEqual([]);
    },
  );

  it("drops a leg whose activation state changes with the legs around it", async () => {
    expect(await kept(three, move(three, 0, [17, 0]))).toEqual([]);
  });

  it("keeps a leg after a crossing only while the crossing stays the same", () => {
    const route: LegResult = { kind: "straight", points: [native([4, 0]), native([8, 0])], distance: 28, activation: 0, seconds: 2 };
    const trip = onMaps(three, [1, 0, 0]);
    const kept = (after: RoutePlan) => keptLegs(trip, [{ kind: "crossing" }, route], after, FRAMES).flatMap((leg, i) => (leg ? [i] : []));
    expect(kept(trip)).toEqual([0, 1]);
    expect(kept(move(trip, 0, native([2, 0])))).toEqual([]);
    expect(kept(onMaps(trip, [0, 0, 0]))).toEqual([]);
  });
});

describe("world plans", () => {
  async function flatTerrain(origin: Tile) {
    const present: Tile[] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) present.push([x, y]);
    const { files, pin } = await flatArtifact(0, origin, [3, 3], present);
    const load = await loadArtifact(async (path) => files.get(path), pin);
    if (!load.ok) throw new Error(load.reason);
    return createTerrain(load.artifact);
  }

  it("routes one world plan on frames with other origins at other pixels and the same world positions", async () => {
    const [first, later] = [await flatTerrain([23, 20]), await flatTerrain([22, 21])];
    const p = { ...plan([], [normal]), stops: [at([100, 700], null, first.frame), at([700, 900], null, first.frame)] };
    const ends = async (terrain: Terrain) => {
      const leg = (await routeJourney(terrain, p, run, { maxSlope: DEFAULT_MAX_SLOPE })).legs[0]!;
      if (leg.kind !== "route") throw new Error(leg.kind);
      return [leg.points[0]!, leg.points.at(-1)!];
    };
    const yards = (terrain: Terrain, point: Point) => {
      const { x, y } = nativeToWorld(terrain.frame, point);
      return [x, y].map((n) => Math.round(n * 100) / 100);
    };
    const [onFirst, onLater] = [await ends(first), await ends(later)];
    expect([onFirst, onLater]).toEqual([
      [
        [102, 702],
        [702, 902],
      ],
      [
        [614, 190],
        [1214, 390],
      ],
    ]);
    const world = [
      [4693.75, 5668.75],
      [4068.75, 5460.42],
    ];
    expect(onFirst.map((point) => yards(first, point))).toEqual(world);
    expect(onLater.map((point) => yards(later, point))).toEqual(world);
  });
});
