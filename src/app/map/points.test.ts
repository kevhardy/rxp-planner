import { MAP_BOUNDS, plannerContext } from "../../data/plannerFixture.ts";
import { beforeAll, describe, expect, it } from "vitest";
import {
  EntityIndex,
  GameData,
  mapToWorld,
  objectivePoints,
  worldToCanvas,
  worldToMap,
  type QuestPoint,
  type WorldMapData,
} from "../../data/index.ts";
import { plannerData } from "../../data/plannerFixture.ts";
import { terrainFixture } from "../../data/terrainFixture.ts";
import { parseGuide, type CommandLine } from "../../guide/index.ts";
import { zoneData, datasetContext, questRow, zonePoint, ZONES } from "../testing.ts";
import { simData } from "../../rules/index.ts";
import { locateOnTerrain, movedArgs, questSpots, stepObjectives } from "./points.ts";
import { terrainSurface } from "./surfaces.ts";
import { canvasToView } from "./viewport.ts";

let data: GameData;
let map: WorldMapData;

beforeAll(async () => {
  data = plannerData();
  map = structuredClone(terrainFixture);
});

const firstStep = (body: string) => parseGuide(`#group T\n#name One\nstep\n${body}\n`).steps[0]!;

describe("terrainSurface", () => {
  it("writes an unmoved point back to its arguments", () => {
    const terrain = terrainSurface(data, map, new WeakMap());
    for (const zone of ["Mulgore", "Eastern Plaguelands", "Redridge Mountains", "Stormwind City", "Elwynn Forest"]) {
      const step = firstStep(`.goto ${zone},50,50,10,0`);
      const point = terrain.place(step).points[0]!;
      const target = terrain.locate(point.at, point)!;
      expect(movedArgs(data, step.body[0] as CommandLine, target)).toEqual([zone, "50.00", "50.00", "10", "0"]);
    }
  });

  it("keeps a moved point on the map its .goto names while it stays there", () => {
    const terrain = terrainSurface(data, map, new WeakMap());
    const step = firstStep(".goto 2482,50,50,15");
    const line = step.body[0] as CommandLine;
    const [point] = terrain.place(step).points;
    expect(point).toMatchObject({ uiMapId: 2482 });
    const { at } = point!;
    expect(movedArgs(data, line, terrain.locate({ x: at.x + 0.01, y: at.y }, point)!)[0]).toBe("2482");
  });
});

describe("locateOnTerrain", () => {
  const canvas = (instance: number, uiMapId: number, x: number, y: number) =>
    worldToCanvas(map, { instance, ...mapToWorld(MAP_BOUNDS.get(uiMapId)!, x, y) })!;

  it("finds maps under a canvas point, such as Zephras Isle", () => {
    const at = locateOnTerrain(data, map, canvas(2991, 2521, 43, 43.2))!;
    expect(at.uiMapId).toBe(2521);
    expect(at.x).toBeCloseTo(43, 6);
    expect(at.y).toBeCloseTo(43.2, 6);
    const line = firstStep(".goto 2521,1,2,30,0").body[0] as CommandLine;
    expect(movedArgs(data, line, at)).toEqual(["Zephras Isle", "43.00", "43.20", "30", "0"]);
  });

  it("keeps a dragged point on its map while the map covers it", () => {
    const at = canvas(0, 1453, 50, 50);
    expect(locateOnTerrain(data, map, at)?.uiMapId).toBe(1453);
    expect(locateOnTerrain(data, map, at, 1429)?.uiMapId).toBe(1429);
    expect(locateOnTerrain(data, map, at, 2521)?.uiMapId).toBe(1453);
  });

  it("finds no map where no zone map covers the point", () => {
    const kalimdor = map.areas.find((a) => a.key === "kalimdor")!;
    expect(locateOnTerrain(data, map, { x: kalimdor.cropLeft + 1, y: 1 })).toBeUndefined();
    expect(locateOnTerrain(data, map, { x: 0, y: 0 })).toBeUndefined();
  });
});

