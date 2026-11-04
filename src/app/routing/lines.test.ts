import { describe, expect, it } from "vitest";
import type { WorldLocation } from "../../data/index.ts";
import { worldMap } from "../../data/terrainFixture.ts";
import { at, testFrame } from "../../routing/fixtures/region.ts";
import { nativeToWorld, worldToNative, type NativeFrame, type Point } from "../../routing/frame.ts";
import type { JourneyLeg } from "../../routing/journey.ts";
import { createPlan, DEFAULT_LEG, type MovementMode, type RoutePlan } from "../../routing/plan.ts";
import type { TerrainRoute } from "../../routing/search.ts";
import { insetBeside, legLines, projection } from "./lines.ts";

const run: MovementMode = { name: "Run", speed: 7, activation: 0 };

const A: Point = [2, 6];
const B: Point = [34, 6];
const bend: Point = [18, 2];
const [onA, onB] = [at(A), at(B)];
const yards = ({ x, y }: WorldLocation): Point => [x, y];
const route = (points: Point[]): TerrainRoute => ({
  kind: "route",
  points,
  descents: [],
  descentDrop: 0,
  falls: [],
  swims: [],
  swimDistance: 0,
  swimSeconds: 0,
  swimRemounts: [],
  distance: 0,
  terrainSeconds: 0,
  activation: 0,
  seconds: 0,
});

describe("leg lines", () => {
  it("draws each leg's own path when legs repeat the same stops", () => {
    const plan: RoutePlan = {
      id: "plan",
      stops: [onA, onB, onA, onB],
      legs: Array.from({ length: 3 }, () => ({ ...DEFAULT_LEG, downhill: false })),
      settings: { swimming: { enabled: false, speed: 3.5 }, modes: [run] },
    };
    const journey = { mode: run, legs: [route([A, bend, B]), route([B, A]), route([A, B])] };
    const lines = legLines(plan, journey, null);
    expect(lines[0]).toEqual({ points: [A, bend, B], maps: [0, 0, 0], look: "route" });
    expect(lines[2]).toEqual({ points: [A, B], maps: [0, 0], look: "route" });
    expect(legLines(plan, undefined, null).map((line) => line.look)).toEqual(["pending", "pending", "pending"]);
  });

  it("draws a leg of an unknown kind as failed, or as provisional when it has a route", () => {
    const plan: RoutePlan = {
      id: "plan",
      stops: [onA, onB],
      legs: [{ ...DEFAULT_LEG, downhill: false }],
      settings: { swimming: { enabled: false, speed: 3.5 }, modes: [run] },
    };
    const unknown = (leg: { kind: string; route?: ReturnType<typeof route> }) =>
      legLines(plan, { mode: run, legs: [leg as JourneyLeg] }, null)[0];
    expect(unknown({ kind: "probe" })).toEqual({
      points: [yards(onA), yards(onB)],
      maps: [{ world: 0 }, { world: 0 }],
      look: "failed",
      label: "probe",
    });
    expect(unknown({ kind: "probe", route: route([A, bend, B]) })).toEqual({
      points: [A, bend, B],
      maps: [0, 0, 0],
      look: "provisional",
      label: "probe, provisional route",
    });
  });
});

