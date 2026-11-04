import type { Point } from "./frame.ts";
import { describe, expect, it } from "vitest";
import { CELLS } from "./artifact.ts";
import { E, N, S, W, at as atPixel, flat, records, TEST_FRAME, whole, withFloor, type CellSpec } from "./fixtures/region.ts";
import type { Building, FloorPoint, Target } from "./floor.ts";
import { classifyStop, doorsPath, pairPath, pathLength } from "./indoor.ts";
import { keptLegs, routeJourney } from "./journey.ts";
import { floorLines } from "./result.ts";
import { DEFAULT_LEG, type MovementMode, type RoutePlan, type WorldStop } from "./plan.ts";
import { routeLeg, stopKeys, type ExpandedCells, type LegRequest, type LegResult, type TerrainRoute } from "./search.ts";
import { CELL_SPACING, cellToNative, nativeToCell, type CellPoint, type TerrainRegion } from "./terrain.ts";

const run: MovementMode = { name: "Run", speed: 7, activation: 0 };
const mount: MovementMode = { name: "Mount", speed: 14, activation: 3 };

const at = (x: number, y: number, z = 0): FloorPoint => [x * 16, y * 16, z * 8];
const px = ([x, y]: readonly number[]): Point => [(x ?? 0) / 16, (y ?? 0) / 16];
const centre = (cell: CellPoint): Point => cellToNative({ tile: [0, 0] }, cell);
const pixels = (points: Point[]): WorldStop[] => points.map((p) => atPixel(p));

const A = at(16, 14),
  B = at(32, 18, 5);
const T0 = at(28, 12, 5),
  T1 = at(20, 16),
  T2 = at(20, 20);
const TARGETS: Target[] = [
  { point: [T0[0], T0[1]], floor: 1, kind: 0 },
  { point: [T1[0], T1[1]], floor: 255, kind: 1 },
  { point: [T2[0], T2[1]], floor: 0, kind: 0 },
];
interface Paths {
  doors: FloorPoint[][][];
  pair02: FloorPoint[];
  doorsAB: FloorPoint[];
}
const PATHS: Paths = {
  doors: [
    [
      [A, at(24, 14), at(24, 12, 5), T0],
      [A, T1],
      [A, T2],
    ],
    [
      [B, T0],
      [B, at(20, 16, 5)],
      [B, at(24, 18, 5), at(24, 20), T2],
    ],
  ],
  pair02: [T0, at(24, 12, 5), at(24, 20), T2],
  doorsAB: [A, at(24, 14), at(24, 18, 5), B],
};
const attachA: CellPoint = [3, 3],
  attachB: CellPoint = [8, 4];
function building(paths: Partial<Paths> = {}): Building {
  const { doors, pair02, doorsAB } = { ...PATHS, ...paths };
  return {
    placement: 1,
    box: [256, 128, 511, 383],
    ground: 0,
    floors: [0, 40],
    doors: [
      { tile: [0, 0], cell: attachA[1] * CELLS + attachA[0], layer: 0, point: A },
      { tile: [0, 0], cell: attachB[1] * CELLS + attachB[0], layer: 0, point: B },
    ],
    targets: TARGETS,
    paths: [...(doors[0] ?? []), ...(doors[1] ?? []), [], pair02, [], doorsAB],
  };
}
function town(paths: Partial<Paths> = {}): TerrainRegion {
  const cells: Record<number, CellSpec> = {};
  for (let y = 2; y <= 5; y++) for (let x = 4; x <= 7; x++) cells[y * 16 + x] = { building: true, layers: [{ height: 20 }] };
  const region = flat(16, 10, CELL_SPACING);
  return withFloor(region, cells, [records([0, 0], { buildings: [building(paths)] })]);
}

const request: LegRequest = { maxSlope: 35, mode: run, swimming: { enabled: false, speed: 4.7 } };
async function go(region: TerrainRegion, from: Point, to: Point, options: Partial<LegRequest> = {}): Promise<TerrainRoute> {
  const result = await routeLeg(whole(region), from, to, { followTerrain: true, downhill: false }, { ...request, ...options });
  if (result.kind !== "route") throw new Error(`expected a route, found ${JSON.stringify(result)}`);
  return result;
}
const west = centre([0, 3]),
  east = centre([12, 4]);