describe("item objective droppers", () => {
  const at = (x: number, kind: string, sourceType: string, sourceId: number, sourceName: string) =>
    zonePoint(ZONES.teldrassil, x, 40, { kind, sourceType, sourceId, sourceName });
  const grellkin = at(40, "item", "npc", 1989, "Grellkin");
  const grell = at(50, "item", "npc", 1988, "Grell");
  const mushroom = at(60, "item", "object", 152094, "Hyacinth Mushroom");
  const spider = at(70, "item", "npc", 1986, "Webwood Spider");
  const grellkinKill = at(80, "mob", "npc", 1989, "Grellkin");
  const mushrooms = { index: 1, type: "item", id: 10639, ids: [10639], name: "Hyacinth Mushroom" };
  const ichor = { index: 3, type: "item", id: 10640, ids: [10640], name: "Webwood Ichor" };
  const game = (grellExcluded = false) =>
    zoneData(
      [
        questRow(3521, "Iverron's Antidote", {
          objectives: [mushrooms, ichor],
          objectivePoints: [grellkin, grell, mushroom, spider, grellkinKill],
        }),
      ],
      {
        droppers: {
          "10639": [
            { type: "npc", id: 1989 },
            { type: "npc", id: 1988, ...(grellExcluded && { objectiveExcluded: true as const }) },
            { type: "object", id: 152094 },
          ],
          "10640": [{ type: "npc", id: 1986 }],
        },
      },
    );
  const entities = new EntityIndex({
    version: 2,
    entities: {
      item: [[10639, "Hyacinth Mushroom"]],
      quest: [[3521, "Iverron's Antidote"]],
      npc: [[1989, "Grellkin"]],
      spell: [[78, "Heroic Strike"]],
      object: [[152094, "Hyacinth Mushroom"]],
    },
  });
  const spawns = (body: string, d = game()) =>
    questSpots(d, firstStep(body), "Alliance", simData(d, entities, "Alliance"))
      .flatMap((s) => s.objectives ?? [])
      .map((o) => [o.key, o.spawns.map((p) => Math.round(p.x))]);

  it("shows item droppers for a text-only objective at the .complete row", () => {
    const d = game();
    const quest = d.quest(3521, "Alliance")!;
    quest.objectives = [];
    quest.textObjectives = [
      { name: "Hyacinth Mushroom", count: 4, need: "kills", link: { kind: "item", id: 10639 } },
      { name: "Webwood Ichor", count: 1, need: "kills", link: { kind: "item", id: 10640 } },
    ];
    expect(spawns("    .complete 3521,1\n    .complete 3521,2\n    .mob Grellkin", d)).toEqual([
      ["3521:1", [40, 60]],
      ["3521:2", [70]],
    ]);
  });

  it("narrows NPC droppers to the step's .mob lines that drop the item, keeping objects", () => {
    expect(spawns("    .complete 3521,1\n    .mob Grellkin")).toEqual([["3521:1", [40, 60]]]);
    expect(spawns("    .complete 3521,1\n    .mob Grell::1988")).toEqual([["3521:1", [50, 60]]]);
    for (const mob of ["Webwood Spider::1986", "Unknown Wolf"]) {
      expect(spawns(`    .complete 3521,1\n    .mob ${mob}`)).toEqual([["3521:1", [40, 50, 60]]]);
    }
  });

  it("marks a .mob-narrowed objective at the narrowed spawn nearest the step's points", () => {
    const d = zoneData(
      [
        questRow(3521, "Iverron's Antidote", {
          objectives: [mushrooms],
          objectivePoints: [...[20, 22, 24, 70].map((x) => at(x, "item", "npc", 1989, "Grellkin")), at(30, "item", "npc", 1988, "Grell")],
        }),
      ],
      {
        droppers: {
          "10639": [
            { type: "npc", id: 1989 },
            { type: "npc", id: 1988 },
          ],
        },
      },
    );
    const marker = (body: string) =>
      questSpots(d, firstStep(body), "Alliance", simData(d, entities, "Alliance")).map((s) => [
        Math.round(s.x),
        Math.round(s.y),
        s.label.slice(s.label.indexOf(", nearest") + 2),
      ]);
    const goto = "    .goto Teldrassil,68,40";
    expect(marker(`${goto}\n    .complete 3521,1\n    .mob Grellkin`)).toEqual([[70, 40, "nearest the step's points among 4 locations"]]);
    expect(marker("    .complete 3521,1\n    .mob Grellkin")).toEqual([[24, 40, "nearest the middle of 4 locations"]]);
    expect(marker("    .goto Elwynn Forest,68,40\n    .complete 3521,1\n    .mob Grellkin")).toEqual([
      [24, 40, "nearest the middle of 4 locations"],
    ]);
    expect(marker(`${goto}\n    .complete 3521,1`)).toEqual([[30, 40, "nearest the middle of 5 locations"]]);
  });

  it("skips a dropper the dataset excludes for the objective, even when a .mob line names it", () => {
    const d = game(true);
    const quest = d.quest(3521, "Alliance")!;
    expect(quest.objectives.map((o) => objectivePoints(d, quest, o, "Alliance"))).toEqual([[grellkin, mushroom], [spider]]);
    expect(spawns("    .complete 3521,1\n    .mob Grell::1988", d)).toEqual([["3521:1", [40, 60]]]);
  });
});

