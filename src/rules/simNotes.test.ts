import { describe, expect, it } from "vitest";
import { guideTextPlain, parseGuide } from "../guide/index.ts";
import type { KillAssumption, KillsLater, StepNote, StepSnapshot, XpGain } from "./simulate.ts";
import { cardText, levelBands, lineKillParts, stepXp } from "./simNotes.ts";
import { testRules } from "./testing.ts";

const gain = (quest: number, kills = 0, checkpoint = 0) => ({ quest, kills, checkpoint });

const npcNames: Record<number, string> = { 80: "Kobold Laborer", 475: "Kobold Tunneler", 248464: "Nimsy" };
const names = {
  npc: (id: number) => npcNames[id]!,
  item: (id: number) => ({ 159: "Refreshing Spring Water", 773: "Gold Dust", 11119: "Milly's Harvest" })[id]!,
  quest: (id: number) => ({ 16: "Give Gerard a Drink", 47: "Gold Dust Exchange", 3904: "Milly's Harvest" })[id]!,
  guide: (g: number) => ({ 2: "6-11 Elwynn Forest" })[g]!,
  objective: ({ questId }: { questId: number }) => ({ 47: "Gold Dust" })[questId] ?? names.quest(questId),
};
const step = (...body: string[]) => parseGuide(["step", ...body].join("\n") + "\n").steps[0]!;

