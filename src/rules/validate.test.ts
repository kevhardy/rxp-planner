import { describe, expect, it } from "vitest";
import { FlightNodes } from "../data/index.ts";
import { parseGuide } from "../guide/index.ts";
import { previewRoute } from "./preview.ts";
import { createProfile } from "./profile.ts";
import { simulateRoute, type SimData, type SimStart } from "./simulate.ts";
import { simQuest, testRules } from "./testing.ts";
import { QUEST_LOG_SIZE, validateRoute, validateSimulation, type QuestInfo, type Warning } from "./validate.ts";

const humanWarrior = createProfile({ race: "Human", class: "WARRIOR", level: 10 });

const logIds = Array.from({ length: QUEST_LOG_SIZE + 2 }, (_, i) => 1001 + i);
const accepts = (n: number) =>
  logIds
    .slice(0, n)
    .map((id) => `.accept ${id}`)
    .join("\n");

const quests = new Map<number, QuestInfo>([
  ...logIds.map((id): [number, QuestInfo] => [id, { name: `Quest ${id}`, preAny: [], preAll: [], exclusiveTo: [] }]),
  [47, { name: "Gold Dust Exchange", preAny: [], preAll: [], exclusiveTo: [] }],
  [48, { name: "Sweet Amber", preAny: [], preAll: [], exclusiveTo: [] }],
  [52, { name: "Protect the Frontier", preAny: [], preAll: [], exclusiveTo: [] }],
  [56, { name: "The Night Watch", preAny: [], preAll: [], exclusiveTo: [] }],
  [60, { name: "Kobold Candles", preAny: [], preAll: [], exclusiveTo: [] }],
  [2500, { name: "Badlands Reagent Run", preAny: [], preAll: [], exclusiveTo: [] }],
  [17, { name: "Uldaman Reagent Run", preAny: [2500], preAll: [], exclusiveTo: [] }],
  [2501, { name: "Badlands Reagent Run II", preAny: [], preAll: [17, 2500], exclusiveTo: [] }],
  [8372, { name: "Fight for Warsong Gulch", preAny: [], preAll: [], exclusiveTo: [] }],
  [8404, { name: "Fight for Warsong Gulch", preAny: [8372, 8399], preAll: [], exclusiveTo: [], acceptOnTurnIn: true }],
  [7791, { name: "A Donation of Wool", preAny: [], preAll: [], exclusiveTo: [], acceptOnTurnIn: true }],
  [1799, { name: "Fragments of the Orb of Orahil", preAny: [], preAll: [], exclusiveTo: [] }],
  [4961, { name: "Cleansing of the Orb of Orahil", preAny: [], preAll: [1799, 4962], exclusiveTo: [] }],
  [4962, { name: "Shard of a Felhound", preAny: [], preAll: [], exclusiveTo: [4963] }],
  [4963, { name: "Shard of an Infernal", preAny: [], preAll: [], exclusiveTo: [4962] }],
  [90001, { name: "Either Path", preAny: [2500], preAll: [17], exclusiveTo: [] }],
]);
const lookup = (id: number) => quests.get(id);

const parse = (texts: string[]) => texts.map((text, i) => parseGuide(`#group G\n#name ${"ABC"[i]}\n${text}`));

function validate(...texts: string[]): Warning[] {
  return validateRoute(previewRoute(parse(texts), 0, humanWarrior), lookup);
}

const simData: SimData = {
  quest: (id) => {
    const quest = quests.get(id);
    return quest && simQuest(quest);
  },
  npc: () => undefined,
  item: () => undefined,
  rules: testRules,
  entityByName: () => undefined,
  locateGoto: () => undefined,
  flights: new FlightNodes(),
  uiMapNamed: () => undefined,
};

function validateSim(start: number, ...texts: string[]): Warning[] {
  const guides = parse(texts);
  return validateSimulation(guides, simulateRoute(guides, start, humanWarrior, simData), lookup);
}

function validateSeeded(seed: Partial<SimStart>, text: string): Warning[] {
  const guides = parse([text]);
  const simulation = simulateRoute(guides, 0, humanWarrior, simData, 0, { log: new Map(), done: new Set(), ...seed });
  return validateSimulation(guides, simulation, lookup);
}

