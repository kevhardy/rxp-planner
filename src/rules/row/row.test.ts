import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GameData, TextObjective } from "../../data/index.ts";
import { plannerData } from "../../data/plannerFixture.ts";
import { extractGuides, guideText, guideTextPlain, parseGuide, type CommandLine, type Step } from "../../guide/index.ts";
import { previewRoute, stepLabels } from "../preview.ts";
import { createProfile, type Profile } from "../profile.ts";
import { conditionPhrase, lineFace, rowNames, stepRow, stepSkipText, type RowNames, type StepRowModel } from "./index.ts";

const QUESTS: Record<number, string> = {
  783: "A Threat Within",
  7: "Kobold Camp Cleanup",
  33: "Wolves Across the Border",
  91741: "Nibbled-On Book",
};
const ITEMS: Record<number, string> = { 6948: "Hearthstone", 247834: "Nibbled-On Book", 2488: "Gladius" };
const names: RowNames = {
  name: (type, id) =>
    type === "quest" ? QUESTS[id] : type === "item" ? ITEMS[id] : type === "spell" && id === 6673 ? "Battle Shout" : undefined,
  objective: (quest, index) =>
    quest === 7 && index === 1
      ? { name: "Kobold Vermin", type: "monster", count: 10 }
      : quest === 33 && index === 1
        ? { name: "Tough Wolf Meat", type: "item", count: 8 }
        : undefined,
  place: () => undefined,
  map: () => undefined,
  faction: () => undefined,
};
const noNames: RowNames = {
  name: () => undefined,
  objective: () => undefined,
  place: () => undefined,
  map: () => undefined,
  faction: () => undefined,
};

const docs = extractGuides(readFileSync(join(import.meta.dirname, "../../../guides/rxp-forever/Alliance-1-13_Human.lua"), "utf8")).map(
  (g) => parseGuide(g.text),
);
const warrior = createProfile({ race: "Human", class: "WARRIOR", level: 1 });

function row(name: string, n: number, { profile = warrior, showSkipped = false } = {}): StepRowModel {
  const at = docs.findIndex((d) => d.header.some((l) => l.kind === "tag" && l.name === "name" && l.value.includes(name)));
  const doc = docs[at]!;
  const preview = previewRoute(docs, at, profile, false).guides[0]!.steps[n - 1]!;
  return stepRow(doc.steps[n - 1]!, { names, character: { preview, profile }, labels: stepLabels(doc.steps, profile), showSkipped });
}

function bodyRow(body: string, profile: Profile, showSkipped: boolean): StepRowModel {
  const doc = parseGuide(`#name Test\n#group Test\nstep\n${body}`);
  const preview = previewRoute([doc], 0, profile, false).guides[0]!.steps[0]!;
  return stepRow(doc.steps[0]!, { names, character: { preview, profile }, labels: new Map(), showSkipped });
}

const icon = (written: string) => guideText(`|T${written}|t`)[0]!;
const bubble = icon("interface/worldmap/chatbubble_64grey.blp:20");
const texts = (items: { text: unknown }[]) => items.map((item) => item.text);