describe("projection", () => {
  const frame = { tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 } as const;
  const easternKingdoms: NativeFrame = { scope: { map: 0 }, frame: { ...frame, origin: [23, 20], size: [23, 42] } };
  const kalimdor: NativeFrame = { scope: { map: 1 }, frame: { ...frame, origin: [0, 0], size: [64, 64] } };
  const razorHill: Point = [20937, 16081];
  const kharanos: Point = [5092, 11516];

  const pixelUnder = (proj: ReturnType<typeof projection>, view: { x: number; y: number }, frame: NativeFrame) =>
    worldToNative(frame, proj.toStop(view)!)!.map((n) => Math.round(n * 1000) / 1000);

  it("places each point with the frame of its map, and finds the world stop under a stage point", () => {
    const proj = projection(worldMap, [easternKingdoms, kalimdor]);
    expect(proj.toStop(proj.toView(razorHill, 1)!)!.instance).toBe(1);
    expect(pixelUnder(proj, proj.toView(razorHill, 1)!, kalimdor)).toEqual(razorHill);
    expect(pixelUnder(proj, proj.stopView(nativeToWorld(easternKingdoms, kharanos))!, easternKingdoms)).toEqual(kharanos);
    expect(proj.toView(razorHill, 0)).not.toEqual(proj.toView(razorHill, 1));
  });

  it("gives no stop outside the pixels of its map's frame", () => {
    const view = projection(worldMap, [easternKingdoms]).toView(kharanos, 0)!;
    const westOfKharanos: NativeFrame = { ...easternKingdoms, frame: { ...easternKingdoms.frame, size: [9, 42] } };
    expect(pixelUnder(projection(worldMap, [easternKingdoms]), view, easternKingdoms)).toEqual(kharanos);
    expect(projection(worldMap, [westOfKharanos]).toStop(view)).toBeUndefined();
  });

  it("shows a stop without a frame, and gives no stop on a map without one", () => {
    const view = projection(worldMap, [easternKingdoms, kalimdor]).toView(razorHill, 1)!;
    const proj = projection(worldMap, [easternKingdoms]);
    expect(proj.toView(razorHill, 1)).toBeUndefined();
    expect(proj.stopView(nativeToWorld(kalimdor, razorHill))).toEqual(view);
    expect(proj.toStop(view)).toBeUndefined();
  });
});

it("draws a leg between two maps as a quiet straight connector", () => {
  const onKalimdor = at(B, null, testFrame(1));
  const plan = createPlan(onA, onKalimdor, "plan");
  expect(legLines(plan, { mode: run, legs: [{ kind: "crossing" }] }, null)).toEqual([
    {
      points: [yards(onA), yards(onKalimdor)],
      maps: [{ world: 0 }, { world: 1 }],
      look: "crossing",
      label: "no ground route between continents",
    },
  ]);
});

it("draws a leg with rides through its ground parts, with each ride as its own dashed part, and keeps the line of each step", () => {
  const plan = createPlan(onA, at(B, null, testFrame(1)), "plan");
  const dockA: Point = [A[0] + 10, A[1]];
  const dockB: Point = [B[0] - 10, B[1]];
  const link = {
    service: "ship-bootybay-ratchet",
    mode: "ship",
    from: { id: "DOCK_BOOTYBAY", name: "Booty Bay Harbor", map: 0, point: dockA },
    to: { id: "DOCK_RATCHET", name: "Ratchet Harbor", map: 1, point: dockB },
    requires: {},
    seconds: { min: 1, average: 2, max: 3 },
  };
  const walk = (from: Point, to: Point) => ({
    kind: "straight" as const,
    points: [from, to] as [Point, Point],
    distance: 1,
    activation: 0,
    seconds: 1,
  });
  const parts = [
    { kind: "ground" as const, map: 0, from: A, to: dockA, result: walk(A, dockA) },
    { kind: "ride" as const, link },
    { kind: "ground" as const, map: 1, from: dockB, to: B, result: walk(dockB, B) },
  ];
  expect(legLines(plan, { mode: run, legs: [{ kind: "transport", parts, seconds: 5 }] }, null)).toEqual([
    {
      points: [A, dockA, dockA, dockB, dockB, B],
      maps: [0, 0, 0, 1, 1, 1],
      look: "route",
      indoor: [],
      rides: [{ points: [dockA, dockB], maps: [0, 1], mode: "ship" }],
      steps: [
        { points: [A, dockA], maps: [0, 0] },
        { points: [dockA, dockB], maps: [0, 1] },
        { points: [dockB, B], maps: [1, 1] },
      ],
    },
  ]);
});