describe("stepXp", () => {
  const at = { guide: 0, step: 0, line: 0 };
  const none = { kills: [], levelUps: [], checkpoints: [], notes: [] };
  const objective = { questId: 47, row: 0 };
  const defaultDrop = (npcId: number) => ({ npcId, chance: { value: 0.5, source: { kind: "default" as const } } });
  type Notes = Partial<Pick<StepSnapshot, "kills" | "levelUps" | "notes" | "checkpoints" | "xp">>;
  const ringXp = (snapshot: Notes, ...body: string[]) =>
    stepXp(
      testRules,
      { level: 5, xp: 2000 },
      { ...none, state: { level: 5, xp: 2500 }, xp: gain(0, 500), ...snapshot },
      names,
      step(...body),
    );
  const ring = (snapshot: Notes, ...body: string[]) => ringXp(snapshot, ...body).notes.map(cardText);

  it("rings the progress before the step and a checkpoint's jump, with the kills it stands for in its own section", () => {
    const checkpoint = {
      at,
      kind: "xp",
      target: { kind: "plus", level: 3, xp: 1130 },
      gap: 812,
      kills: { count: 14, mobs: [{ npcId: 80, count: 14 }] },
    } as const;
    const snapshot = { ...none, state: { level: 3, xp: 1130 }, xp: gain(0, 0, 812), checkpoints: [checkpoint] };
    const xp = stepXp(testRules, { level: 3, xp: 318 }, snapshot, names, step(".xp 3+1130"));
    expect(xp).toMatchObject({ level: 3, earned: 0, dinged: false, checkpoint: true });
    expect(xp.before).toBeCloseTo(318 / 1400);
    expect(xp.jump).toBeCloseTo(812 / 1400);
    expect([xp.card, ...xp.notes]).toEqual([
      {
        title: "Level 3",
        value: [{ mono: "80%" }],
        rows: [
          { label: "XP", value: [{ mono: "1,130/1,400" }] },
          { label: "To level 4", value: [{ mono: "270" }, " xp"] },
        ],
      },
      { title: "Checkpoint", value: [{ mono: "+812" }, " xp"], rows: [{ label: "Stands for", value: ["about 14 Kobold Laborer kills"] }] },
    ]);
    expect(xp.label).toBe("Level 3, 80%, 1,130/1,400 xp, 270 to level 4, +812 xp from a checkpoint");
    const commented = stepXp(testRules, { level: 3, xp: 318 }, snapshot, names, step("-- @sim level=3+1130"));
    expect(cardText(commented.notes[0]!)).toBe(
      "Checkpoint: +812 xp\nStands for: about 14 Kobold Laborer kills\nComment: @sim level=3+1130",
    );
  });

  it("starts a level's ring empty, with the kill that reaches the level in its kill section, and fills it at the cap", () => {
    const kills = {
      at,
      objective,
      count: 12,
      countFrom: "data",
      mobFrom: "objective",
      mobs: [{ npcId: 80, levels: [{ level: 3, kills: 12 }] }],
    } as const;
    const up = { level: 3, at, kill: { entry: 0, n: 11, of: 12 } };
    const dinged = stepXp(
      testRules,
      { level: 2, xp: 270 },
      { ...none, state: { level: 3, xp: 68 }, xp: gain(0, 698), kills: [kills], levelUps: [up] },
      names,
      step(".complete 47,1"),
    );
    expect(dinged).toMatchObject({ before: 0, jump: 0, dinged: true });
    expect(dinged.earned).toBeCloseTo(68 / 1400);
    expect([dinged.card, ...dinged.notes].map(cardText)).toEqual([
      "Level 3: 4%\nXP: 68/1,400\nTo level 4: 1,332 xp",
      "12 kills\nKobold Laborer at Lv 3\nCount: from quest data\nMob: the objective's mob\nLevel 3 at kill 11 of 12",
    ]);
    expect(dinged.label).toBe("Level 3, 4%, 68/1,400 xp, 1,332 to level 4, +698 kill xp");
    const cap = stepXp(testRules, { level: 60, xp: 0 }, { ...none, state: { level: 60, xp: 0 }, xp: gain(0) }, names, step(".xp 60"));
    expect(cap).toMatchObject({ before: 1, earned: 0, jump: 0 });
    expect([cap.card, ...cap.notes].map(cardText)).toEqual(["Level 60"]);
  });

  it("gives each kill assumption a section, with a comment as its source, the turn-in that counts it, and a shared caveat once", () => {
    const tunnelers: KillAssumption = {
      at,
      objective,
      count: 6,
      countFrom: "override",
      mobFrom: "objective",
      itemId: 773,
      drops: [defaultDrop(475)],
      mobs: [{ npcId: 475, levels: [{ level: 5, kills: 6 }] }],
      xp: { settings: {}, rates: [{ base: 50, reward: 50, count: 6 }] },
    };
    const laborers: KillAssumption = {
      at: { ...at, line: 1 },
      objective: { questId: 3904, row: 0 },
      count: 3,
      countFrom: "data",
      mobFrom: "stepMob",
      mobLines: ["mob"],
      itemId: 11119,
      drops: [defaultDrop(80)],
      mobs: [
        {
          npcId: 80,
          levels: [
            { level: 4, kills: 2 },
            { level: 5, kills: 1 },
          ],
        },
      ],
      xp: { settings: {}, rates: [{ base: 60, reward: 60, count: 3 }] },
    };
    const atTurnIn: KillAssumption = {
      at: { ...at, line: 2 },
      objective: { questId: 16, row: 0 },
      count: 2,
      countFrom: "data",
      mobFrom: "objective",
      itemId: 159,
      drops: [defaultDrop(248464)],
      mobs: [{ npcId: 248464, levels: [{ level: 6, kills: 2 }] }],
    };
    const counted: StepNote = { kind: "killsAtTurnIn", at: { ...at, line: 2 }, questId: 16, kills: 2 };
    const up = { level: 6, at: laborers.at, kill: { entry: 1, n: 2, of: 3 } };
    const card = ring(
      { kills: [tunnelers, laborers, atTurnIn], levelUps: [up], notes: [counted] },
      ".complete 47,1 -- @sim kills=6",
      ".complete 3904,1 -- @sim killxp=60",
      ".turnin 16",
    );
    expect(card).toEqual([
      "6 kills for Gold Dust: +300 xp\nKobold Tunneler at Lv 5\nCount: from @sim kills=6, 50% drop chance\nMob: the objective's mob\nXP: 6 × 50",
      [
        "3 kills for Milly's Harvest: +180 xp",
        "2 Kobold Laborer at Lv 4",
        "1 Kobold Laborer at Lv 5",
        "Count: from quest data, 50% drop chance",
        "Mob: from .mob",
        "XP: 3 × 60",
        "Comment: @sim killxp=60",
        "Level 6 at kill 2 of 3",
      ].join("\n"),
      [
        "2 kills for Refreshing Spring Water",
        "Nimsy at Lv 6",
        "Count: from quest data, 50% drop chance",
        "Mob: the objective's mob",
        "Counted: here, at the turn-in",
        "Every drop chance above: the planner's default for a missing rate.",
      ].join("\n"),
    ]);
  });

  it("gives an estimated drop chance's percentage once, in the Count row", () => {
    const kills: KillAssumption = {
      at,
      objective: { questId: 16, row: 0 },
      count: 7,
      countFrom: "data",
      mobFrom: "objective",
      itemId: 159,
      drops: [{ npcId: 248464, chance: { value: 0.42, source: { kind: "estimated" } } }],
      mobs: [{ npcId: 248464, levels: [{ level: 6, kills: 7 }] }],
    };
    expect(ring({ kills: [kills] }, ".complete 16,1")).toEqual([
      [
        "7 kills for Refreshing Spring Water",
        "Nimsy at Lv 6",
        "Count: from quest data, 42% drop chance",
        "Mob: the objective's mob",
        "Drop chance: an estimated drop rate.",
      ].join("\n"),
    ]);
  });

  it("marks elite mobs, words an unknown item, gives drop chances that differ in full, and names extra= kills' comment as their mob", () => {
    const kills: KillAssumption = {
      at,
      objective,
      count: 5,
      countFrom: "override",
      mobFrom: "objective",
      itemId: null,
      drops: [defaultDrop(475), { npcId: 248464, chance: { value: 0.669, source: { kind: "estimated" } } }, defaultDrop(40)],
      mobs: [
        { npcId: 475, levels: [{ level: 5, kills: 3 }] },
        { npcId: 248464, elite: true, levels: [{ level: 6, kills: 2 }] },
      ],
      xp: { settings: {}, rates: [{ base: 50, reward: 50, count: 5 }] },
    };
    const extra: KillAssumption = {
      at: { ...at, line: 1 },
      count: 2,
      countFrom: "override",
      mobFrom: "override",
      mobs: [{ npcId: 80, levels: [{ level: 3, kills: 2 }] }],
    };
    const lines = [".complete 47,1", "-- @sim extra=2 mob=80"];
    expect(ring({ kills: [kills, extra] }, ...lines)).toEqual([
      [
        "5 kills: +250 xp",
        "3 Kobold Tunneler at Lv 5",
        "2 Nimsy (elite) at Lv 6",
        "Count: from kills=, 50% to 66.9% drop chance",
        "Mob: the objective's mob",
        "XP: 5 × 50",
        "Kobold Tunneler: 50% drop chance, the planner's default for a missing rate. Nimsy: 66.9% drop chance, an estimated drop rate.",
      ].join("\n"),
      "2 extra kills\nKobold Laborer at Lv 3\nMob: from @sim extra=2 mob=80",
    ]);
    const caveat = (chance: { value: number; source: NonNullable<KillAssumption["drops"]>[number]["chance"]["source"] }) =>
      ring({ kills: [{ ...kills, drops: [475, 248464].map((npcId) => ({ npcId, chance })) }] }, ...lines)[0]!
        .split("\n")
        .at(-1);
    expect(caveat({ value: 1, source: { kind: "guaranteed", source: "quest-rule:test" } })).toBe(
      "Kobold Tunneler, Nimsy drop chance: guaranteed while the quest needs the item.",
    );
    expect(caveat({ value: 0.5, source: { kind: "override" } })).toBe("Kobold Tunneler, Nimsy drop chance: from drop=.");
  });

  it("shows a comment as the source only of what its line sets, else in the first section that it sets or comes from", () => {
    const kills: KillAssumption = {
      at,
      objective,
      count: 4,
      countFrom: "data",
      mobFrom: "override",
      mobs: [{ npcId: 80, levels: [{ level: 5, kills: 4 }] }],
    };
    expect(ring({ kills: [kills] }, ".complete 47,1 -- @sim drop=0.5")).toEqual([
      "4 kills\nKobold Laborer at Lv 5\nCount: from quest data\nMob: from mob=\nComment: @sim drop=0.5",
    ]);
    expect(ring({ kills: [{ ...kills, countFrom: "override", mobFrom: "objective" }] }, ".complete 47,1 -- @sim drop=0.5")).toEqual([
      "4 kills\nKobold Laborer at Lv 5\nCount: from kills=\nMob: the objective's mob\nComment: @sim drop=0.5",
    ]);
    const extra: KillAssumption = {
      at,
      count: 2,
      countFrom: "override",
      mobFrom: "override",
      mobs: [{ npcId: 475, levels: [{ level: 5, kills: 2 }] }],
    };
    const own = { ...kills, mobFrom: "objective" } as const;
    expect(ring({ kills: [own, extra] }, ".complete 47,1 -- @sim extra=2 mob=475")).toEqual([
      "4 kills\nKobold Laborer at Lv 5\nCount: from quest data\nMob: the objective's mob",
      "2 extra kills\nKobold Tunneler at Lv 5\nMob: from @sim extra=2 mob=475",
    ]);
    const jump = { at, kind: "level", target: { kind: "plus", level: 5, xp: 2500 }, gap: 300, kills: null } as const;
    expect(ring({ kills: [own], checkpoints: [jump], xp: gain(0, 0, 300) }, ".complete 47,1 -- @sim level=5+2500").at(-1)).toBe(
      "Checkpoint: +300 xp\nComment: @sim level=5+2500",
    );
    const passed = { ...jump, at: { ...at, line: 1 }, gap: -50 };
    expect(ring({ checkpoints: [jump, passed], xp: gain(0, 0, 300) }, ".xp 5+2500", "-- @sim level=5")).toEqual(["Checkpoint: +300 xp"]);
  });

  it("gives a drop chance source that every kill section shares once, after the last", () => {
    const pair = (line: number, npcIds: number[]): KillAssumption => ({
      at: { ...at, line },
      objective,
      count: 4,
      countFrom: "data",
      mobFrom: "objective",
      itemId: 773,
      drops: npcIds.map(defaultDrop),
      mobs: npcIds.map((npcId) => ({ npcId, levels: [{ level: 5, kills: 2 }] })),
    });
    const lastLines = (...kills: KillAssumption[]) => ring({ kills }, ".complete 47,1", ".complete 47,1").map((s) => s.split("\n").at(-1));
    expect(lastLines(pair(0, [475, 248464]), pair(1, [80, 475]))).toEqual([
      "Mob: the objective's mob",
      "Every drop chance above: the planner's default for a missing rate.",
    ]);
    const mixed = pair(1, [80, 475]);
    mixed.drops![1]!.chance.source = { kind: "override" };
    expect(lastLines(pair(0, [475, 248464]), mixed)).toEqual([
      "Kobold Tunneler, Nimsy drop chance: the planner's default for a missing rate.",
      "Kobold Laborer drop chance: the planner's default for a missing rate. Kobold Tunneler drop chance: from drop=.",
    ]);
  });

  it("lists what the step does not count, with a comment on such a line", () => {
    const later: KillsLater = { kind: "killsLater", at, objective, reason: "completewith", countedAt: { guide: 0, step: 47, line: 1 } };
    const notes: StepNote[] = [
      { kind: "killsAtTurnIn", at: { ...at, line: 3 }, questId: 47, kills: 4 },
      later,
      { kind: "gathered", at: { ...at, line: 1 }, objective: { questId: 3904, row: 0 }, itemId: 11119, count: 8 },
      { kind: "bought", at: { ...at, line: 2 }, objective: { questId: 16, row: 0 }, itemId: 159, count: 1 },
    ];
    const lines = [".complete 47,1", ".complete 3904,1 -- @sim mob=80", ".complete 16,1", ".turnin 47"];
    expect(ring({ notes }, ...lines)).toEqual([
      [
        "Not counted here",
        "Gold Dust: kills at step 48 (#completewith step)",
        "8 Milly's Harvest: from objects: no kills",
        "Comment: @sim mob=80",
        "1 Refreshing Spring Water: bought: no kills",
      ].join("\n"),
      "Notes\nGold Dust Exchange: 4 kills counted here",
    ]);
    const where = (countedAt: KillsLater["countedAt"], reason: KillsLater["reason"] = "completewith") =>
      ring({ notes: [{ ...later, countedAt, reason }] }, ...lines)[0]!.split("\n")[1];
    expect(where({ guide: 0, step: 0, line: 5 }, "disablecheckbox")).toBe("Gold Dust: kills at line 6 (.disablecheckbox follows)");
    expect(where({ guide: 2, step: 2, line: 0 })).toBe("Gold Dust: kills at step 3 of 6-11 Elwynn Forest (#completewith step)");
    expect(where(null)).toBe("Gold Dust: kills never counted (#completewith step)");
    expect(ring({ notes: notes.slice(0, 1) }, ...lines)).toEqual(["Notes\nGold Dust Exchange: 4 kills counted here"]);
  });

  it("marks the ring with ! for kills counted later or never, with a dot for any other note or a comment, and not otherwise", () => {
    const later: StepNote = { kind: "killsLater", at, objective, reason: "completewith", countedAt: null };
    const gathered: StepNote = { kind: "gathered", at, objective, itemId: 773, count: 8 };
    const kills: KillAssumption = {
      at,
      objective,
      count: 1,
      countFrom: "data",
      mobFrom: "objective",
      mobs: [{ npcId: 80, levels: [{ level: 5, kills: 1 }] }],
    };
    const checkpoint = { at, kind: "xp", target: { kind: "plus", level: 5, xp: 2500 }, gap: 500, kills: null } as const;
    const mark = (snapshot: Notes, line = ".complete 47,1") => ringXp(snapshot, line).mark;
    expect([
      mark({}),
      mark({ notes: [gathered, later] }),
      mark({ notes: [gathered] }),
      mark({ kills: [kills] }),
      mark({ checkpoints: [checkpoint], xp: gain(0, 0, 500) }, ".xp 5+2500"),
      mark({ checkpoints: [checkpoint], xp: gain(0, 0, 500) }, "-- @sim level=5+2500"),
    ]).toEqual([undefined, "killsLater", "notes", "notes", undefined, "notes"]);
  });
});