describe("stepRow on Northshire", () => {
  it("shows the Hearthstone delete as an action and the step's tags in the footer", () => {
    const step = row("Northshire", 4);
    expect(step.does).toEqual([
      {
        line: 3,
        mark: { kind: "destroy" },
        text: ["Delete the ", icon("134414:0"), "[Hearthstone] from your bags, as it's no longer needed"],
      },
    ]);
    expect(step.footer).toEqual([
      { kind: "tag", line: 1, text: ["Optional"], hint: "Hidden in the step list" },
      { kind: "tag", line: 2, text: ["Until step 7 is done"], hint: "Stays on screen until its lines or that step are done" },
    ]);
  });

  it("leaves out a tag whose own condition fails, even with skipped lines shown", () => {
    expect(texts(row("Northshire", 4, { showSkipped: true }).footer)).toEqual([["Optional"], ["Until step 7 is done"]]);
    const warlock = createProfile({ race: "Human", class: "WARLOCK", level: 1 });
    expect(texts(row("Northshire", 4, { profile: warlock }).footer)).toEqual([["Softcore only"], ["Optional"], ["Until step 7 is done"]]);
  });

  it("shows each text line as a note in guide order, in its colors, with its leading icon as the mark", () => {
    const step = row("Northshire", 6);
    expect(step.notes).toEqual([
      {
        line: 1,
        mark: { kind: "note" },
        text: ["Kill ", { text: "Young Wolves", color: "ENEMY" }, " until you have 10c+ worth of vendor trash"],
      },
      {
        line: 2,
        mark: { kind: "note" },
        text: [
          { text: "You will train", color: "WARN" },
          " ",
          icon("132333:0"),
          "[Battle Shout] ",
          { text: "which increases early leveling speeds", color: "WARN" },
        ],
      },
      { line: 3, mark: { icon: bubble }, text: ["Talk to ", { text: "Brother Danil", color: "FRIENDLY" }] },
      { line: 7, mark: { icon: bubble }, text: ["Talk to ", { text: "Llane Beshere", color: "FRIENDLY" }, " inside downstairs"] },
    ]);
    expect(step.does).toEqual([
      { line: 4, mark: { kind: "vendor" }, text: [{ text: "Vendor trash", color: "WARN" }] },
      { line: 8, mark: { kind: "train" }, text: ["Train ", icon("132333:0"), "[Battle Shout]"] },
    ]);
    expect(step.footer).toEqual([{ kind: "condition", line: "step", text: ["Warrior only"], tone: "warn" }]);
    expect(step.where.targets).toEqual([
      { line: 5, label: "Brother Danil" },
      { line: 9, label: "Llane Beshere" },
    ]);
    expect(step.where.mobs).toEqual([{ line: 11, label: "Young Wolf" }]);
  });

  it("keeps quest actions in guide order and marks an item objective with the bag", () => {
    expect(row("Northshire", 7).does.map((d) => d.mark)).toEqual([{ kind: "turnin" }, { kind: "accept" }]);
    const step = row("Northshire", 11);
    expect(step.does).toEqual([{ line: 20, mark: { kind: "collect" }, text: ["Wolves Across the Border · Tough Wolf Meat ×8"] }]);
    expect(step.footer).toEqual([
      { kind: "tag", line: 0, text: ["Sticky"], hint: "Stays on screen until done" },
      { kind: "setting", line: 1, text: ["Label ", { mono: "WolfMeatEnd" }] },
    ]);
    expect(step.where.waypoints).toEqual({ shown: 14, skipped: [] });
  });

  it("labels commands without text and marks a kill objective with the sword", () => {
    const step = row("Northshire", 12);
    expect(step.does).toEqual([
      {
        line: 16,
        mark: { kind: "use" },
        text: [
          { text: "Use the", color: "WARN" },
          " ",
          icon("133736:0"),
          "[",
          { text: "Nibbled-On Book", color: "LOOT" },
          "] ",
          { text: "to start the quest", color: "WARN" },
        ],
      },
      { line: 18, mark: { kind: "collect" }, text: ["Collect Nibbled-On Book ×1"] },
      { line: 19, mark: { kind: "accept" }, text: ["Accept Nibbled-On Book"] },
      { line: 20, mark: { kind: "kill" }, text: ["Kobold Camp Cleanup · Kobold Vermin ×10"] },
    ]);
    expect(step.where.mobs).toEqual([{ line: 22, label: "Kobold Vermin" }]);
    expect(step.footer).toEqual([
      { kind: "tag", line: 0, text: ["Loop waypoints"] },
      { kind: "setting", line: 21, text: ["Hide checkbox"], hint: "No checkbox on the line above" },
    ]);
  });

  it("shows a goto's text as an action with nested colors", () => {
    const step = row("Northshire", 14);
    expect(step.does).toEqual([
      {
        line: 2,
        mark: { kind: "goto" },
        text: [
          { text: "Travel toward ", color: "WARN" },
          { text: "Brother Paxton", color: "FRIENDLY" },
          { text: " in Northshire Abbey. Don't worry about completing ", color: "WARN" },
          { text: "Vermins", color: "ENEMY" },
          { text: " or ", color: "WARN" },
          { text: "Wolves", color: "ENEMY" },
          { text: " straight away", color: "WARN" },
        ],
      },
    ]);
    expect(step.where.places.map((p) => p.line)).toEqual([1, 2]);
    expect(texts(step.footer)).toEqual([["Until the next step is done"]]);
  });
});

