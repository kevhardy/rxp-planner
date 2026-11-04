import { describe, expect, it } from "vitest";
import type { GameData } from "../../src/data/gameData.ts";
import type { TerrainRoute } from "../../src/routing/search.ts";
import { checkEnds, checkSite, endPoint, expectedOf, type Site } from "./acceptance.ts";

const world = [
  [0, 0],
  [10, 0],
  [10, -10],
];
const route = (change: Partial<TerrainRoute> = {}): TerrainRoute => ({
  kind: "route",
  points: [
    [0, 0],
    [0, 1],
    [1, 1],
  ],
  descents: [],
  descentDrop: 0,
  falls: [],
  swims: [],
  swimDistance: 0,
  swimSeconds: 0,
  swimRemounts: [],
  distance: 20,
  terrainSeconds: 20 / 7,
  activation: 0,
  seconds: 20 / 7,
  ...change,
});
const site = (change: Partial<Site>): Site => ({
  id: "x",
  name: "x",
  from: [0, 0],
  to: [10, -10],
  truth: { length: 20, time: 2.9 },
  ...change,
});

describe("checkSite", () => {
  it("passes a route that meets its time, length, turn, and points", () => {
    const expected = site({ time: 3, length: 21, turn: { at: [10, 0], degrees: 90, side: "right" }, via: [[5, 0]], swim: false });
    expect(checkSite(expected, { result: route(), world }).fails).toEqual([]);
  });

  it("names each check that fails", () => {
    const expected = site({ time: 2, turn: { at: [10, 0], degrees: 90, side: "left" }, via: [[0, -10]], fallCount: 1 });
    expect(checkSite(expected, { result: route(), world }).fails).toEqual([
      "time 2.9 s, expected 2 s (+42.9%)",
      "turn right 90°, expected left 90°",
      "passes 10.0 yd from [0, -10]",
      "0 drops, expected 1",
    ]);
  });

  it("notes a route shorter than truth when the site allows it, and fails a longer one", () => {
    const compare = { tolerance: 0.1, shorter: "note" as const };
    const short = checkSite(site({ truth: { length: 40, time: 5.7 }, compare }), { result: route(), world });
    expect(short.fails).toEqual([]);
    expect(short.notes[0]).toBe("length 20.0 yd, truth 40 yd (-50.0%): shorter with 0 drops, 0.0 yd swim");
    expect(checkSite(site({ truth: { length: 10, time: 1.4 }, compare }), { result: route(), world }).fails).toEqual([
      "length 20.0 yd, truth 10 yd (+100.0%)",
    ]);
  });

  it("fails a route with fatal falls on that takes another path in the same time", () => {
    const other = route({
      points: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    });
    expect(checkSite(site({ fatalSame: true }), { result: route(), world, fatal: other }).fails).toEqual([
      "fatal falls on gives another route (route, 2.9 s)",
    ]);
  });

  it("fails a provisional route", () => {
    expect(checkSite(site({}), { result: { kind: "limit", cells: 9, route: route() }, world }).fails).toEqual([
      "limit (provisional 20.0 yd)",
    ]);
  });
});

describe("checkEnds", () => {
  it("fails an end that the route meets at a door in place of the stop", () => {
    const result = route({
      stops: [
        { class: "building", floor: "door" },
        { class: "target", floor: { index: 1, ground: 1, confirmed: true } },
      ],
    });
    expect(checkEnds(result)).toEqual(["start moves to a door"]);
  });
});

describe("expectedOf", () => {
  it("names each check of a site", () => {
    const expected = site({ time: [14, 16], length: 68, compare: { tolerance: 0.25 }, paths: [], swim: false, falls: [{ height: 30.9 }] });
    expect(expectedOf(expected)).toBe("14–16 s; 68 yd; truth ±25%; paths: none; no swim; drop 30.9 yd");
  });
});

describe("endPoint", () => {
  const at = (x: number, y: number, instance = 0) => ({ world: { instance, x, y } });
  const point = (sourceId: number, x: number, y: number, instance = 0) => ({ sourceType: "npc", sourceId, ...at(x, y, instance) });
  const npcs: Record<number, object> = {
    1: { spawns: [at(100, 200)] },
    2: { spawns: [at(500, 600)] },
    3: {},
    4: { spawns: [at(0, 0), at(10, 10)] },
  };
  const game = {
    npc: (id: number) => npcs[id],
    quests: [
      { startPoints: [point(1, 100, 230)], endPoints: [], objectivePoints: [point(9, 101, 200)] },
      { startPoints: [], endPoints: [point(1, 100, 201, 1)], objectivePoints: [point(1, 110, 200)] },
    ],
  } as unknown as Pick<GameData, "npc" | "quests">;

  it("keeps a world position", () => {
    expect(endPoint([-10, 20], game)).toEqual([-10, 20]);
  });

  it("resolves an NPC to its quest point nearest its spawn, as world X north and Y west", () => {
    expect(endPoint({ npc: 1 }, game)).toEqual([200, 110]);
  });

  it("resolves an NPC with no quest point to its spawn", () => {
    expect(endPoint({ npc: 2 }, game)).toEqual([600, 500]);
  });

  it("refuses an NPC without exactly one spawn", () => {
    expect(() => endPoint({ npc: 3 }, game)).toThrow("NPC 3 has 0 spawns, expected 1");
    expect(() => endPoint({ npc: 4 }, game)).toThrow("NPC 4 has 2 spawns, expected 1");
  });
});
