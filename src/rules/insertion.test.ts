import { beforeAll, describe, expect, it } from "vitest";
import { FlightNodes, GameData, type EntityIndex, type QuestPoint, type QuestRow, type WorldLocation } from "../data/index.ts";
import { plannerContext, plannerData, questRow, zoneData, zonePoint, ZONES } from "../data/plannerFixture.ts";
import { insertStep, newStep, parseGuide, serializeGuide } from "../guide/index.ts";
import { createProfile } from "./profile.ts";
import { checkpointLine, simDirectives } from "./simComments.ts";
import { simData } from "./simData.ts";
import { simulateRoute, type QuestProgress, type SimData, type SimNpc, type SimQuest, type SimState } from "./simulate.ts";
import { simQuest, testRules } from "./testing.ts";
import { killXp, xpToNextLevel } from "./xp.ts";
import {
  grindEstimate,
  insertionState,
  objectiveInfo,
  suggestQuests,
  type ObjectiveSuggestion,
  type QuestSuggestion,
} from "./insertion.ts";

const warrior = createProfile({ race: "Human", class: "WARRIOR" });

function stubData(
  quests: Record<number, Partial<SimQuest> & Pick<SimQuest, "name">>,
  npcs: Record<number, SimNpc> = {},
  names: Record<string, number> = {},
): SimData {
  return {
    quest: (id) => quests[id] && simQuest(quests[id]),
    npc: (id) => npcs[id],
    item: () => undefined,
    rules: testRules,
    entityByName: (name) => {
      const id = names[name];
      return id === undefined ? undefined : { kind: "npc", id };
    },
    locateGoto: () => undefined,
    flights: new FlightNodes(),
    uiMapNamed: () => undefined,
  };
}

const guide = (name: string, text: string, header = "") => parseGuide(`#group G\n#name ${name}\n${header}${text}\n`);

describe("insertionState", () => {
  const docs = [
    guide("A", "step\n.accept 783\nstep << Mage\n.accept 7", "#next B\n"),
    guide("B", "step\n.accept 33", "-- @sim level=5\n-- @sim done=18\n"),
    guide("C", "step\n.accept 15"),
  ];
  const route = simulateRoute(
    docs,
    0,
    warrior,
    stubData({ 783: { name: "A Threat Within" }, 7: { name: "Kobold Camp Cleanup" }, 33: { name: "Wolves Across the Border" } }),
  );

  it("starts after the step it follows, and a skipped step passes its state on", () => {
    const [accept, skipped] = route.guides[0]!.steps;
    expect(skipped!.preview.shown).toBe(false);
    expect([...insertionState(route.guides[0], 0)!.log.keys()]).toEqual([783]);
    expect(insertionState(route.guides[0], 1)).toBe(accept!.state);
  });

  it("starts before the first step after the header's level= and done=, on a guide reached through #next", () => {
    const state = insertionState(route.guides[1], null)!;
    expect(state).toBe(route.guides[1]!.afterHeader);
    expect(state).toMatchObject({ level: 5, xp: 0 });
    expect(state.done.has(18)).toBe(true);
    expect([...state.log.keys()]).toEqual([783]);
  });

  it("starts at the end from the last step", () => {
    expect(insertionState(route.guides[1], 0)).toBe(route.guides[1]!.end);
    expect([...insertionState(route.guides[1], 0)!.log.keys()]).toEqual([783, 33]);
  });

  it("has no state without a simulation", () => {
    expect(insertionState(undefined, null)).toBeUndefined();
  });
});