describe("stepRow on Elwynn Forest", () => {
  it("phrases the checks and puts the setting last", () => {
    const step = row("Elwynn", 14);
    expect(step.footer).toEqual([
      { kind: "condition", line: "step", text: ["Warrior only"], tone: "warn" },
      { kind: "check", line: 6, text: ["Skip with less than 5s 36c"] },
      { kind: "check", line: 7, text: ["While main-hand DPS is below 3.8"] },
      { kind: "setting", line: 4, text: ["Hide checkbox"], hint: "No checkbox on the line above" },
    ]);
    expect(texts(step.does)).toEqual([
      [{ text: "Buy a", color: "BUY" }, " ", icon("135321:0"), "[Gladius] ", { text: "from her if you can afford it", color: "BUY" }],
      ["Collect Gladius ×1"],
    ]);
  });
});

describe("stepRow line conditions", () => {
  const body = ".accept 33 << Mage\n#sticky << Mage\n.waypoint Elwynn Forest,1,1 << Mage\n.waypoint Elwynn Forest,2,2 << Mage";

  it("drops a line whose condition fails", () => {
    const step = bodyRow(body, warrior, false);
    expect([step.does, step.footer, step.where.waypoints]).toEqual([[], [], { shown: 0, skipped: [] }]);
  });

  it("keeps a skipped line with its reason when skipped lines show, but never a tag", () => {
    const step = bodyRow(body, warrior, true);
    expect(step.does).toEqual([{ line: 0, mark: { kind: "accept" }, text: ["Accept Wolves Across the Border"], skipped: "Only for Mage" }]);
    expect(step.footer).toEqual([]);
    expect(step.where.waypoints).toEqual({ shown: 0, skipped: [{ reason: "Only for Mage", line: 2, count: 2 }] });
  });

  it("places point commands under Where and keeps only a goto-icon text as an action", () => {
    const step = bodyRow(
      ".flygoto Elwynn Forest,1,1,10 >>Fly to the tower\n.pin Elwynn Forest,2,2,Chest >>A chest\n.questwaypoint Elwynn Forest,3,3,10,33,1",
      warrior,
      false,
    );
    expect([step.does, step.notes, step.where.places, step.where.waypoints]).toEqual([
      [{ line: 0, mark: { kind: "goto" }, text: ["Fly to the tower"] }],
      [{ line: 1, mark: { kind: "note" }, text: ["A chest"] }],
      [
        { line: 0, text: ["Elwynn Forest,1,1"] },
        { line: 1, text: ["Elwynn Forest,2,2"] },
      ],
      { shown: 1, skipped: [] },
    ]);
  });

  it("names a goto's zone where it changes, and gives its point as a mono part", () => {
    const placed: RowNames = { ...names, place: ([zone, x, y]) => ({ zone: zone!, point: `${x}, ${y}` }) };
    const doc = parseGuide("#name Test\n#group Test\nstep\n.goto Elwynn Forest,40,50\n.goto Elwynn Forest,41,51\n.goto Westfall,50,50");
    const preview = previewRoute([doc], 0, warrior, false).guides[0]!.steps[0]!;
    const step = stepRow(doc.steps[0]!, { names: placed, character: { preview, profile: warrior }, labels: new Map(), showSkipped: false });
    expect(step.where.places.map((p) => p.text)).toEqual([
      ["Elwynn Forest ", { mono: "40, 50" }],
      [{ mono: "41, 51" }],
      ["Westfall ", { mono: "50, 50" }],
    ]);
    expect(lineFace(doc.steps[0]!.body[1]!, placed).text).toEqual(["Elwynn Forest ", { mono: "41, 51" }]);
  });

  // `CurrentStepFrame.UpdateText` in GuideWindow.lua draws a line's text with the icon that `addon.icons` in
  // functions.lua gives its command, and the commands whose text reads as a note have none. `addon.functions.waypoint`
  // keeps its text as the arrow's title, which the guide window does not show.
  it.each([
    ["goto", "Elwynn Forest,40,40,10", "place", "do"],
    ["groundgoto", "Elwynn Forest,40,40,10", "place", "do"],
    ["flygoto", "Elwynn Forest,40,40,10", "place", "do"],
    ["questgoto", "Elwynn Forest,40,40,10,33,1", "place", "note"],
    ["waypoint", "Elwynn Forest,40,40,10", "waypoint", "arrow"],
    ["questwaypoint", "Elwynn Forest,40,40,10,33,1", "waypoint", "arrow"],
    ["ingamewaypoint", "Elwynn Forest,40,40", "waypoint", "note"],
    ["pin", "Elwynn Forest,40,40,Chest", "place", "note"],
    ["treasure", "Elwynn Forest,40,40,33", "place", "note"],
    ["rare", "Elwynn Forest,40,40,Hogger", "place", "note"],
    ["line", "Elwynn Forest,40,40,45,45", "none", "note"],
    ["loop", "10,Elwynn Forest,40,40,45,45", "none", "note"],
  ])("puts .%s %s under Where as a %s, and its text in %s", (command, args, where, textAs) => {
    const shown = (text: string) => {
      const step = bodyRow(`.${command} ${args}${text}`, warrior, false);
      return [step.where.places, step.where.waypoints.shown, step.does, step.notes];
    };
    const places = where === "place" ? [{ line: 0, text: ["Elwynn Forest,40,40"] }] : [];
    const waypoints = where === "waypoint" ? 1 : 0;
    expect(shown("")).toEqual([places, waypoints, [], []]);
    const item = { line: 0, mark: { kind: textAs === "do" ? "goto" : "note" }, text: ["Go there"] };
    expect(shown(" >>Go there")).toEqual([places, waypoints, textAs === "do" ? [item] : [], textAs === "note" ? [item] : []]);
  });

  it("shows a bare equip as an action and as the check RXP reads it as", () => {
    const step = bodyRow(".equip 16,2488", warrior, false);
    expect(step.does).toEqual([{ line: 0, mark: { kind: "equip" }, text: ["Equip Gladius"] }]);
    expect(step.footer).toEqual([{ kind: "check", line: 0, text: ["Skip once Gladius is equipped"] }]);
  });

  it("puts an assumed level on a line with no action", () => {
    const doc = parseGuide("#name Test\n#group Test\nstep\n-- @sim level=5\n.accept 783");
    const checkpoints = [
      { line: 0, level: "5" },
      { line: 1, level: "6" },
    ];
    const step = stepRow(doc.steps[0]!, { names, character: undefined, labels: new Map(), showSkipped: false, checkpoints });
    expect(step.does).toEqual([
      { line: 0, mark: { kind: "checkpoint" }, text: ["Assume level 5"] },
      { line: 1, mark: { kind: "accept" }, text: ["Accept A Threat Within"] },
    ]);
  });
});