describe("questSpots", () => {
  it("shows linked NPC text rows and skips unlinked rows after provided items", () => {
    const d = plannerData();
    const quest = d.quest(92461, "Horde")!;
    const linked = quest.textObjectives![0]!;
    quest.textObjectives = [
      { name: "Provided tool", need: "providedItem", link: { kind: "item", id: 264163 } },
      linked,
      { name: "Unlinked action", need: "action" },
      { ...linked, need: "action" },
    ];
    const step = firstStep("    .complete 92461,1\n    .complete 92461,2\n    .complete 92461,3");
    const objectives = stepObjectives(d, step, "Horde");
    expect([...objectives].map(([line, o]) => [line, o.key, o.inferred, o.objective.index])).toEqual([
      [0, "92461:1", true, undefined],
      [2, "92461:3", true, undefined],
    ]);
    const spots = questSpots(d, step, "Horde");
    expect(spots.map((s) => [s.label, s.objectives?.map((o) => [o.key, o.spawns.map((p) => p.world)])])).toEqual([
      [
        "Harmony in Balance: Juvenile Vuldren slain (inferred from page order), nearest the middle of 1 location",
        [
          ["92461:1", [{ instance: 2991, x: 1872.75, y: 3925.333426 }]],
          ["92461:3", [{ instance: 2991, x: 1872.75, y: 3925.333426 }]],
        ],
      ],
    ]);
  });

  const step = () => firstStep("    .accept 92461\n    .accept 176");
  const yards = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  it("names no objective for an index outside a text-row quest", () => {
    const d = plannerData();
    const quest = d.quest(92461, "Horde")!;
    const linked = quest.textObjectives![0]!;
    quest.textObjectives = [linked, { ...linked, name: "Second" }];
    const step = firstStep("    .complete 92461,0\n    .complete 92461,2\n    .complete 92461,3");
    expect([...stepObjectives(d, step, "Horde")].map(([line, o]) => [line, o.key, o.objective.name])).toEqual([[1, "92461:2", "Second"]]);
  });

  it("locates quest locations by their world positions", () => {
    const poster = data.quest(176)!.startPoints[0]!.world;
    const spots = questSpots(data, step(), "Alliance");
    expect(spots).toMatchObject([
      {
        kind: "start",
        label: "Starts Harmony in Balance: Rorian the Dayseeker",
        uiMapId: 2521,
        x: expect.closeTo(42, 9),
        y: expect.closeTo(23.4, 9),
      },
      { kind: "start", label: 'Starts Wanted:  "Hogger": Wanted Poster', uiMapId: 1429, world: poster },
      { kind: "start", label: 'Starts Wanted:  "Hogger": Wanted Poster', uiMapId: 1429 },
    ]);
    expect(spots[1]!.x).toBeCloseTo(worldToMap(MAP_BOUNDS.get(1429)!, poster).x, 9);
    expect(questSpots(data, firstStep("    .complete 176,1"), "Alliance")).toMatchObject([
      { kind: "objective", uiMapId: 1429, objectives: [{ key: "176:1", color: 0, spawns: expect.any(Array) }] },
    ]);
  });

  // RXP reads a negative `.accept` ID as is, which names no quest, and a negative `.turnin` ID as its absolute value
  // (`addon.functions.accept` and `addon.functions.turnin` in functions.lua).
  it("marks no giver for a negative .accept and the ender for a negative .turnin", () => {
    expect(questSpots(data, firstStep("    .accept -176\n    .turnin -176"), "Alliance").map((s) => [s.kind, s.label])).toEqual([
      ["end", 'Turn in Wanted:  "Hogger": Marshal Dughan'],
    ]);
  });

  it("marks a .complete objective only when the data gives its index", async () => {
    const unnumbered = plannerData();
    for (const o of unnumbered.quest(176)!.objectives) delete o.index;
    expect(questSpots(unnumbered, firstStep("    .complete 176,1"), "Alliance")).toEqual([]);
  });

  it("adds a .goto for a quest location that points where the location is", () => {
    for (const spot of questSpots(data, step(), "Alliance")) {
      const located = data.locateGoto(data.formatLocation(spot));
      if (!located.ok) throw new Error(located.message);
      expect(located.uiMapId).toBe(spot.uiMapId);
      expect(yards(located.world, spot.world)).toBeLessThan(0.5);
    }
  });

  it("draws quest locations on the terrain map, and reads them back", () => {
    const terrain = terrainSurface(data, map, new WeakMap());
    for (const spot of questSpots(data, step(), "Alliance")) {
      const at = terrain.project(spot)!;
      expect(at).toEqual(canvasToView(map, worldToCanvas(map, spot.world)!));
      const back = terrain.locate(at)!;
      expect(back.uiMapId).toBe(spot.uiMapId);
      expect(back.x).toBeCloseTo(spot.x, 6);
      expect(back.y).toBeCloseTo(spot.y, 6);
    }
  });

  it("gives one place one marker, and equal percentages at two places two", () => {
    const ruul = (kind: "start" | "turn-in", world: { instance: number; x: number; y: number }): QuestPoint => ({
      kind,
      sourceType: "npc",
      sourceId: 2985,
      sourceName: "Ruul Eagletalon",
      zoneId: 215,
      uiMapId: 1412,
      x: 47.35,
      y: 62.02,
      world,
    });
    const here = { instance: 1, ...mapToWorld(MAP_BOUNDS.get(1412)!, 47.35, 62.02) };
    const there = { instance: 1, x: -384.68960264999987, y: -2397.1015759600004 };
    const [giver, ender, other] = [ruul("start", here), ruul("turn-in", here), ruul("turn-in", there)];
    const place = { instance: 0, x: 501.28, y: -8468.64 };
    const cityGiver: QuestPoint = {
      kind: "start",
      sourceType: "npc",
      sourceId: 656,
      sourceName: "Wilder Thistlenettle",
      zoneId: 1519,
      uiMapId: 1453,
      ...worldToMap(MAP_BOUNDS.get(1453)!, place),
      world: place,
    };
    const forestEnder: QuestPoint = {
      kind: "turn-in",
      sourceType: "npc",
      sourceId: 656,
      sourceName: "Wilder Thistlenettle",
      zoneId: 12,
      uiMapId: 1429,
      ...worldToMap(MAP_BOUNDS.get(1429)!, place),
      world: place,
    };
    const mixed = new GameData(
      {
        source: data.source,
        maxLevel: data.maxLevel,
        zones: [...data.zones],
        continents: [...data.continents],
        npcNames: {},
        sources: [...data.sources],
        quests: [
          questRow(743, "Dangers of the Windfury", { questLevel: 8, requiredLevel: 5, startPoints: [giver], endPoints: [ender, other] }),
          questRow(167, "Oh Brother...", { questLevel: 20, requiredLevel: 15, startPoints: [cityGiver], endPoints: [forestEnder] }),
        ],
      },
      plannerContext,
    );
    const spots = (id: number, faction: "Alliance" | "Horde") =>
      questSpots(mixed, firstStep(`    .accept ${id}\n    .turnin ${id}`), faction);
    expect(spots(743, "Horde").map((s) => [s.kind, s.world])).toEqual([
      ["both", here],
      ["end", there],
    ]);
    expect(spots(743, "Horde")[0]).toMatchObject({ uiMapId: 1412, x: expect.closeTo(47.35, 9), y: expect.closeTo(62.02, 9) });
    expect(spots(167, "Alliance")).toMatchObject([{ kind: "both", uiMapId: 1453, world: place }]);
  });

  const hillsbrad = { id: 267, uiMapId: 1424, instance: 0 };
  const alterac = { id: 36, uiMapId: 1416, instance: 0 };
  const spawn = (
    [sourceId, sourceName]: [number, string],
    zone: { id: number; uiMapId: number; instance: number },
    x: number,
    y: number,
    world = { instance: zone.instance, ...mapToWorld(MAP_BOUNDS.get(zone.uiMapId)!, x, y) },
  ): QuestPoint => ({ kind: "mob", sourceType: "npc", sourceId, sourceName, zoneId: zone.id, uiMapId: zone.uiMapId, x, y, world });
  const lion: [number, string] = [2406, "Mountain Lion"];
  const objectiveSpot = (id: number, name: string, zoneIds: number[], spawns: QuestPoint[]) => {
    const { sourceId, sourceName } = spawns[0]!;
    const quest = questRow(id, name, {
      zoneIds,
      objectivePoints: spawns,
      objectives: [{ index: 1, type: "monster", id: sourceId!, ids: [sourceId!], name: sourceName }],
    });
    const mixed = new GameData(
      {
        source: data.source,
        maxLevel: data.maxLevel,
        zones: [...data.zones],
        continents: [...data.continents],
        npcNames: {},
        sources: [...data.sources],
        quests: [quest],
      },
      plannerContext,
    );
    const [spot] = questSpots(mixed, firstStep(`    .complete ${id},1`), "Alliance");
    expect(spot!.objectives![0]!.spawns).toHaveLength(spawns.length);
    return spot!;
  };
  const costlyMenace = (spawns: QuestPoint[]) => objectiveSpot(564, "Costly Menace", [hillsbrad.id], spawns);

  it("marks an objective at the spawn nearest the middle of its spawns' world positions", () => {
    const west = spawn(lion, hillsbrad, 38.6, 23.4);
    const east = spawn(lion, hillsbrad, 39, 24.4);
    const far = spawn(lion, hillsbrad, 38.8, 23.9, { ...west.world, y: west.world.y + 200 });
    expect([west.world, east.world]).toContainEqual(costlyMenace([west, far, east]).world);
  });

  it("marks an objective in the quest's zone when another zone has more of its spawns", () => {
    const lions = [
      [hillsbrad, 38.6, 23.4],
      [hillsbrad, 39, 24.4],
      [alterac, 29.8, 81.6],
      [alterac, 30.4, 84],
      [alterac, 30.8, 76.2],
    ] as const;
    expect(costlyMenace(lions.map(([zone, x, y]) => spawn(lion, zone, x, y))).uiMapId).toBe(1424);
  });

  it("marks an objective in the zone with the most spawns when no spawn is in a quest zone", () => {
    const barrens = { id: 17, uiMapId: 1413, instance: 1 };
    const needles = { id: 400, uiMapId: 1441, instance: 1 };
    const battleguard: [number, string] = [7873, "Razorfen Battleguard"];
    const guards = [
      [needles, 38.4, 27.2],
      [needles, 39.2, 29.4],
      [barrens, 45.4, 89.4],
      [barrens, 45.6, 89.8],
      [barrens, 46, 87.6],
    ] as const;
    const spot = objectiveSpot(
      6626,
      "A Host of Evil",
      [722],
      guards.map(([zone, x, y]) => spawn(battleguard, zone, x, y)),
    );
    expect(spot).toMatchObject({ uiMapId: 1413, x: expect.closeTo(45.4, 6), y: expect.closeTo(89.4, 6) });
  });
});