const kinds = (route: TerrainRoute) => route.paths?.map((p) => p.kind);
const pathStarts = (route: TerrainRoute) => route.paths?.map((p) => route.points[p.start]);
const visits = (route: TerrainRoute, cell: CellPoint) => route.points.some((p) => nativeToCell({ tile: [0, 0] }, p).join() === cell.join());

describe("stop classes", () => {
  const near = (targets: Target[], hints: FloorPoint[] = []) =>
    withFloor(flat(CELLS, CELLS, CELL_SPACING), { [10 * CELLS + 10]: { building: true, layers: [{ height: 0 }] } }, [
      records([0, 0], { buildings: [{ ...building(), targets, paths: [] }], hints }),
    ]);
  const stop = at(41, 41);
  const target = (dx: number, floor: number, kind: 0 | 1 = 0): Target => ({ point: [stop[0] + dx * 16, stop[1]], floor, kind });

  it("matches the nearest target within 3 px, then the first in target order", () => {
    expect(classifyStop(near([target(0, 0), target(0, 2)]), px(stop))).toMatchObject({ class: "target", target: 0 });
    expect(classifyStop(near([target(0, 2), target(0, 255, 1)]), px(stop))).toMatchObject({ class: "target", target: 0 });
    expect(classifyStop(near([target(3, 0), target(2, 2)]), px(stop))).toMatchObject({ class: "target", target: 1 });
    expect(classifyStop(near([target(3, 0)]), px(stop))).toMatchObject({ class: "target", target: 0 });
    expect(classifyStop(near([target(3.0625, 0)]), px(stop)).class).toBe("ground");
  });

  it("gives a building stop on a building cell, then a hint, then ground", () => {
    const region = town();
    expect(classifyStop(region, centre([5, 2]))).toMatchObject({ class: "building", building: { home: [0, 0], index: 0 } });
    const hinted = near([], [at(2, 2, 10)]);
    expect(classifyStop(hinted, [4, 2])).toEqual({ class: "hint", height: 10 });
    expect(classifyStop(hinted, [6, 2])).toEqual({ class: "ground" });
    expect(classifyStop(flat(4, 4), [2, 2])).toEqual({ class: "ground" });
  });

  it("matches only a target or a building with a floor within a storey of a requested height", () => {
    const colocated = near([target(0, 0), target(0, 1)]);
    expect(classifyStop(colocated, px(stop), 5)).toMatchObject({ class: "target", target: 1 });
    expect(classifyStop(colocated, px(stop), 1)).toMatchObject({ class: "target", target: 0 });
    expect(classifyStop(near([target(0, 0), target(0, 255, 1)]), px(stop), 30)).toMatchObject({ class: "target", target: 1 });
    expect(classifyStop(town(), centre([5, 2]), 8)).toMatchObject({ class: "building" });
    expect(classifyStop(town(), centre([5, 2]), 9)).toEqual({ class: "ground" });
    expect(classifyStop(town(), centre([5, 2]), -4)).toEqual({ class: "ground" });
  });

  it("finds pair paths and door-to-door paths by their index", () => {
    const b = building();
    expect(pairPath(b, 0, 2)).toBe(PATHS.pair02);
    expect(pairPath(b, 2, 0)).toEqual(PATHS.pair02.toReversed());
    expect(pairPath(b, 0, 1)).toEqual([]);
    expect(doorsPath(b, 0, 1)).toBe(PATHS.doorsAB);
  });
});