function phrases(line: string): string[] {
  const step: Step = parseGuide(`#name Test\n#group Test\nstep\n${line}`).steps[0]!;
  const r = stepRow(step, { names: noNames, character: undefined, labels: new Map([["Camp", 4]]), showSkipped: false });
  return [...r.does.map((d) => guideTextPlain(d.text)), ...r.footer.map((f) => guideTextPlain(f.text))];
}

describe("command phrases", () => {
  it.each([
    [".accept 783", ["Accept Quest #783"]],
    [".accept -176", ["Accept Quest #-176"]],
    // Lua's `tonumber` reads no `0b` prefix, and only `.turnin` and `.complete` drop a quest ID's sign.
    [".turnin 0b11", ["Turn in Quest #0b11"]],
    [".complete 0b11,1", ["Quest #0b11 · Objective 1"]],
    [".turnin -0x1f", ["Turn in Quest #31"]],
    [".abandon 176,-177", ["Abandon Quest #176 and Quest #-177"]],
    [".isOnQuest -176", ["While Quest #-176 is in your log"]],
    [".destroy 6948", ["Destroy Item #6948"]],
    [".use 6948:p", ["Use Item #6948"]],
    [".use 6948:p,2488", ["Use Item #6948, Item #2488"]],
    [".usespell 133:p", ["Cast Spell #133"]],
    [".subzoneskip 57", ["Skip in Area #57"]],
    [".subzoneskip 57,3", ["Skip outside Area #57"]],
    [".zoneskip Elwynn Forest", ["Skip in Elwynn Forest"]],
    [".zoneskip Elwynn Forest,01", ["Skip outside Elwynn Forest"]],
    [".zoneskip Elwynn Forest,3", ["Skip outside Elwynn Forest"]],
    [".xp 3+1110", ["Grind until you are 1110 xp into level 3"]],
    [".xp 5-200", ["Grind until you are 200 xp away from level 5"]],
    [".xp 5.5", ["Grind until you are 50% into level 5"]],
    [".xp <6,1", ["Skip below level 6"]],
    [".xp >8", ["Grind to level 8"]],
    [".xp <8", ["Complete below level 8"]],
    [".xp 8,+1", ["Skip at level 8+"]],
    [".xp <10+5890,1", ["Skip below 5890 xp into level 10"]],
    [".xp >8+1200,1", ["Skip at or above 1200 xp into level 8"]],
    [".xp 8-300,1", ["Skip at or above 300 xp short of level 8"]],
    [".xp 8.5,-1", ["Skip below 50% into level 8"]],
    [".xp <8.005,1", ["Skip below 0.5% into level 8"]],
    [".xp 8.005", ["Grind until you are 0.5% into level 8"]],
    [".xp <8,-1", ["Skip below level 8"]],
    [".xp 6,1,Camp", ["Jump to step 5 at level 6+"]],
    [".maxlevel 12", ["Skip above level 12"]],
    [".money >1.5", ["Skip with 1g 50s or more"]],
    [".money <12.0004", ["Skip with less than 12g 4c"]],
    [".money >0", ["Skip with 0c or more"]],
    [".itemcount 6948,<2", ["While you have fewer than 2 Item #6948"]],
    [".cooldown item,6948,<5m", ["Skip while Item #6948 has less than 5 min left"]],
    [".skill cooking,10,1", ["While Cooking is below 10"]],
    [".reputation 72,friendly,0,1", ["Skip once you are Friendly with Faction #72"]],
    [".reputation 72,honored", ["Grind to Honored with Faction #72"]],
    [".home 87", ["Set your Hearthstone to Area #87"]],
    [".bindlocation 87,1", ["Skip while your hearth is not at Area #87"]],
    [".bronzetube", ["While you still need Item #4371 for Quest #174"]],
    [".bronzetube 1", ["Skip while you still need Item #4371 for Quest #174"]],
    [".aura 8326", ["Skip while Spell #8326 is on you"]],
    [".aura -8326,<30", ["Skip while Spell #8326 has more than 30 s left"]],
    [".aura 8326,3+,pet", ["Skip while Spell #8326 has 3+ stacks"]],
    [".aura 8326 >> Get the buff", ["Get the buff"]],
    [".blastedLands", ["Collect 14 Vulture Gizzard, 11 Basilisk Brain, 6 Scorpok Pincer, 6 Blasted Boar Lung, 5 Snickerfang Jowl"]],
    [".equip -16", ["Equip an item in the main-hand slot", "Skip while the main-hand slot is empty"]],
  ])("%s", (line, expected) => {
    expect(phrases(line)).toEqual(expected);
  });
});

