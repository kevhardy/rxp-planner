import { describe, expect, it } from "vitest";
import { percentToWorld } from "../../packages/data-contract/geometry.ts";
import { GameData, type QuestPoint } from "../data/index.ts";
import { MAP_BOUNDS, plannerContext, plannerData, plannerFile, questRow } from "../data/plannerFixture.ts";
import { parseGuide, serializeGuide } from "../guide/index.ts";
import type { Faction } from "./profile.ts";
import { insertCheckpoint, insertQuest, type QuestDraft, type QuestRequest, type SuggestedQuest } from "./questInsertion.ts";

const planner = plannerData();

const insert = (data: GameData, text: string, after: number | null, request: QuestRequest, faction: Faction = "Alliance") => {
  const doc = parseGuide(text);
  const insertion = insertQuest({ data, faction, doc, after }, request);
  return insertion && { text: serializeGuide(insertion.edit(doc)), step: insertion.select };
};
const suggestion = (s: SuggestedQuest, skipped = false): QuestRequest => ({ kind: "suggestion", suggestion: s, skipped });

describe("insertQuest for a suggestion", () => {
  const guide = "#name T\nstep\n    .xp 2\n";
  const hogger = planner.quest(176, "Alliance")!;

  it("adds the command with a .goto to the point the suggestion measured to", () => {
    expect(insert(planner, guide, 0, suggestion({ kind: "accept", questId: 176, location: hogger.startPoints[1]!.world }))).toEqual({
      text: `${guide}step\n    .goto Elwynn Forest,24.57,78.23\n    .accept 176\n`,
      step: 1,
    });
    expect(insert(planner, guide, 0, suggestion({ kind: "turnin", questId: 176, location: hogger.endPoints[0]!.world }))?.text).toBe(
      `${guide}step\n    .goto Elwynn Forest,42.11,65.93\n    .turnin 176\n`,
    );
    const spawn = hogger.objectivePoints[0]!.world;
    expect(insert(planner, guide, 0, suggestion({ kind: "objective", questId: 176, location: spawn, objective: { index: 1 } }))?.text).toBe(
      `${guide}step\n    .goto Elwynn Forest,25.78,89.82\n    .complete 176,1\n`,
    );
  });

  it("adds no .goto when no point of the quest is at the location", () => {
    const elsewhere = hogger.endPoints[0]!.world;
    expect(insert(planner, guide, 0, suggestion({ kind: "accept", questId: 176, location: elsewhere }))?.text).toBe(
      `${guide}step\n    .accept 176\n`,
    );
    expect(insert(planner, guide, 0, suggestion({ kind: "accept", questId: 176, location: null }))?.text).toBe(
      `${guide}step\n    .accept 176\n`,
    );
  });

  it("finds the point in the faction's quest record", () => {
    const theldurinTheLost = 687;
    const horde = planner.quest(theldurinTheLost, "Horde")!.startPoints[0]!.world;
    const request = suggestion({ kind: "accept", questId: theldurinTheLost, location: horde });
    expect(insert(planner, guide, 0, request, "Horde")?.text).toBe(
      `${guide}step\n    .goto Arathi Highlands,74.54,35.64\n    .accept 687\n`,
    );
    expect(insert(planner, guide, 0, request)?.text).toBe(`${guide}step\n    .accept 687\n`);
  });

  it("adds nothing for a quest the data lacks or an objective without an index", () => {
    expect(insert(planner, guide, 0, suggestion({ kind: "accept", questId: 999999, location: null }))).toBeUndefined();
    const objective = { kind: "objective", questId: 176, location: null, objective: { index: null } } as const;
    expect(insert(planner, guide, 0, suggestion(objective))).toBeUndefined();
    expect(insert(planner, guide, 0, suggestion({ ...objective, objective: { index: 1 } }))?.text).toBe(
      `${guide}step\n    .complete 176,1\n`,
    );
  });
});