describe("quest order", () => {
  it("warns on a completion or turn-in before the accept", () => {
    expect(validate("step\n.complete 47,1\nstep\n.turnin 48\nstep\n.accept 47\n.accept 48")).toEqual([
      { kind: "notAccepted", at: { guide: 0, step: 0, line: 0 }, questId: 47, command: "complete" },
      { kind: "notAccepted", at: { guide: 0, step: 1, line: 0 }, questId: 48, command: "turnin" },
    ]);
  });

  it("accepts lines in one step together, across #next, and with Lua numbers", () => {
    expect(validate("step\n.turnin 47\n.accept 47\n.accept +48\n#next B", "step\n.complete 48,1\n.turnin 48")).toEqual([]);
  });

  it("warns on an accept before its prerequisites and points to the later turn-in", () => {
    const text = [".accept 2500\n.accept 8372", ".accept 17", ".accept 8404", ".accept 2501", ".turnin 2500\n.turnin 8372"]
      .map((l) => `step\n${l}`)
      .join("\n");
    expect(validate(text)).toEqual([
      {
        kind: "prerequisite",
        at: { guide: 0, step: 1, line: 0 },
        questId: 17,
        allOf: [],
        anyOf: [2500],
        later: { guide: 0, step: 4, line: 0 },
      },
      {
        kind: "prerequisite",
        at: { guide: 0, step: 2, line: 0 },
        questId: 8404,
        allOf: [],
        anyOf: [8372, 8399],
        later: { guide: 0, step: 4, line: 1 },
      },
      {
        kind: "prerequisite",
        at: { guide: 0, step: 3, line: 0 },
        questId: 2501,
        allOf: [17, 2500],
        anyOf: [],
        later: { guide: 0, step: 4, line: 0 },
      },
    ]);
    expect(validate("step\n.accept 8372\nstep\n.turnin 8372\n.accept 8404")).toEqual([]);
  });

  it("counts a group member done once a quest exclusive with it is turned in", () => {
    const text = "step\n.accept 1799\n.accept 4963\nstep\n.turnin 1799\n.turnin 4963\nstep\n.accept 4961";
    expect(validate(text)).toEqual([]);
    expect(validate(text.replace(".turnin 4963", ""))).toEqual([
      { kind: "prerequisite", at: { guide: 0, step: 2, line: 0 }, questId: 4961, allOf: [4962], anyOf: [] },
    ]);
  });

  it("skips preQuestGroup when preQuestSingle lists any quest", () => {
    expect(validate("step\n.accept 2500\nstep\n.turnin 2500\nstep\n.accept 90001")).toEqual([]);
    expect(validate("step\n.accept 90001")).toEqual([
      { kind: "prerequisite", at: { guide: 0, step: 0, line: 0 }, questId: 90001, allOf: [], anyOf: [2500] },
    ]);
  });

  it("warns when a step leaves more than 40 quests in the log", () => {
    expect(validate(`step\n${accepts(41)}\nstep\n.accept ${logIds[41]}`)).toEqual([
      { kind: "questLogFull", at: { guide: 0, step: 0, line: 40 }, count: 41 },
      { kind: "questLogFull", at: { guide: 0, step: 1, line: 0 }, count: 42 },
    ]);
    expect(validate(`step\n${accepts(41)}\n.turnin ${logIds[0]}`)).toEqual([]);
  });

  it("leaves a quest that a step accepts and turns in out of the log, in either order", () => {
    const forty = `step\n${accepts(40)}`;
    expect(validate(`step\n.turnin 47\n.accept 47\n${forty}`)).toEqual([]);
    expect(validate(`step\n.accept 47\n.turnin 47\n${forty}`)).toEqual([]);
  });

  it("applies a step's accepts and abandons in line order", () => {
    const again = `step\n.accept 47\nstep\n${accepts(40)}\n`;
    expect(validate(`${again}.abandon 47\n.accept 47`)).toEqual([{ kind: "questLogFull", at: { guide: 0, step: 1, line: 41 }, count: 41 }]);
    expect(validate(`${again}.accept 47\n.abandon 47`)).toEqual([]);
  });

  it("leaves a quest accepted again after its turn-in out of the log", () => {
    expect(validate(`step\n.accept 47\n.turnin 47\nstep\n${accepts(40)}\n.accept 47\nstep\n.turnin 47`)).toEqual([]);
  });

  it("treats an accept that needs a turned-in quest as conditional", () => {
    const forty = accepts(40);
    expect(validate(`step\n${forty}\nstep\n.accept 17,2,999\n.accept 47,0x3,2500`)).toEqual([
      { kind: "unknownQuest", at: { guide: 0, step: 1, line: 0 }, questId: 999 },
    ]);
    expect(validate(`step\n${forty}\nstep\n.accept 47,2`)).toMatchObject([{ kind: "questLogFull", count: 41 }]);
  });

  it("reads a negative quest ID as no quest, except in .turnin and .complete", () => {
    expect(validate("step\n.accept -47\nstep\n.acceptmultiple -48\nstep\n.turnin 48\n.turnin -47")).toEqual([
      { kind: "unknownQuest", at: { guide: 0, step: 0, line: 0 }, questId: -47 },
      { kind: "unknownQuest", at: { guide: 0, step: 1, line: 0 }, questId: -48 },
      { kind: "notAccepted", at: { guide: 0, step: 2, line: 0 }, questId: 48, command: "turnin" },
    ]);
  });

  it("skips steps and lines that depend on live quest or bag state", () => {
    const text = [
      "step\n.isOnQuest 52\n.turnin 47",
      "step\n.isNotOnQuest 52\n.turnin 47",
      "step\n.isQuestComplete 52\n.turnin 47",
      "step\n.isQuestNotComplete 52\n.turnin 47",
      "step\n.isQuestTurnedIn 52\n.turnin 47",
      "step\n.isQuestAvailable 52\n.turnin 47",
      "step\n.itemcount 100,1\n.accept 17",
      "step\n.turnin -48",
      "step\n.turnin 7791",
      "step << Mage\n.turnin 56",
      "step\n.turnin 60 << Mage",
    ].join("\n");
    expect(validate(text)).toEqual([]);
  });
});

