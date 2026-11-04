import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FlightNodes, type WorldLocation } from "../data/index.ts";
import { parseGuide } from "../guide/index.ts";
import { createProfile, simulateRoute, type SimData } from "../rules/index.ts";
import { simQuest, testRules } from "../rules/testing.ts";
import { CELLS, heightAt, loadArtifact } from "./artifact.ts";
import { floorPin } from "./fixtures/repin.ts";
import { nativeToWorld, type Point } from "./frame.ts";
import { routeTrip } from "./journey.ts";
import { PlaybackRouting } from "./playback.ts";
import { routeLeg } from "./search.ts";
import { HEAD_LAYERS, createTerrain, nativeToCell } from "./terrain.ts";

const GROUND_CLEARANCE = 4 * 0.2666666 + 0.5 / 8;
const SLICE_DIR = `${import.meta.dirname}/fixtures/slices/coldridge-caves/`;
const read = async (path: string) => new Uint8Array(readFileSync(`${SLICE_DIR}${path}`));
const pin = await floorPin(await read("manifest.json"));
const load = await loadArtifact(read, pin);
if (!load.ok) throw new Error(load.reason);
const { artifact } = load;

interface CaveCase {
  name: string;
  from: Point;
  to: Point;
  heights: { from: number; to: number };
  entrance: Point;
  forbiddenDescent: [Point, Point];
  hasDescent: boolean;
}

const cases: CaveCase[] = [
  {
    name: "The Grizzled Den",
    hasDescent: false,
    from: [4998, 11460],
    to: [4748, 11389],
    heights: { from: 362.125, to: 346.875 },
    entrance: [4878, 11554],
    forbiddenDescent: [
      [4894, 11302],
      [4890, 11302],
    ],
  },
  {
    name: "Gol'Bolar Quarry Mine",
    hasDescent: true,
    from: [6303, 11632],
    to: [6283, 11454],
    heights: { from: 362, to: 338.75 },
    entrance: [6226, 11638],
    forbiddenDescent: [
      [6198, 11606],
      [6202, 11606],
    ],
  },
];

async function rawCellHeights(terrain: ReturnType<typeof createTerrain>, point: Point) {
  const region = await terrain.region([point], 0);
  const [x, y] = nativeToCell(region, point);
  const floor = region.floor!;
  const i = y * region.width + x;
  const first = floor.layerStart[i]!;
  const layers = Array.from({ length: (floor.head[i] ?? 0) & HEAD_LAYERS }, (_, k) => floor.height[first + k]!);
  const tile = await artifact.tile([region.tile[0] + Math.floor(x / CELLS), region.tile[1] + Math.floor(y / CELLS)]);
  const [col, row] = [x % CELLS, y % CELLS];
  const ground = Math.min(
    heightAt(tile, col, row),
    heightAt(tile, col + 1, row),
    heightAt(tile, col, row + 1),
    heightAt(tile, col + 1, row + 1),
  );
  return { layers, ground, hole: tile.holes[row * CELLS + col] !== 0 };
}