describe("levelBands", () => {
  type Progress = { level: number; xp: number };
  const chain = (from: Progress, steps: { state: Progress; xp: XpGain }[]) =>
    steps.map((step, i) => ({ before: steps[i - 1]?.state ?? from, ...step }));

  it("splits each level's XP by step, with a level-up's XP on both sides of it", () => {
    const bands = levelBands(testRules, {
      afterHeader: { level: 2, xp: 80 },
      steps: chain({ level: 2, xp: 80 }, [
        { state: { level: 2, xp: 270 }, xp: gain(190) },
        { state: { level: 3, xp: 68 }, xp: gain(0, 698) },
        { state: { level: 3, xp: 68 }, xp: gain(0) },
        { state: { level: 3, xp: 1130 }, xp: gain(0, 0, 1062) },
        { state: { level: 4, xp: 0 }, xp: gain(270) },
      ]),
    });
    expect(
      bands.map(({ level, after, detail, segments }) => ({ level, after, detail, parts: segments.map((s) => `${s.kind}: ${s.text}`) })),
    ).toEqual([
      {
        level: 2,
        after: -1,
        detail: ["steps ", { mono: "1–2" }, " · ", { mono: "900" }, " xp"],
        parts: ["before: 80 xp before step 1", "earned: Step 1: +190 xp", "earned: Step 2: +630 xp"],
      },
      {
        level: 3,
        after: 1,
        detail: ["steps ", { mono: "2–5" }, " · ", { mono: "1,400" }, " xp"],
        parts: ["earned: Step 2: +68 xp", "jump: Step 4: +1,062 xp from a checkpoint", "earned: Step 5: +270 xp"],
      },
      { level: 4, after: 4, detail: [{ mono: "0%" }, " · ", { mono: "0/2,100" }, " xp"], parts: [] },
    ]);
    expect(bands[1]!.segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
  });

  it("opens one band for the last of several levels a step gains, splitting mixed XP by source", () => {
    const bands = levelBands(testRules, {
      afterHeader: { level: 1, xp: 0 },
      steps: [{ before: { level: 1, xp: 0 }, state: { level: 3, xp: 300 }, xp: gain(100, 0, 1500) }],
    });
    expect(bands.map((b) => [b.level, guideTextPlain(b.detail), b.segments.map((s) => s.text)])).toEqual([
      [1, "step 1 · 400 xp", ["Step 1: +25 xp", "Step 1: +375 xp from a checkpoint"]],
      [3, "21% · 300/1,400 xp", ["Step 1: +19 xp", "Step 1: +281 xp from a checkpoint"]],
    ]);
  });

  it("opens a band at the level that a step's state= sets on arrival", () => {
    const bands = levelBands(testRules, {
      afterHeader: { level: 2, xp: 80 },
      steps: [
        { before: { level: 2, xp: 80 }, state: { level: 2, xp: 270 }, xp: gain(190) },
        { before: { level: 4, xp: 500 }, state: { level: 4, xp: 700 }, xp: gain(200) },
      ],
    });
    expect(bands.map((b) => [b.level, b.after, guideTextPlain(b.detail), b.segments.map((s) => `${s.kind}: ${s.text}`)])).toEqual([
      [2, -1, "30% · 270/900 xp", ["before: 80 xp before step 1", "earned: Step 1: +190 xp"]],
      [4, 0, "33% · 700/2,100 xp", ["before: 500 xp set on arrival at step 2", "earned: Step 2: +200 xp"]],
    ]);
  });
});

describe("lineKillParts", () => {
  const at = { guide: 0, step: 0, line: 2 };
  const objective = { questId: 47, row: 0 };

  it("gives a line's sources and XP in short, with a card for each of its kills", () => {
    const kills: KillAssumption = {
      at,
      objective,
      count: 8,
      countFrom: "guideText",
      mobFrom: "stepMob",
      mobLines: ["mob"],
      itemId: 773,
      drops: [{ npcId: 475, chance: { value: 0.5, source: { kind: "default" as const } } }],
      mobs: [{ npcId: 475, levels: [{ level: 5, kills: 8 }] }],
      xp: { settings: {}, rates: [{ base: 50, reward: 50, count: 8 }] },
    };
    const extra: KillAssumption = {
      at,
      count: 2,
      countFrom: "override",
      mobFrom: "override",
      mobs: [{ npcId: 80, levels: [{ level: 3, kills: 2 }] }],
      xp: { settings: {}, rates: [{ base: 60, reward: 60, count: 2 }] },
    };
    const levelUps = [
      { level: 3, at, kill: { entry: 0, n: 6, of: 8 } },
      { level: 4, at, kill: { entry: 1, n: 2, of: 2 } },
    ];
    const parts = lineKillParts({ notes: [], kills: [kills, extra], levelUps }, 2, names)!;
    expect(parts).toMatchObject({ count: "from the guide text · 50% drop chance", mob: "from .mob", xp: 520, level: 4 });
    expect(parts.cards.map(cardText)).toEqual([
      [
        "8 kills for Gold Dust: +400 xp",
        "8 Kobold Tunneler at Lv 5",
        "Count: from the guide text, 50% drop chance",
        "Mob: from .mob",
        "XP: 8 × 50",
        "Level 3 at kill 6 of 8",
        "Kobold Tunneler: 50% drop chance, the planner's default for a missing rate.",
      ].join("\n"),
      "2 extra kills: +120 xp\n2 Kobold Laborer at Lv 3\nMob: from extra=\nXP: 2 × 60\nLevel 4 at kill 2 of 2",
    ]);
    expect(lineKillParts({ notes: [], kills: [kills], levelUps }, 3, names)).toBeUndefined();
  });

  it("says where a deferred line's kills count, and that gathered and bought items need none", () => {
    const later: KillsLater = { kind: "killsLater", at, objective, reason: "completewith", countedAt: { guide: 0, step: 47, line: 1 } };
    const parts = lineKillParts({ notes: [later], kills: [], levelUps: [] }, 2, names)!;
    expect(parts).toMatchObject({ count: "kills at step 48", mob: "", xp: 0 });
    expect(parts.cards.map(cardText)).toEqual([
      "No kills counted here\nQuest: Gold Dust Exchange\nWhy: #completewith step\nCounted: step 48",
    ]);
    const gathered = { kind: "gathered", at, objective: { ...objective, questId: 3904 }, itemId: 11119, count: 8 } as const;
    expect(lineKillParts({ notes: [gathered], kills: [], levelUps: [] }, 2, names)?.count).toBe("from objects: no kills");
    const water = { kind: "bought", at, objective: { ...objective, questId: 16 }, itemId: 159, count: 1 } as const;
    const bought = lineKillParts({ notes: [water], kills: [], levelUps: [] }, 2, names)!;
    expect([bought.count, ...bought.cards.map(cardText)]).toEqual([
      "bought: no kills",
      "No kills\nItem: 1 Refreshing Spring Water, bought",
    ]);
  });
});