describe("stepSkipText", () => {
  const skipText = (command: string) => {
    const line = parseGuide(`#name T\n#group T\nstep\n${command}`).steps[0]!.body[0] as CommandLine;
    return stepSkipText({ kind: "command", name: line.name, args: line.args, line: 0 }, warrior, names, new Map([["Camp", 4]]));
  };

  it("names a step that a runtime gate hides by the gate's phrase", () => {
    expect(skipText(".zoneskip Elwynn Forest,3")).toBe("Skip outside Elwynn Forest");
    expect(skipText(".isOnQuest 7")).toBe("Only while Kobold Camp Cleanup is in your log");
    expect(skipText(".isQuestTurnedIn 783")).toBe("Only after A Threat Within is turned in");
    expect(skipText(".xp 6,1,Camp")).toBe("Jump to step 5 at level 6+");
    expect(skipText(".maxlevel 12")).toBe("Skip above level 12");
  });

  it("names a step that another command hides as describeReason does", () => {
    expect(skipText(".dungeon DM")).toBe("Dungeon DM off");
  });
});

describe("conditionPhrase", () => {
  const phrase = (text: string) => conditionPhrase(parseGuide(`#name T\n#group T\nstep << ${text}`).steps[0]!.line.condition!);

  it.each([
    ["Warrior", { text: "Warrior only", tone: "warn" }],
    ["Warrior/Rogue", { text: "Warrior, Rogue only", tone: "warn" }],
    ["!Priest !Mage", { text: "Not Priest, Mage", tone: "warn" }],
    ["Human", { text: "Human only" }],
    ["Alliance Warrior", { text: "Only for Alliance Warrior" }],
  ])("%s", (text, expected) => {
    expect(phrase(text)).toEqual(expected);
  });
});