describe("routes into and out of buildings", () => {
  it("ends at an upstairs target through the door with the cheaper total", async () => {
    const fromWest = await go(town(), west, px(T0));
    expect(pathStarts(fromWest)).toEqual([px(A)]);
    expect(fromWest.points.at(-1)).toEqual(px(T0));
    expect(fromWest.stops).toEqual([
      { class: "ground" },
      { class: "target", floor: { index: 1, ground: 0, confirmed: true }, building: 1 },
    ]);
    expect(fromWest.distance).toBeCloseTo(3 * CELL_SPACING + pathLength(PATHS.doors[0]![0]!), 6);
    expect(fromWest.seconds).toBeCloseTo(fromWest.distance / run.speed, 6);
    const fromEast = await go(town(), east, px(T0));
    expect(pathStarts(fromEast)).toEqual([px(B)]);
    expect(fromEast.paths).toEqual([{ kind: "door", start: fromEast.points.length - 2, end: fromEast.points.length - 1 }]);
  });

  it("ends at a kind 1 target on the floor that the cheaper door path reaches, not confirmed", async () => {
    const route = await go(town(), east, px(T1));
    expect(pathStarts(route)).toEqual([px(B)]);
    expect(route.stops?.[1]).toEqual({ class: "target", floor: { index: 1, ground: 0, confirmed: false }, building: 1 });
    expect(floorLines(route)).toEqual([{ text: "Inside: upper level. The floor is not confirmed.", side: 1, warn: true }]);
  });

  it("starts at a kind 1 target on the reversed path of the cheaper door", async () => {
    const route = await go(town(), px(T1), east);
    expect(route.points.slice(0, 3)).toEqual([px(T1), px(B), centre(attachB)]);
    expect(route.paths).toEqual([{ kind: "door", start: 0, end: 1 }]);
    expect(route.stops).toEqual([{ class: "target", floor: { index: 1, ground: 0, confirmed: false }, building: 1 }, { class: "ground" }]);
  });

  it("gives no floor to a leg that stays on a kind 1 target", async () => {
    const route = await go(town(), px(T1), px(T1));
    expect(route.stops).toEqual([
      { class: "target", building: 1 },
      { class: "target", building: 1 },
    ]);
    expect(floorLines(route)).toEqual([]);
  });

  it("takes the cheaper of an eligible pair path and the doors", async () => {
    const short = await go(town(), px(T0), px(T2));
    expect(short.paths).toEqual([{ kind: "pair", start: 0, end: 3 }]);
    expect(short.distance).toBeCloseTo(pathLength(PATHS.pair02), 6);
    expect(short.stops).toEqual([
      { class: "target", floor: { index: 1, ground: 0, confirmed: true }, building: 1 },
      { class: "target", floor: { index: 0, ground: 0, confirmed: true }, building: 1 },
    ]);
    const long = await go(town({ pair02: [T0, at(31, 8, 5), at(31, 23), T2] }), px(T0), px(T2));
    expect(kinds(long)).toEqual(["door", "door"]);
  });

  it("leaves by a door and enters by a door between a kind 1 target and another target", async () => {
    const route = await go(town(), px(T1), px(T2));
    expect(kinds(route)).toEqual(["door", "door"]);
    expect(route.points).toEqual([px(T1), px(A), centre(attachA), px(A), px(T2)]);
    expect(route.stops).toEqual([
      { class: "target", floor: { index: 0, ground: 0, confirmed: false }, building: 1 },
      { class: "target", floor: { index: 0, ground: 0, confirmed: true }, building: 1 },
    ]);
  });

  it("uses only the doors with a path to the target", async () => {
    const doors = [[PATHS.doors[0]![0]!, PATHS.doors[0]![1]!, []], PATHS.doors[1]!];
    const through = await go(town({ doors }), west, px(T2));
    expect(kinds(through)).toEqual(["doors", "door"]);
    expect(pathStarts(through)).toEqual([px(A), px(B)]);
    const around = await go(town({ doors, doorsAB: [] }), west, px(T2));
    expect(pathStarts(around)).toEqual([px(B)]);
  });

  it("stops at the cheaper door, door only, when no door has a path to the target", async () => {
    const doors = PATHS.doors.map((d) => [d[0]!, d[1]!, []]);
    for (const [from, attach] of [
      [west, attachA],
      [east, attachB],
    ] as const) {
      const route = await go(town({ doors }), from, px(T2));
      expect(route.points.at(-1)).toEqual(centre(attach));
      expect(route.paths).toBeUndefined();
      expect(route.stops?.[1]).toEqual({ class: "target", floor: "door", building: 1 });
    }
  });

  it("stops or starts at a door for a building stop that matches no target", async () => {
    const inside = centre([5, 2]);
    const end = await go(town(), west, inside);
    expect(end.points.at(-1)).toEqual(centre(attachA));
    expect(end.paths).toBeUndefined();
    expect(end.stops).toEqual([{ class: "ground" }, { class: "building", floor: "door", building: 1 }]);
    const start = await go(town(), inside, east);
    expect(start.points[0]).toEqual(centre(attachB));
    expect(start.stops?.[0]).toEqual({ class: "building", floor: "door", building: 1 });
  });

  it("gives the explored layer the cells under each stored path that the search follows", async () => {
    const expanded: ExpandedCells = new Map();
    await routeLeg(whole(town()), west, px(T2), { followTerrain: true, downhill: false }, request, expanded);
    const marked = expanded.get("0,0")!;
    const footprint: CellPoint[] = [];
    for (let y = 2; y <= 5; y++) for (let x = 4; x <= 7; x++) if (marked[y * CELLS + x]) footprint.push([x, y]);
    expect(footprint).toEqual([
      [4, 3],
      [5, 3],
      [6, 3],
      [4, 4],
      [6, 4],
      [7, 4],
      [5, 5],
    ]);
  });

  it("goes through the building on a door-to-door path when it is shorter, and around it without one", async () => {
    const [from, to] = [centre([2, 3]), centre([9, 4])];
    const through = await go(town(), from, to);
    expect(through.paths).toEqual([{ kind: "doors", start: 2, end: 5 }]);
    expect(through.distance).toBeCloseTo(2 * CELL_SPACING + pathLength(PATHS.doorsAB), 6);
    expect(through.stops).toBeUndefined();
    const around = await go(town({ doorsAB: [] }), from, to);
    expect(around.paths).toBeUndefined();
    expect(around.distance).toBeGreaterThan(through.distance);
  });

  it("charges the activation once, on the first stored path or step", async () => {
    const route = await go(town(), px(T1), east, { mode: mount });
    expect(route.activation).toBe(3);
    expect(route.seconds).toBeCloseTo(route.distance / mount.speed + 3, 6);
    const doorOnly = await go(town(), centre([5, 2]), east, { mode: mount });
    expect(doorOnly.activation).toBe(3);
    expect(doorOnly.seconds).toBeCloseTo(doorOnly.distance / mount.speed + 3, 6);
    const doors = PATHS.doors.map((d) => [d[0]!, d[1]!, []]);
    const still = await go(town({ doors }), centre(attachA), px(T2), { mode: mount });
    expect(still).toMatchObject({ points: [centre(attachA)], distance: 0, activation: 0, seconds: 0 });
  });

  it("finds a door-to-door path that is shorter than the distance between its attach cells", async () => {
    const wall = (gap: number) => {
      const region = flat(20, 12, CELL_SPACING);
      for (let y = 0; y < 12; y++) if (y !== gap) region.blocked[y * 20 + 10] = 1;
      return withFloor(region, {}, [records([0, 0], { buildings: [tunnel] })]);
    };
    const tunnel: Building = {
      ...building(),
      doors: [
        { tile: [0, 0], cell: 5 * CELLS + 8, layer: 0, point: at(40, 22) },
        { tile: [0, 0], cell: 5 * CELLS + 12, layer: 0, point: at(44, 22) },
      ],
      targets: [],
      paths: [[at(40, 22), at(44, 22)]],
    };
    const route = await go(wall(2), centre([4, 2]), centre([16, 2]));
    expect(kinds(route)).toEqual(["doors"]);
    expect(route.distance).toBeCloseTo(11 * CELL_SPACING, 6);
    expect(route.points).toEqual([centre([4, 2]), centre([8, 5]), [40, 22], [44, 22], centre([12, 5]), centre([16, 2])]);
    expect(route.paths).toEqual([{ kind: "doors", start: 2, end: 3 }]);
    expect(await go(wall(4), centre([5, 1]), centre([16, 8]))).toEqual({
      kind: "route",
      points: [
        [22, 6],
        [34, 22],
        [40, 22],
        [44, 22],
        [50, 22],
        [66, 34],
      ],
      heights: [0, 0, 0, 0, 0, 0],
      descents: [],
      descentDrop: 0,
      falls: [],
      swims: [],
      swimDistance: 0,
      swimSeconds: 0,
      swimRemounts: [],
      distance: 45.83333333333333,
      terrainSeconds: 6.547619047619047,
      activation: 0,
      seconds: 6.547619047619048,
      paths: [{ kind: "doors", start: 2, end: 3 }],
    });
  });

  it("reads the home tile of a building whose doors attach in the region", async () => {
    const threeTiles = (doors: CellPoint[], wall: boolean) => {
      const tile = (cols: number) => {
        const region = flat(cols * CELLS, CELLS, CELL_SPACING);
        if (wall) for (let x = 5; x < Math.min(cols, 2) * CELLS; x++) region.blocked[64 * region.width + x] = 1;
        const points = doors.map(([x, y], i) => at(x * 4 + 2 - 2 * 512, y * 4 + 2 + (i ? -2 : 2)));
        const tunnel: Building = {
          ...building(),
          doors: doors.map(([x, y], i) => ({ tile: [-1, 0], cell: y * CELLS + x - CELLS, layer: 0, point: points[i]! })),
          targets: [],
          paths: [points],
        };
        const doorRefs = [0, 1].map((door) => ({ home: [1, 0] as [number, number], building: 0, door }));
        return withFloor(region, {}, [records([1, 0], { doorRefs }), ...(cols > 2 ? [records([2, 0], { buildings: [tunnel] })] : [])]);
      };
      const span = (points: readonly Point[], margin: number) =>
        Math.min(3, Math.floor((Math.max(...points.map((p) => p[0])) + margin) / (CELLS * 4)) + 1);
      return {
        frame: TEST_FRAME,
        bounds: (points: readonly Point[], margin: number) => ({ tile: [0, 0] as [number, number], cols: span(points, margin), rows: 1 }),
        region: async (points: readonly Point[], margin: number) => tile(span(points, margin)),
      };
    };
    const leg = { followTerrain: true, downhill: false };
    const short = await routeLeg(
      threeTiles(
        [
          [128, 61],
          [128, 63],
        ],
        false,
      ),
      centre([127, 60]),
      centre([127, 64]),
      leg,
      request,
    );
    expect(short.kind === "route" && kinds(short)).toEqual(["doors"]);
    expect(short.kind === "route" && short.distance).toBeCloseTo((2 * Math.SQRT2 + 1) * CELL_SPACING, 6);
    const long = await routeLeg(
      threeTiles(
        [
          [130, 63],
          [130, 65],
        ],
        true,
      ),
      centre([120, 60]),
      centre([120, 68]),
      leg,
      request,
    );
    expect(long.kind === "route" && kinds(long)).toEqual(["doors"]);
    expect(long.kind === "route" && long.distance).toBeLessThan(30 * CELL_SPACING);
  });

  it("keeps the mode active after an end at a target over water", async () => {
    const region = town();
    region.water[3 * 16 + 7] = 1;
    const plan = {
      id: "plan",
      stops: pixels([west, px(T0), east]),
      legs: [
        { ...DEFAULT_LEG, downhill: false },
        { ...DEFAULT_LEG, downhill: false },
      ],
      settings: { swimming: { enabled: false, speed: 3.5 }, modes: [run, mount] },
    };
    const journey = await routeJourney(whole(region), plan, mount, { maxSlope: 35 });
    expect(journey.legs.map((leg) => ("activation" in leg ? leg.activation : undefined))).toEqual([3, 0]);
  });

  it("does not use up the activation on a leg between two stops at one target", async () => {
    const plan = {
      id: "plan",
      stops: pixels([px(T2).map((v, i) => (i ? v : v - 1.5)) as Point, px(T2).map((v, i) => (i ? v : v + 0.5)) as Point, east]),
      legs: [
        { ...DEFAULT_LEG, downhill: false },
        { ...DEFAULT_LEG, downhill: false },
      ],
      settings: { swimming: { enabled: false, speed: 3.5 }, modes: [run, mount] },
    };
    const journey = await routeJourney(whole(town()), plan, mount, { maxSlope: 35 });
    expect(journey.legs.map((leg) => (leg.kind === "route" ? [leg.points.length, leg.activation] : leg.kind))).toEqual([
      [1, 0],
      [expect.any(Number), 3],
    ]);
  });

  it("puts a leg from a target to the same target on the floor of the target", async () => {
    expect((await go(town(), px(T0), px(T0))).heights).toEqual([5]);
  });
});

