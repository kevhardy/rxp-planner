import { describe, expect, it } from "vitest";
import { EntityIndex, FlightNodes, GameData, type QuestPoint, type QuestRow, type WorldLocation } from "../data/index.ts";
import { northshireFile, northshireNames } from "../data/northshireFixture.ts";
import { plannerContext, plannerData, zonePoint, ZONES } from "../data/plannerFixture.ts";
import { parseGuide } from "../guide/index.ts";
import { findOpportunities, opportunityData, type ObjectiveArea, type OpportunityData, type Spawn } from "./opportunities.ts";
import { createProfile } from "./profile.ts";
import { simData } from "./simData.ts";
import { simulateRoute, type SimData, type SimNumberedObjective, type SimQuest } from "./simulate.ts";
import { simQuest, testRules } from "./testing.ts";

const at = (x: number, y: number, zoneId = 40, npc?: number): Spawn => ({
  zoneId,
  world: { instance: 0, x: 774.55 + x, y: -9869.39 - y },
  ...(npc && { npc }),
});
const objective = (kind: SimNumberedObjective["kind"], count: number, name: string, index = 1): SimNumberedObjective => ({
  index,
  kind,
  ids: [],
  count,
  name,
});

const quests: Record<number, Partial<SimQuest> & Pick<SimQuest, "name">> = {
  12: { name: "The People's Militia", level: 12, objectives: [objective("monster", 15, "Defias Trapper")] },
  38: { name: "Westfall Stew", level: 13, objectives: [objective("item", 3, "Murloc Eye", 2)] },
  13: { name: "The People's Militia", level: 14, objectives: [objective("monster", 15, "Defias Pillager")] },
  151: { name: "Poor Old Blanchy", level: 14, objectives: [objective("item", 8, "Handful of Oats")] },
  9: { name: "The Killing Fields", level: 15, objectives: [objective("monster", 20, "Harvest Watcher")] },
  52: { name: "Protect the Frontier", level: 10, objectives: [objective("monster", 5, "Young Forest Bear", 2)] },
};
const spawns: Record<number, { kind: ObjectiveArea["kind"]; spawns: Spawn[] }> = {
  12: { kind: "kill", spawns: [at(0, 0, 40, 504), at(10, 0, 40, 504), at(0, 145, 40, 504), at(900, 900, 40, 504)] },
  38: { kind: "drop", spawns: [at(50, 0, 40, 126)] },
  13: { kind: "kill", spawns: [at(1000, 0, 40, 589)] },
  151: { kind: "object", spawns: [at(0, 30), at(500, 0)] },
  9: { kind: "kill", spawns: [at(0, 60, 40, 114)] },
  52: { kind: "kill", spawns: [at(-90, 0, 12, 822)] },
};
const places: Record<string, WorldLocation> = {
  "Westfall,64.06,20.12": at(0, 0).world,
  "Stormwind City,66.27,62.13": { instance: 0, x: 478.62, y: -8832.77 },
};
const names: Record<number, string> = { 504: "Defias Trapper", 126: "Murloc Coastrunner", 114: "Harvest Watcher" };

function data(): OpportunityData & SimData {
  const quest = (id: number) => quests[id] && simQuest(quests[id]);
  return {
    quest,
    npc: () => undefined,
    item: () => undefined,
    rules: testRules,
    entityByName: () => undefined,
    flights: new FlightNodes(),
    uiMapNamed: () => undefined,
    locateGoto: (args) => places[args.join(",")],
    areas: (id) => (spawns[id] ? [{ ref: { questId: id, row: 0 }, name: quest(id)!.objectives[0]!.name, ...spawns[id] }] : []),
    questsInZone: (zoneId) => (zoneId === 40 ? [12, 38, 13, 151, 9] : [52]),
    npcName: (id) => names[id],
    giverName: (id) => (id === 151 ? "Verna Furlbrow" : undefined),
  };
}

const guide = `#group G
#name A
step
.accept 12
.accept 38
.accept 13
.accept 9
.accept 52
step
#completewith next
.complete 9,1
step
.goto Westfall,64.06,20.12
.complete 12,1
step
.goto Stormwind City,66.27,62.13
.collect 730,3,38
step
.complete 38,2
`;

function run(text = guide, game = data()) {
  const docs = [parseGuide(text)];
  const profile = createProfile({ race: "Human", class: "WARRIOR", level: 10 });
  return findOpportunities(docs, simulateRoute(docs, 0, profile, game), profile, game);
}