describe("objective identity", () => {
  const mob = (zone: { id: number; uiMapId: number }, sourceId: number, sourceName: string, ...xy: [number, number][]) =>
    xy.map(([x, y]) => zonePoint(zone, x, y, { kind: "mob", sourceType: "npc", sourceId, sourceName }));
  const nightsabers = mob(ZONES.teldrassil, 2031, "Young Nightsaber", [40, 40], [41, 40]);
  const boars = mob(ZONES.teldrassil, 1984, "Young Thistle Boar", [42, 41]);
  const mines = mob({ id: 3358, uiMapId: 1461 }, 15005, "Mine Assaulted", [40, 40], [41, 40]);
  const kodos = [...mob(ZONES.desolace, 4700, "Aged Kodo", [40, 40], [41, 40]), ...mob(ZONES.desolace, 4701, "Dying Kodo", [42, 41])];
  const mine = { index: 1, type: "monster", id: 15005, ids: [15005], name: "Mine Assaulted" };
  const game = () =>
    zoneData([
      questRow(456, "The Balance of Nature", {
        objectives: [
          { index: 1, type: "monster", id: 2031, ids: [2031], name: "Young Nightsaber" },
          { index: 2, type: "monster", id: 1984, ids: [1984], name: "Young Thistle Boar" },
        ],
        objectivePoints: [...nightsabers, ...boars],
      }),
      questRow(8166, "The Battle for Arathi Basin!", { objectives: [mine], objectivePoints: mines }),
      questRow(8167, "The Battle for Arathi Basin!", { objectives: [mine], objectivePoints: mines }),
      questRow(5561, "Kodo Roundup", {
        objectives: [{ index: 1, type: "monster", id: 4700, ids: [4700, 4701, 4702], name: "Aged Kodo" }],
        objectivePoints: kodos,
      }),
    ]);
  const spots = (d: GameData, body: string) => questSpots(d, firstStep(body), "Alliance");
  const worlds = (points: { world?: unknown }[]) => points.map((p) => p.world);

  it("keeps each objective's spawns and color where nearby objectives share a marker", () => {
    const [spot, ...others] = spots(game(), "    .complete 456,1\n    .complete 456,2");
    expect(others).toEqual([]);
    expect(spot!.objectives!.map((o) => [o.key, o.color, worlds(o.spawns)])).toEqual([
      ["456:1", 0, worlds(nightsabers)],
      ["456:2", 1, worlds(boars)],
    ]);
  });

  it("gives an objective the spawns of each of its IDs, not only of the first", () => {
    const [spot] = spots(game(), "    .complete 5561,1");
    expect(spot!.objectives!.map((o) => [o.key, worlds(o.spawns)])).toEqual([["5561:1", worlds(kodos)]]);
  });

  it("keeps objectives that share spawns and a label apart", () => {
    const [spot, ...others] = spots(game(), "    .complete 8166,1\n    .complete 8167,1");
    expect(others).toEqual([]);
    expect(spot!.label).toBe("The Battle for Arathi Basin!: Mine Assaulted, nearest the middle of 2 locations");
    expect(spot!.objectives!.map((o) => [o.key, o.color, worlds(o.spawns)])).toEqual([
      ["8166:1", 0, worlds(mines)],
      ["8167:1", 1, worlds(mines)],
    ]);
  });

  it("gives repeated .complete lines of one objective one entry, color, and spawn group", () => {
    const body = "    .complete 456,2\n    .complete 456,1\n    .complete 456,2 --again\n    .complete 456,9";
    const byLine = stepObjectives(game(), firstStep(body), "Alliance");
    expect([...byLine].map(([line, o]) => [line, o.key, o.color])).toEqual([
      [0, "456:2", 0],
      [1, "456:1", 1],
      [2, "456:2", 0],
    ]);
    expect(byLine.get(2)).toBe(byLine.get(0));
    expect(spots(game(), body)[0]!.objectives!.map((o) => o.key)).toEqual(["456:2", "456:1"]);
  });
});