describe("journeys with a leg of one point", () => {
  function lake(): TerrainRegion {
    const region = town();
    for (let y = 0; y < 10; y++)
      for (let x = 0; x <= 2; x++) {
        region.water[y * 16 + x] = 0;
        region.elevation[y * 16 + x] = -10;
        region.slope[y * 16 + x] = 80;
      }
    return region;
  }
  const trip = (stops: Point[]): RoutePlan => ({
    id: "plan",
    stops: pixels(stops),
    legs: stops.slice(1).map(() => ({ ...DEFAULT_LEG, downhill: false })),
    settings: { swimming: { enabled: true, speed: 3.5 }, modes: [run, mount] },
  });
  const inside = centre([5, 2]);

  it("does not remount after a swim when the only later leg stays at a door", async () => {
    const shore = centre(attachA);
    const [leg] = (await routeJourney(whole(lake()), trip([west, shore, inside]), mount, { maxSlope: 35 })).legs;
    expect(leg).toMatchObject({ kind: "route", swimRemounts: [] });
    expect(leg).toEqual((await routeJourney(whole(lake()), trip([west, shore]), mount, { maxSlope: 35 })).legs[0]);
  });

  it("keeps no leg whose activation a changed leg in a building can change", async () => {
    const before = trip([west, inside, east]);
    const after = { ...before, stops: before.stops.with(0, atPixel(centre(attachA))) };
    const journey = (p: RoutePlan) => routeJourney(whole(town()), p, mount, { maxSlope: 35 });
    const activations = (legs: LegResult[]) => legs.map((leg) => (leg.kind === "route" ? leg.activation : leg.kind));
    expect(activations((await journey(before)).legs)).toEqual([3, 0]);
    expect(activations((await journey(after)).legs)).toEqual([0, 3]);
    expect(keptLegs(before, (await journey(before)).legs, after, [TEST_FRAME])).toEqual([]);
  });
});