describe("findOpportunities", () => {
  it("ranks other objectives near a step's area, with RXP text to paste", () => {
    const [trappers] = run();
    expect(trappers).toEqual({
      guide: 0,
      step: 2,
      zoneId: 40,
      points: 3,
      opportunities: [
        {
          questId: 38,
          objective: { row: 0, index: 2, name: "Murloc Eye" },
          kind: "drop",
          source: "log",
          distanceYards: 40,
          overlapShare: 0.67,
          remaining: 3,
          mobs: [126],
          covered: false,
          plannedStep: 4,
          suggestion: [
            "step",
            "    #completewith next",
            "    >>Kill Murloc Coastrunner as you go. Loot them for Murloc Eye",
            "    .complete 38,2 --Murloc Eye (3)",
            "    .mob Murloc Coastrunner",
          ].join("\n"),
        },
        {
          questId: 151,
          objective: { row: 0, index: 1, name: "Handful of Oats" },
          kind: "object",
          source: "pickup",
          distanceYards: 30,
          overlapShare: 0.67,
          remaining: 8,
          mobs: [],
          covered: false,
          plannedStep: null,
          suggestion: ">>Pick up Poor Old Blanchy (151) from Verna Furlbrow. Loot Handful of Oats as you go",
        },
        {
          questId: 9,
          objective: { row: 0, index: 1, name: "Harvest Watcher" },
          kind: "kill",
          source: "log",
          distanceYards: 60,
          overlapShare: 1,
          remaining: 20,
          mobs: [114],
          covered: true,
          plannedStep: null,
          suggestion: [
            "step",
            "    #completewith next",
            "    >>Kill Harvest Watcher as you go",
            "    .complete 9,1 --Harvest Watcher (20)",
            "    .mob Harvest Watcher",
          ].join("\n"),
        },
      ],
    });
  });

  it("numbers a text-row opportunity by page order", () => {
    const base = data();
    const stew = simQuest({
      name: "Westfall Stew",
      level: 13,
      objectives: [
        { kind: "text", name: "Murloc Fin", count: 2, need: "kills" },
        { kind: "text", name: "Murloc Eye", count: 3, need: "kills" },
      ],
    });
    const text: typeof base = {
      ...base,
      quest: (id) => (id === 38 ? stew : base.quest(id)),
      areas: (id) => (id === 38 ? [{ ref: { questId: 38, row: 1 }, name: "Murloc Eye", ...spawns[38]! }] : base.areas(id)),
    };
    const docs = [parseGuide(guide)];
    const profile = createProfile({ race: "Human", class: "WARRIOR", level: 10 });
    const [trappers] = findOpportunities(docs, simulateRoute(docs, 0, profile, text), profile, text);
    expect(trappers!.opportunities[0]).toMatchObject({
      questId: 38,
      objective: { row: 1, index: 2, name: "Murloc Eye" },
      remaining: 3,
      suggestion: expect.stringContaining(".complete 38,2 --Murloc Eye (3)"),
    });
  });

  it("offers no pickup of a quest turned in without an accept", () => {
    const base = data();
    const donation: typeof base = { ...base, quest: (id) => (id === 151 ? { ...base.quest(id)!, acceptOnTurnIn: true } : base.quest(id)) };
    const docs = [parseGuide(guide)];
    const profile = createProfile({ race: "Human", class: "WARRIOR", level: 10 });
    const [trappers] = findOpportunities(docs, simulateRoute(docs, 0, profile, donation), profile, donation);
    expect(trappers!.opportunities.map((o) => o.questId)).toEqual([38, 9]);
  });

  it("skips a step done away from its objectives' spawns and one that is itself as you go", () => {
    expect(run().map((s) => s.step)).toEqual([2, 4]);
  });

  const killingFields = (sticky: string, later: string) =>
    run(`#group G
#name A
step
.accept 12
.accept 9
step
#sticky
${sticky}
step
.goto Westfall,64.06,20.12
${later}
step
.goto Westfall,64.06,20.12
.complete 9,1
`)
      .find((s) => s.step === 3)!
      .opportunities.map((o) => [`${o.questId},${o.objective.index}`, o.covered]);

  it("ends a #sticky step's cover of an objective once a later step completes it", () => {
    expect(killingFields(".complete 12,1", ".complete 12,1")).toEqual([
      ["151,1", false],
      ["38,2", false],
    ]);
  });

  // `addon.UpdateStepCompletion` in GuideWindow.lua keeps a #sticky step active until each of its lines is done, and
  // `addon.UpdateQuestCompletionData` in functions.lua ends a `.complete` line at its own count. The sticky line needs
  // all 15 kills, so a later line that needs 5 leaves it active.
  it("keeps a #sticky step's cover when a later step needs fewer of the objective", () => {
    expect(killingFields(".complete 12,1", ".complete 12,1,5")).toEqual([
      ["151,1", false],
      ["38,2", false],
      ["12,1", true],
    ]);
  });

  // `addon.UpdateQuestCompletionData` in functions.lua caps a line's count at the objective's 15 kills.
  it("ends a #sticky step's cover of an objective at the objective's count when its line asks for more", () => {
    expect(killingFields(".complete 12,1,20", ".complete 12,1")).toEqual([
      ["151,1", false],
      ["38,2", false],
    ]);
  });

  // `addon.functions.collect` in functions.lua ends a `.collect` line at its own quantity, so the later line is done at
  // 1 Murloc Eye and the sticky line that needs all 3 stays active.
  it("keeps a #sticky step's cover when a later .collect line needs fewer of the objective", () => {
    const base = data();
    const stew = simQuest({ ...quests[38]!, objectives: [{ ...objective("item", 3, "Murloc Eye", 2), ids: [730] }] });
    const found = run(
      `#group G
#name A
step
.accept 38
.accept 9
step
#sticky
.complete 38,2
step
.goto Westfall,64.06,20.12
.collect 730,1,38,2
step
.goto Westfall,64.06,20.12
.complete 9,1
`,
      { ...base, quest: (id) => (id === 38 ? stew : base.quest(id)) },
    );
    expect(found.find((s) => s.step === 3)!.opportunities.find((o) => o.questId === 38)).toMatchObject({
      covered: true,
      remaining: 3,
    });
  });
});

