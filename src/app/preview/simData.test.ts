import { beforeAll, describe, expect, it } from "vitest";
import { EntityIndex, FlightNodes, GameData, type Quest, type QuestPoint } from "../../data/index.ts";
import { QUEST_DEFAULTS } from "../../../packages/data-contract/model.ts";
import { plannerData, plannerNames, plannerFile, plannerContext } from "../../data/plannerFixture.ts";
import { parseGuide } from "../../guide/index.ts";
import { buildTimeline, createProfile, momentAt, simulateRoute, timelineNpcs, type SimData } from "../../rules/index.ts";
import { zoneData, questRow } from "../testing.ts";
import { worldToCanvas } from "../../data/maps.ts";
import { worldMap } from "../../data/terrainFixture.ts";
import type { WorldMapPoi } from "../../data/worldMap.ts";
import { simData } from "../../rules/index.ts";

describe("simData", () => {
  let data: GameData, entities: EntityIndex, alliance: SimData;
  beforeAll(async () => {
    data = plannerData();
    entities = new EntityIndex(plannerNames);
    alliance = simData(data, entities, "Alliance");
  });

  it("finds the nearest graveyard on the same world map with the destination UI map", () => {
    const poi = (instance: number, x: number, y: number, category = "graveyard"): WorldMapPoi => ({
      name: "Spirit Healer",
      category,
      entity: { type: "npc", id: 6491 },
      area: instance === 0 ? "eastern-kingdoms" : "kalimdor",
      side: 0,
      level: 0,
      ...worldToCanvas(worldMap, { instance, x, y })!,
    });
    const game = new GameData(plannerFile(), {
      ...plannerContext,
      terrain: { ...worldMap, pois: [poi(0, 900, -6200), poi(1, 700, -6200), poi(0, 600, -6200), poi(0, 700, -6200, "innkeeper")] },
    });
    const sim = simData(game, entities, "Alliance");
    expect(sim.spiritHealer?.({ instance: 0, x: 700, y: -6200 })).toEqual({
      instance: 0,
      x: expect.closeTo(600, 6),
      y: expect.closeTo(-6200, 6),
      uiMapId: 1426,
    });
    expect(sim.spiritHealer?.({ instance: 1, x: 700, y: -6200 })).toMatchObject({
      instance: 1,
      x: expect.closeTo(700, 6),
      y: expect.closeTo(-6200, 6),
    });
    expect(sim.spiritHealer?.({ instance: 33, x: 700, y: -6200 })).toBeUndefined();
    expect(sim.spiritHealer?.({ instance: 0, x: -Infinity, y: -Infinity })).toBeUndefined();
  });

  it("gives the first of two graveyards at the same distance", () => {
    const center = worldToCanvas(worldMap, { instance: 0, x: 0, y: -6200 })!;
    const poi = (dx: number): WorldMapPoi => ({
      name: "Spirit Healer",
      category: "graveyard",
      entity: { type: "npc", id: 6491 },
      area: "eastern-kingdoms",
      side: 0,
      level: 0,
      x: center.x + dx,
      y: center.y,
    });
    const healer = (...dxs: number[]) =>
      new GameData(plannerFile(), { ...plannerContext, terrain: { ...worldMap, pois: dxs.map(poi) } }).spiritHealer({
        instance: 0,
        x: 0,
        y: -6200,
      });
    expect(healer(-100, 100)!.x).toBeCloseTo(104.17, 2);
    expect(healer(100, -100)!.x).toBeCloseTo(-104.17, 2);
  });

  it("gives a quest's levels, XP, objectives, and where its NPCs stand", () => {
    const talin = [
      { instance: 0, x: expect.closeTo(689.03, 2), y: expect.closeTo(-6221.38, 2) },
      { instance: 0, x: expect.closeTo(689.03, 2), y: expect.closeTo(-6227.95, 2) },
    ];
    expect(alliance.quest(183)).toEqual({
      name: "The Boar Hunter",
      preAny: [],
      preAll: [],
      acceptOnTurnIn: false,
      level: 3,
      requiredLevel: 1,
      baseXp: 250,
      zoneIds: [1],
      givers: talin,
      enders: talin,
      giverNpcs: [714],
      enderNpcs: [714],
      objectives: [{ index: 1, kind: "monster", ids: [708], count: 12, name: "Small Crag Boar" }],
      requiredRaceMask: 77,
      requiredClassMask: 0,
      requiredFaction: "Alliance",
      nextQuestInChain: null,
      exclusiveTo: [],
      parentQuest: 0,
      requiredMaxLevel: 0,
      requiredSkill: null,
      requiredMinRep: null,
      requiredMaxRep: null,
      requiredSpecialization: 0,
      event: false,
    });
    expect(alliance.quest(76156)?.objectives).toEqual([
      { index: 1, kind: "item", ids: [206157], count: 5, name: "Seaforium Mining Charge" },
    ]);
    expect(alliance.locateGoto(["Dun Morogh", "22.6", "71.43"])).toEqual({
      instance: 0,
      uiMapId: 1426,
      x: expect.closeTo(689.03, 2),
      y: expect.closeTo(-6222.37, 2),
    });
  });

  it.each(["1426/0,-2329.60,-5163.76", "Dun Morogh,83.89,39.16", "1426,83.89,39.16"])(
    "keeps the Loch Modan tunnel step after %s",
    (place) => {
      const doc = parseGuide(
        `#classic\n#group Test\n#name Enter Loch Modan\nstep\n.goto ${place}\n+Talk to Pilot Hammerfoot\nstep\n.goto 1426/0,-2354.62,-4898.20,25\n.zoneskip Loch Modan\n+Walk the tunnel east`,
      );
      const run = simulateRoute([doc], 0, createProfile({ race: "Human", class: "WARRIOR", level: 1, soloSelfFound: true }), {
        ...alliance,
        zoneAt: () => 1432,
      });
      expect(run.guides[0]!.steps.map((step) => step.preview.shown)).toEqual([true, true]);
    },
  );

  it.each([
    {
      name: "home and hearth",
      body: "step\n.goto Loch Modan,35,48\n.home\nstep\n.goto Dun Morogh,83.89,39.16\n+Walk away\nstep\n.hs\nstep\n.zoneskip Loch Modan\n+Fly instead",
      shown: [true, true, true, false],
      zone: 1429,
    },
    {
      name: "patched bind and hearth",
      body: 'step\n-- @sim state={"bind":"Loch Modan,35,48"}\n.goto Dun Morogh,83.89,39.16\n+Walk away\nstep\n.hs\nstep\n.zoneskip Loch Modan\n+Fly instead',
      shown: [true, true, false],
      zone: 1429,
    },
    {
      name: "patched position before a reverse gate",
      body: 'step\n-- @sim state={"position":"Loch Modan,35,48"}\n.zoneskip Loch Modan,1\n+Stay in Loch Modan',
      shown: [true],
      zone: 1429,
    },
    {
      name: "NPC position replaces the previous guide map",
      body: "step\n.goto Dun Morogh,22.6,71.43\n+Arrive\nstep\n.accept 183\nstep\n.zoneskip Loch Modan\n+Continue",
      shown: [true, true, false],
      zone: 1432,
    },
    {
      name: "unknown NPC zone passes a reverse gate",
      body: "step\n.accept 183\nstep\n.zoneskip Loch Modan,1\n+Continue",
      shown: [true, true],
      zone: undefined,
    },
    {
      name: "flight arrival replaces the previous guide map",
      body: 'step\n-- @sim state={"flightPaths":{"Thelsamar":true}}\n.goto 1453/0,500,-8800\n.fly Thelsamar\nstep\n.zoneskip Loch Modan\n+Continue',
      shown: [true, false],
      zone: 1432,
    },
    {
      name: "continent goto uses the geographic zone",
      body: "step\n.goto 1415,54,55\n+Arrive\nstep\n.zoneskip Loch Modan\n+Continue",
      shown: [true, false],
      zone: 1432,
    },
  ])("resolves zoneskip from $name", ({ body, shown, zone }) => {
    const doc = parseGuide(`#classic\n#group Test\n#name Travel\n${body}`);
    const flights = new FlightNodes({
      "2": { name: "Stormwind, Elwynn", faction: "Alliance", world: { instance: 0, x: 478.62, y: -8832.77 } },
      "8": { name: "Thelsamar, Loch Modan", faction: "Alliance", world: { instance: 0, x: -2930.01, y: -5421.91 } },
    });
    const run = simulateRoute([doc], 0, createProfile({ race: "Dwarf", class: "WARRIOR", level: 1 }), {
      ...alliance,
      flights,
      zoneAt: () => zone,
    });
    expect(run.guides[0]!.steps.map((step) => step.preview.shown)).toEqual(shown);
  });

  it("keeps the bind's zone across guides and timeline replay", async () => {
    const guides = [
      parseGuide(
        "#classic\n#group Test\n#name Bind\n#next Return\nstep\n.goto Loch Modan,35,48\n.home\nstep\n.goto Dun Morogh,83.89,39.16\n+Walk away",
      ),
      parseGuide("#classic\n#group Test\n#name Return\nstep\n.hs\nstep\n.zoneskip Loch Modan\n+Fly instead"),
    ];
    const timeline = await buildTimeline(guides, 0, createProfile({ race: "Dwarf", class: "WARRIOR", level: 1 }), {
      ...alliance,
      zoneAt: () => 1429,
    });
    expect(timeline.steps.map((step) => [step.source, step.step])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
    expect(momentAt(timeline, timeline.totals.seconds)!.character.position?.uiMapId).toBe(1432);
  });

  it("uses one spawn for nearby observations of the same NPC without merging a whole chain", () => {
    const wolves: Record<number, string> = { 69: "Timber Wolf", 299: "Young Wolf" };
    const point = (x: number, sourceId = 69, instance = 0): QuestPoint => ({
      zoneId: 12,
      uiMapId: 1429,
      x: 50,
      y: 50,
      world: { instance, x: -58 + x, y: -8873 },
      kind: "mob",
      sourceType: "npc",
      sourceId,
      sourceName: wolves[sourceId]!,
    });
    const points = [point(0), point(0), point(6), point(12), point(22), point(6, 299), point(6, 69, 1)];
    const game = zoneData([questRow(33, "Wolves Across the Border", { objectivePoints: points })]);
    const simulation = simData(game, entities, "Alliance");
    expect(simulation.spawns!(69, 33)).toEqual([
      { instance: 0, x: -58, y: -8873, id: "npc:69:0:-58,-8873" },
      { instance: 0, x: -46, y: -8873, id: "npc:69:0:-46,-8873" },
      { instance: 0, x: -36, y: -8873, id: "npc:69:0:-36,-8873" },
      { instance: 1, x: -52, y: -8873, id: "npc:69:1:-52,-8873" },
    ]);
    expect(simulation.spawns!(299, 33)).toEqual([{ instance: 0, x: -52, y: -8873, id: "npc:299:0:-52,-8873" }]);
    expect(game.quest(33)!.objectivePoints).toEqual(points);
    const reversed = zoneData([questRow(33, "Wolves Across the Border", { objectivePoints: [...points].reverse() })]);
    expect(simData(reversed, entities, "Alliance").spawns!(69, 33)).toEqual([
      { instance: 1, x: -52, y: -8873, id: "npc:69:1:-52,-8873" },
      { instance: 0, x: -36, y: -8873, id: "npc:69:0:-36,-8873" },
      { instance: 0, x: -46, y: -8873, id: "npc:69:0:-46,-8873" },
      { instance: 0, x: -58, y: -8873, id: "npc:69:0:-58,-8873" },
    ]);
  });

  it("takes an NPC's record spawns over its objective points, for every quest and for grinds", () => {
    const world = (x: number) => ({ instance: 0, x: 31 + x, y: -9797 });
    const point = (x: number): QuestPoint => ({
      zoneId: 12,
      uiMapId: 1429,
      x: 40.18,
      y: 80.18,
      world: world(x),
      kind: "mob",
      sourceType: "npc",
      sourceId: 40,
      sourceName: "Kobold Miner",
    });
    const mine = "fargodeep-mine-210351";
    const spawns = [
      { world: world(100), z: 24, guid: 80604, interior: mine },
      { world: world(100), z: 24, guid: 80605 },
      { world: world(101), z: 25.5, guid: 80608 },
      { world: world(100), z: 34, guid: 80609, interior: mine },
      { world: world(206), z: 24, guid: 80610 },
      { world: world(200), z: 24, guid: 80614 },
      { world: world(212), z: 24, guid: 80615 },
      { world: world(222), z: 24, guid: 80616 },
      { world: world(99) },
      { world: world(300) },
    ];
    const rawSpawns = structuredClone(spawns);
    const game = zoneData([questRow(60, "Kobold Candles", { objectivePoints: [point(0), point(50)] })], {
      npcs: { 40: { spawns, provenance: { fields: { spawns: { source: "override:test" } } } } },
    });
    const sim = simData(game, entities, "Alliance");
    const recorded = [
      { ...world(100), id: "npc:40:80604", z: 24, interior: mine },
      { ...world(100), id: "npc:40:80605", z: 24 },
      { ...world(100), id: "npc:40:80609", z: 34, interior: mine },
      { ...world(200), id: "npc:40:80614", z: 24 },
      { ...world(212), id: "npc:40:80615", z: 24 },
      { ...world(222), id: "npc:40:80616", z: 24 },
      { ...world(300), id: "npc:40:0:331,-9797" },
    ];
    expect(sim.spawns!(40, 60)).toEqual(recorded);
    expect(sim.spawns!(40, 7)).toEqual(recorded);
    expect(timelineNpcs(game, "Alliance").spawns!(40, undefined)).toEqual(recorded);
    expect(timelineNpcs(game, "Alliance").spawns!(475, undefined)).toEqual([]);
    expect(game.npc(40)!.spawns).toEqual(rawSpawns);
  });

  it("keeps text rows' links and leaves out items the quest provides", () => {
    expect(alliance.quest(76160)?.objectives[1]).toEqual({
      kind: "text",
      name: "Windfury Cone",
      count: 8,
      need: "kills",
      link: { kind: "item", id: 206170 },
    });
    expect(alliance.quest(94013)?.objectives).toEqual([{ kind: "text", name: "Tame a Vuldren", count: 1, need: "action" }]);
  });

  it("counts only the text rows of a quest that also has numbered objectives without an index", () => {
    const quests = [
      questRow(65603, "The Binding", {
        objectives: [{ type: "monster", id: 185335, ids: [185335], name: "Summoned Incubus", count: 1, need: "kills" }],
        textObjectives: [
          { name: "Summoned Incubus slain", count: 1, need: "kills", link: { kind: "npc", id: 185335 } },
          { name: "Wooden Figurine", count: 1, need: "providedItem", link: { kind: "item", id: 190186 } },
        ],
      }),
    ];
    expect(simData(zoneData(quests), entities, "Alliance").quest(65603)).toMatchObject({
      objectives: [{ kind: "text", name: "Summoned Incubus slain", count: 1, need: "kills", link: { kind: "npc", id: 185335 } }],
    });
  });

  describe("a quest whose only text rows are items it provides", () => {
    const quests = () => [
      questRow(66, "The Tome of Valor", {
        objectives: [{ index: 1, type: "monster", id: 5, ids: [5], name: "Wolf", count: 3 }],
        textObjectives: [{ name: "Letter", count: 1, need: "providedItem" }],
      }),
    ];

    it("has no rows, even with numbered objectives", () => {
      expect(simData(zoneData(quests()), entities, "Alliance").quest(66)).toMatchObject({ objectives: [] });
    });

    it("warns noMatch at .complete q,1 and completes on accept", () => {
      const result = simulateRoute(
        [parseGuide("#group G\n#name G\nstep\n.accept 66\n.complete 66,1\n")],
        0,
        createProfile({ race: "Human", class: "WARRIOR" }),
        simData(zoneData(quests()), entities, "Alliance"),
      );
      expect(result.guides[0]!.steps[0]!.state.log.get(66)!.status).toBe("complete");
      expect(result.warnings).toContainEqual({
        kind: "noKillTarget",
        at: { guide: 0, step: 0, line: 1 },
        questId: 66,
        objective: "Objective 1",
        reason: "noMatch",
      });
    });
  });

  it("gives who can take a quest, as the faction sees it", () => {
    expect(alliance.quest(5305)).toMatchObject({
      exclusiveTo: [8869],
      requiredSkill: { skill: 164, value: 250 },
      requiredSpecialization: 9787,
    });
    expect(alliance.quest(8370)).toMatchObject({ requiredMaxLevel: 29 });
    expect(alliance.quest(254)).toMatchObject({ parentQuest: 253 });
    const horde = simData(data, entities, "Horde");
    expect(horde.quest(8904)).toMatchObject({ nextQuestInChain: 8979, exclusiveTo: [8900, 8901, 8902, 8979], event: true });
    expect(alliance.quest(8904)).toMatchObject({ exclusiveTo: [] });
  });

  it("marks seasonal, war-effort, and invasion quests as world events", () => {
    const quests = [
      questRow(1658, "Crashing the Wickerman Festival", { types: ["pvp", "seasonal"] }),
      questRow(8492, "The Alliance Needs Copper Bars!", { types: ["war-effort"] }),
      questRow(9085, "Shadows of Doom", { types: ["invasion"] }),
      questRow(33, "Wolves Across the Border", { types: ["general"] }),
    ];
    const sim = simData(zoneData(quests), entities, "Alliance");
    expect([1658, 8492, 9085, 33].map((id) => sim.quest(id)!.event)).toEqual([true, true, true, false]);
  });

  it("carries a numbered objective's need only when the data gives one", () => {
    const objective = { type: "monster", id: 6177, ids: [6177], name: "Narm Faulk" };
    const quests = [
      questRow(1783, "The Tome of Divinity", {
        objectives: [
          { ...objective, index: 1, need: "action" },
          { ...objective, index: 2, count: 3 },
        ],
      }),
    ];
    expect(simData(zoneData(quests), entities, "Alliance").quest(1783)!.objectives).toEqual([
      { index: 1, kind: "monster", ids: [6177], count: null, name: "Narm Faulk", need: "action" },
      { index: 2, kind: "monster", ids: [6177], count: 3, name: "Narm Faulk" },
    ]);
  });

  it("gives NPC levels and rank from the dataset", () => {
    expect(alliance.npc(251160)).toEqual({ levels: { min: 2, max: 3 }, elite: false, zoneIds: [16593] });
  });

  it("gives an item's NPC droppers, and marks it as only from objects or as sold", () => {
    const item = alliance.item(782)!;
    expect({ ...item, droppers: item.droppers.toSorted((a, b) => a.id - b.id) }).toEqual({
      droppers: [{ id: 97 }, { id: 478 }],
      objectsOnly: false,
      sold: false,
    });
    expect(alliance.item(8593)).toEqual({ droppers: [], objectsOnly: true, sold: false });
    expect(alliance.item(15885)).toEqual({ droppers: [], objectsOnly: false, sold: false });
    expect(alliance.item(2320)).toEqual({ droppers: [], objectsOnly: false, sold: true });
    expect(alliance.item(1262)).toEqual({ droppers: [], objectsOnly: false, sold: false });
    expect(alliance.item(12238)).toBeUndefined();
  });

  const vagash = { questId: 314, quest: "Protecting the Herd", zoneId: 1, itemId: 3627, item: "Fang of Vagash" };
  const garrick = { questId: 6, quest: "Bounty on Garrick Padfoot", zoneId: 12, itemId: 182, item: "Garrick's Head" };
  const wolfMeat = { questId: 33, quest: "Wolves Across the Border", zoneId: 12, itemId: 750, item: "Tough Wolf Meat" };
  const npcs = {
    69: { levels: { min: 2, max: 2 }, elite: false, zoneIds: [12] },
    103: { levels: { min: 5, max: 5 }, elite: false, zoneIds: [12] },
    299: { levels: { min: 1, max: 1 }, elite: false, zoneIds: [12] },
    704: { levels: { min: 2, max: 2 }, elite: false, zoneIds: [1] },
    705: { levels: { min: 1, max: 1 }, elite: false, zoneIds: [1] },
    1388: { levels: { min: 11, max: 11 }, elite: true, zoneIds: [1] },
  };
  it.each<
    typeof wolfMeat & {
      name: string;
      count: number;
      ids: number[];
      chance?: number;
      guaranteed?: { source: string };
      override?: string;
      expected: number;
    }
  >([
    {
      name: "a source-backed guaranteed Fang of Vagash needs one kill without an estimated chance",
      ...vagash,
      count: 1,
      ids: [1388],
      guaranteed: { source: "quest-rule:test" },
      expected: 1,
    },
    {
      name: "a guarantee wins over an estimated chance",
      ...garrick,
      count: 4,
      ids: [103],
      chance: 0.25,
      guaranteed: { source: "quest-rule:test" },
      expected: 4,
    },
    {
      name: "drop= overrides a guarantee and its estimated chance",
      ...garrick,
      count: 4,
      ids: [103],
      chance: 0.25,
      guaranteed: { source: "quest-rule:test" },
      override: " -- @sim drop=0.5",
      expected: 8,
    },
    {
      name: "kills= keeps its count with a guarantee and drop=",
      ...garrick,
      count: 4,
      ids: [103],
      guaranteed: { source: "quest-rule:test" },
      override: " -- @sim kills=10 drop=0.5",
      expected: 10,
    },
    {
      name: "a single Garrick head at its estimated chance rounds to one kill",
      ...garrick,
      count: 1,
      ids: [103],
      chance: 0.9364,
      expected: 1,
    },
    {
      // round(3 / 0.42) = 7. A chance rounded to 0.4 would give 8 kills, and one rounded to 0.5 would give 6.
      name: "an unrounded estimated chance reaches the simulator unchanged",
      ...wolfMeat,
      count: 3,
      ids: [69],
      chance: 0.42,
      expected: 7,
    },
    {
      name: "four pooled items at 60 percent need seven rounded expected kills",
      ...wolfMeat,
      count: 4,
      ids: [69, 299],
      chance: 0.6,
      expected: 7,
    },
    {
      name: "four items from one 60 percent source also need seven kills",
      ...wolfMeat,
      count: 4,
      ids: [69],
      chance: 0.6,
      expected: 7,
    },
    {
      name: "an exact half expected kill rounds up",
      ...wolfMeat,
      count: 1,
      ids: [69],
      chance: 0.4,
      expected: 3,
    },
    {
      name: "an expectation just below a half keeps the Math.round boundary",
      ...wolfMeat,
      count: 1,
      ids: [69],
      chance: 0.40000000001,
      expected: 2,
    },
  ])("$name", ({ questId, quest, zoneId, itemId, item, count, ids, chance, guaranteed, override = "", expected }) => {
    const game = zoneData(
      [
        questRow(questId, quest, {
          zoneIds: [zoneId],
          objectives: [{ index: 1, type: "item", id: itemId, ids: [itemId], name: item, count }],
        }),
      ],
      {
        sources: [{ source: "quest-rule:test", pins: { fixture: "1" } }],
        npcs: Object.fromEntries(ids.map((id) => [id, npcs[id as keyof typeof npcs]])),
        droppers: {
          [itemId]: ids.map((id) => ({ type: "npc", id, ...(chance !== undefined && { chance }), ...(guaranteed && { guaranteed }) })),
        },
      },
    );
    const result = simulateRoute(
      [parseGuide(`#group G\n#name G\nstep\n.accept ${questId}\n.complete ${questId},1${override}\n.turnin ${questId}\n`)],
      0,
      createProfile({ race: "Human", class: "WARRIOR", level: 6 }),
      simData(game, entities, "Alliance"),
    );
    expect(result.guides.flatMap((guide) => guide.steps.flatMap((step) => step.kills)).reduce((sum, kill) => sum + kill.count, 0)).toBe(
      expected,
    );
  });

  it("rounds pinned wolf meat once and excludes all 73 noise droppers before assigning chances", () => {
    const wolves = [
      [299, 70080, 129285],
      [69, 30616, 56984],
      [704, 8249, 14376],
      [705, 80914, 120991],
    ].map(([id, count, outof]) => ({ type: "npc" as const, id: id!, chance: count! / outof! }));
    const noise = [
      [103, 2, 10408],
      [1115, 28, 83461],
      [1117, 12, 59813],
      [1120, 3, 29402],
      [1121, 3, 29175],
      [1122, 2, 11771],
      [1123, 2, 29221],
      [1124, 3, 5873],
      [1125, 210, 118280],
      [1126, 122, 55356],
      [1127, 78, 87710],
      [1128, 83, 46943],
      [113, 111, 142334],
      [1134, 24, 41977],
      [1135, 40, 72802],
      [116, 40, 113841],
      [1161, 4, 76137],
      [1162, 8, 74466],
      [1173, 6, 32047],
      [1176, 2, 21292],
      [118, 34, 105005],
      [1186, 4, 69878],
      [119, 3, 4596],
      [1190, 2, 66108],
      [1195, 11, 86715],
      [1196, 49, 64662],
      [1201, 44, 76942],
      [1211, 34, 130245],
      [1388, 8, 6352],
      [1397, 7, 32631],
      [1689, 6, 15934],
      [1718, 37, 19192],
      [1922, 63, 52576],
      [1961, 2, 7637],
      [1984, 8, 43224],
      [2003, 8, 12202],
      [2005, 4, 8896],
      [2010, 5, 50573],
      [2152, 7, 22128],
      [257, 58, 95832],
      [285, 47, 41849],
      [30, 30, 24284],
      [330, 2, 9094],
      [38, 136, 230203],
      [40, 71, 133278],
      [43, 5, 13045],
      [448, 5, 11425],
      [454, 9, 179940],
      [46, 25, 68415],
      [474, 9, 49453],
      [475, 109, 210490],
      [476, 14, 20833],
      [478, 48, 145445],
      [480, 4, 44309],
      [504, 9, 181518],
      [524, 14, 31746],
      [6, 40, 84986],
      [6866, 3, 3723],
      [706, 140, 134021],
      [707, 72, 33811],
      [708, 51, 115433],
      [7234, 2, 5550],
      [724, 91, 43390],
      [732, 17, 61870],
      [735, 49, 31960],
      [80, 48, 87104],
      [808, 2, 9545],
      [822, 29, 81903],
      [834, 6, 48981],
      [880, 3, 3551],
      [94, 44, 31629],
      [946, 4, 11328],
      [97, 7, 31887],
    ].map(([id, count, outof]) => ({ type: "npc" as const, id: id!, objectiveExcluded: true, chance: count! / outof! }));
    const game = zoneData(
      [
        questRow(33, "Wolves Across the Border", {
          zoneIds: [12],
          objectives: [{ index: 1, type: "item", id: 750, ids: [750], name: "Tough Wolf Meat", count: 8 }],
        }),
      ],
      {
        npcs: Object.fromEntries(wolves.map(({ id }) => [id, npcs[id as keyof typeof npcs]])),
        droppers: { 750: [...noise, ...wolves] },
      },
    );
    const sim = simData(game, entities, "Alliance");
    expect(sim.item(750)?.droppers.map((d) => d.id)).toEqual([299, 69, 704, 705]);
    const run = (line: string) =>
      simulateRoute(
        [parseGuide("#group G\n#name G\nstep\n.accept 33\n" + line + "\nstep\n.turnin 33\n")],
        0,
        createProfile({ race: "Human", class: "WARRIOR", level: 3 }),
        sim,
      ).guides[0]!.steps.map((step) =>
        step.kills.map((k) => ({ count: k.count, mobs: k.mobs.map((m) => [m.npcId, m.levels.reduce((sum, l) => sum + l.kills, 0)]) })),
      );
    expect(run(".complete 33,1")).toEqual([
      [
        {
          count: 15,
          mobs: [
            [69, 8],
            [299, 7],
          ],
        },
      ],
      [],
    ]);
    expect(run(".complete 33,1,4")).toEqual([
      [
        {
          count: 7,
          mobs: [
            [69, 4],
            [299, 3],
          ],
        },
      ],
      [
        {
          count: 8,
          mobs: [
            [69, 4],
            [299, 4],
          ],
        },
      ],
    ]);
  });

  describe("droppers that the dataset excludes for objectives", () => {
    const item = (id: number, name: string) => ({ index: 1, type: "item", id, ids: [id], name, count: 2 });
    const npc = (min: number, max: number, zone: number) => ({ levels: { min, max }, elite: false, zoneIds: [zone] });
    const excluded = (id: number) => ({ type: "npc" as const, id, objectiveExcluded: true as const });
    const game = zoneData(
      [
        questRow(33, "Wolves Across the Border", { baseXp: 100, zoneIds: [12], objectives: [item(750, "Tough Wolf Meat")] }),
        questRow(4106, "Salve via Skinning", {
          questLevel: 55,
          requiredLevel: 48,
          baseXp: 100,
          zoneIds: [361],
          objectives: [item(11512, "Patch of Tainted Skin")],
        }),
      ],
      {
        npcs: { "6": npc(1, 2, 12), "299": npc(1, 1, 12), "7126": npc(52, 60, 361), "8957": npc(51, 52, 361), "8961": npc(51, 52, 361) },
        droppers: {
          "750": [excluded(6), { type: "npc", id: 299, chance: 0.556 }],
          "11512": [excluded(8957), excluded(7126), excluded(8961)],
        },
      },
    );
    const run = (quest: number, level: number) =>
      simulateRoute(
        [parseGuide(`#group G\n#name G\nstep\n.accept ${quest}\n.complete ${quest},1\n.turnin ${quest}\n`)],
        0,
        createProfile({ race: "Human", class: "WARRIOR", level }),
        simData(game, entities, "Alliance"),
      );

    it("gives each eligible dropper with its chance", () => {
      expect(simData(game, entities, "Alliance").item(750)).toEqual({
        droppers: [{ id: 299, chance: 0.556 }],
        objectsOnly: false,
        sold: false,
      });
    });

    it("kills only the droppers that the dataset leaves eligible", () => {
      const kills = run(33, 5).guides[0]!.steps[0]!.kills;
      expect(kills.map((k) => [k.count, k.mobFrom, k.mobs.map((m) => m.npcId)])).toEqual([[4, "zoneDroppers", [299]]]);
    });

    it("kills none for an item whose only NPC droppers are excluded, and warns", () => {
      const { guides, warnings } = run(4106, 50);
      expect(guides[0]!.steps[0]!.kills).toEqual([]);
      expect(warnings).toEqual([
        {
          kind: "noKillTarget",
          reason: "noDropper",
          at: { guide: 0, step: 0, line: 1 },
          questId: 4106,
          objective: "Patch of Tainted Skin",
        },
      ]);
    });
  });

  describe("drop chance", () => {
    const npc = (min: number, max: number) => ({ levels: { min, max }, elite: false, zoneIds: [12] });
    const dropper = (id: number, chance?: number) => ({ type: "npc" as const, id, ...(chance !== undefined && { chance }) });
    const game = zoneData(
      [
        questRow(60, "Kobold Candles", {
          baseXp: 100,
          zoneIds: [12],
          objectives: [{ index: 1, type: "item", id: 772, ids: [772], name: "Large Candle", count: 10 }],
        }),
        questRow(86, "Pie for Billy", {
          baseXp: 100,
          zoneIds: [12],
          objectives: [{ index: 1, type: "item", id: 769, ids: [769], name: "Chunk of Boar Meat", count: 4 }],
        }),
        questRow(7, "Kobold Camp Cleanup", {
          baseXp: 100,
          zoneIds: [12],
          objectives: [{ index: 1, type: "monster", id: 6, ids: [6], name: "Kobold Vermin", count: 3 }],
        }),
      ],
      {
        npcs: { "6": npc(1, 2), "40": npc(6, 7), "475": npc(5, 6), "113": npc(5, 6), "119": npc(10, 11) },
        droppers: {
          "772": [dropper(40, 0.25), dropper(475)],
          "769": [dropper(113), dropper(119)],
        },
      },
    );
    const route = (...steps: string[]) =>
      simulateRoute(
        [parseGuide(`#group G\n#name G\nstep\n.accept 60\n.accept 86\n.accept 7\n${steps.map((s) => `step\n${s}\n`).join("")}`)],
        0,
        createProfile({ race: "Human", class: "WARRIOR", level: 5 }),
        simData(game, entities, "Alliance"),
      );
    const kills = (...steps: string[]) =>
      route(...steps)
        .guides[0]!.steps.slice(1)
        .map((step) => step.kills.map((k) => k.count));
    const mobKills = (...steps: string[]) =>
      route(...steps)
        .guides[0]!.steps.slice(1)
        .map((step) => step.kills.flatMap((k) => k.mobs.map((m) => [m.npcId, m.levels.reduce((n, l) => n + l.kills, 0)])));

    it("takes each dropper's share of the items at its estimated chance, else at the default", () => {
      const step = simulateRoute(
        [parseGuide("#group G\n#name G\nstep\n.accept 60\n.complete 60,1\n")],
        0,
        createProfile({ race: "Human", class: "WARRIOR", level: 5 }),
        simData(game, entities, "Alliance"),
      ).guides[0]!.steps[0]!;
      expect(step.kills.map((k) => [k.count, k.mobs.map((m) => [m.npcId, m.levels.reduce((n, l) => n + l.kills, 0)])])).toEqual([
        [
          30,
          [
            [40, 20],
            [475, 10],
          ],
        ],
      ]);
      expect(step.kills[0]!.drops).toEqual([
        { npcId: 40, chance: { value: 0.25, source: { kind: "estimated" } } },
        { npcId: 475, chance: { value: 0.5, source: { kind: "default" } } },
      ]);
    });

    it("uses cumulative rounding across partial targets at the default chance", () => {
      expect(kills(".complete 86,1,1", ".complete 86,1,2", ".complete 86,1,3", ".turnin 86")).toEqual([[2], [2], [2], [2]]);
    });

    it("credits explicit kills at the chance of the NPC that receives them", () => {
      expect(mobKills(".complete 60,1,1 -- @sim kills=1", ".complete 60,1,1", ".turnin 60")).toEqual([
        [[40, 1]],
        [
          [40, 1],
          [475, 1],
        ],
        [
          [40, 18],
          [475, 9],
        ],
      ]);
    });

    it("retains a zero-kill segment before a later line changes the chance", () => {
      expect(
        kills(".complete 60,1,1 -- @sim kills=1 drop=0.9", ".complete 60,1,1 -- @sim drop=1", ".complete 60,1,2 -- @sim drop=0.1"),
      ).toEqual([[1], [], [10]]);
    });

    it("counts kills= as the kills, whatever the chance", () => {
      expect(kills(".complete 60,1 -- @sim kills=5")).toEqual([[5]]);
    });

    it("uses a line's drop= for every dropper on that line only", () => {
      expect(mobKills(".complete 60,1 -- @sim drop=0.5")).toEqual([
        [
          [40, 10],
          [475, 10],
        ],
      ]);
      expect(kills(".complete 60,1,4 -- @sim drop=0.5", ".turnin 60")).toEqual([[8], [18]]);
      const [entry] = route(".complete 60,1,4 -- @sim drop=0.5").guides[0]!.steps[1]!.kills;
      expect(entry!.drops!.map((d) => d.chance)).toEqual([
        { value: 0.5, source: { kind: "override" } },
        { value: 0.5, source: { kind: "override" } },
      ]);
    });

    it("counts kills= over drop=, and warns on drop= for a kill objective", () => {
      expect(kills(".complete 60,1 -- @sim kills=5 drop=0.5")).toEqual([[5]]);
      const { guides, warnings } = route(".complete 7,1 -- @sim drop=0.5");
      expect(guides[0]!.steps[1]!.kills.map((k) => k.count)).toEqual([3]);
      expect(warnings).toContainEqual({
        kind: "unknownSimKey",
        at: { guide: 0, step: 1, line: 0 },
        key: "drop",
        value: "0.5",
        problem: "misplaced",
      });
      expect(route(".complete 7,1 -- @sim kills=0 drop=0.5").warnings).toContainEqual({
        kind: "unknownSimKey",
        at: { guide: 0, step: 1, line: 0 },
        key: "drop",
        value: "0.5",
        problem: "misplaced",
      });
    });

    it("counts a partial line and the turn-in by items, so their kills sum to the objective's", () => {
      expect(mobKills(".complete 60,1,4", ".turnin 60")).toEqual([
        [
          [40, 8],
          [475, 4],
        ],
        [
          [40, 12],
          [475, 6],
        ],
      ]);
      expect(kills(".turnin 60")).toEqual([[30]]);
      expect(kills(".complete 86,1,1 -- @sim kills=1", ".complete 86,1,1 -- @sim kills=1", ".turnin 86")).toEqual([[1], [1], [6]]);
      expect(kills(".complete 60,1,6 -- @sim drop=0.3", ".complete 60,1,6", ".turnin 60")).toEqual([[20], [], [12]]);
    });
  });

  it("finds entities by name", () => {
    expect(alliance.entityByName("Hogger")).toEqual({ kind: "npc", id: 448 });
    expect(alliance.entityByName("Broken Tooth")?.kind).toBe("ambiguous");
    expect(alliance.entityByName("No Such Mob")).toBeUndefined();
  });

  it("reads each prerequisite list and the turn-in rule on their own", () => {
    const quest = { ...QUEST_DEFAULTS, id: 960, name: "Onu is Meditating", preQuestSingle: [944], types: ["repeatable"] };
    const stub = { quest: () => quest as unknown as Quest } as unknown as GameData;
    expect(simData(stub, entities, "Alliance").quest(960)).toMatchObject({ preAny: [944], preAll: null, acceptOnTurnIn: true });
  });
});