describe("labels, IDs, and routes", () => {
  it("warns on labels no shown step has", () => {
    const text = "step\n#completewith next\nstep\n#completewith Gone\n#requires Hidden\n.xp 5,1,Gone\nstep << Mage\n#label Hidden";
    expect(validate(text)).toEqual([
      { kind: "missingLabel", at: { guide: 0, step: 1, line: 0 }, label: "Gone", hidden: false },
      { kind: "missingLabel", at: { guide: 0, step: 1, line: 1 }, label: "Hidden", hidden: true },
      { kind: "missingLabel", at: { guide: 0, step: 1, line: 2 }, label: "Gone", hidden: false },
    ]);
  });

  it("finds labels, but not quest order, on steps #level and .maxlevel skip", () => {
    const text =
      "step\n#completewith Later\n#requires Old\nstep\n#label Later\n#level 20\n.turnin 48\nstep\n#label Old\n.maxlevel 5\n.turnin 52";
    expect(validate(text)).toEqual([]);
    expect(validateSim(0, text)).toEqual([]);
  });

  // RXP indexes every loaded step's label (`addon:LoadGuide` in
  // GuideWindow.lua). `.cooldown` and `.zoneskip` only complete the active
  // step at runtime (`addon.functions.cooldown` and `addon.functions.zoneskip`
  // in functions.lua), so the step stays loaded.
  it("finds labels on steps that .cooldown or .zoneskip skips", () => {
    expect(validateSim(0, "step\n.cooldown item,6948,<10\n#label L\nstep\n#requires L\n+Go")).toEqual([]);
    const guides = parse(["step\n.goto Elwynn Forest,1,1\n+Walk\nstep\n.zoneskip 1429\n#label L\nstep\n#requires L\n+Go"]);
    const inElwynn: SimData = { ...simData, locateGoto: () => ({ x: 0, y: 0, instance: 0, uiMapId: 1429 }) };
    const simulation = simulateRoute(guides, 0, humanWarrior, inElwynn);
    expect(simulation.guides[0]!.steps.map((s) => s.preview.shown)).toEqual([true, false, true]);
    expect(validateSimulation(guides, simulation, lookup)).toEqual([]);
  });

  it("warns on unknown quest IDs", () => {
    expect(validate("step\n.accept 999\n.turnin 999")).toMatchObject([
      { kind: "unknownQuest", questId: 999 },
      { kind: "unknownQuest", questId: 999 },
    ]);
  });

  it("warns when #next finds no guide", () => {
    expect(validate("#next Z\nstep")).toEqual([{ kind: "missingNext", at: { guide: 0, line: 2 }, next: "Z" }]);
    expect(validate("#next B\nstep\n.turnin 47", "#season 2\n#next Z\nstep")).toEqual([
      { kind: "notAccepted", at: { guide: 0, step: 0, line: 0 }, questId: 47, command: "turnin" },
      { kind: "missingNext", at: { guide: 1, line: 3 }, next: "Z" },
    ]);
  });

  it("knows .buy, .groundgoto, and .daily, which accepts as .acceptmultiple does", () => {
    expect(validate("step\n.daily 47,48\n.buy 159,5\n.groundgoto Durotar,52,43\nstep\n.turnin 48")).toEqual([]);
  });

  it("checks a fallback guide RXP runs although it is inactive", () => {
    expect(validate("#next B\nstep", "#xprate >1.49\nstep\n.turnin 47")).toEqual([
      { kind: "notAccepted", at: { guide: 1, step: 0, line: 0 }, questId: 47, command: "turnin" },
    ]);
  });
});