describe("lineFace", () => {
  const face = (line: string) => lineFace(parseGuide(`#name T\n#group T\nstep\n${line}`).steps[0]!.body[0]!, names);

  it("reads a line as its row would", () => {
    expect(face(".complete 7,1")).toEqual({ mark: { kind: "kill" }, text: ["Kobold Camp Cleanup · Kobold Vermin ×10"] });
    expect(face(".money <0.0536")).toEqual({ mark: { kind: "check" }, text: ["Skip with less than 5s 36c"] });
    expect(face(".mob +Young Wolf")).toEqual({ mark: { kind: "kill" }, text: ["Young Wolf"] });
    expect(face("#sticky")).toEqual({ mark: { kind: "tag" }, text: ["Sticky"] });
    expect(face("#label Camp")).toEqual({ mark: { kind: "tag" }, text: ["Label ", { mono: "Camp" }] });
  });

  it.each([
    ["goto", "Elwynn Forest,40,40,10", "goto", "Elwynn Forest,40,40", "goto"],
    ["groundgoto", "Elwynn Forest,40,40,10", "goto", "Elwynn Forest,40,40", "goto"],
    ["flygoto", "Elwynn Forest,40,40,10", "goto", "Elwynn Forest,40,40", "goto"],
    ["questgoto", "Elwynn Forest,40,40,10,33,1", "goto", "Elwynn Forest,40,40", "note"],
    ["waypoint", "Elwynn Forest,40,40,10", "goto", "Elwynn Forest,40,40", "goto"],
    ["questwaypoint", "Elwynn Forest,40,40,10,33,1", "goto", "Elwynn Forest,40,40", "goto"],
    ["ingamewaypoint", "Elwynn Forest,40,40", "goto", "Elwynn Forest,40,40", "note"],
    ["pin", "Elwynn Forest,40,40,Chest", "goto", "Elwynn Forest,40,40", "note"],
    ["treasure", "Elwynn Forest,40,40,33", "goto", "Elwynn Forest,40,40", "note"],
    ["rare", "Elwynn Forest,40,40,Hogger", "goto", "Elwynn Forest,40,40", "note"],
    ["line", "Elwynn Forest,40,40,45,45", "path", "Elwynn Forest,40,40,45,45", "note"],
    ["loop", "10,Elwynn Forest,40,40,45,45", "path", "10,Elwynn Forest,40,40,45,45", "note"],
  ])("reads .%s %s with the %s mark as %s, and its text with the %s mark", (command, args, kind, label, textKind) => {
    expect(face(`.${command} ${args}`)).toEqual({ mark: { kind }, text: [label] });
    expect(face(`.${command} ${args} >>Go there`)).toEqual({ mark: { kind: textKind }, text: ["Go there"] });
  });

  it.each([
    [".daily 100", "daily"],
    [".dailyturnin 100", "dailyturnin"],
    [".home Goldshire", "home"],
    [".vehicle 100", "vehicle"],
    [".tame 100", "tame"],
    [".stable", "stable"],
    [".gossipoption 1", "gossip"],
    [".emote BOW", "emote"],
    [".bankdeposit 2589", "bank"],
    [".bankwithdraw 2589", "bank"],
    [".engrave 5", "engrave"],
    [".reputation 72,friendly", "reputation"],
    [".reputation 72,friendly,0,1", "check"],
    [".skill cooking,50", "skill"],
    [".skill cooking,50,1", "check"],
    [".clicknext Group\\Guide", "next"],
    [".link https://example.com", "setting"],
    [".timer 10", "setting"],
  ])("reads %s with the %s mark", (line, kind) => {
    expect(face(line).mark).toEqual({ kind });
  });

  it("reads the leading icon of a .pin line's text as its mark", () => {
    expect(face(".pin Elwynn Forest,40,40 >>|T133736:0|t Chest")).toEqual({ mark: { icon: icon("133736:0") }, text: [" Chest"] });
  });
});

describe("rowNames", () => {
  it("names a .complete line's text-row objective by its page order", () => {
    const { objective } = rowNames(plannerData(), null);
    expect(objective(76156, 1)).toEqual({ name: "Seaforium Mining Charge", type: "item", count: 5 });
    expect(objective(76160, 2)).toEqual({ name: "Windfury Cone", type: "item", count: 8 });
  });

  it("gives an NPC text row a kind only when it needs kills", () => {
    const rows: TextObjective[] = [
      { name: "Injured Deathguard healed", count: 1, need: "action", link: { kind: "npc", id: 1 } },
      { name: "Gnoll slain", count: 4, need: "kills", link: { kind: "npc", id: 2 } },
    ];
    const data = { quest: () => ({ objectives: [], textObjectives: rows }) } as unknown as GameData;
    const { objective } = rowNames(data, null);
    expect(objective(1, 1)).toEqual({ name: "Injured Deathguard healed", count: 1 });
    expect(objective(1, 2)).toEqual({ name: "Gnoll slain", type: "monster", count: 4 });
  });
});