describe("ground and hint stops in floor cells", () => {
  it("enters and leaves a floor cell without a node from a side cell, with no node within 5 yd", async () => {
    const region = withFloor(flat(6, 3, 7), { [6 + 3]: {} });
    const straight = (points: Point[], distance: number, seconds: number): TerrainRoute => ({
      kind: "route",
      points,
      heights: [0, 0, 0],
      descents: [],
      descentDrop: 0,
      falls: [],
      swims: [],
      swimDistance: 0,
      swimSeconds: 0,
      swimRemounts: [],
      distance,
      terrainSeconds: seconds,
      activation: 0,
      seconds,
    });
    expect(await go(region, centre([0, 1]), centre([3, 1]))).toEqual(
      straight(
        [
          [2, 6],
          [10, 6],
          [14, 6],
        ],
        21,
        3,
      ),
    );
    expect(await go(region, centre([3, 1]), centre([5, 1]))).toEqual(
      straight(
        [
          [14, 6],
          [18, 6],
          [22, 6],
        ],
        14,
        2,
      ),
    );
    const terrain = flat(6, 3, CELL_SPACING);
    terrain.blocked[6 + 3] = 1;
    expect(await routeLeg(whole(terrain), centre([0, 1]), centre([3, 1]), { followTerrain: true, downhill: false }, request)).toEqual({
      kind: "no-path",
      endpoint: "end",
    });
  });

  const route = (r: TerrainRoute) => r.points.map((p) => nativeToCell({ tile: [0, 0] }, p));

  it("starts or ends a ground stop on the node nearest in 3D within 5 yd, at the terrain height", async () => {
    const region = withFloor(flat(6, 3, CELL_SPACING), { [6 + 2]: { layers: [{ height: 16.5 }] } });
    const stop: Point = [centre([2, 1])[0] + 1, centre([2, 1])[1]];
    expect(route(await go(region, stop, centre([5, 1])))).toEqual([
      [3, 1],
      [5, 1],
    ]);
    expect(route(await go(region, centre([5, 1]), stop)).at(-1)).toEqual([3, 1]);
    const plan: RoutePlan = {
      id: "plan",
      stops: pixels([stop, centre([3, 1]), centre([5, 1])]),
      legs: [DEFAULT_LEG, DEFAULT_LEG],
      settings: { swimming: { enabled: false, speed: 4.7 }, modes: [run, mount] },
    };
    const { legs } = await routeJourney(whole(region), plan, mount, { maxSlope: 35 });
    expect(legs.map((leg) => leg.kind === "route" && [leg.points.length, leg.activation])).toEqual([
      [1, 0],
      [2, 3],
    ]);
  });

  it("keeps the mode active after a ground stop in water that snaps to dry ground", async () => {
    const region = withFloor(flat(6, 3, CELL_SPACING), { [6 + 2]: { surface: 0 } });
    region.water[6 + 2] = 0;
    const stop: Point = [centre([2, 1])[0] + 1, centre([2, 1])[1]];
    const plan: RoutePlan = {
      id: "plan",
      stops: pixels([centre([5, 1]), stop, centre([5, 1])]),
      legs: [DEFAULT_LEG, DEFAULT_LEG],
      settings: { swimming: { enabled: false, speed: 4.7 }, modes: [run, mount] },
    };
    const { legs } = await routeJourney(whole(region), plan, mount, { maxSlope: 35 });
    expect(legs.map((leg) => leg.kind === "route" && leg.activation)).toEqual([3, 0]);
  });

  it("keeps no leg after a leg whose hazard setting decides whether its ground stop is in water", async () => {
    const region = withFloor(flat(6, 3, CELL_SPACING), {
      [6 + 2]: { surface: 0 },
      [6 + 3]: { layers: [{ height: 0, walk: E, hazard: true }] },
    });
    for (const i of [1, 2, 3, 7, 8, 13, 14, 15]) region.water[i] = 0;
    const stop: Point = [centre([2, 1])[0] + 1, centre([2, 1])[1]];
    const plan = (hazards: boolean): RoutePlan => ({
      id: "plan",
      stops: pixels([centre([5, 1]), stop, centre([5, 1])]),
      legs: [
        { ...DEFAULT_LEG, hazards },
        { ...DEFAULT_LEG, hazards: true },
      ],
      settings: { swimming: { enabled: true, speed: 4.7 }, modes: [run, mount] },
    });
    const activations = async (p: RoutePlan) =>
      (await routeJourney(whole(region), p, mount, { maxSlope: 35 })).legs.map((leg) => leg.kind === "route" && leg.activation);
    expect(await activations(plan(true))).toEqual([3, 0]);
    expect(await activations(plan(false))).toEqual([3, 3]);
    const { legs } = await routeJourney(whole(region), plan(true), mount, { maxSlope: 35 });
    expect(keptLegs(plan(true), legs, plan(false), [TEST_FRAME])).toEqual([]);
  });

  it("ends a ground stop on the layer at the terrain height, not on a layer far above", async () => {
    const grid = flat(7, 5, CELL_SPACING);
    grid.blocked[7 + 4] = grid.blocked[21 + 4] = 1;
    const region = withFloor(grid, {
      [14 + 3]: {
        layers: [
          { height: 0, walk: S | N },
          { height: 10, walk: E },
        ],
      },
      [14 + 4]: { layers: [{ height: 10, walk: W | E, masks: [2, 1] }] },
    });
    const end = await go(region, centre([6, 2]), centre([3, 2]));
    expect(visits(end, [4, 2])).toBe(false);
    expect(end.points.at(-1)).toEqual(centre([3, 2]));
  });

  it("takes the lower of two nodes at one distance", async () => {
    const region = (west: number, east: number) =>
      withFloor(flat(7, 3, CELL_SPACING), {
        [7 + 3]: {
          layers: [
            { height: west, walk: W },
            { height: east, walk: E },
          ],
        },
        [7 + 4]: { layers: [{ height: east, walk: W | E, masks: [2, 1] }] },
      });
    expect(visits(await go(region(-2, 2), centre([0, 1]), centre([3, 1])), [4, 1])).toBe(false);
    expect(visits(await go(region(2, -2), centre([0, 1]), centre([3, 1])), [4, 1])).toBe(true);
  });

  it("keeps a stop on a walkable terrain cell beside a floor cell in its own cell", async () => {
    const region = withFloor(flat(6, 3, CELL_SPACING), { [6 + 3]: { layers: [{ height: 0, walk: W | E }] } });
    const stop: Point = [centre([2, 1])[0] + 1, centre([2, 1])[1]];
    expect(route(await go(region, stop, centre([5, 1])))[0]).toEqual([2, 1]);
    region.slope[6 + 2] = 60;
    const steep = await go(region, stop, centre([5, 1]));
    expect([route(steep)[0], steep.stops?.[0]]).toEqual([[3, 1], { class: "ground", steep: true }]);
  });

  const deck = (hints: FloorPoint[]) =>
    withFloor(
      flat(7, 3, CELL_SPACING),
      {
        [7 + 3]: {
          layers: [
            { height: 0, walk: W | S | N },
            { height: 10, walk: E },
          ],
        },
        [7 + 4]: { layers: [{ height: 10, walk: W | E, masks: [2, 1] }] },
      },
      [records([0, 0], { hints })],
    );
  const deckCell = centre([3, 1]);

  it("ends a hint stop on the layer nearest the hint height", async () => {
    const upper = await go(deck([at(deckCell[0], deckCell[1], 10)]), centre([0, 1]), deckCell);
    expect(visits(upper, [4, 1])).toBe(true);
    expect(upper.stops).toEqual([{ class: "ground" }, { class: "hint" }]);
    const lower = await go(deck([at(deckCell[0], deckCell[1], 2)]), centre([0, 1]), deckCell);
    expect(visits(lower, [4, 1])).toBe(false);
    expect(lower.distance).toBeCloseTo(3 * CELL_SPACING, 6);
  });

  it("uses a plan height for either end of a hint route, and otherwise keeps the hint height", async () => {
    const region = deck([at(deckCell[0], deckCell[1], 10)]);
    const terrain = whole(region);
    const lower = await go(region, centre([0, 1]), deckCell, { heights: { to: 0 } });
    expect(route(lower)).toEqual([
      [0, 1],
      [3, 1],
    ]);
    expect(lower.distance).toBeCloseTo(12.5, 6);
    expect(route(await go(region, deckCell, centre([0, 1]), { heights: { from: 0 } }))).toEqual([
      [3, 1],
      [0, 1],
    ]);
    for (const height of [0, 10, undefined]) {
      expect(await stopKeys(terrain, deckCell, height, DEFAULT_LEG, request)).toEqual({
        from: [height === 0 ? 1048624 : 1048625],
        to: [height === 0 ? 1048624 : 1048625],
      });
    }
    const upper = await go(region, centre([0, 1]), deckCell, { heights: { to: 10 } });
    expect(route(upper)).toEqual([
      [0, 1],
      [5, 2],
      [5, 1],
      [4, 1],
      [3, 1],
    ]);
    expect(route(await go(region, centre([0, 1]), deckCell))).toEqual([
      [0, 1],
      [5, 2],
      [5, 1],
      [4, 1],
      [3, 1],
    ]);
  });

  it("enters one of two equal layers on the mask of the side layer, and does not cross the wall between them", async () => {
    const region = withFloor(flat(7, 3, CELL_SPACING), {
      [7 + 2]: { layers: [{ height: 0, walk: W | S | E | N, masks: [1, 1, 1, 1] }] },
      [7 + 3]: {
        layers: [
          { height: 0, walk: W },
          { height: 0, walk: E },
        ],
      },
      [7 + 4]: { layers: [{ height: 0, walk: W | S | E | N, masks: [2, 1, 1, 1] }] },
    });
    const into = await go(region, centre([0, 1]), centre([3, 1]));
    expect(into.distance).toBeCloseTo(3 * CELL_SPACING, 6);
    const past = await go(region, centre([1, 1]), centre([5, 1]));
    expect(visits(past, [3, 1])).toBe(false);
    expect(past.distance).toBeGreaterThan(4 * CELL_SPACING);
  });
});