it("draws a flight as one dashed part along its path, through the flight points that it passes", () => {
  const plan = createPlan(onA, onB, "plan");
  const stop = (id: string, name: string, point: Point, air?: true) => ({ id, name, map: 0, point, ...(air && { air }) });
  const [p, q, r]: [Point, Point, Point] = [
    [8, 6],
    [18, 6],
    [28, 6],
  ];
  const link = (from: ReturnType<typeof stop>, to: ReturnType<typeof stop>, path?: Point[]) => ({
    kind: "ride" as const,
    link: { service: "f", mode: "flight", from, to, requires: {}, seconds: { min: 1, average: 1, max: 1 }, ...(path && { path }) },
  });
  const parts = [
    link(stop("FLIGHT_2", "Stormwind", p), stop("FLIGHT_2:air", "Stormwind", p, true)),
    link(stop("FLIGHT_2:air", "Stormwind", p, true), stop("FLIGHT_12:air", "Darkshire", q, true), [p, [13, 2], q]),
    link(stop("FLIGHT_12:air", "Darkshire", q, true), stop("FLIGHT_4:air", "Sentinel Hill", r, true), [q, [23, 2], r]),
    link(stop("FLIGHT_4:air", "Sentinel Hill", r, true), stop("FLIGHT_4", "Sentinel Hill", r)),
  ];
  const [line] = legLines(plan, { mode: run, legs: [{ kind: "transport", parts, seconds: 4 }] }, null);
  const points: Point[] = [p, [13, 2], q, [23, 2], r];
  expect(line!.rides).toEqual([{ points, maps: points.map(() => 0), mode: "flight" }]);
});

describe("inset beside a panel", () => {
  const inset = { top: 12, right: 60, bottom: 84, left: 12 };
  const box = { vw: 600, vh: 600, w: 600, h: 600 };
  const tall = { top: 12, right: 588, bottom: 500, left: 350 };
  const wide = { top: 12, right: 588, bottom: 200, left: 40 };
  const square = (left: number, top: number, size: number) => {
    const [a, b] = [left + size * 0.4, left + size * 0.6];
    const [c, d] = [top + size * 0.4, top + size * 0.6];
    return [
      { left, top, width: size, height: size },
      [
        { x: a, y: c },
        { x: b, y: c },
        { x: b, y: d },
        { x: a, y: d },
      ],
    ] as const;
  };

  it("fits left of a tall panel and below a wide one", () => {
    const [frame, shown] = square(10, 70, 10);
    expect(insetBeside(inset, frame, [...shown], box, 40, [tall])).toEqual({ ...inset, right: 262 });
    expect(insetBeside(inset, frame, [...shown], box, 40, [wide])).toEqual({ ...inset, top: 212 });
  });

  it("fits beside the panel on the side that shows the most points when no side shows them all", () => {
    const whole = { left: 0, top: 0, width: 100, height: 100 };
    const map = [
      { x: 10, y: 10 },
      { x: 90, y: 90 },
    ];
    expect(insetBeside(inset, whole, map, box, 40, [tall])).toEqual({ ...inset, right: 262 });
  });

  it("clears each of several panels on the side that leaves the most room", () => {
    const legend = { top: 12, right: 200, bottom: 500, left: 12 };
    const caption = { top: 12, right: 540, bottom: 40, left: 210 };
    const [frame, shown] = square(40, 40, 20);
    expect(insetBeside(inset, frame, [...shown], box, 40, [legend, caption])).toEqual({ ...inset, left: 212, top: 52 });
  });

  it("fits the stage's corner beside the panel, but keeps the inset when neither side can show the points", () => {
    const corner = { left: 85, top: 5, width: 10, height: 10 };
    const ends = [
      { x: 85, y: 5 },
      { x: 95, y: 15 },
    ];
    expect(insetBeside(inset, corner, ends, box, 40, [tall])).toEqual({ ...inset, right: 262 });
    const whole = { left: 0, top: 0, width: 100, height: 100 };
    const map = [
      { x: 10, y: 10 },
      { x: 90, y: 90 },
    ];
    expect(insetBeside(inset, whole, map, box, 40, [wide])).toEqual(inset);
  });
});
