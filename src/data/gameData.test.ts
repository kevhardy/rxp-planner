import { MAP_BOUNDS, plannerContext, plannerData, plannerFile } from "./plannerFixture.ts";
import { validateGameDataFile } from "../../packages/data-contract/validation.ts";
import { beforeAll, describe, expect, it } from "vitest";
import { GameData, pointLabel, type GotoError, type GotoLocation } from "./gameData.ts";
import { mapToWorld, worldToMap, type WorldBounds } from "./maps.ts";
import type { BundleSource, GameDataFile, Quest, QuestField, QuestRow } from "./model.ts";

let data: GameData;
beforeAll(async () => {
  data = plannerData();
});

const elwynn = () => data.zoneByName("Elwynn Forest")!;

function located(result: GotoLocation | GotoError) {
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe("quests", () => {
  it("looks up a quest with its requirements and points", () => {
    const quest = data.quest(743)!;
    expect(quest).toMatchObject({
      name: "Dangers of the Windfury",
      requiredLevel: 5,
      questLevel: 8,
      raceRequirement: "Horde",
    });
    expect(quest.requiredRaceMask! & 2).toBeTruthy();
    expect(quest.requiredRaceMask! & 1).toBe(0);
    expect(quest.startPoints).toEqual([
      expect.objectContaining({ zoneId: 215, uiMapId: 1412, x: 47.35, y: 62.02, sourceId: 2985, sourceName: "Ruul Eagletalon" }),
    ]);
    expect(quest.endPoints[0]).toMatchObject({ sourceType: "npc", sourceId: 2985, sourceName: "Ruul Eagletalon" });
    expect(data.npcName(197)).toBe("Marshal McBride");
    expect(data.quest(1)).toBeUndefined();
  });

  it("has prerequisites", () => {
    expect(data.quest(171)!.preQuestGroup).toEqual([558, 4822]);
    expect(data.quest(794)!.preQuestSingle).toEqual([792, 1499]);
  });

  it("links objective points to objectives", () => {
    const quest = data.quest(743)!;
    expect(quest.objectives).toEqual([{ index: 1, type: "item", id: 4751, ids: [4751], name: "Windfury Talon", count: 8 }]);
    expect(quest.objectivePoints.length).toBeGreaterThan(0);
    expect(quest.objectivePoints.every((p) => p.sourceId === 4751 && p.kind === "item")).toBe(true);
  });

  it("searches by name, ID, zone, and level", () => {
    const ids = (quests: { id: number }[]) => quests.map((q) => q.id);
    expect(ids(data.searchQuests({ text: "kobold c" }))).toEqual([7, 60]);
    expect(ids(data.searchQuests({ text: " 783 " }))).toEqual([783]);
    expect(ids(data.searchQuests({ zoneId: elwynn().id, minLevel: 5, maxLevel: 5 }))).toEqual([6, 54, 2158, 21]);
  });
});

describe("race classes", () => {
  it("reads each race's classes by name from the dataset's IDs", () => {
    expect(data.raceClasses?.Dwarf).toEqual(["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN"]);
    expect(data.raceClasses?.Scourge).toEqual(["WARRIOR", "PALADIN", "ROGUE", "PRIEST", "MAGE", "WARLOCK"]);
    expect(data.raceClasses?.HighOrder).toEqual(["WARRIOR", "HUNTER", "ROGUE", "MAGE", "DRUID"]);
    expect(data.raceClasses?.Windshaper).toEqual(["WARRIOR", "HUNTER", "ROGUE", "SHAMAN", "DRUID"]);
  });

  it("refuses an unknown race or class ID, and says nothing without the field", () => {
    const { raceClasses = {}, races = {}, ...file } = plannerFile();
    const load = (ids: Record<string, number[]>) => new GameData({ ...file, races, raceClasses: ids }, plannerContext);
    expect(() => load({ ...raceClasses, "10": [1] })).toThrow("Race classes name unknown race ID 10.");
    expect(() => load({ ...raceClasses, "3": [1, 6] })).toThrow("Race classes give race ID 3 unknown class ID 6.");
    expect(() => new GameData({ ...file, raceClasses }, plannerContext)).toThrow("Race classes name unknown race ID 1.");
    expect(new GameData({ ...file, races }, plannerContext).raceClasses).toBeUndefined();
  });
});

describe("zones", () => {
  it("finds a zone by Questie ID, UI map ID, name, and RXP alias", () => {
    const zone = data.zoneByUiMapId(1453)!;
    expect(zone.name).toBe("Stormwind City");
    expect(data.zone(zone.id)).toBe(zone);
    expect(data.zoneByName("Stormwind City")).toBe(zone);
    expect(data.zoneByName("StormwindClassic")).toBe(zone);
    expect(zone).toMatchObject({ category: "city", instance: 0 });
    expect(zone.bounds).toEqual(MAP_BOUNDS.get(1453));
    expect(zone.continent?.name).toBe("Eastern Kingdoms");
  });

  it("prefers the zone with a map when names repeat", () => {
    expect(data.zoneByName("Westfall")?.uiMapId).toBe(1436);
  });

  it("prefers the zone on a continent when a name or UI map repeats, wherever it comes in the list", () => {
    const file = plannerFile();
    const dungeon = { id: 9300, name: "Hollow Barrow", instance: 9037, category: "dungeon" as const, uiMapId: 9300 };
    const outdoors = { ...dungeon, id: 9301, instance: 0, category: "zone" as const };
    const game = new GameData({ ...file, zones: [...file.zones, dungeon, outdoors] }, plannerContext);
    expect(game.zoneByName("Hollow Barrow")?.id).toBe(9301);
    expect(game.zoneByUiMapId(9300)?.id).toBe(9301);
  });

  it("joins RXP zone names to the dataset's UI maps", () => {
    expect(data.uiMapNamed("Loch Modan")).toBe(1432);
    expect(data.uiMapNamed("StormwindNew")).toBe(1453);
    expect(data.uiMapNamed("The Deadmines")).toBeUndefined();
    const file = plannerFile();
    const zones = [...file.zones, { id: 9207, name: "Loch Modan", instance: 9037, category: "dungeon" as const, uiMapId: 9132 }];
    expect(() => new GameData({ ...file, zones }, plannerContext)).toThrow("The dataset gives RXP zone Loch Modan UI maps 1432, 9132.");
  });

  it("finds the zone under a continent point", () => {
    const kalimdor = data.continentByUiMapId(1414)!;
    expect(data.zoneAtContinentPoint(kalimdor, 51.9, 55.3)?.name).toBe("The Barrens");
    expect(data.zoneAtContinentPoint(kalimdor, 1, 1)).toBeUndefined();
  });
});

describe("world coordinates", () => {
  it("converts HBD world coordinates to zone percentages and back", () => {
    const bounds = MAP_BOUNDS.get(1429)!;
    const pos = worldToMap(bounds, { x: -136.48, y: -8933.47 });
    expect(pos.x).toBeCloseTo(48.17, 1);
    expect(pos.y).toBeCloseTo(42.94, 1);
    const world = mapToWorld(bounds, pos.x, pos.y);
    expect(world.x).toBeCloseTo(-136.48, 6);
    expect(world.y).toBeCloseTo(-8933.47, 6);
  });
});

describe("locateGoto", () => {
  it("places zone names, map IDs, and world coordinates", () => {
    expect(data.locateGoto(["Elwynn Forest", "48.17", "42.94", "30"])).toMatchObject({
      ok: true,
      form: "name",
      uiMapId: 1429,
      x: 48.17,
      y: 42.94,
    });
    expect(data.locateGoto(["1429", "48.17", "42.94"])).toMatchObject({ ok: true, form: "map-id", uiMapId: 1429, x: 48.17 });
    const world = located(data.locateGoto(["1429/0", "-136.48", "-8933.47"]));
    expect(world).toMatchObject({ form: "world", uiMapId: 1429, world: { instance: 0, x: -136.48, y: -8933.47 } });
    expect(world.x).toBeCloseTo(48.17, 1);
  });

  it("finds the zone under a continent point", () => {
    const result = located(data.locateGoto(["1414", "51.92", "55.27"]));
    expect(result).toMatchObject({ form: "map-id", uiMapId: 1414, x: 51.92, y: 55.27 });
    const zone = data.zoneAt(result.world)!;
    expect(zone.name).toBe("The Barrens");
    const pos = worldToMap(zone.bounds!, result.world);
    expect(pos.x).toBeCloseTo(46.01, 1);
    expect(pos.y).toBeCloseTo(35.11, 1);
  });

  it("reports why a point cannot be placed", () => {
    const reason = (args: string[]) => {
      const result = data.locateGoto(args);
      return result.ok ? "ok" : result.reason;
    };
    expect(reason(["Nowhere", "50", "50"])).toBe("unknown-zone");
    expect(reason(["9999", "50", "50"])).toBe("unknown-zone");
    expect(data.locateGoto(["291", "50", "50"])).toMatchObject({
      ok: false,
      reason: "no-bounds",
      message: "The Deadmines has no world position on Forever.",
    });
    expect(reason(["Elwynn Forest", "50"])).toBe("bad-coordinates");
    expect(reason(["1448/1", "-1308.08", "3990.00.1"])).toBe("bad-coordinates");
    expect(reason(["1429/0", "0", "0"])).toBe("outside-map");
    // RXP takes zone percentages as written, even outside the map.
    expect(reason(["1414", "1", "1"])).toBe("ok");
  });

  it("locates Zephras Isle in every zone form", () => {
    const named = located(data.locateGoto(["Zephras Isle", "43", "43.2"]));
    const world = { instance: 2991, ...mapToWorld(MAP_BOUNDS.get(2521)!, 43, 43.2) };
    expect(named).toEqual({ ok: true, form: "name", uiMapId: 2521, x: 43, y: 43.2, world });
    expect(data.locateGoto(["2521", "43", "43.2"])).toEqual({ ...named, form: "map-id" });
    const fromWorld = located(data.locateGoto(["2521/2991", String(world.x), String(world.y)]));
    expect(fromWorld).toMatchObject({ form: "world", uiMapId: 2521, world });
    expect(fromWorld.x).toBeCloseTo(43, 9);
    expect(fromWorld.y).toBeCloseTo(43.2, 9);
    expect(data.locateGoto(["2521/2991", "0", "0"])).toMatchObject({ ok: false, reason: "outside-map" });
    expect(data.locateGoto(["2548", "50", "50"])).toMatchObject({ ok: true, world: { instance: 0 } });
  });

  it("converts all four Stormwind and Eastern Plaguelands aliases as pinned RXP v4.11.26 does", () => {
    // Outputs of RXP's `GetMapInfo` in map.lua for 30,60, run in Lua with Forever's values: a client before 3.0, and
    // `WOW_PROJECT_MAINLINE`, the default that Blizzard_BNet sets. This is source analysis, not an in-game observation.
    const rxp: Record<string, [number, number, number]> = {
      StormwindClassic: [1453, 42.8907289793, 70.8629547758],
      StormwindNew: [1453, 13.3384446035, 45.9620903269],
      EPLClassic: [1423, 26.2684724538, 54.0620127106],
      EPLNew: [1423, 33.8849596922, 66.1824079652],
    };
    for (const [alias, [uiMapId, x, y]] of Object.entries(rxp)) {
      const result = located(data.locateGoto([alias, "30", "60"]));
      expect([alias, result.uiMapId]).toEqual([alias, uiMapId]);
      expect(result.x).toBeCloseTo(x, 8);
      expect(result.y).toBeCloseTo(y, 8);
      expect(result.world).toEqual({ instance: 0, ...mapToWorld(MAP_BOUNDS.get(uiMapId)!, result.x, result.y) });
    }
  });

  it("converts world coordinates under an alias name as RXP v4.11.26 does", () => {
    // RXP's `.goto` handler in functions.lua passes world coordinates through `GetMapInfo` in map.lua, so StormwindNew's
    // percentage transform applies to them.
    const result = located(data.locateGoto(["StormwindNew/0", "680", "-6611"]));
    expect(result).toMatchObject({ form: "world", uiMapId: 1453 });
    expect(result.world.x).toBeCloseTo(853.4779762857, 8);
    expect(result.world.y).toBeCloseTo(-8574.795094273, 8);
  });

  it("keeps the instance that world coordinates name", () => {
    const [x, y] = ["1839.375", "3354.250144"];
    expect(located(data.locateGoto(["2521/2991", x, y])).world).toEqual({ instance: 2991, x: 1839.375, y: 3354.250144 });
    expect(data.locateGoto(["2521/1", x, y])).toEqual({
      ok: false,
      form: "world",
      reason: "wrong-instance",
      message: "World point 1839.375,3354.250144 names instance 1, but Zephras Isle is on instance 2991.",
      uiMapId: 2521,
    });
    for (const zone of ["1429/1", "1429/9999"]) {
      expect(data.locateGoto([zone, "-136.48", "-8933.47"])).toMatchObject({ ok: false, reason: "wrong-instance" });
    }
    expect(located(data.locateGoto(["2524/2997", "1500", "0"])).world).toEqual({ instance: 2997, x: 1500, y: 0 });
  });
});

describe("formatLocation", () => {
  it("writes RXP's name for the map, or its ID when RXP has none", () => {
    expect(data.formatLocation({ uiMapId: 2521, x: 43.004, y: 43.2 })).toEqual(["Zephras Isle", "43.00", "43.20"]);
    expect(data.formatLocation({ uiMapId: 2548, x: 10, y: 20 })).toEqual(["2548", "10.00", "20.00"]);
    expect(data.formatLocation({ uiMapId: 1453, x: 25, y: 42.945 })).toEqual(["Stormwind City", "25.00", "42.95"]);
  });
});

describe("pointLabel", () => {
  it("rounds the percentages a source wrote, not their float error, to one decimal", () => {
    // Elwynn Forest's 24.55 comes back from its world position as 24.549999999999997.
    expect(pointLabel(24.549999999999997, 74.69)).toBe("24.6, 74.7");
    // The double nearest 1.45 is under it, so toFixed(1) gives 1.4.
    expect(pointLabel(1.45, 0)).toBe("1.5, 0.0");
    expect(pointLabel(24.549, 24.5499)).toBe("24.5, 24.5");
    expect(pointLabel(-1.25, -0.04)).toBe("-1.3, 0.0");
  });
});

describe("locateQuestPoint", () => {
  const worldAt = (bounds: WorldBounds, x: number, y: number) => ({ instance: bounds.instance, ...mapToWorld(bounds, x, y) });
  const at = (uiMapId: number, x: number, y: number, world: ReturnType<typeof worldAt>) => ({
    uiMapId,
    x: expect.closeTo(x, 9),
    y: expect.closeTo(y, 9),
    world,
  });
  const source = (quest: Quest, field: QuestField) => data.fieldOrigin(quest, field)?.source;

  it("locates a finished Zephras Isle point", () => {
    const quest = data.quest(92461)!;
    expect(source(quest, "startPoints")).toBe("source-a");
    expect(data.locateQuestPoint(quest.startPoints[0]!)).toEqual(at(2521, 42, 23.4, worldAt(MAP_BOUNDS.get(2521)!, 42, 23.4)));
  });

  it("keeps a Classic fallback record's world position on Forever's redrawn maps", () => {
    const quest = data.quest(743)!;
    const p = quest.startPoints[0]!;
    expect(source(quest, "startPoints")).toBe("source-b");
    expect(p).toMatchObject({ zoneId: 215, x: 47.35, y: 62.02 });
    const era = { instance: 1, x: -384.68960264999987, y: -2397.1015759600004 };
    const location = data.locateQuestPoint(p);
    expect(location.world).toEqual(era);
    expect(location).toMatchObject({ uiMapId: 1412, x: expect.closeTo(46.535243561801295, 6), y: expect.closeTo(64.93696556919146, 6) });
  });

  it("places a point on the map its source named, not its zone's map", () => {
    const p = {
      kind: "start",
      sourceType: "npc",
      sourceId: 68,
      sourceName: "Stormwind City Guard",
      zoneId: 12,
      uiMapId: 1453,
      x: 50,
      y: 50,
      world: { instance: 0, x: 854.168, y: -8575 },
    };
    expect(data.zone(12)!.uiMapId).toBe(1429);
    expect(data.locateQuestPoint(p)).toEqual(at(1453, 50, 50, p.world));
  });
});

describe("provenance", () => {
  const sourceA: BundleSource = { source: "source-a", pins: { archive: "sha256:aa" } };
  const sourceB: BundleSource = {
    source: "source-b",
    pins: { commit: "abc" },
    derivedFrom: [{ source: "source-c", edition: "forever", pins: { "AreaTable.csv": "sha256:bb" } }],
  };
  const rewordedWithChoices = [
    "Description reworded",
    "Rewards: adds Choice of Mining for Dummies, Choice of Pelt Collecting for Beginners, Choice of Wild Harvest",
  ];
  const quest: Quest = {
    id: 4402,
    name: "Galgar's Cactus Apple Surprise",
    requiredLevel: 1,
    questLevel: 3,
    requiredRaceMask: 178,
    requiredClassMask: 0,
    requiredFaction: "Horde",
    raceRequirement: "Horde",
    classRequirement: "Any class",
    zoneIds: [14],
    types: ["general"],
    preQuestGroup: [],
    preQuestSingle: [788],
    nextQuestInChain: null,
    baseXp: 380,
    startPoints: [],
    endPoints: [],
    objectiveText: ["Bring Galgar 10 Cactus Apples. You remember him saying that they could be found near cactuses."],
    objectivePoints: [],
    objectives: [{ index: 1, type: "item", id: 11583, ids: [11583], name: "Cactus Apple", count: 10 }],
    capturedObjectives: [{ text: "10Cactus Apple (10)", quantity: 10, links: [{ type: "item", id: 11583 }] }],
    changes: { status: "updated", labels: ["rewards_changed", "reworded"], lines: rewordedWithChoices, notShown: rewordedWithChoices },
    rewardItems: [{ item: 11584, count: 10 }],
    rewardChoices: [
      { item: 247840, count: 1 },
      { item: 247841, count: 1 },
      { item: 247846, count: 1 },
    ],
    rewardReputation: [
      { faction: 76, value: 200 },
      { faction: 530, value: 200 },
    ],
    rewardMoney: 50,
    provenance: {
      fields: {
        name: { source: "source-b" },
        objectives: { source: "source-b" },
        rewardItems: { source: "source-a" },
        questLevel: { source: "override:forever", reason: "Verified in game" },
      },
      evidence: { "source-a": ["capture quest=4402"] },
    },
  };
  const file = (quests: QuestRow[]): GameDataFile => ({
    source: { name: "Test", version: "1", pack: "forever" },
    maxLevel: 60,
    quests,
    zones: [],
    continents: [],
    npcNames: {},
    sources: [sourceA, sourceB],
  });

  it("keeps a quest's captured facts and resolves each field's winning source against the bundle's sets", () => {
    const decoded = new GameData(JSON.parse(JSON.stringify(file([quest]))), plannerContext);
    const q = decoded.quest(4402)!;
    expect(q).toEqual(quest);
    expect(decoded.sources).toEqual([sourceA, sourceB]);
    expect(decoded.fieldOrigin(q, "rewardItems")).toEqual({ ...sourceA, evidence: ["capture quest=4402"] });
    expect(decoded.fieldOrigin(q, "objectives")).toEqual(sourceB);
    expect(decoded.fieldOrigin(q, "questLevel")).toEqual({ source: "override:forever", reason: "Verified in game" });
    expect(decoded.fieldOrigin(q, "baseXp")).toBeUndefined();
  });

  it.each(["toString", "constructor", "__proto__"])("reads only own evidence for source %s after decoding", (source) => {
    const set: BundleSource = { source, pins: { revision: "abc" } };
    for (const ownEvidence of [undefined, ["local capture"]]) {
      const input = {
        ...file([
          {
            ...quest,
            provenance: {
              fields: { name: { source }, rewardItems: { source: sourceA.source } },
              evidence: { [sourceA.source]: ["other capture"], ...(ownEvidence && { [source]: ownEvidence }) },
            },
          },
        ]),
        sources: [set, sourceA],
      };
      const decoded = new GameData(JSON.parse(JSON.stringify(input)), plannerContext);
      const row = decoded.quest(4402)!;
      expect(decoded.fieldOrigin(row, "name")).toEqual({ ...set, ...(ownEvidence && { evidence: ownEvidence }) });
      expect(decoded.fieldOrigin(row, "rewardItems")).toEqual({ ...sourceA, evidence: ["other capture"] });
    }
  });

  const byLevel = (Alliance: number, Horde: number): NonNullable<QuestRow["byFaction"]> => ({
    Alliance: { requiredLevel: Alliance, provenance: { requiredLevel: { source: "source-a" } } },
    Horde: { requiredLevel: Horde, provenance: { requiredLevel: { source: "source-a" } } },
  });
  const split: QuestRow = { ...quest, requiredLevel: null, byFaction: byLevel(10, 12) };

  it("resolves each faction's values and leaves them unresolved without a faction", () => {
    const decoded = new GameData(file([split]), plannerContext);
    const level = (faction?: "Alliance" | "Horde") => decoded.quest(4402, faction)?.requiredLevel;
    expect([level("Alliance"), level("Horde"), level()]).toEqual([10, 12, null]);
    expect(decoded.quest(4402)?.unresolved).toEqual(["requiredLevel"]);
    expect(decoded.fieldOrigin(decoded.quest(4402, "Horde")!, "requiredLevel")).toEqual({
      ...sourceA,
      evidence: ["capture quest=4402"],
    });
    expect(decoded.searchQuests({ faction: "Horde" })).toEqual([decoded.quest(4402, "Horde")]);
  });

  it.each<[string, Partial<QuestRow>, RegExp]>([
    [
      "only one faction",
      { byFaction: { Alliance: byLevel(10, 12).Alliance } as NonNullable<QuestRow["byFaction"]> },
      /needs Alliance and Horde/,
    ],
    ["different fields per faction", { byFaction: { ...byLevel(10, 12), Horde: { questLevel: 4 } } }, /same faction fields/],
    [
      "a faction name",
      {
        byFaction: {
          Alliance: { name: "Galgar's Cactus Apple Surprise" },
          Horde: { name: "Galgar's Cactus Apple Surprise" },
        } as unknown as NonNullable<QuestRow["byFaction"]>,
      },
      /same faction fields/,
    ],
    ["one faction's value in the shared fields", { requiredLevel: 10 }, /requiredLevel: a field that differs by faction holds its default/],
    [
      "a shared source for a faction field",
      { provenance: { fields: { requiredLevel: { source: "source-a" } } } },
      /holds its default and no source/,
    ],
    [
      "a faction source the bundle lacks",
      { byFaction: { ...byLevel(10, 12), Horde: { requiredLevel: 12, provenance: { requiredLevel: { source: "source-c" } } } } },
      /Quest 4402 \(Horde\)\.requiredLevel: source-c is not among/,
    ],
    [
      "a shared source the bundle lacks, which a faction source would hide",
      {
        provenance: { fields: { name: { source: "source-c" } } },
        byFaction: {
          Alliance: {
            requiredLevel: 10,
            provenance: { requiredLevel: { source: "source-a" }, name: { source: "source-a" } },
          },
          Horde: { requiredLevel: 12, provenance: { requiredLevel: { source: "source-a" }, name: { source: "source-a" } } },
        } as NonNullable<QuestRow["byFaction"]>,
      },
      /Quest 4402\.name: source-c is not among/,
    ],
    [
      "a faction source for a shared field",
      {
        byFaction: {
          ...byLevel(10, 12),
          Horde: {
            requiredLevel: 12,
            provenance: { requiredLevel: { source: "source-a" }, questLevel: { source: "source-a" } },
          },
        },
      },
      /Quest 4402 \(Horde\): byFaction cites a source for a field it does not give/,
    ],
    ["fields marked unresolved", { unresolved: ["requiredLevel"] } as Partial<QuestRow>, /only lookups mark fields unresolved/],
  ])("rejects a row with %s", (_, change, error) => {
    expect(() => validateGameDataFile(file([{ ...split, ...change }]))).toThrow(error);
  });

  it("rejects provenance that names a set the bundle does not list", () => {
    const stray = { ...quest, provenance: { fields: { name: { source: "source-c" as const } } } };
    expect(() => validateGameDataFile(file([stray]))).toThrow(/Quest 4402\.name: source-c/);
    expect(() => validateGameDataFile({ ...file([]), sources: [sourceA, sourceA] })).toThrow(/twice/);
  });
});