describe("opportunityData", () => {
  it("places an objective at its mobs, or at its items on the ground", () => {
    const game = plannerData();
    const sim: Pick<SimData, "quest"> = {
      quest: (id) =>
        ({
          183: simQuest({
            name: "The Boar Hunter",
            objectives: [{ index: 1, kind: "monster", ids: [708], count: 12, name: "Small Crag Boar" }],
          }),
          3904: simQuest({
            name: "Milly's Harvest",
            objectives: [{ index: 1, kind: "item", ids: [11119], count: 8, name: "Milly's Harvest" }],
          }),
        })[id],
    };
    const lookup = opportunityData(game, sim as SimData, "Alliance");
    const placed = (id: number) => lookup.areas(id).map((a) => ({ ...a, spawns: a.spawns.map((p) => [p.zoneId, p.npc]) }));
    expect(placed(183)).toEqual([{ ref: { questId: 183, row: 0 }, kind: "kill", name: "Small Crag Boar", spawns: [[1, 708]] }]);
    expect(placed(3904)).toEqual([{ ref: { questId: 3904, row: 0 }, kind: "object", name: "Milly's Harvest", spawns: [[12, undefined]] }]);
    expect(lookup.questsInZone(12)).toContain(3904);
  });

  const wolfMeat = (quest: Partial<QuestRow>) => {
    const file = northshireFile();
    const game = new GameData({ ...file, quests: file.quests.map((q) => (q.id === 33 ? { ...q, ...quest } : q)) }, plannerContext);
    return opportunityData(game, simData(game, new EntityIndex(northshireNames), "Alliance"), "Alliance").areas(33);
  };
  const point = (x: number, y: number, kind: string, sourceType: string, sourceId: number): QuestPoint =>
    zonePoint(ZONES.elwynn, x, y, { kind, sourceType, sourceId, sourceName: String(sourceId) });

  it("gives an objective no extra points, no other entity with its ID, and one spawn for close sightings", () => {
    const areas = wolfMeat({
      objectivePoints: [
        point(48.6, 39.6, "item", "npc", 299),
        point(48.6005, 39.6005, "item", "npc", 299),
        point(49, 38.8, "item", "npc", 69),
        point(60, 60, "extra", "npc", 299),
        point(62, 62, "mob", "npc", 69),
        point(30, 30, "item", "npc", 750),
        point(30.1, 30.1, "item", "object", 750),
      ],
    });
    expect(areas[0]!.spawns.map((s) => s.npc)).toEqual([299, 69]);
  });

  it("gives an object objective no spawns", () => {
    const areas = wolfMeat({
      objectives: [{ index: 1, type: "object", id: 4000, ids: [4000], name: "Crate" }],
      objectivePoints: [point(48.6, 39.6, "object", "object", 4000)],
    });
    expect(areas).toEqual([]);
  });
});