describe("insertQuest joining", () => {
  const billy = 247;
  const bernice = 246;
  const npc = (kind: string, sourceId: number): QuestPoint => {
    const placed = percentToWorld([MAP_BOUNDS.get(1429)], 50, 50);
    if (!placed.ok) throw new Error(placed.reason);
    return {
      zoneId: 12,
      uiMapId: 1429,
      x: 50,
      y: 50,
      world: placed.world,
      kind,
      sourceType: "npc",
      sourceId,
      sourceName: `NPC ${sourceId}`,
    };
  };
  const file = plannerFile();
  const data = new GameData(
    {
      ...file,
      quests: [
        ...file.quests,
        questRow(85, "Lost Necklace", { endPoints: [npc("turn-in", billy)] }),
        questRow(86, "Pie for Billy", { startPoints: [npc("start", billy)], endPoints: [npc("turn-in", bernice)] }),
        questRow(84, "Back to Billy", { startPoints: [npc("start", bernice)] }),
      ],
    },
    plannerContext,
  );
  const text = "#name T\nstep\n    .goto Elwynn Forest,40,60\n    .turnin 85 >>Hand in Lost Necklace\n\nstep\n\t.accept   9\n";
  const marker = (id: number, skipped = false): QuestRequest => ({
    kind: "marker",
    command: "accept",
    id,
    marker: data.locateQuestPoint(npc("start", 0)),
    skipped,
  });

  it("joins the step when the command meets its NPC, leaving out the .goto", () => {
    const joined =
      "#name T\nstep\n    .goto Elwynn Forest,40,60\n    .turnin 85 >>Hand in Lost Necklace\n    .accept 86\n\nstep\n\t.accept   9\n";
    expect(insert(data, text, 0, marker(86))).toEqual({ text: joined, step: 0 });
    expect(insert(data, text, 0, suggestion({ kind: "accept", questId: 86, location: npc("start", billy).world }))).toEqual({
      text: joined,
      step: 0,
    });
  });

  it("makes a new step after a skipped step, for another NPC, and before the first step", () => {
    const added = (id: number) => `step\n    .goto Elwynn Forest,50.00,50.00\n    .accept ${id}\n`;
    const second = (id: number) => text.replace("\nstep\n\t", `\n${added(id)}step\n\t`);
    expect(insert(data, text, 0, marker(86, true))).toEqual({ text: second(86), step: 1 });
    const skipped = suggestion({ kind: "accept", questId: 86, location: npc("start", billy).world }, true);
    expect(insert(data, text, 0, skipped)).toEqual({ text: second(86), step: 1 });
    expect(insert(data, text, 0, marker(84))).toEqual({ text: second(84), step: 1 });
    expect(insert(data, text, null, marker(86))).toEqual({ text: text.replace("#name T\n", `#name T\n${added(86)}`), step: 0 });
  });

  it("makes a new step when the step works on objectives", () => {
    const objectives = "#name T\nstep\n    .complete 86,1\n    .turnin 86\n";
    expect(insert(data, objectives, 0, marker(84))?.text).toBe(`${objectives}step\n    .goto Elwynn Forest,50.00,50.00\n    .accept 84\n`);
  });

  it("keeps a joined step's comment and CRLF line endings", () => {
    const crlf = "#name T\r\nstep\r\n    -- at the inn\r\n\t.turnin   85\r\nstep\r\n    .accept 9\r\n";
    expect(insert(data, crlf, 0, marker(86))?.text).toBe(crlf.replace("\t.turnin   85\r\n", "\t.turnin   85\r\n    .accept 86\r\n"));
  });

  it("puts a reviewed draft in new steps, even at the step's NPC, and selects the first", () => {
    const draft: QuestDraft = {
      quest: data.quest(86)!,
      givers: [{ label: "Billy", args: ["Elwynn Forest", "50", "50"] }],
      enders: [],
      objectives: [],
    };
    const choices = { accept: true, complete: false, turnin: true, giver: 0, ender: -1 };
    expect(insert(data, text, 0, { kind: "draft", draft, choices })).toEqual({
      text: text.replace("\nstep\n\t", "\nstep\n    .goto Elwynn Forest,50,50\n    .accept 86\nstep\n    .turnin 86\nstep\n\t"),
      step: 1,
    });
  });

  it("edits the document it is given, as a built-in's copy with another header", () => {
    const doc = parseGuide(text);
    const insertion = insertQuest({ data, faction: "Alliance", doc, after: 0 }, marker(86))!;
    const copy = parseGuide(text.replace("#name T\n", "#name T\n#next Copy\\Next\n"));
    expect(serializeGuide(insertion.edit(copy))).toBe(
      "#name T\n#next Copy\\Next\nstep\n    .goto Elwynn Forest,40,60\n    .turnin 85 >>Hand in Lost Necklace\n    .accept 86\n\nstep\n\t.accept   9\n",
    );
  });
});

describe("insertCheckpoint", () => {
  const checkpoint = (text: string, after: number | null, skipped: boolean) => {
    const doc = parseGuide(text);
    const insertion = insertCheckpoint(doc, after, skipped, { kind: "plus", level: 3, xp: 700 });
    return { text: serializeGuide(insertion.edit(doc)), select: insertion.select };
  };
  const guide = "#group G\n#name T\n\n\nstep\n  .accept 1\n\n\nstep\n    .xp 2\n    .xp 3\n";

  it("puts the line after the selected step's last non-blank line, with the guide's indent", () => {
    expect(checkpoint(guide, 0, false)).toEqual({
      text: "#group G\n#name T\n\n\nstep\n  .accept 1\n    -- @sim level=3+700\n\n\nstep\n    .xp 2\n    .xp 3\n",
      select: { step: 0, line: 1 },
    });
  });

  it("puts the line after the header's last non-blank line, with no indent, and selects no line", () => {
    expect(checkpoint(guide, null, false)).toEqual({
      text: "#group G\n#name T\n-- @sim level=3+700\n\n\nstep\n  .accept 1\n\n\nstep\n    .xp 2\n    .xp 3\n",
      select: { step: null, line: null },
    });
  });

  it("puts the line in a new step after a skipped step and selects it", () => {
    expect(checkpoint(guide, 0, true)).toEqual({
      text: "#group G\n#name T\n\n\nstep\n  .accept 1\n\n\nstep\n    -- @sim level=3+700\nstep\n    .xp 2\n    .xp 3\n",
      select: { step: 1, line: 0 },
    });
  });
});