describe("guide text", () => {
  it("warns on unknown, unhandled, and misspelled names", () => {
    const text = "step\n.frobnicate 1\n.useitem 123\n.dungeon XYZ\n#colour red\n#completwith next";
    expect(validate(text)).toEqual([
      { kind: "unknownCommand", at: { guide: 0, step: 0, line: 0 }, command: "frobnicate" },
      { kind: "noHandler", at: { guide: 0, step: 0, line: 1 }, command: "useitem" },
      { kind: "unknownDungeon", at: { guide: 0, step: 0, line: 2 }, dungeon: "XYZ" },
      { kind: "unknownTag", at: { guide: 0, step: 0, line: 3 }, tag: "colour" },
      { kind: "misspelledTag", at: { guide: 0, step: 0, line: 4 }, tag: "completwith", correct: "completewith" },
    ]);
  });

  it("knows RXP's point commands and checks their quest IDs", () => {
    const text = [
      "step",
      ".flygoto Elwynn Forest,41.5,65.9",
      ".questwaypoint Elwynn Forest,41.5,65.9,20,47,1",
      ".questgoto Elwynn Forest,41.5,65.9,20,9999,1",
      ".pin Elwynn Forest,41.5,65.9,Chest",
      ".ingamewaypoint Elwynn Forest,41.5,65.9",
      ".treasure Elwynn Forest,41.5,65.9,48",
      ".rare Elwynn Forest,41.5,65.9,Mother Fang",
    ].join("\n");
    expect(validate(text)).toEqual([{ kind: "unknownQuest", at: { guide: 0, step: 0, line: 2 }, questId: 9999 }]);
  });

  it("warns on a quest point that RXP drops, naming its first argument that is not a number", () => {
    const text = [
      "step",
      ".questgoto Elwynn Forest,41.5,65.9,20",
      ".questgoto Elwynn Forest,41.5,65.9,far,47,1",
      ".questwaypoint Elwynn Forest,41.5,65.9,20,47",
      ".questwaypoint Elwynn Forest,41.5,65.9,20,0x2F,0b1",
      ".questgoto Elwynn Forest,41.5,65.9,20,0x2F,1",
    ].join("\n");
    expect(validate(text)).toEqual([
      { kind: "droppedPoint", at: { guide: 0, step: 0, line: 0 }, command: "questgoto", arg: "questId" },
      { kind: "droppedPoint", at: { guide: 0, step: 0, line: 1 }, command: "questgoto", arg: "radius" },
      { kind: "droppedPoint", at: { guide: 0, step: 0, line: 2 }, command: "questwaypoint", arg: "objective" },
      { kind: "droppedPoint", at: { guide: 0, step: 0, line: 3 }, command: "questwaypoint", arg: "objective" },
    ]);
  });

  it("accepts #maxlevel in the header and in steps, shown or not", () => {
    expect(validate("#maxlevel 30\nstep\n#maxlevel 20\n.accept 47\nstep\n#maxlevel 5\n.turnin 47")).toEqual([]);
  });

  it("warns on an .enabledungeon that names no dungeon RXP knows", () => {
    expect(validate("step\n.enabledungeon !XYZ\n.enabledungeon BMH")).toEqual([
      { kind: "unknownDungeon", at: { guide: 0, step: 0, line: 0 }, dungeon: "XYZ" },
    ]);
  });

  it("warns on suspicious tokens and invalid groups, even on hidden lines", () => {
    expect(validate("step << Nightelf\n.accept 47 << fRogue\n.accept 48 << Mage(Human)")).toEqual([
      { kind: "suspiciousToken", at: { guide: 0, step: 0 }, token: "Nightelf", suggestion: "NightElf" },
      { kind: "suspiciousToken", at: { guide: 0, step: 0, line: 0 }, token: "fRogue" },
      { kind: "invalidCondition", at: { guide: 0, step: 0, line: 1 }, text: "Mage(Human)" },
    ]);
  });
});