describe("suggestQuests", () => {
  let data: GameData;
  let sim: SimData;
  let elwynn: { id: number; uiMapId: number };
  let durotar: { id: number; uiMapId: number };
  let barrens: { id: number; uiMapId: number };
  let stormwind: { id: number; uiMapId: number };
  let here: WorldLocation;

  const npcNames: Record<number, string> = {
    196: "Eagan Peltskinner",
    197: "Marshal McBride",
    822: "Young Forest Bear",
    823: "Deputy Willem",
    913: "Lyria Du Lac",
    3143: "Gornek",
    3391: "Gazlowe",
    14722: "Clavicus Knavingham",
    263399: "Sam Sarsaparilla",
  };
  const npc = (id: number, kind = "start"): Pick<QuestPoint, "kind" | "sourceType" | "sourceId" | "sourceName"> => ({
    kind,
    sourceType: "npc",
    sourceId: id,
    sourceName: npcNames[id]!,
  });
  const at = (x: number, giver: number, kind = "start") => zonePoint(elwynn, x, 60, npc(giver, kind));
  const gornek = () => zonePoint(durotar, 42, 68.4, npc(3143));
  const row = (id: number, name: string, level: number | null, fields: Partial<QuestRow> = {}) =>
    questRow(id, name, { zoneIds: [elwynn.id], questLevel: level, baseXp: level && 100 * level, ...fields });

  beforeAll(async () => {
    const forever = plannerData();
    elwynn = forever.zoneByName("Elwynn Forest") as typeof elwynn;
    durotar = forever.zoneByName("Durotar") as typeof durotar;
    barrens = forever.zoneByName("The Barrens") as typeof barrens;
    stormwind = forever.zoneByName("Stormwind City") as typeof stormwind;
    data = new GameData(
      {
        source: forever.source,
        maxLevel: forever.maxLevel,
        zones: [...forever.zones],
        continents: [...forever.continents],
        npcNames: {},
        sources: [...forever.sources],
        quests: [
          row(33, "Wolves Across the Border", 2, { endPoints: [at(41, 196, "turn-in")] }),
          row(52, "Protect the Frontier", 10, {
            requiredLevel: 7,
            objectives: [
              { index: 1, type: "monster", id: 118, ids: [118], name: "Prowler", count: 8 },
              { index: 2, type: "monster", id: 822, ids: [822], name: "Young Forest Bear", count: 5 },
            ],
            objectivePoints: [zonePoint(elwynn, 46, 60, npc(822, "mob"))],
          }),
          row(783, "A Threat Within", 1, { startPoints: [at(43, 823)] }),
          row(18, "Brotherhood of Thieves", 4, { startPoints: [at(70, 823)] }),
          row(1638, "A Warrior's Training", 10, { requiredLevel: 10, startPoints: [at(50, 913)] }),
          row(54, "Report to Goldshire", 5, { preQuestSingle: [21], startPoints: [at(55, 197)] }),
          row(887, "Southsea Freebooters", 14, {
            requiredLevel: 9,
            zoneIds: [barrens.id],
            startPoints: [zonePoint(barrens, 62.6, 36.2, npc(3391))],
          }),
          row(96045, "Camping 101: Alchemy", 6, { zoneIds: [1537] }),
          row(3104, "Glyphic Letter", 1, { requiredClassMask: 128, startPoints: [at(44, 197)] }),
          row(7791, "A Donation of Wool", 60, {
            types: ["city-donation"],
            zoneIds: [stormwind.id],
            startPoints: [zonePoint(stormwind, 44.27, 73.99, npc(14722))],
          }),
          row(98372, "An Unfortunate End", null),
          row(2383, "Simple Parchment", 1, { requiredRaceMask: 2, zoneIds: [durotar.id], startPoints: [gornek()] }),
          row(788, "Cutting Teeth", 2, { requiredFaction: "Horde", zoneIds: [durotar.id], startPoints: [gornek()] }),
          row(97915, "Camping 101: Alchemy", 6, { requiredLevel: 4, exclusiveTo: [96045], startPoints: [at(60, 263399)] }),
        ],
      },
      plannerContext,
    );
    sim = simData(data, {} as EntityIndex, "Alliance");
    here = zonePoint(elwynn, 40, 60, npc(196)).world;
  });

  const progress = (status: QuestProgress["status"], objectives: boolean[]): QuestProgress => ({
    status,
    objectives: objectives.map((complete) => ({ count: complete ? 1 : 0, complete })),
  });
  const state = (): SimState => ({
    level: 5,
    xp: 0,
    position: here,
    log: new Map([
      [33, progress("complete", [])],
      [52, progress("partial", [true, false])],
    ]),
    done: new Set([96045]),
    bind: null,
    flightPaths: new Set(),
  });
  const ids = (list: QuestSuggestion[]) => list.map((s) => s.questId);

  it("lists ready turn-ins, open objectives, and quests to accept, with XP at the state's level", () => {
    const list = suggestQuests(state(), data, sim, warrior);
    expect(list.find((s) => s.kind === "turnin")).toMatchObject({ questId: 33, name: "Wolves Across the Border", xp: 200 });
    expect(list.filter((s) => s.kind === "objective")).toEqual([
      expect.objectContaining({ questId: 52, objective: { row: 1, name: "Young Forest Bear", index: 2 } }),
    ]);
    expect(ids(list.filter((s) => s.kind === "accept")).sort((a, b) => a - b)).toEqual([18, 54, 783, 1638, 97915, 98372]);
    expect(list.find((s) => s.questId === 783)!.xp).toBe(100);
    expect(list.find((s) => s.questId === 98372)!.xp).toBeNull();
  });

  it("numbers a text-row objective by page order", () => {
    const textRows = simQuest({
      name: "Text Rows",
      zoneIds: [elwynn.id],
      objectives: [
        { kind: "text", name: "Prowler slain", count: 1, need: "kills" },
        { kind: "text", name: "Young Forest Bear slain", count: 2, need: "kills" },
      ],
    });
    const rows: SimData = { ...sim, quest: (id) => (id === 99 ? textRows : sim.quest(id)) };
    const log = new Map<number, QuestProgress>([
      [
        99,
        {
          status: "partial",
          objectives: [
            { count: 1, complete: true },
            { count: 0, complete: false },
          ],
        },
      ],
    ]);
    const objectives = suggestQuests({ ...state(), log }, data, rows, warrior).filter((s) => s.kind === "objective");
    expect(objectives.map((s) => s.objective)).toEqual([{ row: 1, name: "Young Forest Bear slain", index: 2 }]);
  });

  it("places a text-row objective at its item's droppers, not at extra points", () => {
    const point = (x: number, kind: string, sourceType: string, sourceId: number, sourceName: string) =>
      zonePoint(ZONES.elwynn, x, 40, { kind, sourceType, sourceId, sourceName });
    const dropper = point(48, "item", "npc", 299, "Young Wolf");
    const meat = zoneData(
      [
        questRow(33, "Wolves Across the Border", {
          zoneIds: [ZONES.elwynn.id],
          textObjectives: [{ name: "Tough Wolf Meat", count: 8, need: "kills", link: { kind: "item", id: 750 } }],
          objectivePoints: [dropper, point(70, "extra", "item", 750, "Tough Wolf Meat")],
        }),
      ],
      { droppers: { "750": [{ type: "npc", id: 299 }] } },
    );
    const position = point(40, "start", "npc", 196, "Eagan Peltskinner").world;
    const log = new Map([[33, progress("partial", [false])]]);
    const list = suggestQuests({ ...state(), position, log }, meat, simData(meat, {} as EntityIndex, "Alliance"), warrior);
    expect(list.find((s) => s.kind === "objective")?.location).toEqual(dropper.world);
  });

  it("returns quests the character cannot accept yet as locked, with the reasons", () => {
    const list = suggestQuests(state(), data, sim, warrior);
    expect(list.find((s) => s.questId === 1638)).toEqual(
      expect.objectContaining({ kind: "accept", locked: [{ kind: "level", requiredLevel: 10 }] }),
    );
    expect(list.find((s) => s.questId === 54)).toEqual(
      expect.objectContaining({ kind: "accept", locked: [{ kind: "prerequisite", allOf: [], anyOf: [21] }] }),
    );
    expect(list.find((s) => s.questId === 97915)).toEqual(
      expect.objectContaining({ kind: "accept", locked: [{ kind: "exclusive", quests: [96045] }] }),
    );
    expect(list.find((s) => s.questId === 783)).toMatchObject({ kind: "accept" });
    expect(list.find((s) => s.questId === 783)).not.toHaveProperty("locked");
  });

  it("marks a missing prerequisite on any row, including a quest already in the log", () => {
    const list = suggestQuests(state(), data, sim, warrior);
    expect(list.find((s) => s.questId === 54)!.prerequisiteMissing).toBe(true);
    expect(list.find((s) => s.questId === 783)!.prerequisiteMissing).toBe(false);
    const logged = { ...state(), log: new Map([[54, progress("complete", [])]]) };
    const turnin = suggestQuests(logged, data, sim, warrior).find((s) => s.questId === 54)!;
    expect(turnin).toMatchObject({ kind: "turnin", prerequisiteMissing: true });
    expect(turnin).not.toHaveProperty("locked");
  });

  it("keeps the current zone by default, nearest first, and others last in every zone", () => {
    expect(ids(suggestQuests(state(), data, sim, warrior))).toEqual([33, 783, 52, 1638, 54, 97915, 18, 98372]);
    const all = suggestQuests(state(), data, sim, warrior, { zone: null });
    expect(ids(all)).toEqual([33, 783, 52, 1638, 54, 97915, 18, 98372, 887]);
    expect(all.find((s) => s.questId === 887)).toMatchObject({ distance: null, location: expect.objectContaining({ instance: 1 }) });
    expect(ids(suggestQuests(state(), data, sim, warrior, { zone: barrens.id }))).toEqual([887]);
  });

  it("sorts by quest level or XP instead", () => {
    expect(ids(suggestQuests(state(), data, sim, warrior, { sort: "level" }))).toEqual([783, 33, 18, 54, 97915, 52, 1638, 98372]);
    expect(ids(suggestQuests(state(), data, sim, warrior, { sort: "xp" }))).toEqual([52, 1638, 97915, 54, 18, 33, 783, 98372]);
  });

  it("leaves out quests that a header done= across #next turns in", () => {
    const docs = [guide("A", "step\n.accept 33\n.accept 52", "#next B\n"), guide("B", "step\n.accept 783", "-- @sim done=33,52\n")];
    const at = insertionState(simulateRoute(docs, 0, { ...warrior, level: 5 }, sim).guides[1], null)!;
    expect(ids(suggestQuests(at, data, sim, warrior, { zone: null })).filter((id) => id === 33 || id === 52)).toEqual([]);
  });
});

