import { fixture as manifestFixture } from "./manifestFixture.ts";
import { describe, expect, expectTypeOf, it } from "vitest";
import { decodeJson } from "../../packages/data-contract/json.ts";
import {
  QUEST_DEFAULTS,
  type GameDataFile,
  type ObjectiveNeed,
  type QuestObjective,
  type QuestRow,
} from "../../packages/data-contract/model.ts";
import { validateGameDataFile } from "../../packages/data-contract/validation.ts";
import { validateCompleteGameData } from "../../packages/data-contract/completeData.ts";

describe("standalone consumer contract", () => {
  const roundTrip = async (file: GameDataFile) => {
    const decoded = await decodeJson(new TextEncoder().encode(JSON.stringify(file)));
    validateCompleteGameData(decoded);
    return decoded;
  };
  const fixture = (): GameDataFile => ({
    ...manifestFixture().quests,
    sources: [{ source: "custom:era", pins: { snapshot: "one" }, derivedFrom: [{ source: "custom", edition: "era", pins: {} }] }],
    quests: [
      {
        ...QUEST_DEFAULTS,
        zoneIds: [17, 44],
        types: ["general"],
        startPoints: [],
        endPoints: [],
        objectiveText: [],
        objectives: [],
        objectivePoints: [],
        id: 91904,
        name: "A Sealed Crate",
        requiredLevel: 0,
        questLevel: 60,
        requiredFaction: null,
        rewardItems: [],
        rewardMoney: 0,
        provenance: { fields: { requiredLevel: { source: "custom:era" } }, evidence: { "custom:era": ["record:91904"] } },
      },
    ],
    sellers: { "159": [{ id: 295 }], "1262": [] },
  });

  it("preserves unknown, zero, empty, and absent values with open provider metadata", async () => {
    const file = fixture();
    const before = JSON.stringify(file);
    const decoded = await roundTrip(file);
    expect(JSON.stringify(decoded)).toBe(before);
    expect(decoded.quests[0]).toMatchObject({
      requiredLevel: 0,
      requiredRaceMask: null,
      requiredFaction: null,
      rewardItems: [],
      rewardMoney: 0,
    });
    expect(Object.hasOwn(decoded.quests[0]!, "rewardReputation")).toBe(false);
  });

  it.each([
    ["non-string source key", { fields: { name: { source: 1 } } }, /invalid field source/],
    ["null field source", { fields: { name: null } }, /invalid field source/],
    ["non-string reason", { fields: { name: { source: "override:era", reason: 1 } } }, /invalid field source/],
    ["non-object fields", { fields: [] }, /invalid provenance/],
    ["non-string evidence", { fields: {}, evidence: { "custom:era": [1] } }, /invalid evidence/],
    ["unlisted evidence source", { fields: {}, evidence: { missing: ["record:91904"] } }, /not among/],
  ])("rejects %s", (_, provenance, message) => {
    const file = fixture();
    Object.assign(file.quests[0]!, { provenance });
    expect(() => validateGameDataFile(file)).toThrow(message);
  });

  it.each([
    ["pins", [{ source: "custom:era", pins: { build: 1 } }]],
    ["lineage", [{ source: "custom:era", pins: {}, derivedFrom: [{ source: "custom", edition: "other", pins: {} }] }]],
  ])("rejects malformed source %s", (_, sources) => {
    expect(() => validateGameDataFile({ ...fixture(), sources })).toThrow(/Invalid bundle source/);
  });

  it.each([
    ["a repeated NPC", [{ id: 295 }, { id: 295 }]],
    ["a non-positive NPC ID", [{ id: 0 }]],
  ])("rejects a seller with %s", (_, sellers) => {
    expect(() => validateCompleteGameData({ ...fixture(), sellers: { "159": sellers } })).toThrow(/Invalid item sellers/);
  });

  it.each([
    ["a null point list", { startPoints: null }, "Quest 91904.startPoints is not a list"],
    ["a list as a point", { endPoints: [[]] }, "Quest 91904.endPoints[0] is not a point"],
    ["a number as a point", { objectivePoints: [7] }, "Quest 91904.objectivePoints[0] is not a point"],
    [
      "a faction's point list that is not a list",
      { byFaction: { Alliance: { objectivePoints: [] }, Horde: { objectivePoints: {} } } },
      "Quest 91904 (Horde).objectivePoints is not a list",
    ],
  ])("rejects a row with %s", (_, change, message) => {
    const file = fixture();
    Object.assign(file.quests[0]!, change);
    expect(() => validateGameDataFile(file)).toThrow(message);
  });

  const objective = (index: number, need?: unknown, { id, name } = { id: 6, name: "Kobold Vermin" }) => ({
    index,
    type: "monster",
    id,
    ids: [id],
    name,
    ...(need !== undefined && { need }),
  });
  const worker = { id: 257, name: "Kobold Worker" };
  const northshire = {
    ...QUEST_DEFAULTS,
    requiredLevel: 1,
    requiredRaceMask: 77,
    requiredClassMask: 0,
    requiredFaction: "Alliance" as const,
    raceRequirement: "Alliance",
    classRequirement: "Any class",
    zoneIds: [12],
    types: ["general"],
    preQuestGroup: [],
    startPoints: [],
    endPoints: [],
    objectiveText: [],
    objectives: [],
    objectivePoints: [],
    rewardItems: [],
    rewardReputation: [{ faction: 72, value: 100 }],
  } satisfies Partial<QuestRow>;
  const withObjectives = (shared: object[], alliance: object[], horde: object[]): GameDataFile => {
    const file = fixture();
    file.quests.push(
      {
        ...northshire,
        id: 7,
        name: "Kobold Camp Cleanup",
        questLevel: 2,
        preQuestSingle: [783],
        nextQuestInChain: 15,
        baseXp: 170,
        objectiveText: ["Kill 10 Kobold Vermin, then return to Marshal McBride."],
        objectives: shared as QuestObjective[],
        rewardMoney: 25,
      },
      {
        ...northshire,
        id: 15,
        name: "Investigate Echo Ridge",
        questLevel: 3,
        preQuestSingle: [7],
        nextQuestInChain: 21,
        baseXp: 250,
        objectiveText: ["Kill 10 Kobold Workers, then report back to Marshal McBride."],
        objectives: [],
        rewardMoney: 40,
        byFaction: { Alliance: { objectives: alliance as QuestObjective[] }, Horde: { objectives: horde as QuestObjective[] } },
      },
    );
    return file;
  };

  it("keeps a numbered objective's need on shared and faction objectives, and its absence", async () => {
    const needs: ObjectiveNeed[] = ["kills", "providedItem", "action"];
    const file = withObjectives(
      [...needs.map((need, i) => objective(i + 1, need)), objective(4)],
      [objective(1, "action", worker)],
      [objective(1, undefined, worker)],
    );
    const before = JSON.stringify(file);
    const decoded = await roundTrip(file);
    expect(JSON.stringify(decoded)).toBe(before);
    expect(Object.hasOwn(decoded.quests[1]!.objectives[3]!, "need")).toBe(false);
    expect(Object.hasOwn(decoded.quests[2]!.byFaction!.Horde.objectives![0]!, "need")).toBe(false);
  });

  it.each([null, "unknown", "talk", true])("rejects a numbered objective need of %j", (need) => {
    expect(() => validateCompleteGameData(withObjectives([objective(1, need)], [], []))).toThrow(/Invalid quest 7 fields/);
    expect(() => validateCompleteGameData(withObjectives([], [objective(1, undefined, worker)], [objective(1, need, worker)]))).toThrow(
      /Invalid quest 15 faction values/,
    );
  });

  const withDroppers = (objectiveExcluded: unknown = true): GameDataFile => ({
    ...fixture(),
    droppers: {
      "750": [
        { type: "npc", id: 299 },
        { type: "npc", id: 1125, objectiveExcluded },
      ],
      "12234": {
        byFaction: {
          Alliance: [{ type: "object", id: 174848 }],
          Horde: [{ type: "item", id: 15103, objectiveExcluded }],
        },
      },
    } as NonNullable<GameDataFile["droppers"]>,
  });

  it("keeps a dropper's objective exclusion and its absence", async () => {
    const file = withDroppers();
    const before = JSON.stringify(file);
    const decoded = await roundTrip(file);
    expect(JSON.stringify(decoded)).toBe(before);
    expect(decoded.droppers).toStrictEqual({
      "750": [
        { type: "npc", id: 299 },
        { type: "npc", id: 1125, objectiveExcluded: true },
      ],
      "12234": {
        byFaction: { Alliance: [{ type: "object", id: 174848 }], Horde: [{ type: "item", id: 15103, objectiveExcluded: true }] },
      },
    });
  });

  it.each([false, null, "true", 1])("rejects a dropper objective exclusion of %j", (objectiveExcluded) => {
    expect(() => validateCompleteGameData(withDroppers(objectiveExcluded))).toThrow(/Invalid item droppers/);
  });

  it("keeps guaranteed drops, estimated chances, and absence across shared and faction lists", async () => {
    const file = fixture();
    file.sources!.push({ source: "override:quest-rule", pins: { snapshot: "two" } });
    file.droppers = {
      "1006": [
        { type: "npc", id: 330, guaranteed: { source: "custom:era" }, chance: 0.001 },
        { type: "npc", id: 118, objectiveExcluded: true },
      ],
      "20810": {
        byFaction: {
          Alliance: [{ type: "npc", id: 15440, guaranteed: { source: "override:quest-rule" } }],
          Horde: [{ type: "npc", id: 15612, guaranteed: { source: "custom:era" } }],
        },
      },
    };
    const decoded = await roundTrip(file);
    expect(decoded.droppers).toStrictEqual(file.droppers);
    expect(decoded.droppers?.["1006"]).toStrictEqual([
      { type: "npc", id: 330, guaranteed: { source: "custom:era" }, chance: 0.001 },
      { type: "npc", id: 118, objectiveExcluded: true },
    ]);
  });

  it.each([
    ["null", "npc", null, /invalid guaranteed drop/],
    ["boolean", "npc", true, /invalid guaranteed drop/],
    ["array", "npc", [], /invalid guaranteed drop/],
    ["missing source", "npc", {}, /invalid guaranteed drop/],
    ["empty source", "npc", { source: "" }, /invalid guaranteed drop/],
    ["whitespace source", "npc", { source: " " }, /invalid guaranteed drop/],
    ["numeric source", "npc", { source: 1 }, /invalid guaranteed drop/],
    ["object dropper", "object", { source: "custom:era" }, /invalid guaranteed drop/],
    ["item dropper", "item", { source: "custom:era" }, /invalid guaranteed drop/],
    ["undeclared source", "npc", { source: "missing" }, /not among the bundle's sources/],
    ["undeclared override", "npc", { source: "override:missing" }, /not among the bundle's sources/],
  ])("rejects a guaranteed drop with %s in shared and faction lists", (_, type, guaranteed, message) => {
    const dropper = { type, id: 330, guaranteed };
    for (const value of [[dropper], { byFaction: { Alliance: [dropper], Horde: [] } }, { byFaction: { Alliance: [], Horde: [dropper] } }]) {
      expect(() => validateCompleteGameData({ ...fixture(), droppers: { "1006": value } })).toThrow(message);
    }
  });

  it("keeps race classes without the game tables", async () => {
    const file = { ...fixture(), raceClasses: { "3": [1, 2, 3, 4, 5, 7] } };
    const before = JSON.stringify(file);
    const decoded = await roundTrip(file);
    expect(decoded.raceClasses).toStrictEqual({ "3": [1, 2, 3, 4, 5, 7] });
    expect(JSON.stringify(decoded)).toBe(before);
  });

  it.each([
    ["an empty class list", { "3": [] }],
    ["a repeated class", { "3": [1, 1, 2] }],
    ["unsorted classes", { "3": [2, 1] }],
    ["a non-integer race ID", { "3.5": [1] }],
    ["a non-integer class ID", { "3": [1, 2.5] }],
  ])("rejects race classes with %s", (_, raceClasses) => {
    expect(() => validateCompleteGameData({ ...fixture(), raceClasses })).toThrow(/Invalid race classes/);
  });

  const gameTables = {
    flightNodes: {
      "32": { name: "Theramore, Dustwallow Marsh", faction: "Alliance", world: { instance: 1, x: -4516.58, y: -3825.37 } },
      "25": { name: "Crossroads, The Barrens", faction: "Horde", world: { instance: 1, x: -2596.08, y: -441.8 } },
      "80": { name: "Ratchet, The Barrens", world: { instance: 1, x: -3773.01, y: -894.59 } },
    },
    factionNames: { "470": "Ratchet" },
    races: {
      "1": { fileName: "Human", faction: "Alliance" },
      "95": { fileName: "Skyborne", faction: "Alliance" },
      "96": { fileName: "Skyborne", faction: "Horde" },
    },
    classes: { "1": { fileName: "WARRIOR" }, "11": { fileName: "DRUID" } },
    raceClasses: { "1": [1], "95": [1, 11], "96": [11] },
  } satisfies Partial<GameDataFile>;

  it("keeps the game tables", async () => {
    const file = { ...fixture(), ...gameTables };
    const before = JSON.stringify(file);
    const decoded = await roundTrip(file);
    validateCompleteGameData(decoded);
    expect(decoded).toMatchObject(gameTables);
    expect(JSON.stringify(decoded)).toBe(before);
  });

  it.each([
    [
      "a flight node faction other than Alliance or Horde",
      { flightNodes: { "80": { name: "Ratchet, The Barrens", faction: "Neutral", world: { instance: 1, x: -3773.01, y: -894.59 } } } },
      /Invalid flight nodes/,
    ],
    [
      "a flight node without a name",
      { flightNodes: { "80": { name: "", world: { instance: 1, x: -3773.01, y: -894.59 } } } },
      /Invalid flight nodes/,
    ],
    [
      "a flight node without an instance",
      { flightNodes: { "80": { name: "Ratchet, The Barrens", world: { x: -3773.01, y: -894.59 } } } },
      /Invalid flight nodes/,
    ],
    [
      "a noncanonical flight node ID",
      { flightNodes: { "080": { name: "Ratchet, The Barrens", world: { instance: 1, x: -3773.01, y: -894.59 } } } },
      /Invalid flight nodes/,
    ],
    ["an empty faction name", { factionNames: { "470": "" } }, /Invalid faction names/],
    ["a race faction other than Alliance or Horde", { races: { "1": { fileName: "Human", faction: "Neutral" } } }, /Invalid races/],
    [
      "two races with one file name and faction",
      {
        races: {
          "95": { fileName: "Skyborne", faction: "Alliance" },
          "96": { fileName: "Skyborne", faction: "Alliance" },
        },
      },
      /Invalid races/,
    ],
    ["two classes with one file name", { classes: { "1": { fileName: "WARRIOR" }, "11": { fileName: "WARRIOR" } } }, /Invalid classes/],
    ["race classes for a missing race", { ...gameTables, raceClasses: { "2": [1] } }, /Invalid race classes race reference/],
    ["race classes with a missing class", { ...gameTables, raceClasses: { "1": [2] } }, /Invalid race classes class reference/],
  ])("rejects game tables with %s", (_, tables, message) => {
    expect(() => validateCompleteGameData({ ...fixture(), ...tables })).toThrow(message);
  });

  const ruleTables = {
    races: {
      "1": { fileName: "Human", faction: "Alliance", maskBit: 0 },
      "95": { fileName: "Skyborne", faction: "Alliance", maskBit: 32 },
      "96": { fileName: "Skyborne", faction: "Horde", maskBit: 33 },
    },
    professions: { "164": { name: "Blacksmithing", noSpecialization: true }, "9787": { name: "Weaponsmith" } },
    standings: [
      { name: "Unfriendly", min: -3000 },
      { name: "Neutral", min: 0 },
      { name: "Friendly", min: 3000 },
    ],
    xpToNextLevel: Array.from({ length: 59 }, (_, i) => 400 + i),
  } satisfies Partial<GameDataFile>;
  const withSkills = (skill: number, specialization: number) => {
    const file = fixture();
    file.quests.push({
      ...QUEST_DEFAULTS,
      id: 5305,
      name: "Sweet Serenity",
      requiredLevel: 50,
      questLevel: 60,
      requiredRaceMask: 0,
      requiredClassMask: 0,
      raceRequirement: "Any race",
      classRequirement: "Any class",
      zoneIds: [618],
      types: ["dungeon", "profession"],
      preQuestGroup: [],
      preQuestSingle: [],
      baseXp: 8300,
      startPoints: [],
      endPoints: [],
      objectiveText: [],
      objectives: [{ index: 1, type: "item", id: 13351, ids: [13351], name: "Crimson Hammersmith's Apron", count: 1, need: "kills" }],
      objectivePoints: [],
      rewardItems: [{ item: 12824, count: 1 }],
      exclusiveTo: [8869],
      byFaction: {
        Alliance: { requiredSkill: { skill, value: 250 }, requiredSpecialization: specialization },
        Horde: { requiredSkill: null, requiredSpecialization: 0 },
      },
    });
    return file;
  };

  it("keeps the profession, standing, XP, and race bit tables", async () => {
    const file = { ...withSkills(164, 9787), ...ruleTables };
    const before = JSON.stringify(file);
    const decoded = await roundTrip(file);
    expect(decoded).toMatchObject(ruleTables);
    expect(JSON.stringify(decoded)).toBe(before);
  });

  it("checks profession keys only when the bundle has the professions table", () => {
    const file = withSkills(186, 9787);
    expect(() => validateCompleteGameData(file)).not.toThrow();
    expect(() => validateCompleteGameData({ ...file, ...ruleTables })).toThrow("Invalid quest 5305 profession reference");
  });

  it.each([
    ["a race mask bit of 53", { races: { "1": { fileName: "Human", faction: "Alliance", maskBit: 53 } } }, "Invalid races"],
    [
      "two races with one mask bit",
      {
        races: {
          "95": { fileName: "Skyborne", faction: "Alliance", maskBit: 32 },
          "96": { fileName: "Skyborne", faction: "Horde", maskBit: 32 },
        },
      },
      "Invalid race mask bits",
    ],
    ["a profession without a name", { professions: { "164": { name: "" } } }, "Invalid professions"],
    [
      "a noSpecialization other than true",
      { professions: { "164": { name: "Blacksmithing", noSpecialization: false } } },
      "Invalid professions",
    ],
    ["no standings", { standings: [] }, "Invalid standings"],
    [
      "standings out of order",
      {
        standings: [
          { name: "Neutral", min: 0 },
          { name: "Unfriendly", min: -3000 },
        ],
      },
      "Invalid standings",
    ],
    [
      "two standings with one name",
      {
        standings: [
          { name: "Neutral", min: 0 },
          { name: "Neutral", min: 3000 },
        ],
      },
      "Invalid standings",
    ],
    ["XP for 58 levels below maxLevel 60", { xpToNextLevel: ruleTables.xpToNextLevel.slice(1) }, "Invalid XP to next level"],
    ["XP of 0 to leave a level", { xpToNextLevel: [0, ...ruleTables.xpToNextLevel.slice(1)] }, "Invalid XP to next level"],
    [
      "a quest skill that is not a profession",
      { ...ruleTables, professions: { "9787": { name: "Weaponsmith" } } },
      "Invalid quest 5305 profession reference",
    ],
    [
      "a faction specialization that is not a profession",
      { ...ruleTables, professions: { "164": { name: "Blacksmithing" } } },
      "Invalid quest 5305 profession reference",
    ],
  ])("rejects rule tables with %s", (_, tables, message) => {
    expect(() => validateCompleteGameData({ ...withSkills(164, 9787), ...tables })).toThrow(message);
  });

  const startingTables = {
    flightNodes: gameTables.flightNodes,
    races: {
      "1": { fileName: "Human", faction: "Alliance", startingFlightNodes: [32, 80] },
      "95": { fileName: "Skyborne", faction: "Alliance", startingFlightNodes: [] },
      "96": { fileName: "Skyborne", faction: "Horde", startingFlightNodes: [25] },
    },
  } satisfies Partial<GameDataFile>;
  const humanStarts = (startingFlightNodes: number[]) => ({
    ...startingTables,
    races: { ...startingTables.races, "1": { fileName: "Human", faction: "Alliance", startingFlightNodes } },
  });

  it("keeps the starting flight nodes of each race, an empty list included", async () => {
    const file = { ...fixture(), ...startingTables };
    const before = JSON.stringify(file);
    const decoded = await roundTrip(file);
    expect(decoded.races).toStrictEqual(startingTables.races);
    expect(JSON.stringify(decoded)).toBe(before);
  });

  it.each([
    ["an unknown flight node", humanStarts([32, 99]), "Invalid race starting flight node reference"],
    ["a flight node of the other faction", humanStarts([25, 32]), "Invalid race starting flight node reference"],
    ["descending flight nodes", humanStarts([80, 32]), "Invalid race starting flight nodes"],
    ["a repeated flight node", humanStarts([32, 32]), "Invalid race starting flight nodes"],
    [
      "no flightNodes table",
      { flightNodes: undefined, races: { "95": startingTables.races["95"] } },
      "Invalid race starting flight node reference",
    ],
  ])("rejects starting flight nodes with %s", (_, tables, message) => {
    expect(() => validateCompleteGameData({ ...fixture(), ...tables })).toThrow(message);
  });

  it("keeps an NPC record without provenance", async () => {
    const file = { ...fixture(), npcs: { "69": { levels: { min: 2, max: 2 } } } };
    const before = JSON.stringify(file);
    const decoded = await roundTrip(file);
    expect(decoded.npcs).toStrictEqual({ "69": { levels: { min: 2, max: 2 } } });
    expect(JSON.stringify(decoded)).toBe(before);
  });

  it.each([[null], ["custom:era"], [1], [[]]])("rejects NPC record provenance %j", (provenance) => {
    expect(() => validateCompleteGameData({ ...fixture(), npcs: { "69": { provenance } } })).toThrow(/NPC 69: invalid provenance/);
  });

  const withDropper = (extra: Record<string, unknown>): GameDataFile => ({
    ...fixture(),
    droppers: {
      "750": [
        { type: "npc", id: 69, ...extra },
        { type: "npc", id: 299 },
      ],
      "3713": { byFaction: { Alliance: [{ type: "npc", id: 2381, ...extra }], Horde: [{ type: "npc", id: 2397 }] } },
    },
  });

  it("keeps a dropper's chance and its absence", async () => {
    const file = withDropper({ chance: 0.669 });
    const before = JSON.stringify(file);
    const decoded = await roundTrip(file);
    expect(JSON.stringify(decoded)).toBe(before);
    expect(decoded.droppers).toStrictEqual({
      "750": [
        { type: "npc", id: 69, chance: 0.669 },
        { type: "npc", id: 299 },
      ],
      "3713": {
        byFaction: { Alliance: [{ type: "npc", id: 2381, chance: 0.669 }], Horde: [{ type: "npc", id: 2397 }] },
      },
    });
  });

  it.each([0.42, 1, 0.0001])("accepts a dropper chance of %j", (chance) => {
    expect(() => validateCompleteGameData(withDropper({ chance }))).not.toThrow();
  });

  it.each([0, -0.1, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.5", null, []])("rejects a dropper chance of %j", (chance) => {
    expect(() => validateCompleteGameData(withDropper({ chance }))).toThrow(/Invalid item droppers/);
  });

  it.each([{ loot: { count: 6690, outof: 10000 } }, { count: 6690 }, { outof: 10000 }])(
    "rejects a dropper that carries loot counts %j beside its chance",
    (counts) => {
      expect(() => validateCompleteGameData(withDropper({ chance: 0.669, ...counts }))).toThrow(/Invalid item droppers/);
    },
  );

  const confirmed = (guid: number, x = 131.632) => ({ world: { instance: 0, x, y: -9797.38 }, z: 24.4919, guid });
  const place = (x: number, y = -9800) => ({ world: { instance: 0, x, y } });
  const withSpawns = (spawns: unknown): GameDataFile => ({
    ...fixture(),
    npcs: {
      "6": { levels: { min: 1, max: 2 }, provenance: { fields: {} } },
      "40": { spawns, provenance: { fields: { spawns: { source: "custom:era" } } } } as NonNullable<GameDataFile["npcs"]>[string],
    },
  });

  it("keeps an NPC's spawn list and its absence", async () => {
    const spawns = [{ ...confirmed(80604), interior: "fargodeep-mine-210351" }, confirmed(80605), place(120, -9810), place(120, -9805)];
    const decoded = await roundTrip(withSpawns(spawns));
    expect(decoded.npcs).toStrictEqual(withSpawns(spawns).npcs);
    expect(decoded.npcs?.["40"]?.spawns).toStrictEqual([
      { world: { instance: 0, x: 131.632, y: -9797.38 }, z: 24.4919, guid: 80604, interior: "fargodeep-mine-210351" },
      { world: { instance: 0, x: 131.632, y: -9797.38 }, z: 24.4919, guid: 80605 },
      { world: { instance: 0, x: 120, y: -9810 } },
      { world: { instance: 0, x: 120, y: -9805 } },
    ]);
    expect(decoded.npcs?.["6"]).toStrictEqual({ levels: { min: 1, max: 2 }, provenance: { fields: {} } });
  });

  it.each([
    ["an empty list", []],
    ["only places", [place(120)]],
    ["a place before a confirmed spawn", [place(120), confirmed(80604)]],
    ["a repeated guid", [confirmed(80604), confirmed(80604)]],
    ["guids out of order", [confirmed(80605), confirmed(80604)]],
    ["a guid of 0", [confirmed(0)]],
    ["a fractional guid", [confirmed(80604.5)]],
    ["a confirmed spawn without a height", [{ world: { instance: 0, x: 131.632, y: -9797.38 }, guid: 80604 }]],
    ["a height that is not finite", [{ ...confirmed(80604), z: null }]],
    ["an empty interior", [{ ...confirmed(80604), interior: "" }]],
    ["a world without an instance", [{ world: { x: 131.632, y: -9797.38 }, z: 24.4919, guid: 80604 }]],
    ["a place with a height", [confirmed(80604), { ...place(120), z: 24.4919 }]],
    ["a place with an interior", [confirmed(80604), { ...place(120), interior: "fargodeep-mine-210351" }]],
    ["places out of order by x", [confirmed(80604), place(121), place(120)]],
    ["places out of order by y", [confirmed(80604), place(120, -9799), place(120, -9800)]],
    ["a repeated place", [confirmed(80604), place(120), place(120)]],
  ])("rejects a spawn list with %s", (_, spawns) => {
    expect(() => validateCompleteGameData(withSpawns(spawns))).toThrow(/Invalid NPC records/);
  });

  it("types a partial producer file only as far as its checks go", () => {
    const file: unknown = { ...fixture(), quests: [{ id: "not-a-number", name: 42 }] };
    validateGameDataFile(file);
    expectTypeOf(file.quests[0]!.name).toBeUnknown();
    expect(() => validateCompleteGameData(file)).toThrow("Invalid quest not-a-number fields");
  });

  it("leaves zone and continent entries unknown, since the partial check accepts primitives", () => {
    const file: unknown = { ...fixture(), zones: [7], continents: [false] };
    validateGameDataFile(file);
    expectTypeOf(file.zones).toEqualTypeOf<unknown[]>();
    expectTypeOf(file.continents).toEqualTypeOf<unknown[]>();
    expect([file.zones, file.continents]).toStrictEqual([[7], [false]]);
    expect(() => validateCompleteGameData(file)).toThrow("Invalid zone undefined");
  });

  it("rejects a second row for one quest", () => {
    const file = fixture();
    file.quests.push(structuredClone(file.quests[0]!));
    expect(() => validateGameDataFile(file)).toThrow(/Quest 91904 has two rows/);
  });
});