describe("cave entrances on the Coldridge Valley slice", () => {
  it.each([
    { name: "Bixi Wobblebonk", from: [5566, 10835], to: [5765, 10984], startHeight: 504, endHeight: 508.875 },
    { name: "Bailey Stonemantle", from: [5765, 10984], to: [5566, 10835], startHeight: 508.875, endHeight: 504 },
  ] satisfies { name: string; from: Point; to: Point; startHeight: number; endHeight: number }[])(
    "routes to $name on the Ironforge city floor without an end height",
    async ({ from, to, startHeight, endHeight }) => {
      const route = await routeLeg(
        createTerrain(artifact),
        from,
        to,
        { followTerrain: true, downhill: true },
        {
          heights: { from: startHeight },
          maxSlope: 50,
          mode: { name: "Run", speed: 7, activation: 0 },
          swimming: { enabled: true, speed: 4.7 },
          damagingFalls: true,
          fatalFalls: false,
          hazards: false,
        },
      );
      expect(route.kind).toBe("route");
      if (route.kind !== "route") return;
      expect(route.heights?.at(-1)).toBe(endHeight);
    },
  );

  it("plays Coldridge Pass through both doors without stopping at the optional tunnel waypoint", async () => {
    const guides = [
      parseGuide(
        "#group G\n#name Coldridge Pass\nstep\n.goto 1426/0,135.100,-6248.900\n+Talk to Hands Springsprocket\nstep\n.goto 1426/0,111.82,-6206.61,15,0\n.goto 1426/0,46.32,-6037.19,15 >> Head through Coldridge Pass\n",
      ),
    ];
    const profile = createProfile({ race: "Dwarf", class: "WARRIOR" });
    const data: SimData = {
      quest: () => undefined,
      npc: () => undefined,
      item: () => undefined,
      rules: testRules,
      entityByName: () => undefined,
      flights: new FlightNodes(),
      uiMapNamed: () => undefined,
      locateGoto: (args) => ({ instance: 0, x: Number(args[1]), y: Number(args[2]) }),
    };
    const ground = { terrain: createTerrain(artifact) };
    const playback = await new PlaybackRouting({
      frames: [artifact.manifest],
      route: (plan, mode) => routeTrip(plan, () => ground, { modes: [mode], maxSlope: 50 }),
    }).play({ simulation: simulateRoute(guides, 0, profile, data), guides, profile, data, npcs: {} }, Infinity, () => 0);
    const ways = playback.ways(1);
    expect(ways).toHaveLength(1);
    expect(ways[0]!.estimate).toBeUndefined();
    const route = ways[0]!.journey!.legs[0]!;
    expect(route.kind).toBe("route");
    if (route.kind !== "route") return;
    const doors = route.paths?.find((path) => path.kind === "doors");
    expect(doors).toBeDefined();
    expect(route.points[doors!.start]).toEqual([4491.3125, 12119.5]);
    expect(route.points[doors!.end]).toEqual([4564.625, 11945.125]);
  });

  describe("a kill walk to a spawn inside a cave", () => {
    interface KillQuest {
      id: number;
      name: string;
      mob: { id: number; name: string };
      giverAt: string;
      mobAt: string;
    }
    const troggs: KillQuest = {
      id: 432,
      name: "Those Blasted Troggs!",
      mob: { id: 1115, name: "Rockjaw Skullthumper" },
      giverAt: "69.0,56.2",
      mobAt: "70.8,54.8",
    };

    async function approachHeight(start: Point, spawn: Point, target = troggs) {
      const at = (p: Point): WorldLocation => nativeToWorld(artifact.manifest, p);
      const quest = simQuest({
        name: target.name,
        baseXp: 100,
        objectives: [{ index: 1, kind: "monster", ids: [target.mob.id], count: 1, name: target.mob.name }],
      });
      const data: SimData = {
        quest: (id) => (id === target.id ? quest : undefined),
        npc: () => ({ levels: { min: 8, max: 9 }, elite: false, zoneIds: [] }),
        item: () => undefined,
        rules: testRules,
        entityByName: () => undefined,
        flights: new FlightNodes(),
        uiMapNamed: () => undefined,
        locateGoto: () => at(start),
      };
      const guides = [
        parseGuide(
          `#group G\n#name A\nstep\n.goto Dun Morogh,${target.giverAt}\n.accept ${target.id}\nstep\n.goto Dun Morogh,${target.mobAt}\n.complete ${target.id},1\n`,
        ),
      ];
      const profile = createProfile({ race: "Dwarf", class: "WARRIOR" });
      const ground = { terrain: createTerrain(artifact) };
      const playback = await new PlaybackRouting(
        { frames: [artifact.manifest], route: (plan, mode) => routeTrip(plan, () => ground, { modes: [mode], maxSlope: 50 }) },
        { every: 0 },
      ).play(
        {
          simulation: simulateRoute(guides, 0, profile, data),
          guides,
          profile,
          data,
          npcs: { spawns: () => [{ ...at(spawn), id: "spawn" }] },
        },
        Infinity,
        () => 0,
      );
      const kill = playback.timeline.steps[1]!.activities.find((a) => a.kind === "kill")!;
      if (kill.kind !== "kill" || !kill.walk) throw new Error("Expected a kill walk");
      expect(playback.routing).toMatchObject({ pending: 0, straight: {} });
      return Math.round(playback.at(kill.start + kill.walk.kills[0]!.arrive)!.place!.height! * 8) / 8;
    }

    // Gol'Bolar Quarry Mine. The mine floor is at 361 yd, under the mountain at 400 yd.
    const mine: Point = [6303, 11632];

    it("stops on the floor of the hint at a spawn in Gol'Bolar Quarry Mine", async () => {
      expect(await approachHeight(mine, [6232, 11582])).toBe(361);
    });

    it("uses the buried ground floor when two hints at the spawn are a storey apart", async () => {
      expect(await approachHeight(mine, [6248, 11606])).toBe(361.75);
    });

    it("stays outdoors on Shimmer Ridge when the hint at the spawn is outdoors above the Grizzled Den", async () => {
      const headhunters: KillQuest = {
        id: 287,
        name: "Frostmane Hold",
        mob: { id: 1123, name: "Frostmane Headhunter" },
        giverAt: "46.73,53.83",
        mobAt: "41.2,45.6",
      };
      expect(await approachHeight([4998, 11460], [4848, 11310], headhunters)).toBe(443.5);
    });
  });

  it.each(cases)(
    "routes into $name through its entrance, without a descent through the ground",
    async ({ from, to, heights, entrance, forbiddenDescent, hasDescent }) => {
      const terrain = createTerrain(artifact);
      const route = await routeLeg(
        terrain,
        from,
        to,
        { followTerrain: true, downhill: true },
        {
          heights,
          maxSlope: 50,
          mode: { name: "Run", speed: 7, activation: 0 },
          swimming: { enabled: true, speed: 4.7 },
          damagingFalls: true,
          fatalFalls: false,
          hazards: false,
        },
      );
      if (route.kind !== "route") throw new Error(`Expected a route, got ${route.kind}`);
      const edges = route.descents.map((i) => [route.points[i]!, route.points[i + 1]!]);
      expect.soft(route.points.some(([x, y]) => Math.hypot(x - entrance[0], y - entrance[1]) <= 8)).toBe(true);
      expect.soft(edges).not.toContainEqual(forbiddenDescent);
      expect.soft(route.descents.length > 0).toBe(hasDescent);
      const underground = [];
      for (const point of edges.flat()) {
        const { layers, ground, hole } = await rawCellHeights(terrain, point);
        if (!hole && layers.length && layers.every((height) => height < ground - GROUND_CLEARANCE))
          underground.push({ point, layers, ground });
      }
      expect.soft(underground).toEqual([]);
    },
  );
});