describe("objectiveInfo", () => {
  const undead = createProfile({ race: "Scourge", class: "WARRIOR" });
  const objective = (index: number, kind: "monster" | "item", ids: number[], count: number, name: string) => ({
    index,
    kind,
    ids,
    count,
    name,
  });
  const objectives = [
    objective(1, "monster", [1941], 6, "Rot Hide Graverobber"),
    objective(2, "item", [2834], 3, "Embalming Ichor"),
    objective(3, "monster", [1941, 1675], 2, "Rot Hide Mongrel"),
    { ...objective(4, "monster", [1941], 1, "Rot Hide Graverobber"), need: "action" as const },
    { ...objective(5, "item", [2834], 1, "Embalming Ichor"), need: "providedItem" as const },
  ];
  const mob = (min: number, max: number, zoneIds = [85]) => ({ levels: { min, max }, elite: false, zoneIds });
  const data = (items: Record<number, { sold?: boolean; objectsOnly?: boolean }> = {}): SimData => ({
    ...stubData(
      {
        358: { name: "Graverobbers", zoneIds: [85], objectives },
      },
      { 1941: mob(6, 7), 1675: mob(7, 8, [28, 85]) },
    ),
    item: (id) => items[id] && { droppers: [{ id: 1941 }, { id: 1675 }], sold: false, objectsOnly: false, ...items[id] },
  });
  const suggestion = (row: number) =>
    ({ kind: "objective", questId: 358, objective: { row, name: objectives[row]!.name, index: 1 } }) as ObjectiveSuggestion;
  const at = (lines: string, sim = data()) =>
    insertionState(simulateRoute([guide("A", `step\n.accept 358\n${lines}`)], 0, undead, sim).guides[0], 0)!;
  const info = (lines: string, row: number, sim = data()) => objectiveInfo(at(lines, sim), sim, suggestion(row), 1);

  it("gives the target and the kills a new .complete line counts", () => {
    expect(info("", 0)).toEqual({ target: { kind: "npc", id: 1941 }, need: { kind: "kills", kills: 6, mobs: [1941], drops: false } });
    expect(info("", 1, data({ 2834: {} }))).toEqual({
      target: { kind: "item", id: 2834 },
      need: { kind: "kills", kills: 6, mobs: [1941, 1675], drops: true },
    });
    expect(info("", 2)).toEqual({ need: expect.objectContaining({ mobs: [1941, 1675] }) });
  });

  it("leaves the kills earlier lines counted, and continues their mobs", () => {
    expect(info(".complete 358,1,2", 0).need).toMatchObject({ kills: 4, mobs: [1941] });
    expect(info(".complete 358,1,1 -- @sim kills=4", 0).need).toMatchObject({ kills: 2 });
    expect(info(".complete 358,3,1 -- @sim mob=1675", 2).need).toMatchObject({ kills: 1, mobs: [1675] });
    expect(info(".complete 358,2,1", 1, data({ 2834: {} })).need).toMatchObject({ kills: 4, mobs: [1941, 1675] });
  });

  it("keeps the rounding offset from earlier chance overrides", () => {
    expect(info(".complete 358,2,1 -- @sim drop=0.7", 1, data({ 2834: {} })).need).toMatchObject({ kills: 4, mobs: [1941, 1675] });
  });

  it("names the target of an objective that needs no kills", () => {
    expect(info("", 3)).toEqual({ target: { kind: "npc", id: 1941 } });
    expect(info("", 4, data({ 2834: {} }))).toEqual({ target: { kind: "item", id: 2834 } });
  });

  it("needs a drop for each member's item in a duo, and the same kills of a monster", () => {
    const items = data({ 2834: {} });
    const duo = (row: number, lines = "") => {
      const g = simulateRoute([guide("A", `-- @sim party=2\nstep\n.accept 358\n${lines}`)], 0, undead, items).guides[0]!;
      return objectiveInfo(insertionState(g, 0)!, items, suggestion(row), g.party).need;
    };
    expect([info("", 0, items).need, info("", 1, items).need]).toMatchObject([{ kills: 6 }, { kills: 6 }]);
    expect([duo(0), duo(1)]).toMatchObject([{ kills: 6 }, { kills: 12 }]);
    expect(duo(1, ".complete 358,2,1")).toMatchObject({ kills: 8 });
    expect(duo(1, ".complete 358,2,1 -- @sim drop=0.8")).toMatchObject({ kills: 8 });
  });

  it("needs no kills for an item NPCs sell or only objects give", () => {
    expect(info("", 1, data({ 2834: { sold: true } })).need).toEqual({ kind: "bought" });
    expect(info("", 1, data({ 2834: { objectsOnly: true } })).need).toEqual({ kind: "gathered" });
  });
});