describe("runtime dataset context", () => {
  it("uses local map and terrain geometry for placement and edits without leaking between loads", () => {
    const context = datasetContext(map);
    const bounds = { instance: 0, minX: 100, minY: 200, maxX: 1100, maxY: 1200 };
    context.geometry.bounds = { ...context.geometry.bounds, 1429: bounds, 1415: bounds };
    context.terrain = {
      ...map,
      yardsPerChunk: 100,
      pxPerChunk: 10,
      canvas: { left: 0, width: 640, height: 640 },
      areas: map.areas.map((area) => ({
        ...area,
        canvasX: area.map === 0 ? 0 : 10000,
        canvasY: 0,
        originCol: 0,
        originRow: 0,
        width: 640,
        height: 640,
        cropLeft: 0,
      })),
    };
    const local = zoneData([], {}, context);
    const shared = zoneData([]);
    expect(local.terrainMap({ ...map, places: [], tileBase: "local-tiles/" })).toMatchObject({
      places: [],
      tileBase: "local-tiles/",
      yardsPerChunk: 100,
    });
    const point = { uiMapId: 1429, x: 50, y: 50, world: { instance: 0, x: 700, y: 600 } };
    expect(local.locateGoto(["Elwynn Forest", "50", "50"])).toMatchObject(point);
    expect(local.zoneAt(point.world)).toMatchObject({ id: 12 });
    expect(local.formatLocation(point)).toEqual(["Elwynn Forest", "50.00", "50.00"]);
    const surface = terrainSurface(local, map, new WeakMap());
    expect(surface.project(point)).toEqual({ x: 39.0625, y: 40.625 });
    expect(surface.locate({ x: 39.0625, y: 40.625 }, point)).toEqual(point);
    expect(surface.fitMap(1429)).toEqual({ left: 31.25, top: 32.8125, width: 15.625, height: 15.625 });
    expect(locateOnTerrain(local, map, { x: 250, y: 260 })).toEqual(point);
    expect(shared.locateGoto(["Elwynn Forest", "75", "75"])).toEqual(data.locateGoto(["Elwynn Forest", "75", "75"]));
  });

  it("falls back to legacy names and raw IDs when metadata has no own entry", () => {
    const context = datasetContext(map);
    for (const sources of [undefined, {}]) {
      const local = zoneData([], {}, sources ? { ...context, sources } : context);
      for (const key of ["constructor", "toString", "__proto__", "local-catalog"]) expect(local.sourceLabel(key)).toBe(key);
      expect(local.sourceLabel("questie:era")).toBe("Questie Era");
      expect(local.sourceLabel("questie:constructor")).toBe("questie:constructor");
      expect(local.sourceLabel("community:era")).toBe("community:era");
    }
  });
});