describe("validateSimulation", () => {
  it("counts prerequisites that done= and predecessor guides turn in", () => {
    expect(validateSim(0, "-- @sim done=2500\nstep\n.accept 17")).toEqual([]);
    expect(validateSim(1, "#next B\nstep\n.accept 2500\n.turnin 2500", "step\n.accept 17")).toEqual([]);
  });

  it("warns once, at the accept, for a missing prerequisite", () => {
    const prerequisites = validateSim(0, "step\n.accept 17\nstep\n.complete 17,1\n.turnin 17").filter((w) => w.kind === "prerequisite");
    expect(prerequisites).toEqual([{ kind: "prerequisite", at: { guide: 0, step: 0, line: 0 }, questId: 17, allOf: [], anyOf: [2500] }]);
    expect(validateSim(0, "step\n.accept 2500\nstep\n.accept 17\n.turnin 2500")).toEqual([]);
  });

  it("passes a .complete or turn-in of a quest already turned in", () => {
    expect(validateSim(0, "-- @sim done=48\nstep\n.turnin 48\nstep\n.accept 47\n.turnin 47\nstep\n.turnin 47")).toEqual([]);
    const completes = validateSim(0, "-- @sim done=48\nstep\n.complete 48,1\nstep\n.accept 47\n.turnin 47\nstep\n.complete 47,1");
    expect(completes.filter((w) => w.kind === "notAccepted")).toEqual([]);
  });

  it("leaves a quest accepted again after its turn-in out of the log size", () => {
    expect(validateSim(0, `step\n.accept 47\n.turnin 47\nstep\n${accepts(40)}\n.accept 47`)).toEqual([]);
  });

  it("counts a seeded log toward the quest log size", () => {
    const seeded = (n: number) => new Map(logIds.slice(0, n).map((id) => [id, []]));
    expect(validateSeeded({ log: seeded(40) }, `step\n.accept ${logIds[40]}`)).toEqual([
      { kind: "questLogFull", at: { guide: 0, step: 0, line: 0 }, count: 41 },
    ]);
    expect(validateSeeded({ log: seeded(39) }, `step\n.accept ${logIds[40]}`)).toEqual([]);
  });

  it("counts seeded turn-ins as all-of and any-of prerequisites", () => {
    expect(validateSeeded({ done: new Set([2500, 17, 8372]) }, "step\n.accept 8404\n.accept 2501")).toEqual([]);
    expect(validateSeeded({ done: new Set([2500]) }, "step\n.accept 2501")).toEqual([
      { kind: "prerequisite", at: { guide: 0, step: 0, line: 0 }, questId: 2501, allOf: [17], anyOf: [] },
    ]);
  });

  it("checks steps that pass their gates and skips the rest", () => {
    const text = [
      "step\n#label Done\n.isQuestTurnedIn 47\n.turnin 52",
      "step\n#completewith Done\n.accept 47\n.turnin 47",
      "step\n.isQuestTurnedIn 47\n.turnin 48",
      "step\n.itemcount 100,1\n.turnin 56",
    ].join("\n");
    expect(validateSim(0, text)).toEqual([{ kind: "notAccepted", at: { guide: 0, step: 2, line: 1 }, questId: 48, command: "turnin" }]);
  });

  it("checks labels, but not quest order, on steps an .xp jump passes over", () => {
    const text = "step\n.xp 1,1,End\nstep\n#label Passed\n.turnin 48\nstep\n#label End\n#requires Passed";
    expect(validateSim(0, text)).toEqual([]);
  });

  it("returns the simulation's warnings with the log size and route end, in route order", () => {
    expect(validateSim(0, `#next Z\n-- @sim level=11\nstep\n${accepts(41)}`)).toMatchObject([
      { kind: "missingNext", at: { guide: 0, line: 2 } },
      { kind: "checkpointGap", at: { guide: 0, line: 3 } },
      { kind: "questLogFull", at: { guide: 0, step: 0, line: 40 }, count: 41 },
    ]);
  });
});