describe("grindEstimate", () => {
  const data = stubData(
    {},
    { 525: { levels: { min: 5, max: 6 }, elite: false, zoneIds: [12] }, 299: { levels: { min: 1, max: 1 }, elite: false, zoneIds: [12] } },
    { "Mangy Wolf": 525 },
  );

  it("gives XP per kill, XP needed, and the kills the simulator counts for the same target", () => {
    const estimate = grindEstimate({ level: 5, xp: 100 }, { kind: "level", level: 6 }, 525, data);
    expect(estimate.xpNeeded).toBe(xpToNextLevel(testRules, 5) - 100);
    expect(estimate.xpPerKill).toEqual({ min: killXp(5, 5, false), max: killXp(5, 6, false) });
    const route = simulateRoute([guide("A", "step\n    .mob Mangy Wolf\n    .xp 6")], 0, { ...warrior, level: 5 }, data, 100);
    expect(estimate.kills).toBe(route.guides[0]!.steps[0]!.checkpoints[0]!.kills!.count);
  });

  it("needs no kills once the target is reached, and has no count for a gray mob", () => {
    expect(grindEstimate({ level: 6, xp: 0 }, { kind: "level", level: 6 }, 525, data)).toMatchObject({ xpNeeded: 0, kills: 0 });
    expect(grindEstimate({ level: 20, xp: 0 }, { kind: "level", level: 21 }, 299, data)).toMatchObject({
      xpPerKill: { min: 0, max: 0 },
      kills: null,
    });
  });
});

describe("checkpointLine", () => {
  it("writes a level= checkpoint the simulator reads back as the state", () => {
    let doc = guide("A", "step\n    .accept 783");
    doc = insertStep(doc, 1, { ...newStep(), body: [checkpointLine({ kind: "plus", level: 7, xp: 1234 }, "    ")] });
    expect(serializeGuide(doc)).toBe("#group G\n#name A\nstep\n    .accept 783\nstep\n    -- @sim level=7+1234\n");
    expect(simDirectives(doc, 0).directives).toMatchObject([{ key: "level", target: { kind: "plus", level: 7, xp: 1234 } }]);
    expect(simulateRoute([doc], 0, warrior, stubData({ 783: { name: "A Threat Within" } })).guides[0]!.end).toMatchObject({
      level: 7,
      xp: 1234,
    });
    expect(checkpointLine({ kind: "level", level: 7 }, "").comment).toBe(" @sim level=7");
  });
});
