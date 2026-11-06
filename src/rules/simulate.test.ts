import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FlightNodes, type WorldLocation } from "../data/index.ts";
import { genericFile } from "../data/genericFixture.ts";
import { COMMANDS, extractGuides, parseGuide } from "../guide/index.ts";
import { advance } from "./character.ts";
import type { PlaybackChoices } from "./playbackSettings.ts";
import { createProfile } from "./profile.ts";
import {
  simulateRoute,
  type SimData,
  type SimItem,
  type SimNpc,
  type SimNumberedObjective,
  type SimQuest,
  type SimStart,
  type SimTextObjective,
} from "./simulate.ts";
import { simQuest, testRules } from "./testing.ts";
import { killXp, xpToNextLevel } from "./xp.ts";

const loc = (x: number, y: number, instance = 0): WorldLocation => ({ x, y, instance });
const shadowglen = (x: number, y: number): WorldLocation => loc(831 + x, 10331 + y, 1);

const QUESTS: Record<number, Pick<SimQuest, "name" | "level" | "requiredLevel">> = {
  7: { name: "Kobold Camp Cleanup", level: 2, requiredLevel: 1 },
  15: { name: "Investigate Echo Ridge", level: 3, requiredLevel: 1 },
  16: { name: "Give Gerard a Drink", level: 1, requiredLevel: 1 },
  18: { name: "Brotherhood of Thieves", level: 4, requiredLevel: 2 },
  21: { name: "Skirmish at Echo Ridge", level: 5, requiredLevel: 1 },
  33: { name: "Wolves Across the Border", level: 2, requiredLevel: 1 },
  40: { name: "A Fishy Peril", level: 10, requiredLevel: 7 },
  62: { name: "The Fargodeep Mine", level: 7, requiredLevel: 4 },
  86: { name: "Pie for Billy", level: 6, requiredLevel: 5 },
  170: { name: "A New Threat", level: 2, requiredLevel: 1 },
  255: { name: "Mercenaries", level: 19, requiredLevel: 15 },
  317: { name: "Stocking Jetsteam", level: 6, requiredLevel: 2 },
  319: { name: "A Favor for Evershine", level: 8, requiredLevel: 2 },
  412: { name: "Operation Recombobulation", level: 10, requiredLevel: 7 },
  456: { name: "The Balance of Nature", level: 2, requiredLevel: 1 },
  457: { name: "The Balance of Nature", level: 3, requiredLevel: 1 },
  458: { name: "The Woodland Protector", level: 1, requiredLevel: 1 },
  486: { name: "Ursal the Mauler", level: 12, requiredLevel: 4 },
  783: { name: "A Threat Within", level: 1, requiredLevel: 1 },
  1074: { name: "Ineptitude + Chemicals = Fun", level: 21, requiredLevel: 17 },
  1077: { name: "Special Delivery for Gaxim", level: 21, requiredLevel: 17 },
  1578: { name: "Supplying the Front", level: 12, requiredLevel: 1 },
  1581: { name: "Elixirs for the Bladeleafs", level: 8, requiredLevel: 4 },
  1640: { name: "Beat Bartleby", level: 10, requiredLevel: 10 },
  2459: { name: "Ferocitas the Dream Eater", level: 8, requiredLevel: 1 },
  3519: { name: "A Friend in Need", level: 4, requiredLevel: 2 },
  3861: { name: "CLUCK!", level: 1, requiredLevel: 1 },
  4449: { name: "Caught!", level: 45, requiredLevel: 43 },
  5084: { name: "Falling to Corruption", level: 56, requiredLevel: 52 },
  5121: { name: "High Chief Winterfall", level: 59, requiredLevel: 52 },
  5201: { name: "Winterfall Intrusion", level: 60, requiredLevel: 58 },
  5261: { name: "Eagan Peltskinner", level: 2, requiredLevel: 1 },
};

function questFacts(id: number): Pick<SimQuest, "name" | "level" | "requiredLevel"> {
  const facts = QUESTS[id];
  if (facts === undefined) throw new Error(`No facts for quest ${id}`);
  return facts;
}

function simData(
  quests: Record<number, Partial<SimQuest>>,
  places: Record<string, WorldLocation> = {},
  npcs: Record<number, SimNpc> = {},
  items: Record<number, SimItem> = {},
): SimData {
  const quest = (id: number): SimQuest | undefined => quests[id] && simQuest({ ...questFacts(id), ...quests[id] });
  return {
    quest,
    npc: (id) => npcs[id],
    item: (id) => items[id],
    rules: testRules,
    entityByName: () => undefined,
    locateGoto: (args) => places[args.join(",")],
    flights: new FlightNodes(genericFile().flightNodes),
    uiMapNamed: () => undefined,
  };
}

const guide = (name: string, text: string, header = "") => parseGuide(`#group G\n#name ${name}\n${header}${text}\n`);

function simulate(text: string, data: SimData, level = 1, xp = 0, header = "", choices: PlaybackChoices = {}) {
  return simulateRoute(
    [guide("A", text, header)],
    0,
    createProfile({ race: "Human", class: "WARRIOR", level }),
    data,
    xp,
    undefined,
    choices,
  );
}

const FARGODEEP: SimNumberedObjective = { index: 1, kind: "other", ids: [], count: null, name: "Scout through the Fargodeep Mine" };
const KOBOLD_VERMIN: SimNumberedObjective = { index: 1, kind: "monster", ids: [6], count: 10, name: "Kobold Vermin" };
const BALANCE_OF_NATURE: SimNumberedObjective[] = [
  { index: 1, kind: "monster", ids: [2031], count: 7, name: "Young Nightsaber" },
  { index: 2, kind: "monster", ids: [1984], count: 4, name: "Young Thistle Boar" },
];
const BLADELEAF_ELIXIRS: SimTextObjective[] = [
  { kind: "text", name: "Elixir of Minor Strength", count: 6, need: "action", link: { kind: "item", id: 2454 } },
  { kind: "text", name: "Elixir of Minor Defense", count: 2, need: "action", link: { kind: "item", id: 5997 } },
];

describe("simulateRoute", () => {
  it("credits guaranteed items from kills for another objective", () => {
    const data = simData(
      {
        319: { objectives: [{ index: 2, kind: "monster", ids: [1127], count: 2, name: "Elder Crag Boar" }] },
        317: { objectives: [{ index: 1, kind: "item", ids: [769], count: 2, name: "Chunk of Boar Meat" }] },
      },
      {},
      { 1127: { levels: { min: 7, max: 8 }, elite: false, zoneIds: [] } },
      {
        769: {
          droppers: [{ id: 1127, guaranteed: { source: "quest-rule:test" }, chance: 0.25 }],
          objectsOnly: false,
          sold: false,
        },
      },
    );
    const result = simulate("step\n.accept 319\n.accept 317\nstep\n.complete 319,2\n.collect 769,2,317,1\nstep\n.complete 317,1", data);
    expect(result.guides[0]!.steps.map((s) => s.kills.map((k) => k.count))).toEqual([[], [2], []]);
    expect(result.guides[0]!.steps[1]!.state.log.get(317)?.objectives[0]?.count).toBe(2);
  });
  it("pays pass-by kills at the level before the turn-in that follows them", () => {
    const data = {
      ...simData(
        { 456: { objectives: [{ index: 1, kind: "monster", ids: [2031], count: 2, name: "Young Nightsaber" }] }, 458: { baseXp: 100 } },
        { "Teldrassil,1,1": shadowglen(0, 0), "Teldrassil,2,2": shadowglen(200, 0) },
        { 2031: { levels: { min: 1, max: 1 }, elite: false, zoneIds: [] } },
      ),
      spawns: () => [{ ...shadowglen(100, 20), id: "nightsaber" }],
    };
    const text =
      "step\n.goto Teldrassil,1,1\n.accept 456\n.accept 458\nstep\n#completewith Camp\n.complete 456,1\n.mob Young Nightsaber::2031\nstep\n#label Camp\n.goto Teldrassil,2,2\n.turnin 458";
    const step = simulate(text, data, 1, 390).guides[0]!.steps[2]!;
    expect([step.state.level, step.state.xp, step.xp, step.kills.map((k) => k.count)]).toEqual([
      2,
      140,
      { quest: 100, kills: 50, checkpoint: 0 },
      [1],
    ]);
    expect([step.kills[0]!.xp!.rates, step.turnIns.map((t) => t.xp)]).toEqual([[{ base: 50, reward: 50, count: 1 }], [100]]);
    expect(step.levelUps).toEqual([{ level: 2, at: { guide: 0, step: 2 }, kill: { entry: 0, n: 1, of: 1 } }]);
    expect(step.acts.flatMap((a) => a.effects.filter((e) => e.kind === "xp").map((e) => [a.kind, e.level, e.xp]))).toEqual([
      ["kill", 2, 40],
      ["interact", 2, 140],
    ]);
    const folded = step.acts.flatMap((a) => a.effects).reduce(advance, step.before);
    expect([folded.level, folded.xp, [...folded.done], folded.log.get(456)!.objectives[0]!.count]).toEqual([2, 140, [458], 1]);
  });

  describe("after a pass-by kill that the walk puts before the step's lines", () => {
    const npc = (min: number, max = min): SimNpc => ({ levels: { min, max }, elite: false, zoneIds: [] });
    const camp = (npcs: Record<number, SimNpc>, spawns: Record<number, { x: number; y: number; id: string }[]>) => ({
      ...simData(
        {
          456: { objectives: [{ index: 1, kind: "monster", ids: [2031], count: 2, name: "Young Nightsaber" }] },
          458: { baseXp: 100 },
          3519: {},
        },
        { "Teldrassil,1,1": shadowglen(0, 0), "Teldrassil,2,2": shadowglen(200, 0) },
        npcs,
      ),
      spawns: (id: number) => (spawns[id] ?? []).map((p) => ({ ...shadowglen(p.x, p.y), id: p.id })),
      npcsWithSpawns: () => Object.keys(spawns).map(Number),
    });
    const nightsaber = camp({ 2031: npc(1) }, { 2031: [{ x: 100, y: 20, id: "nightsaber" }] });
    const run = (lines: string, data: SimData, level = 1, xp = 390) =>
      simulate(
        `step\n.goto Teldrassil,1,1\n.accept 456\n.accept 458\nstep\n#completewith Camp\n.complete 456,1\n.mob Young Nightsaber::2031\nstep\n#label Camp\n${lines}`,
        data,
        level,
        xp,
      );
    const last = (lines: string, data = nightsaber, level?: number, xp?: number) => run(lines, data, level, xp).guides[0]!.steps.at(-1)!;

    it("drops the grind of a checkpoint that the kill and the turn-in already reach", () => {
      const step = last(".goto Teldrassil,2,2\n.turnin 458\n.xp 2+140 -- @sim mob=2031");
      expect([
        step.state.level,
        step.state.xp,
        step.xp,
        step.checkpoints.map((c) => [c.gap, c.kills]),
        step.acts.map((a) => a.kind),
      ]).toEqual([2, 140, { quest: 100, kills: 50, checkpoint: 0 }, [[0, null]], ["kill", "go", "interact", "update", "update"]]);
    });

    it("counts a checkpoint's gap and grind kills from the XP that the kill and the turn-in give", () => {
      const step = last(".goto Teldrassil,2,2\n.turnin 458\n.xp 2+180 -- @sim mob=2031");
      expect([step.state.level, step.state.xp, step.xp.checkpoint, step.checkpoints.map((c) => [c.gap, c.kills])]).toEqual([
        2,
        180,
        40,
        [[40, { count: 1, mobs: [{ npcId: 2031, count: 1 }] }]],
      ]);
    });

    it("warns about no gap for a level= checkpoint that the kill and the turn-in reach", () => {
      const { warnings } = run(".goto Teldrassil,2,2\n.turnin 458 -- @sim level=2+140", nightsaber);
      expect(warnings.filter((w) => w.kind === "checkpointGap" || w.kind === "checkpointBehind")).toEqual([]);
    });

    it("checks an accept's required level after the kill", () => {
      const { warnings } = run(".goto Teldrassil,2,2\n.accept 3519\n.turnin 458", nightsaber);
      expect(warnings.filter((w) => w.kind === "levelTooLow")).toEqual([]);
    });

    const walk = (
      zone: string,
      at: (x: number, y: number) => WorldLocation,
      quests: Record<number, Partial<SimQuest>>,
      npcs: Record<number, SimNpc>,
      spawns: Record<number, { x: number; y: number }[]>,
    ): SimData => ({
      ...simData(quests, { [`${zone},1,1`]: at(0, 0), [`${zone},2,2`]: at(200, 0) }, npcs),
      spawns: (id: number) => (spawns[id] ?? []).map((p, i) => ({ ...at(p.x, p.y), id: `npc:${id}:${i}` })),
      npcsWithSpawns: () => Object.keys(spawns).map(Number),
    });

    it("picks the grind mob at the level that the kill reaches", () => {
      const mystics: SimNumberedObjective = { index: 1, kind: "monster", ids: [7235], count: 7, name: "Gnarlpine Mystic" };
      const jewel: SimNumberedObjective = { index: 2, kind: "item", ids: [8050], count: 1, name: "Tallonkai's Jewel" };
      const data = walk(
        "Teldrassil",
        (x, y) => loc(320 + x, 10056 + y, 1),
        { 2459: { objectives: [mystics, jewel] } },
        { 7235: npc(6, 7), 1989: npc(3, 4), 2018: npc(9) },
        { 7235: [{ x: 100, y: 20 }], 1989: [0, 5, 10].map((x) => ({ x, y: 30 })), 2018: [0, 5].map((x) => ({ x, y: -30 })) },
      );
      const text =
        "step\n.goto Teldrassil,1,1\n.accept 2459\nstep\n#completewith Camp\n.complete 2459,1\n.mob Gnarlpine Mystic::7235\nstep\n#label Camp\n#loop\n.xp 9+400\n.goto Teldrassil,2,2";
      const step = simulate(text, data, 8, xpToNextLevel(testRules, 8) - 10).guides[0]!.steps.at(-1)!;
      expect([step.state.level, step.state.xp, step.checkpoints.map((c) => [c.gap, c.kills])]).toEqual([
        9,
        400,
        [[353, { count: 4, mobs: [{ npcId: 2018, count: 4 }] }]],
      ]);
    });

    it("gives no turn-in XP once the kill reaches level 60", () => {
      const shamans: SimNumberedObjective = { index: 1, kind: "monster", ids: [7439], count: 5, name: "Winterfall Shaman" };
      const ursas: SimNumberedObjective = { index: 2, kind: "monster", ids: [7438], count: 5, name: "Winterfall Ursa" };
      const data = walk(
        "Winterspring",
        (x, y) => loc(-4960 + x, 6763 + y, 1),
        { 5201: { objectives: [shamans, ursas] }, 5084: { baseXp: 100 } },
        { 7438: npc(57, 58) },
        { 7438: [{ x: 100, y: 20 }] },
      );
      const text =
        "step\n.goto Winterspring,1,1\n.accept 5201\n.accept 5084\nstep\n#completewith Camp\n.complete 5201,2\n.mob Winterfall Ursa::7438\nstep\n#label Camp\n.goto Winterspring,2,2\n.turnin 5084";
      const step = simulate(text, data, 59, xpToNextLevel(testRules, 59) - 10).guides[0]!.steps.at(-1)!;
      expect([step.state.level, step.xp, step.turnIns, step.acts.flatMap((a) => a.effects.filter((e) => e.kind === "xp"))]).toEqual([
        60,
        { quest: 0, kills: 298, checkpoint: 0 },
        [],
        [{ kind: "xp", level: 60, xp: 0 }],
      ]);
    });
  });

  it("kills one pass-by mob at each of two spawns at one spot", () => {
    const rows = [
      { ...shadowglen(100, 20), id: "npc:2031:286" },
      { ...shadowglen(100, 20), id: "npc:2031:287" },
    ];
    const data = {
      ...simData(
        { 456: { objectives: [{ index: 1, kind: "monster", ids: [2031], count: 2, name: "Young Nightsaber" }] }, 458: { baseXp: 100 } },
        { "Teldrassil,1,1": shadowglen(0, 0), "Teldrassil,2,2": shadowglen(200, 0) },
        { 2031: { levels: { min: 1, max: 1 }, elite: false, zoneIds: [] } },
      ),
      spawns: () => rows,
    };
    const text =
      "step\n.goto Teldrassil,1,1\n.accept 456\n.accept 458\nstep\n#completewith Camp\n.complete 456,1\n.mob Young Nightsaber::2031\nstep\n#label Camp\n.goto Teldrassil,2,2\n.turnin 458";
    const step = simulate(text, data).guides[0]!.steps[2]!;
    expect(step.acts.flatMap((a) => (a.kind === "kill" && a.passBy ? a.passBy.kills : []))).toEqual([
      { npcId: 2031, at: rows[0], level: 1 },
      { npcId: 2031, at: rows[1], level: 1 },
    ]);
  });

  it("splits objective kills across legs and credits each row with its last kill", () => {
    const data = {
      ...simData(
        {
          456: {
            objectives: [
              { index: 1, kind: "monster", ids: [2031], count: 2, name: "Young Nightsaber" },
              { index: 2, kind: "monster", ids: [1984], count: 1, name: "Young Thistle Boar" },
            ],
          },
          458: { baseXp: 300 },
          3519: {},
        },
        { "Teldrassil,1,1": shadowglen(0, 0), "Teldrassil,2,2": shadowglen(200, 0), "Teldrassil,3,3": shadowglen(600, 0) },
        {
          2031: { levels: { min: 1, max: 1 }, elite: false, zoneIds: [] },
          1984: { levels: { min: 1, max: 2 }, elite: false, zoneIds: [] },
        },
      ),
      spawns: (npc: number) =>
        (npc === 2031 ? [shadowglen(100, 0), shadowglen(500, 0)] : [shadowglen(300, 0)]).map((p) => ({ ...p, id: `${npc}:${p.x}` })),
    };
    const text =
      "step\n.goto Teldrassil,1,1\n.accept 456\n.accept 458\nstep\n#completewith Camp\n.complete 456,1\n.complete 456,2\nstep\n#label Camp\n.goto Teldrassil,2,2\n.accept 3519\n.goto Teldrassil,3,3\n.turnin 458";
    const step = simulate(text, data).guides[0]!.steps[2]!;
    expect([step.state.level, step.state.xp, step.kills.map((k) => k.count)]).toEqual([2, 50, [2, 1]]);
    expect(step.acts.filter((a) => a.kind !== "update").map((a) => a.kind)).toEqual([
      "kill",
      "go",
      "interact",
      "kill",
      "kill",
      "go",
      "interact",
    ]);
    expect(
      step.acts
        .filter((a) => a.kind === "kill")
        .map((a) => [
          a.kills[0]!.count,
          a.kills[0]!.xp!.rates,
          a.effects.filter((e) => e.kind === "objective").map((e) => [e.ref.row, e.progress.count]),
        ]),
    ).toEqual([
      [1, [{ base: 50, reward: 50, count: 1 }], []],
      [1, [{ base: 50, reward: 50, count: 1 }], [[1, 1]]],
      [1, [{ base: 50, reward: 50, count: 1 }], [[0, 2]]],
    ]);
    expect(step.acts.flatMap((a) => a.effects).reduce(advance, step.before)).toEqual(step.state);
  });

  it("shows a step once a turn-in reaches its level", () => {
    const data = simData({ 783: { baseXp: 2800 } });
    const { guides } = simulate("step\n.accept 783\n.turnin 783\nstep << 5\n.accept 7\nstep << 6\n.accept 18", data, 4);
    const [turnIn, atFive, atSix] = guides[0]!.steps;
    expect(turnIn!.levelUps).toEqual([{ level: 5, at: { guide: 0, step: 0, line: 1 } }]);
    expect(turnIn!.xp).toEqual({ quest: 2800, kills: 0, checkpoint: 0 });
    expect(atFive!.preview.shown).toBe(true);
    expect([...atFive!.state.log.keys()]).toEqual([7]);
    expect(atSix!.preview.shown).toBe(false);
    expect(atSix!.state).toBe(atFive!.state);
  });

  it("turns in a quest missing from the log, but not one already turned in", () => {
    const { guides } = simulate("step\n.turnin 783\nstep\n.turnin 783", simData({ 783: { baseXp: 100 } }));
    const [first, again] = guides[0]!.steps;
    expect(first!.xp.quest).toBe(100);
    expect(again!.xp.quest).toBe(0);
    expect(again!.state).toEqual(first!.state);
  });

  it("passes over an accept of a quest already turned in", () => {
    const data = simData({ 62: { baseXp: 100, objectives: [FARGODEEP] } });
    const text = "step\n.accept 62\n.complete 62,1\n.turnin 62\nstep\n.accept 62\n.complete 62,1\n.turnin 62";
    const { guides, warnings } = simulate(text, data, 3);
    const [first, again] = guides[0]!.steps;
    expect(first!.xp.quest).toBe(100);
    expect(again!.xp.quest).toBe(0);
    expect(again!.state).toEqual(first!.state);
    expect(again!.state.log.has(62)).toBe(false);
    expect(again!.state.done.has(62)).toBe(true);
    expect(warnings.filter((w) => w.kind === "levelTooLow")).toEqual([
      { kind: "levelTooLow", at: { guide: 0, step: 0, line: 0 }, questId: 62, level: 3, requiredLevel: 4 },
    ]);
  });

  it("keeps a completed quest that is not turned in when accepted again", () => {
    const data = simData({ 62: { objectives: [FARGODEEP] } });
    const { guides, warnings } = simulate("step\n.accept 62\n.complete 62,1\nstep\n.accept 62", data, 3);
    const [first, again] = guides[0]!.steps;
    expect(again!.state.log.get(62)).toBe(first!.state.log.get(62));
    expect(again!.state.log.get(62)!.status).toBe("complete");
    expect(warnings.filter((w) => w.kind === "levelTooLow").map((w) => w.at)).toEqual([{ guide: 0, step: 0, line: 0 }]);
  });

  it("records each turn-in's quest XP with its line", () => {
    const data = simData({ 783: { baseXp: 100 }, 7: { baseXp: 250 }, 16: { baseXp: null } });
    const [step] = simulate("step\n.turnin 783\n.accept 7\n.turnin 7\n.turnin 16", data).guides[0]!.steps;
    expect(step!.turnIns).toEqual([
      { at: { guide: 0, step: 0, line: 0 }, questId: 783, xp: 100 },
      { at: { guide: 0, step: 0, line: 2 }, questId: 7, xp: 250 },
    ]);
  });

  it("carries XP across #next", () => {
    const docs = [guide("A", "step\n.turnin 783", "#next B\n"), guide("B", "step\n.accept 7")];
    const profile = createProfile({ race: "Human", class: "WARRIOR" });
    const route = simulateRoute(docs, 0, profile, simData({ 783: { baseXp: 500 } }));
    expect(route.guides.map((g) => g.source)).toEqual([0, 1]);
    expect(route.guides[1]!.start).toMatchObject({ level: 2, xp: 100 });
    expect(route.guides[1]!.end).toMatchObject({ level: 2, xp: 100 });
  });

  it("jumps up to a checkpoint above the state and keeps the state below one", () => {
    const text = "step -- @sim level=3\n.xp 3+100\n.xp 4,1\n.goto Elwynn Forest,1,1 -- @sim level=2";
    const { guides, warnings } = simulate(text, simData({}));
    const step = guides[0]!.steps[0]!;
    expect(step.levelUps).toEqual([
      { level: 2, at: { guide: 0, step: 0 } },
      { level: 3, at: { guide: 0, step: 0 } },
    ]);
    expect(step.checkpoints.map((c) => [c.kind, c.gap])).toEqual([
      ["level", 1300],
      ["xp", 100],
      ["level", -1000],
    ]);
    expect(step.xp.checkpoint).toBe(1400);
    expect(step.state).toMatchObject({ level: 3, xp: 100 });
    expect(warnings).toEqual([
      { kind: "checkpointGap", at: { guide: 0, step: 0 }, target: { level: 3, xp: 0 }, xp: 1300, kills: null },
      { kind: "checkpointBehind", at: { guide: 0, step: 0, line: 2 }, target: { level: 2, xp: 0 }, xp: 1000 },
    ]);
  });

  it("reads 8-300 as 300 XP short of level 8", () => {
    const { guides } = simulate("step\n.xp 8-300", simData({}));
    expect(guides[0]!.end).toMatchObject({ level: 7, xp: xpToNextLevel(testRules, 7) - 300 });
  });

  it("starts with the quests that predecessor guides and done= turn in", () => {
    const docs = [
      guide("P", "step\n.accept 10\n.turnin 10\n.accept 11", "#next S\n"),
      guide("S", "step\n.accept 20", "-- @sim done=12 level=2\n"),
      guide("U", "step\n.turnin 13"),
    ];
    const profile = createProfile({ race: "Human", class: "WARRIOR" });
    const route = simulateRoute(docs, 1, profile, simData({}));
    expect([...route.start.done]).toEqual([10]);
    expect(route.start.log.size).toBe(0);
    const s = route.guides[0]!;
    expect([...s.afterHeader.done]).toEqual([10, 12]);
    expect(s.afterHeader).toMatchObject({ level: 2, xp: 0 });
    expect(s.checkpoints.map((c) => c.gap)).toEqual([400]);
    expect(s.steps[0]!.levelUps).toEqual([]);
  });

  it("takes a quest that a header's done= turns in out of the log, with the kills that it still owed", () => {
    const docs = [
      guide("P", "step\n.goto Elwynn Forest,1,1\n.accept 412\n.complete 412,1,1", "#next S\n"),
      guide("S", "step\n.goto Elwynn Forest,1,1,10\n.collect 3083,3,412", "-- @sim done=412\n"),
    ];
    const data = simData(
      { 412: { objectives: [{ index: 1, kind: "item", ids: [3083], count: 3, name: "Restabilization Cog" }] } },
      { "Elwynn Forest,1,1": loc(1, 1), "Elwynn Forest,1,1,10": loc(1, 1) },
      { 1211: { levels: { min: 8, max: 10 }, elite: false, zoneIds: [1] } },
      { 3083: { droppers: [{ id: 1211 }], sold: false, objectsOnly: false } },
    );
    const s = simulateRoute(docs, 0, createProfile({ race: "Human", class: "WARRIOR" }), data).guides[1]!;
    expect([[...s.afterHeader.log.keys()], [...s.afterHeader.done]]).toEqual([[], [412]]);
    // RXP completes a .collect line for a quest turned in (`addon.functions.collect` in functions.lua).
    expect(s.steps[0]!.acts).toEqual([]);
  });

  it("runs predecessors with hardcore mode off, even after a #hardcore guide", () => {
    const docs = [
      guide("A", "step\n.turnin 783", "#hardcore\n#next B\n"),
      guide("B", "step\n#hardcore\n.turnin 7\nstep\n#softcore\n.turnin 33", "#next S\n"),
      guide("S", "step"),
    ];
    const route = simulateRoute(docs, 2, createProfile({ race: "Human", class: "WARRIOR" }), simData({}));
    expect([...route.start.done].sort((a, b) => a - b)).toEqual([33, 783]);
  });

  it("counts no prior turn-ins from a guide that a later guide with its group and name replaces", () => {
    // `addon.AddGuide` in GuideLoader.lua stores each guide at `addon.guides["group||name"]`,
    // so RXP never loads the first A.
    const docs = [
      guide("A", "step\n.accept 7\n.turnin 7", "#next B\n"),
      guide("B", "step\n.accept 16"),
      guide("A", "step\n.accept 15\n.turnin 15", "#next B\n"),
    ];
    const route = simulateRoute(docs, 1, createProfile({ race: "Human", class: "WARRIOR" }), simData({}));
    expect([...route.start.done]).toEqual([15]);
  });

  it("tracks objective progress to the turn-in", () => {
    const data = simData({ 456: { objectives: BALANCE_OF_NATURE }, 458: {} });
    const text = [
      "step\n.accept 456\n.accept 458",
      "step\n.complete 456,1,3",
      "step\n.complete 456,1",
      "step\n.complete 456,2",
      "step\n.turnin 456",
    ];
    const steps = simulate(text.join("\n"), data).guides[0]!.steps;
    const quest = (i: number) => steps[i]!.state.log.get(456);
    expect(quest(0)).toMatchObject({
      status: "incomplete",
      objectives: [
        { count: 0, complete: false },
        { count: 0, complete: false },
      ],
    });
    expect(steps[0]!.state.log.get(458)?.status).toBe("complete");
    expect(quest(1)).toMatchObject({
      status: "partial",
      objectives: [
        { count: 3, complete: false },
        { count: 0, complete: false },
      ],
    });
    expect(quest(2)).toMatchObject({
      status: "partial",
      objectives: [
        { count: 7, complete: true },
        { count: 0, complete: false },
      ],
    });
    expect(quest(3)).toMatchObject({
      status: "complete",
      objectives: [
        { count: 7, complete: true },
        { count: 4, complete: true },
      ],
    });
    expect(quest(4)).toBeUndefined();
    expect(steps[4]!.state.done.has(456)).toBe(true);
  });

  it("maps .complete to text rows when a quest has no numbered objectives", () => {
    const data = simData({ 1581: { objectives: BLADELEAF_ELIXIRS } });
    const steps = simulate("step\n.accept 1581\n.complete 1581,1\nstep\n.complete 1581,2,1\n.complete 1581,3", data).guides[0]!.steps;
    expect(steps[0]!.state.log.get(1581)).toMatchObject({
      status: "partial",
      objectives: [
        { count: 6, complete: true },
        { count: 0, complete: false },
      ],
    });
    expect(steps[1]!.state.log.get(1581)!.objectives).toMatchObject([
      { count: 6, complete: true },
      { count: 1, complete: false },
    ]);
  });

  it("counts the items a .collect line holds toward its quest's objectives for them, from the accept on", () => {
    const item = (index: number, id: number, count: number, name: string) => ({ index, kind: "item" as const, ids: [id], count, name });
    const data = simData({
      317: { objectives: [item(1, 769, 4, "Chunk of Boar Meat"), item(2, 6952, 2, "Thick Bear Fur")] },
      1581: { objectives: BLADELEAF_ELIXIRS },
    });
    const text = [
      "step\n.collect 769,2,317,1",
      "step\n.accept 317\n.accept 1581",
      "step\n.collect 769,4,317,1\n.collect 6952,5,317,1\n.collect 750,1,317,1",
      "step\n.collect 2454,6,1581,1\n.collect 5997,2,1581,1",
      "step\n.isQuestComplete 317",
    ];
    const steps = simulate(text.join("\n"), data).guides[0]!.steps;
    expect(steps[0]!.state.log.size).toBe(0);
    expect(steps[1]!.state.log.get(317)).toMatchObject({ status: "partial", objectives: [{ count: 2, complete: false }, { count: 0 }] });
    expect(steps[2]!.state.log.get(317)).toMatchObject({
      status: "complete",
      objectives: [
        { count: 4, complete: true },
        { count: 2, complete: true },
      ],
    });
    expect(steps[3]!.state.log.get(1581)).toMatchObject({
      status: "complete",
      objectives: [
        { count: 6, complete: true },
        { count: 2, complete: true },
      ],
    });
    expect(steps[4]!.preview.shown).toBe(true);
    const again = simulate(
      "step\n.collect 769,2,317,1\nstep\n.accept 317\nstep\n.abandon 317\nstep\n.accept 317",
      data,
    ).guides[0]!.steps.at(-1)!;
    expect(again.state.log.get(317)!.objectives.map((o) => [o.count, o.complete])).toEqual([
      [2, false],
      [0, false],
    ]);
  });

  it("counts no items for a .collect line that RXP completes without them (v4.11.26 functions.lua:2976-3056, 3189-3194)", () => {
    const data = simData({ 33: { objectives: [{ index: 1, kind: "item", ids: [750], count: 3, name: "Tough Wolf Meat" }] }, 783: {} });
    const count = (lines: string, before = "") =>
      simulate(`${before}step\n.accept 33\n${lines}`, data).guides[0]!.steps.at(-1)!.state.log.get(33)?.objectives[0]?.count;
    expect(count(".collect 750,3,33")).toBe(0);
    expect(count(".collect 750,3,33,1,1")).toBe(0);
    expect(count(".collect 750,3,33,1,0x20,cooking")).toBe(0);
    expect(count(".collect 750,3")).toBe(0);
    expect(count(".collect 750,3,783,1")).toBe(0);
    expect(count(".collect 750/769,3,33,1")).toBe(0);
    expect(count("", "step\n.collect 750,3,33\n")).toBe(3);
    expect(count(".collect 750,3,33,1,0x10")).toBe(3);
  });

  it("leaves progress unchanged for an objective index that is not a whole number", () => {
    const data = simData({ 1581: { objectives: BLADELEAF_ELIXIRS }, 62: { objectives: [FARGODEEP] } });
    const step = simulate("step\n.accept 1581\n.accept 62\n.complete 1581,1.5\n.complete 62,1.5", data).guides[0]!.steps[0]!;
    expect(step.state.log.get(1581)!.status).toBe("incomplete");
    expect(step.state.log.get(62)!.status).toBe("incomplete");
  });

  it("drops abandoned quests without XP and restarts them on accept", () => {
    const data = simData({ 7: { baseXp: 400, objectives: [KOBOLD_VERMIN] }, 783: {} });
    const text = "step\n.accept 783\n.accept 7\n.complete 7,1,2\nstep\n.abandon 7,783\nstep\n.accept 7";
    const [, abandon, again] = simulate(text, data).guides[0]!.steps;
    expect(abandon!.state).toMatchObject({ level: 1, xp: 0 });
    expect(abandon!.state.log.size).toBe(0);
    expect(abandon!.state.done.size).toBe(0);
    expect(again!.state.log.get(7)).toMatchObject({ status: "incomplete", objectives: [{ count: 0, complete: false }] });
  });

  it("abandons nothing for a negative ID, so the step completes on arrival", () => {
    // `addon.functions.abandon` keeps the sign, and no quest in the log has a negative ID.
    const data = simData({ 7: {} }, { "Elwynn Forest,40,50": loc(-130.58, -8911.71) });
    const text = "step\n.accept 7\nstep\n.abandon -7\n+Look around\nstep\n.abandon -7\n.goto Elwynn Forest,40,50";
    const [, held, arrived] = simulate(text, data).guides[0]!.steps;
    expect([...held!.state.log.keys()]).toEqual([7]);
    expect(arrived!.acts).toEqual([]);
  });

  it("skips a negative turn-in when the quest is missing, or incomplete with a second argument", () => {
    const workers: SimNumberedObjective = { index: 1, kind: "monster", ids: [257], count: 10, name: "Kobold Worker" };
    const data = simData({ 15: { baseXp: 100, objectives: [workers] }, 5261: { baseXp: 100 } });
    const text = "step\n.accept 15\nstep\n.turnin -15,1\n.turnin -5261\nstep\n.complete 15,1\n.turnin -15,1";
    const [, skipped, turnedIn] = simulate(text, data).guides[0]!.steps;
    expect(skipped!.state.log.has(15)).toBe(true);
    expect(skipped!.state.done.size).toBe(0);
    expect(turnedIn!.xp.quest).toBe(100);
    expect([...turnedIn!.state.done]).toEqual([15]);
  });

  // RXP reads a negative `.accept` ID as is, and no quest has that ID (`addon.functions.accept` in functions.lua).
  it("accepts no quest for a negative .accept", () => {
    const data = simData({ 15: {} });
    const [step] = simulate("step\n.accept -15", data).guides[0]!.steps;
    expect(step!.state.log.size).toBe(0);
  });

  it("stops XP at level 60 and keeps tracking quests", () => {
    const data = simData({ 5121: { baseXp: 1000 }, 5201: { baseXp: 1000 } });
    const { guides } = simulate("step\n.turnin 5121\nstep\n.accept 5201\nstep\n.turnin 5201", data, 59, xpToNextLevel(testRules, 59) - 10);
    const [first, accept, turnIn] = guides[0]!.steps;
    expect(first!.state).toMatchObject({ level: 60, xp: 0 });
    expect(accept!.state.log.has(5201)).toBe(true);
    expect(turnIn!.xp.quest).toBe(0);
    expect(turnIn!.state).toMatchObject({ level: 60, xp: 0 });
    expect(turnIn!.state.log.has(5201)).toBe(false);
    expect(turnIn!.state.done.has(5201)).toBe(true);
  });

  it("warns about a level too low to accept and a turn-in without XP", () => {
    const data = simData({ 40: {}, 16: { baseXp: null } });
    const { warnings } = simulate("step\n.accept 40\n.turnin 16", data, 3);
    expect(warnings).toEqual([
      { kind: "noQuestXp", at: { guide: 0, step: 0, line: 1 }, questId: 16 },
      { kind: "levelTooLow", at: { guide: 0, step: 0, line: 0 }, questId: 40, level: 3, requiredLevel: 7 },
    ]);
  });

  it.each(["goto", "groundgoto", "flygoto"])(
    "travels directly to Kharanos without optional .%s waypoints, including a zero flag",
    (command) => {
      const text = [
        "step",
        ".goto 1426,43.316,56.283,60,0",
        ".goto 1426,43.949,52.524,60,1",
        ".goto 1426,38.677,60.561,60,flag",
        ".goto 1426/0,-499.17,-5644.37",
        ".xp 5+1595",
      ].join("\n");
      const data = simData(
        {},
        {
          "1426,43.316,56.283,60,0": loc(-331.23, -5725.04),
          "1426,43.949,52.524,60,1": loc(-362.4, -5601.62),
          "1426,38.677,60.561,60,flag": loc(-102.76, -5865.5),
          "1426/0,-499.17,-5644.37": loc(-499.17, -5644.37),
        },
      );
      const [step] = simulateRoute(
        [guide("5-11 Dun Morogh", text.replaceAll(".goto", `.${command}`))],
        0,
        createProfile({ race: "Dwarf", class: "WARRIOR", level: 5 }),
        data,
      ).guides[0]!.steps;
      expect(step!.acts.filter((act) => act.kind === "go").map((act) => act.to)).toEqual([{ instance: 0, x: -499.17, y: -5644.37 }]);
      expect(step!.state).toMatchObject({ level: 5, xp: 1595 });
    },
  );

  it.each(["goto", "groundgoto", "flygoto"])("uses only the last optional .%s as the fallback destination", (command) => {
    const data = simData({}, { "Elwynn Forest,48,42,60,0": loc(-130.58, -8911.71), "Elwynn Forest,42,65,60,0": loc(77.67, -9444.06) });
    const [step] = simulate(`step\n.${command} Elwynn Forest,48,42,60,0\n.${command} Elwynn Forest,42,65,60,0\n.xp 2`, data).guides[0]!
      .steps;
    expect(step!.acts.filter((act) => act.kind === "go").map((act) => [act.to, act.target.kind])).toEqual([
      [{ instance: 0, x: 77.67, y: -9444.06 }, "guidePlace"],
    ]);
    expect(step!.state).toMatchObject({ level: 2, xp: 0 });
  });

  // RXP runs `.groundgoto` and `.flygoto` as `.goto`, `.questgoto` as an optional `.goto`, and `.questwaypoint` as
  // `.waypoint` (`addon.functions.flygoto`, `.questgoto`, and `.questwaypoint` in functions.lua). `.pin`, `.treasure`,
  // and `.rare` set no `element.arrow`, so `updateArrowData` in map.lua leads to none of them. `.ingamewaypoint` sets
  // no arrow either, but it sets and tracks the game's own waypoint (`addon.functions.ingamewaypoint`).
  it.each([
    ["goto", "48,42,60", [[{ instance: 0, x: -130.58, y: -8911.71 }, "goto"]]],
    ["groundgoto", "48,42,60", [[{ instance: 0, x: -130.58, y: -8911.71 }, "goto"]]],
    ["flygoto", "48,42,60", [[{ instance: 0, x: -130.58, y: -8911.71 }, "goto"]]],
    ["waypoint", "48,42,60", [[{ instance: 0, x: -130.58, y: -8911.71 }, "goto"]]],
    ["questwaypoint", "42,65,60,33,1,4", [[{ instance: 0, x: 77.67, y: -9444.06 }, "goto"]]],
    ["questgoto", "42,65,60,33,1,4", [[{ instance: 0, x: 77.67, y: -9444.06 }, "guidePlace"]]],
    ["ingamewaypoint", "48,42", [[{ instance: 0, x: -130.58, y: -8911.71 }, "goto"]]],
    ["pin", "48,42", []],
    ["treasure", "48,42", []],
    ["rare", "48,42", []],
  ])("travels for a .%s line as RXP leads the player", (command, args, gone) => {
    const data = simData(
      {},
      {
        "Elwynn Forest,48,42,60": loc(-130.58, -8911.71),
        "Elwynn Forest,48,42": loc(-130.58, -8911.71),
        "Elwynn Forest,42,65,60,33,1,4": loc(77.67, -9444.06),
      },
    );
    const [step] = simulate(`step\n.${command} Elwynn Forest,${args}\n.xp 2`, data).guides[0]!.steps;
    expect(step!.acts.filter((act) => act.kind === "go").map((act) => [act.to, act.target.kind])).toEqual(gone);
  });

  // `addon.functions.questgoto` and `addon.functions.questwaypoint` in functions.lua read the radius, quest ID, and
  // objective index with `tonumber`, and make no element unless all three are numbers.
  it.each([
    ["questgoto", "60", []],
    ["questgoto", "far,33,1", []],
    ["questgoto", "60,33", []],
    ["questgoto", "60,33,0b1", []],
    ["questgoto", "60,0x21,1", [[{ instance: 0, x: 77.67, y: -9444.06 }, "guidePlace"]]],
    ["questwaypoint", "60", []],
    ["questwaypoint", "far,33,1", []],
    ["questwaypoint", "60,33", []],
    ["questwaypoint", "60,33,0b1", []],
    ["questwaypoint", "60,0x21,1", [[{ instance: 0, x: 77.67, y: -9444.06 }, "goto"]]],
  ])("travels for .%s Elwynn Forest,42,65,%s only when RXP keeps the line", (command, args, gone) => {
    const data = simData({}, { [`Elwynn Forest,42,65,${args}`]: loc(77.67, -9444.06) });
    const [step] = simulate(`step\n.${command} Elwynn Forest,42,65,${args}\n.xp 2`, data).guides[0]!.steps;
    expect(step!.acts.filter((act) => act.kind === "go").map((act) => [act.to, act.target.kind])).toEqual(gone);
  });

  // `QuestWP` in functions.lua skips the element once the character is on the quest and has `objMax` of the objective,
  // and `generatePins` in map.lua gives a skipped element no pin and no arrow.
  it.each([
    ["questgoto", "accept", "456,1,2", true, []],
    ["questgoto", "accept", "456,1,2", false, [[shadowglen(140, 0), "guidePlace"]]],
    ["questgoto", "accept", "456,1", true, [[shadowglen(140, 0), "guidePlace"]]],
    ["questgoto", "accept", "456,1,0", true, [[shadowglen(140, 0), "guidePlace"]]],
    ["questgoto", "goto", "456,1,2", true, [[shadowglen(140, 0), "guidePlace"]]],
    ["questwaypoint", "accept", "456,1,2", true, []],
    ["questwaypoint", "accept", "456,1,2", false, [[shadowglen(140, 0), "goto"]]],
    ["questwaypoint", "accept", "456,1", true, [[shadowglen(140, 0), "goto"]]],
    ["questwaypoint", "accept", "456,1,0", true, [[shadowglen(140, 0), "goto"]]],
    ["questwaypoint", "goto", "456,1,2", true, [[shadowglen(140, 0), "goto"]]],
  ])("travels for .%s after .%s with quest arguments %s, after the kills: %s", (command, start, quest, killed, gone) => {
    const point = `Teldrassil,3,3,10,${quest}`;
    const data = simData(
      { 456: { objectives: [{ index: 1, kind: "monster", ids: [2031], count: 2, name: "Young Nightsaber" }] } },
      { "Teldrassil,1,1": shadowglen(0, 0), "Teldrassil,2,2": shadowglen(70, 0), [point]: shadowglen(140, 0) },
      { 2031: { levels: { min: 1, max: 1 }, elite: false, zoneIds: [] } },
    );
    const kills = "step\n.goto Teldrassil,2,2\n.complete 456,1";
    const visit = `step\n.${command} ${point}\n+Look around`;
    const text = [
      `step\n.goto Teldrassil,1,1\n.${start} ${start === "accept" ? "456" : "Teldrassil,1,1"}`,
      ...(killed ? [kills, visit] : [visit, kills]),
    ];
    const steps = simulate(text.join("\n"), data).guides[0]!.steps;
    const step = steps[killed ? 2 : 1]!;
    expect(steps[killed ? 1 : 2]!.state.log.get(456)?.objectives[0]?.count).toBe(start === "accept" ? 2 : undefined);
    expect(step.acts.filter((act) => act.kind === "go").map((act) => [act.to, act.target.kind])).toEqual(gone);
  });

  // A skipped quest point enters no `addon.activeWaypoints` (`generatePins` in map.lua), so no arrow leads there.
  it("travels to each place of a step whose .questwaypoint is done", () => {
    const point = "Teldrassil,9,9,10,456,1,2";
    const data = simData(
      { 456: { objectives: [{ index: 1, kind: "monster", ids: [2031], count: 2, name: "Young Nightsaber" }] } },
      {
        "Teldrassil,1,1": shadowglen(0, 0),
        "Teldrassil,2,2": shadowglen(70, 0),
        "Teldrassil,3,3": shadowglen(140, 0),
        "Teldrassil,4,4": shadowglen(210, 0),
        [point]: shadowglen(280, 0),
      },
      { 2031: { levels: { min: 1, max: 1 }, elite: false, zoneIds: [] } },
    );
    const text = [
      "step\n.goto Teldrassil,1,1\n.accept 456",
      "step\n.goto Teldrassil,2,2\n.complete 456,1",
      `step\n.questwaypoint ${point}\n.goto Teldrassil,3,3\n.goto Teldrassil,4,4\n+Look around`,
    ].join("\n");
    const steps = simulate(text, data).guides[0]!.steps;
    expect(steps[1]!.state.log.get(456)?.objectives[0]?.count).toBe(2);
    expect(steps[2]!.acts.filter((act) => act.kind === "go").map((act) => act.to)).toEqual([shadowglen(140, 0), shadowglen(210, 0)]);
  });

  // RXP marks a kill loop with `.waypoint` lines, and its arrow leads to the step's first waypoint (`updateArrowData` in map.lua).
  it.each(["waypoint", "questwaypoint"])("travels only to the first place of a step with .%s lines", (command) => {
    const data = simData(
      {},
      { "Elwynn Forest,48,42,60,33,1": loc(-130.58, -8911.71), "Elwynn Forest,42,65,60,33,1": loc(77.67, -9444.06) },
    );
    const text = `step\n.${command} Elwynn Forest,48,42,60,33,1\n.${command} Elwynn Forest,42,65,60,33,1\n.xp 2`;
    const [step] = simulate(text, data).guides[0]!.steps;
    expect(step!.acts.filter((act) => act.kind === "go").map((act) => act.to)).toEqual([{ instance: 0, x: -130.58, y: -8911.71 }]);
  });

  it("travels to each place of a step with an .ingamewaypoint line, which marks no kill loop", () => {
    const data = simData({}, { "Elwynn Forest,48,42": loc(-130.58, -8911.71), "Elwynn Forest,42,65": loc(77.67, -9444.06) });
    const text = "step\n.goto Elwynn Forest,48,42\n.ingamewaypoint Elwynn Forest,42,65\n+Look around";
    const [step] = simulate(text, data).guides[0]!.steps;
    expect(step!.acts.filter((act) => act.kind === "go").map((act) => act.to)).toEqual([
      { instance: 0, x: -130.58, y: -8911.71 },
      { instance: 0, x: 77.67, y: -9444.06 },
    ]);
  });

  // The fourth `.ingamewaypoint` argument is a tooltip (`addon.functions.ingamewaypoint` in functions.lua), and the
  // game's waypoint has no radius that completes it (`addon.UpdateGotoSteps` in map.lua).
  it.each(["", ",Camp", ",60"])("goes to no .ingamewaypoint%s place from a #completewith step", (tooltip) => {
    const data = simData({}, { "Teldrassil,1,1": loc(0, 0), [`Teldrassil,2,2${tooltip}`]: loc(100, 0), "Teldrassil,3,3": loc(200, 0) });
    const text = [
      "step\n.goto Teldrassil,1,1\n+Start",
      `step\n#completewith next\n.ingamewaypoint Teldrassil,2,2${tooltip}\n+Look around`,
      "step\n.goto Teldrassil,3,3\n+Continue",
    ].join("\n");
    const steps = simulate(text, data).guides[0]!.steps;
    expect(steps.map((step) => step.acts.filter((act) => act.kind === "go").map((act) => act.to))).toEqual([
      [{ instance: 0, x: 0, y: 0 }],
      [],
      [{ instance: 0, x: 200, y: 0 }],
    ]);
  });

  // A point with a positive radius completes when the player comes that near (`addon.UpdateGotoSteps` in map.lua), so
  // the arrow leads there from a `#completewith` step. A `.questgoto` point is optional (`addon.functions.questgoto`
  // in functions.lua), which the walk leaves out, and `.pin`, `.treasure`, and `.rare` set no arrow.
  it.each([
    ["goto", "", [loc(100, 0)]],
    ["groundgoto", "", [loc(100, 0)]],
    ["flygoto", "", [loc(100, 0)]],
    ["questgoto", ",33,1", []],
    ["waypoint", "", [loc(100, 0)]],
    ["questwaypoint", ",33,1", [loc(100, 0)]],
    ["pin", "", []],
    ["treasure", "", []],
    ["rare", "", []],
  ])("goes from a #completewith step to its .%s place with a radius only as RXP's arrow leads", (command, quest, gone) => {
    const point = `Teldrassil,2,2,10${quest}`;
    const data = simData({}, { "Teldrassil,1,1": loc(0, 0), [point]: loc(100, 0), "Teldrassil,3,3": loc(200, 0) });
    const text = [
      "step\n.goto Teldrassil,1,1\n+Start",
      `step\n#completewith next\n.${command} ${point}\n+Look around`,
      "step\n.goto Teldrassil,3,3\n+Continue",
    ].join("\n");
    const steps = simulate(text, data).guides[0]!.steps;
    expect(steps[1]!.acts.filter((act) => act.kind === "go").map((act) => act.to)).toEqual(gone);
  });

  describe("acts of one line of each catalog command", () => {
    const ACTS: Record<string, string[]> = {
      accept: ["interact accept"],
      turnin: ["interact turnin"],
      complete: ["kill"],
      abandon: ["update"],
      goto: ["go", "update"],
      groundgoto: ["go", "update"],
      flygoto: ["go", "update"],
      questgoto: ["go", "update"],
      waypoint: ["go", "update"],
      questwaypoint: ["go", "update"],
      ingamewaypoint: ["go", "update"],
      vendor: ["interact vendor"],
      train: ["interact train"],
      home: ["interact home"],
      fp: ["interact fp"],
      fly: ["interact fly"],
      hs: ["hearth"],
      deathskip: ["deathskip"],
      xp: ["grind"],
    };
    const ARGS: Record<string, string> = {
      accept: "783",
      turnin: "783",
      complete: "7,1",
      abandon: "7",
      isOnQuest: "7",
      isNotOnQuest: "456",
      isQuestComplete: "783",
      isQuestNotComplete: "7",
      isQuestTurnedIn: "33",
      isQuestAvailable: "456",
      goto: "Elwynn Forest,40,40,10",
      groundgoto: "Elwynn Forest,40,40,10",
      flygoto: "Elwynn Forest,40,40,10",
      questgoto: "Elwynn Forest,40,40,10,7,1",
      waypoint: "Elwynn Forest,40,40,10",
      questwaypoint: "Elwynn Forest,40,40,10,7,1",
      ingamewaypoint: "Elwynn Forest,40,40",
      pin: "Elwynn Forest,40,40",
      treasure: "Elwynn Forest,40,40",
      rare: "Elwynn Forest,40,40,Hogger",
      line: "Elwynn Forest,40,40,45,45",
      loop: "10,Elwynn Forest,40,40,45,45",
      target: "Hogger",
      mob: "Hogger",
      unitscan: "Hogger",
      collect: "2589,2,7",
      train: "6673",
      fp: "Theramore",
      fly: "Theramore",
      xp: "2",
    };
    const data: SimData = {
      ...simData(
        { 7: { baseXp: 300, objectives: [KOBOLD_VERMIN] }, 783: { baseXp: 300 } },
        {},
        {
          6: { levels: { min: 1, max: 2 }, elite: false, zoneIds: [] },
        },
      ),
      locateGoto: (args) => (args[0] === "Elwynn Forest" ? loc(-130.58, -8911.71) : undefined),
    };
    const seed: SimStart = {
      log: new Map([
        [7, [{ count: 0, complete: false }]],
        [783, []],
      ]),
      done: new Set([33]),
    };

    it.each([...COMMANDS.keys()])("makes the acts of a lone .%s line", (name) => {
      const doc = guide("A", `step\n.${name} ${ARGS[name] ?? ""}\n+Look around`);
      const profile = createProfile({ race: "Human", class: "WARRIOR", groupQuests: name === "group" });
      const [step] = simulateRoute([doc], 0, profile, data, 0, seed).guides[0]!.steps;
      expect(step!.preview.shown).toBe(true);
      expect(step!.acts.map((act) => (act.kind === "interact" ? `interact ${act.action}` : act.kind))).toEqual(ACTS[name] ?? []);
    });
  });

  it("moves to the step's .goto, else its quest NPC, else stays", () => {
    const gaxim = [loc(335.37, 734.98, 1), loc(345.13, 728.47, 1)];
    const lomac = [loc(-1278.1, -4844.65), loc(-1276.52, -4847.82), loc(-1281.26, -4833.04)];
    const stormwind = loc(975.79, -8922.5);
    const data = simData(
      { 1077: { givers: [loc(801.73, -8999.43)], enders: gaxim }, 1074: { givers: lomac, enders: gaxim } },
      { "Stormwind City,43,80": stormwind },
    );
    const text = [
      "step\n.goto Stormwind City,43,80\n.accept 1077",
      "step\n.accept 1077",
      "step\n.turnin 1077",
      "step\n.goto Nowhere,1,1",
      "step\n.goto Stormwind City,43,80\n.accept 1074\n.goto Nowhere,1,1",
    ].join("\n");
    const positions = simulate(text, data, 21).guides[0]!.steps.map((s) => s.state.position);
    expect(positions).toEqual([stormwind, stormwind, gaxim[0], gaxim[0], lomac[0]]);
  });

  // `.zoneskip` reads the map that the player stands on (`addon.functions.zoneskip` in functions.lua). A `.waypoint`
  // or `.questwaypoint` line makes a kill loop, which walks only to its first place.
  it.each([
    ["waypoint", "first", ""],
    ["questwaypoint", "first", ",10,456,1"],
    ["ingamewaypoint", "last", ""],
  ])("ends a .%s walk at its %s place, which a later .zoneskip reads", (command, end, args) => {
    const elwynn = { ...loc(0, 0), uiMapId: 1429 };
    const westfall = (east: number) => ({ ...loc(east, 0), uiMapId: 1436 });
    const data = simData(
      {},
      { "Elwynn Forest,1,1": elwynn, [`Westfall,2,2${args}`]: westfall(100), [`Westfall,3,3${args}`]: westfall(200) },
    );
    const text = [
      "step\n.goto Elwynn Forest,1,1\n+Start",
      `step\n.${command} Westfall,2,2${args}\n.${command} Westfall,3,3${args}\n+Look around`,
      "step\n.zoneskip 1429\n+Leave Elwynn Forest",
    ].join("\n");
    const steps = simulate(text, data).guides[0]!.steps;
    const stop = westfall(end === "first" ? 100 : 200);
    expect(steps.map((s) => [s.preview.shown, s.state.position])).toEqual([
      [true, elwynn],
      [true, stop],
      [true, stop],
    ]);
  });

  it("simulates the bundled Elwynn Forest guide", () => {
    const source = readFileSync(join(import.meta.dirname, "../../guides/rxp-forever/Alliance-1-13_Human.lua"), "utf8");
    const docs = extractGuides(source).map((g) => parseGuide(g.text));
    const elwynn = docs.findIndex((doc) =>
      doc.header.some((l) => l.kind === "tag" && l.name === "name" && l.value === "6-11 Elwynn Forest"),
    );
    const route = simulateRoute(docs, elwynn, createProfile({ race: "Human", class: "WARRIOR", level: 6 }), simData({}));
    expect(route.start.done.size).toBeGreaterThan(0);
    expect(route.guides[0]!.source).toBe(elwynn);
    for (const g of route.guides) expect(g.steps).toHaveLength(docs[g.source]!.steps.length);
  });
});

describe("step gates", () => {
  const data = simData({ 7: { baseXp: 300, objectives: [KOBOLD_VERMIN] }, 783: { baseXp: 300 } });
  const shown = (text: string, level = 1, xp = 0) => simulate(text, data, level, xp).guides[0]!.steps.map((s) => s.preview.shown);
  const progress = (gate: string) =>
    shown([".accept 7", ".complete 7,1,1", ".complete 7,1", ".turnin 7"].map((line) => `step\n${line}\nstep\n${gate}`).join("\n")).filter(
      (_, i) => i % 2 === 1,
    );

  it(".isOnQuest runs a step when any listed quest is in the log (4367-4416)", () => {
    const { steps } = simulate("step\n.accept 7\nstep\n.isOnQuest 783,7\nstep\n.isOnQuest 783", data).guides[0]!;
    expect(steps.map((s) => s.preview.shown)).toEqual([true, true, false]);
    expect(steps[2]!.preview.reason).toEqual({ kind: "command", name: "isOnQuest", args: ["783"], line: 0 });
  });

  it(".isNotOnQuest runs a step when no listed quest is in the log (4410-4416)", () => {
    expect(shown("step\n.accept 7\nstep\n.isNotOnQuest 783,7\nstep\n.isNotOnQuest 783")).toEqual([true, false, true]);
  });

  it(".isQuestComplete runs a step once the quest in the log is complete (4320-4364, 405-421)", () => {
    expect(progress(".isQuestComplete 7")).toEqual([false, false, true, false]);
  });

  it(".isQuestNotComplete runs a step unless the quest in the log is complete (4360-4365)", () => {
    expect(progress(".isQuestNotComplete 7")).toEqual([true, true, false, true]);
  });

  it(".isQuestTurnedIn runs a step after any listed quest is turned in (4418-4478)", () => {
    const text = "step\n.isQuestTurnedIn 7\nstep\n.accept 7\n.turnin 7\nstep\n.isQuestTurnedIn 7\nstep\n.isQuestTurnedIn 783,7";
    expect(shown(text)).toEqual([false, true, true, true]);
  });

  it(".isQuestAvailable runs a step while any listed quest is not turned in (4480-4484)", () => {
    const text = "step\n.isQuestAvailable 7\nstep\n.turnin 7\nstep\n.isQuestAvailable 7\nstep\n.isQuestAvailable 7,783";
    expect(shown(text)).toEqual([true, true, false, true]);
  });

  const xpGates = (...gates: string[]) => shown(gates.map((g) => `step\n.xp ${g}`).join("\n"), 3, 100);

  it(".xp N,1 skips a step once the target is reached (3306-3428)", () => {
    expect(xpGates("3,1", "4,1", "3+100,1", "3+101,1", "4-1300,1", "4-1299,1", "3.07,1", "3.08,1")).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
  });

  it(".xp reads text such as >N as RXP's pattern does (3313-3314)", () => {
    expect([9, 10, 11].map((level) => shown("step\n.xp >10,1", level)[0])).toEqual([true, false, false]);
    expect(xpGates(">3+100,1", ">3+101,1", "3+100xp,1")).toEqual([false, true, false]);
  });

  it(".xp <N,1 skips a step until the target is reached (3324)", () => {
    expect(xpGates("<3,1", "<4,1")).toEqual([true, false]);
  });

  it(".xp N,-1 skips a step until the target is reached, and <N,-1 as <N,1 (3397)", () => {
    expect(xpGates("3,-1", "4,-1", "<4,-1")).toEqual([true, false, false]);
  });

  it(".xp with a label jumps to the label's step when met, past the steps between (3408-3413)", () => {
    const route = (gate: string) =>
      simulate(`step\n.xp ${gate},1,Target\n.accept 7\nstep\n.accept 783\n.xp 3+1000\nstep\n#label Target`, data, 3, 100).guides[0]!;
    const met = route("3");
    expect(met.steps.map((s) => s.preview.shown)).toEqual([false, false, true]);
    expect(met.steps[1]!.preview.reason).toEqual({ kind: "jump", command: "xp", step: 0, line: 0 });
    expect(met.end).toEqual(met.afterHeader);
    const unmet = route("4");
    expect(unmet.steps.map((s) => s.preview.shown)).toEqual([true, true, true]);
    expect([...unmet.end.log.keys()]).toEqual([7, 783]);
    expect(unmet.end).toMatchObject({ level: 3, xp: 1000 });
  });

  it(".xp ignores a label the guide's loaded steps lack (3373-3375)", () => {
    const text = "step\n.xp 3,1,Gone\nstep\n.xp 3,1,Mage\nstep << Mage\n#label Mage";
    expect(shown(text, 3)).toEqual([true, true, false]);
  });

  it(".xp stops the route at a jump back to its own step or earlier", () => {
    for (const label of ["Top", "Here"]) {
      const text = `step\n#label Top\n.accept 7\nstep\n#label Here\n.xp 3,1,${label}\nstep\n.accept 783\n.xp 4`;
      const route = simulate(text, data, 3, 0, "#next B\n");
      const { steps, end } = route.guides[0]!;
      expect(steps.map((s) => s.preview.shown)).toEqual([true, false, false]);
      expect(steps[2]!.preview.reason).toEqual({ kind: "jump", command: "xp", step: 1, line: 1 });
      expect(end).toMatchObject({ level: 3, xp: 0 });
      expect([...end.log.keys()]).toEqual([7]);
      expect(route.end).toEqual({ kind: "jumpLoop", from: 0, command: "xp", step: 1, line: 1 });
    }
  });

  // `addon.SetStep` in GuideWindow.lua and `addon.functions.maxlevel` in
  // functions.lua. The simulator visits each step once, so it skips a
  // `#sticky` step below its `#level` where RXP would wait.
  it("#level and .maxlevel skip a step without running it, and .maxlevel jumps to its label", () => {
    const route = (level: number) =>
      simulate("step\n#sticky\n#level 11\n.accept 7\nstep\n.maxlevel 9,Target\n.accept 783\nstep\nstep\n#label Target", data, level)
        .guides[0]!;
    const low = route(9);
    expect(low.steps.map((s) => s.preview.shown)).toEqual([false, true, true, true]);
    expect([...low.end.log.keys()]).toEqual([783]);
    const high = route(11);
    expect(high.steps.map((s) => s.preview.shown)).toEqual([true, false, false, true]);
    expect(high.steps[2]!.preview.reason).toEqual({ kind: "jump", command: "maxlevel", step: 1, line: 0 });
    expect([...high.end.log.keys()]).toEqual([7]);
  });

  it("leaves out a predecessor's turn-ins from steps its gates skip", () => {
    const profile = createProfile({ race: "Human", class: "WARRIOR" });
    const runs = (predecessor: string) => {
      const docs = [guide("P", `${predecessor}step\n.isOnQuest 999\n.turnin 7`, "#next S\n"), guide("S", "step\n.isQuestAvailable 7")];
      const fromP = simulateRoute(docs, 0, profile, data).guides[1]!.steps[0]!.preview.shown;
      const fromS = simulateRoute(docs, 1, profile, data).guides[0]!.steps[0]!.preview.shown;
      return [fromP, fromS];
    };
    expect(runs("")).toEqual([true, true]);
    expect(runs("step\n.accept 999\n")).toEqual([false, false]);
  });

  it("applies a predecessor's header done= before its gates", () => {
    const docs = [
      guide("P", "step\n.isQuestTurnedIn 999\n.turnin 7", "#next S\n-- @sim done=999\n"),
      guide("S", "step\n.isQuestAvailable 7"),
    ];
    const profile = createProfile({ race: "Human", class: "WARRIOR" });
    expect(simulateRoute(docs, 0, profile, data).guides[1]!.steps[0]!.preview.shown).toBe(false);
    expect(simulateRoute(docs, 1, profile, data).guides[0]!.steps[0]!.preview.shown).toBe(false);
  });

  it("changes nothing for a skipped step's lines", () => {
    const text = "step\n.accept 783\nstep\n.isOnQuest 7\n.accept 7\n.turnin 783\n.xp 5";
    const [before, skipped] = simulate(text, data).guides[0]!.steps;
    expect(skipped!.preview.shown).toBe(false);
    expect(skipped!.state).toBe(before!.state);
    expect(skipped!.xp).toEqual({ quest: 0, kills: 0, checkpoint: 0 });
  });
});

describe("kills", () => {
  const npc = (min: number, max: number, elite: boolean | null = null): SimNpc => ({ levels: { min, max }, elite, zoneIds: [] });
  const npcs = {
    6: npc(1, 2),
    80: npc(3, 4),
    103: npc(5, 5),
    113: npc(5, 6),
    1178: npc(18, 19, true),
    1985: npc(2, 3),
    707: npc(1, 2),
    5839: npc(43, 44),
    6090: npc(10, 10),
    10738: npc(59, 59, true),
  };
  const monsters = (count: number | null, ids = [707], name = "Rockjaw Trogg"): SimNumberedObjective => ({
    index: 1,
    kind: "monster",
    ids,
    count,
    name,
  });
  const quests: Record<number, Partial<SimQuest>> = {
    170: { objectives: [monsters(8)] },
    457: { objectives: [{ ...monsters(7, [1985], "Thistle Boar"), index: 2 }] },
    7: { objectives: [monsters(10, [6], "Kobold Vermin")] },
    15: { objectives: [monsters(4, [], "Kobold Worker")] },
    21: { objectives: [monsters(10, [], "Kobold Laborer")] },
    1640: { objectives: [monsters(null, [6090], "Bartleby")] },
    86: { objectives: [{ index: 1, kind: "item", ids: [769], count: 2, name: "Chunk of Boar Meat" }] },
    255: { objectives: [monsters(2, [1178], "Mo'grosh Ogre")] },
    16: { objectives: [{ index: 1, kind: "item", ids: [159], count: 2, name: "Refreshing Spring Water" }] },
    3861: { objectives: [{ index: 1, kind: "item", ids: [11109], count: 2, name: "Special Chicken Feed" }] },
  };
  const data = simData(quests, {}, npcs, {
    769: { droppers: [{ id: 113 }, { id: 1985 }], objectsOnly: false, sold: false },
    159: { droppers: [{ id: 6 }], objectsOnly: false, sold: true },
    11109: { droppers: [], objectsOnly: false, sold: true },
  });
  const run = (text: string, level = 1, xp = 0) => simulate(text, data, level, xp);
  const killed = (step: {
    kills: readonly { at: { line?: number }; mobs: readonly { npcId: number; levels: readonly { level: number; kills: number }[] }[] }[];
  }) => step.kills.map((k) => [k.at.line, k.mobs.map((m) => [m.npcId, m.levels.map((l) => [l.level, l.kills])])]);

  it.each([
    ["", 204],
    ["-- @sim killmult=1", 408],
    ["-- @sim killmult=0 killxp=30", 240],
    ["-- @sim killxp=0", 0],
    ["-- @sim killmult=0", 0],
  ])("applies guide and step kill XP settings: %s", (setting, expected) => {
    const step = run(`-- @sim killmult=0.5\nstep\n.accept 170\n.complete 170,1\n${setting}\n`).guides[0]!.steps[0]!;
    expect(step.xp.kills).toBe(expected);
  });

  it("uses each step's rate for a shared objective and leaves quest XP unchanged", () => {
    const result = simulate(
      "-- @sim killmult=0.5\nstep\n.accept 170\n.complete 170,1,3\nstep -- @sim killxp=10\n.complete 170,1\n.turnin 170\n",
      simData({ 170: { objectives: [monsters(8)], baseXp: 100 } }, {}, npcs),
    ).guides[0]!;
    expect(result.steps.map((s) => s.xp)).toEqual([
      { quest: 0, kills: 76, checkpoint: 0 },
      { quest: 100, kills: 50, checkpoint: 0 },
    ]);
  });

  it("recalculates multiplied rewards after leveling within a step", () => {
    const step = run("-- @sim killmult=0.5\nstep\n.accept 170\n.complete 170,1\n", 1, 300).guides[0]!.steps[0]!;
    expect(step.xp.kills).toBe(202);
    expect(step.levelUps[0]?.kill?.n).toBe(4);
    expect(step.state).toMatchObject({ level: 2, xp: 102 });
  });

  it.each([
    ["killmult=0.5", 51, 14],
    ["killmult=0 killxp=30", 60, 12],
    ["killxp=0", 0, null],
  ])("uses %s for extra kills and grind checkpoints", (setting, xp, count) => {
    const step = run(`step\n-- @sim ${setting}\n-- @sim extra=2 mob=707\n.mob 707\n.xp 2\n`).guides[0]!.steps[0]!;
    expect(step.xp.kills).toBe(xp);
    expect(step.checkpoints[0]?.kills?.count ?? null).toBe(count);
  });

  it("counts each kill's XP at the player's level at that kill", () => {
    const step = run("step\n.accept 170\n.complete 170,1", 1, 300).guides[0]!.steps[0]!;
    expect(killed(step)).toEqual([
      [
        1,
        [
          [
            707,
            [
              [1, 4],
              [2, 4],
            ],
          ],
        ],
      ],
    ]);
    expect([killXp(1, 1, false), killXp(1, 2, false), killXp(2, 1, false), killXp(2, 2, false)]).toEqual([50, 52, 44, 55]);
    expect(step.levelUps).toEqual([{ level: 2, at: { guide: 0, step: 0, line: 1 }, kill: { entry: 0, n: 2, of: 8 } }]);
    expect(step.xp).toEqual({ quest: 0, kills: 50 + 52 + 3 * (44 + 55), checkpoint: 0 });
    expect(step.state).toMatchObject({ level: 2, xp: 2 + 3 * (44 + 55) });
  });

  it("splits a partial line and the turn-in as the kill sequence orders them", () => {
    const steps = run("step\n.accept 457\n.complete 457,2,4\nstep\n.turnin 457").guides[0]!.steps;
    expect(killed(steps[0]!)).toEqual([
      [
        1,
        [
          [
            1985,
            [
              [2, 2],
              [3, 2],
            ],
          ],
        ],
      ],
    ]);
    expect(killed(steps[1]!)).toEqual([
      [
        0,
        [
          [
            1985,
            [
              [2, 2],
              [3, 1],
            ],
          ],
        ],
      ],
    ]);
    expect(steps[1]!.notes).toEqual([{ kind: "killsAtTurnIn", at: { guide: 0, step: 1, line: 0 }, questId: 457, kills: 3 }]);
  });

  it("counts a partial line's kills, then the rest, then none at the turn-in", () => {
    const text = "step\n.accept 7\n.complete 7,1,1\nstep\n.complete 7,1\nstep\n.turnin 7";
    const steps = run(text).guides[0]!.steps;
    expect(steps.map((s) => s.kills.map((k) => k.count))).toEqual([[1], [9], []]);
    expect(steps[2]!.notes).toEqual([]);
  });

  it("marks elite mobs", () => {
    expect(run("step\n.accept 255\n.complete 255,1").guides[0]!.steps[0]!.kills[0]!.mobs).toEqual([
      {
        npcId: 1178,
        elite: true,
        levels: [
          { level: 18, kills: 1 },
          { level: 19, kills: 1 },
        ],
      },
    ]);
  });

  it("notes where a #completewith or .disablecheckbox line's kills are counted", () => {
    const later = (text: string) =>
      run(text).guides[0]!.steps.flatMap((s) =>
        s.notes.flatMap((n) =>
          n.kind === "killsLater" ? [[n.at.step, n.reason, n.countedAt && [n.countedAt.step, n.countedAt.line]]] : [],
        ),
      );
    expect(later("step\n#completewith next\n.accept 255\n.complete 255,1\nstep\n.turnin 255")).toEqual([[0, "completewith", [1, 0]]]);
    expect(later("step\n.accept 170\n.complete 170,1\n-- note\n.disablecheckbox\n.complete 170,1")).toEqual([
      [0, "disablecheckbox", [0, 4]],
    ]);
    expect(later("step\n#completewith next\n.accept 170\n.complete 170,1\nstep\n.complete 170,1 -- @sim kills=0")).toEqual([
      [0, "completewith", null],
    ]);
    expect(later("step\n#completewith next\n.accept 170\n.complete 170,1 -- @sim kills=3")).toEqual([]);
    expect(later("step\n.accept 170\n.complete 170,1\n.goto Elwynn Forest,1,1\n.disablecheckbox")).toEqual([]);
  });

  it("defers a .disablecheckbox line in a #completewith step for its hidden checkbox, so the line completes its objective", () => {
    const [step] = run("step\n#completewith next\n.accept 170\n.complete 170,1\n.disablecheckbox\nstep\n.complete 170,1").guides[0]!.steps;
    expect(step!.notes.flatMap((n) => (n.kind === "killsLater" ? [n.reason] : []))).toEqual(["disablecheckbox"]);
    expect(step!.state.log.get(170)?.status).toBe("complete");
  });

  it("counts every kill at a turn-in with no .complete, before the quest XP", () => {
    const data = simData({ 170: { ...quests[170], baseXp: 100 } }, {}, npcs);
    const step = simulate("step\n.accept 170\n.turnin 170", data, 1, 300).guides[0]!.steps[0]!;
    expect(step.kills.map((k) => [k.at.line, k.count, k.countFrom])).toEqual([[1, 8, "data"]]);
    expect(step.notes).toEqual([{ kind: "killsAtTurnIn", at: { guide: 0, step: 0, line: 1 }, questId: 170, kills: 8 }]);
    expect(step.levelUps.map((l) => l.kill)).toEqual([{ entry: 0, n: 2, of: 8 }]);
    expect(step.xp.quest).toBe(100);
  });

  it("counts no turn-in kills for items a .collect line in an #ah step bought", () => {
    const data = simData(
      { ...quests, 1578: { objectives: [{ index: 1, kind: "item", ids: [2845], count: 1, name: "Copper Axe" }] } },
      {},
      npcs,
      {
        769: { droppers: [{ id: 113 }, { id: 1985 }], objectsOnly: false, sold: false },
        2845: { droppers: [], objectsOnly: false, sold: false },
      },
    );
    const turnIn = (collect: string, quest = 86, between = "") => {
      const result = simulate(`step\n${collect}\nstep\n.accept ${quest}\n${between}step\n.turnin ${quest}`, data, 5);
      const step = result.guides[0]!.steps.at(-1)!;
      return { kills: step.kills.reduce((n, k) => n + k.count, 0), warnings: result.warnings.map((w) => w.kind) };
    };
    expect(turnIn(".collect 769,2,86,1")).toEqual({ kills: 4, warnings: [] });
    expect(turnIn("#ah\n.collect 769,2,86,1")).toEqual({ kills: 0, warnings: [] });
    expect(turnIn("#ah\n.collect 769,1,86,1")).toEqual({ kills: 2, warnings: [] });
    expect(turnIn("#ah\n.collect 769,2,86,1", 86, "step\n.abandon 86\nstep\n.accept 86\n")).toEqual({ kills: 0, warnings: [] });
    expect(turnIn(".collect 2845,1,1578,1", 1578).warnings).toEqual(["noKillTarget"]);
    expect(turnIn("#ah\n.collect 2845,1,1578,1", 1578)).toEqual({ kills: 0, warnings: [] });
    // With 0x10, RXP asks for the items of a complete quest too (`addon.functions.collect`).
    const after = (flags: string) =>
      simulate(
        `step\n.accept 86\n.collect 769,2,86,1\nstep\n#ah\n.collect 769,2,86,1${flags}\nstep\n.turnin 86`,
        data,
      ).guides[0]!.steps[2]!.kills.reduce((n, k) => n + k.count, 0);
    expect(after("")).toBe(4);
    expect(after(",0x10")).toBe(4);
  });

  it("counts kills only for objectives that need them, and progress for every objective", () => {
    const geologists: SimNumberedObjective = { ...monsters(3, [5839], "Dark Iron Geologist"), need: "kills" };
    const cloth: SimNumberedObjective = { index: 2, kind: "item", ids: [4306], count: 15, name: "Silk Cloth", need: "action" };
    const mixed = simData({ 4449: { objectives: [geologists, cloth], baseXp: 100 } }, {}, npcs);
    const text = "step\n.accept 4449\n.target Dark Iron Geologist\n.complete 4449,2\nstep\n.turnin 4449";
    const { guides, warnings } = simulate(text, mixed, 45);
    const [complete, turnIn] = guides[0]!.steps;
    expect(warnings).toEqual([]);
    expect(complete!.kills).toEqual([]);
    expect(complete!.state.log.get(4449)?.objectives).toMatchObject([
      { count: 0, complete: false },
      { count: 15, complete: true },
    ]);
    expect(turnIn!.kills.map((k) => [k.objective, k.count, k.countFrom])).toEqual([[{ questId: 4449, row: 0 }, 3, "data"]]);
    const alone = simulate(text, simData({ 4449: { objectives: [geologists], baseXp: 100 } }, {}, npcs), 45);
    expect(turnIn!.xp).toEqual(alone.guides[0]!.steps[1]!.xp);
    expect(turnIn!.xp.kills).toBeGreaterThan(0);
  });

  it("reads kills=, mob=, and extra=, with extra= kills where the comment stands", () => {
    const text = [
      "step -- @sim extra=1 mob=1178",
      ".accept 170",
      ".accept 7",
      ".complete 170,1 -- @sim kills=2 mob=103",
      ".complete 7,1 -- @sim mob=1178",
      "-- @sim extra=2 mob=1985",
    ].join("\n");
    const step = run(text).guides[0]!.steps[0]!;
    expect(killed(step)).toEqual([
      [undefined, [[1178, [[18, 1]]]]],
      [2, [[103, [[5, 2]]]]],
      [
        3,
        [
          [
            1178,
            [
              [18, 5],
              [19, 5],
            ],
          ],
        ],
      ],
      [
        4,
        [
          [
            1985,
            [
              [2, 1],
              [3, 1],
            ],
          ],
        ],
      ],
    ]);
    expect(killXp(1, 2, true)).toBeGreaterThan(killXp(1, 2, false));
  });

  it("stops kill XP at level 60 and keeps counting kills", () => {
    const data = simData({ 5121: { objectives: [monsters(3, [10738], "High Chief Winterfall")] } }, {}, npcs);
    const step = simulate("step\n.accept 5121\n.complete 5121,1", data, 59, xpToNextLevel(testRules, 59) - 10).guides[0]!.steps[0]!;
    expect(step.kills.map((k) => k.count)).toEqual([3]);
    expect(step.levelUps).toEqual([{ level: 60, at: { guide: 0, step: 0, line: 1 }, kill: { entry: 0, n: 1, of: 3 } }]);
    expect(step.xp.kills).toBe(killXp(59, 59, true));
    expect(step.state).toMatchObject({ level: 60, xp: 0 });
  });

  it("reports the kills that close an .xp or checkpoint gap", () => {
    const text = [
      "step\n.xp 2",
      "step\n.mob 707\n.xp 3",
      "step\n.accept 7\n.complete 7,1,1\n.xp 4 -- @sim level=5",
      "step\n.target 103\n.xp 6",
      "step\n.mob 999\n.xp 7",
    ].join("\n");
    const { guides, warnings } = run(text);
    const kills = guides[0]!.steps.map((s) => s.checkpoints.map((c) => c.kills));
    expect(kills[0]).toEqual([null]);
    expect(kills[1]).toEqual([{ count: 19, mobs: [{ npcId: 707, count: 19 }] }]);
    expect(kills[2]!.map((k) => k?.mobs[0]?.npcId)).toEqual([6, 6]);
    expect(kills[3]![0]).toMatchObject({ mobs: [{ npcId: 103 }] });
    expect(kills[4]).toEqual([null]);
    expect(warnings.filter((w) => w.kind === "checkpointGap").map((w) => w.kind === "checkpointGap" && w.kills)).toEqual([kills[2]![1]]);
  });

  it("grinds the mob with the most spawns near the character when the step names none, never a one-spawn mob", () => {
    const npc = (min: number, max: number, elite = false): SimNpc => ({ levels: { min, max }, elite, zoneIds: [] });
    const at: Record<number, WorldLocation[]> = {
      2012: [shadowglen(50, 0), shadowglen(60, 0), shadowglen(70, 0), shadowglen(500, 0)],
      2013: [shadowglen(10, 0), shadowglen(20, 0)],
      2039: [shadowglen(5, 0)],
      2166: [shadowglen(1, 0), shadowglen(2, 0), shadowglen(3, 0), shadowglen(4, 0)],
    };
    const ursal = { index: 1, kind: "monster" as const, ids: [2039], count: 1, name: "Ursal the Mauler" };
    const base = simData(
      { 486: { baseXp: 100, objectives: [ursal] } },
      { "Teldrassil,1,1": shadowglen(0, 0) },
      { 2012: npc(9, 10), 2013: npc(9, 10), 2039: npc(12, 12), 2166: npc(9, 9, true) },
    );
    const grinds = (withSpawns: number[], ursals = at[2039]!, choices: PlaybackChoices = {}) => {
      const data: SimData = {
        ...base,
        spawns: (npcId) => ((npcId === 2039 ? ursals : at[npcId]) ?? []).map((p, i) => ({ ...p, id: `npc:${npcId}:${i}` })),
        npcsWithSpawns: () => withSpawns,
      };
      const steps = simulate("step\n.goto Teldrassil,1,1\n.accept 486\n.complete 486,1\nstep\n.xp 3", data, 1, 0, "", choices).guides[0]!
        .steps;
      return steps[1]!.checkpoints[0]!.kills?.mobs.map((m) => m.npcId) ?? null;
    };
    expect([
      grinds([2012, 2013, 2166]),
      grinds([]),
      grinds([], [shadowglen(200, 0), shadowglen(210, 0)]),
      grinds([], [shadowglen(450, 0), shadowglen(460, 0)]),
      grinds([], [shadowglen(550, 0), shadowglen(560, 0)]),
      grinds([], [shadowglen(550, 0), shadowglen(560, 0)], { area: 600 }),
    ]).toEqual([[2012], null, [2039], [2039], null, [2039]]);
  });

  it("counts kills= at its line and the rest of the objective later, of the first counting line's mob", () => {
    const counts = (text: string) => run(text).guides[0]!.steps.map((s) => s.kills.map((k) => [k.count, k.mobs.map((m) => m.npcId)]));
    expect(counts("step\n.accept 86\n.complete 86,1,0.5 -- @sim mob=707\nstep\n.complete 86,1 -- @sim mob=1985")).toEqual([
      [],
      [[4, [1985]]],
    ]);
    expect(counts("step\n.accept 7\n.complete 7,1,1 -- @sim kills=2 mob=1985\nstep\n.turnin 7")).toEqual([[[2, [1985]]], [[8, [1985]]]]);
    expect(counts("step\n.accept 7\n.complete 7,1,10 -- @sim kills=20\nstep\n.turnin 7")).toEqual([[[20, [6]]], []]);
    expect(counts("step\n.accept 21\n.complete 21,1,1 -- @sim mob=80\nstep\n.complete 21,1\nstep\n.turnin 21")).toEqual([
      [[1, [80]]],
      [[9, [80]]],
      [],
    ]);
    expect(counts("step\n.accept 7\n.complete 7,1,1 -- @sim kills=2 mob=1985\n.complete 7,1 -- @sim kills=5")).toEqual([
      [
        [2, [1985]],
        [5, [1985]],
      ],
    ]);
  });

  it("keeps a line's guide-text count for later lines and the turn-in", () => {
    const counts = (text: string) => run(text).guides[0]!.steps.map((s) => s.kills.map((k) => k.count));
    expect(counts("step\n#completewith next\n.accept 1640\n.complete 1640,1 --Bartleby (8)\nstep\n.turnin 1640")).toEqual([[], [8]]);
    expect(counts("step\n.accept 1640\n.complete 1640,1 --Bartleby (8)\n.disablecheckbox\nstep\n.complete 1640,1")).toEqual([[], [8]]);
    expect(counts("step\n.accept 1640\n.complete 1640,1,3 >>Bartleby (8) -- @sim kills=2\nstep\n.turnin 1640")).toEqual([[2], [6]]);
    expect(counts("step\n.accept 1640\n.complete 1640,1 --Bartleby (8)\n.disablecheckbox\n.complete 1640,1\n.turnin 1640")).toEqual([[8]]);
    expect(
      counts(
        "step\n.accept 1640\n.complete 1640,1 --Bartleby (8)\n.disablecheckbox\nstep\n.complete 1640,1,2 --Bartleby (10)\n.complete 1640,1",
      ),
    ).toEqual([[], [2, 8]]);
  });

  it("counts whole kills up to a fractional partial count", () => {
    const counts = run("step\n.accept 170\n.complete 170,1,1.5\nstep\n.turnin 170").guides[0]!.steps.map((s) =>
      s.kills.map((k) => k.count),
    );
    expect(counts).toEqual([[1], [7]]);
  });

  it("counts none for kills=0, ending the count only on a line that finishes the objective", () => {
    const counts = (text: string) => run(text).guides[0]!.steps.map((s) => s.kills.map((k) => k.count));
    expect(counts("step\n.accept 7\n.complete 7,1,3 -- @sim kills=0\nstep\n.turnin 7")).toEqual([[], [10]]);
    expect(counts("step\n.accept 7\n.complete 7,1 -- @sim kills=0\nstep\n.complete 7,1\n.turnin 7")).toEqual([[], []]);
  });

  it("warns about unproven turn-in kills unless a .disablecheckbox line of the current acceptance deferred them", () => {
    const unproven = (text: string) =>
      run(text)
        .guides[0]!.steps.at(-1)!
        .acts.flatMap((a) => (a.kind === "kill" ? [a.unproven ?? false] : []));
    const deferred = "step\n.accept 7\n.complete 7,1\n.disablecheckbox\n";
    expect(unproven("step\n.accept 7\nstep\n.turnin 7")).toEqual([true]);
    expect(unproven(`${deferred}step\n.turnin 7`)).toEqual([false]);
    expect(unproven(`${deferred}.turnin 7`)).toEqual([false]);
    expect(unproven(`${deferred}step\n.abandon 7\nstep\n.accept 7\nstep\n.turnin 7`)).toEqual([true]);
    expect(unproven(`${deferred}.abandon 7\nstep\n.accept 7\nstep\n.turnin 7`)).toEqual([true]);
    expect(unproven(`${deferred}.abandon 7\n.accept 7\nstep\n.turnin 7`)).toEqual([true]);
  });

  it("warns about a turn-in's kills for each objective that no .disablecheckbox line deferred", () => {
    const two = simData({ 456: { objectives: [monsters(7, [6], "Kobold Vermin"), { ...monsters(4, [707]), index: 2 }] } }, {}, npcs);
    const acts = simulate("step\n.accept 456\n.complete 456,1\n.disablecheckbox\nstep\n.turnin 456", two).guides[0]!.steps[1]!.acts;
    expect(
      acts.flatMap((a) => (a.kind === "kill" ? [[a.kills.map((k) => [k.objective!.row, k.count]), a.unproven ?? false]] : [])),
    ).toEqual([
      [[[0, 7]], false],
      [[[1, 4]], true],
    ]);
  });

  it("leaves a #completewith or .disablecheckbox line's kills to the next line that counts them", () => {
    const counts = (text: string) => run(text).guides[0]!.steps.map((s) => s.kills.map((k) => [k.at.line, k.count]));
    expect(counts("step\n.accept 7\n.complete 7,1\n.disablecheckbox\nstep\n.complete 7,1")).toEqual([[], [[0, 10]]]);
    expect(counts("step\n#completewith next\n.accept 7\n.complete 7,1 -- @sim kills=3\nstep\n.turnin 7")).toEqual([[[2, 3]], [[0, 7]]]);
    expect(counts("step\n.accept 7\n.complete 7,1 -- @sim kills=3\n.disablecheckbox\nstep\n.complete 7,1")).toEqual([[[1, 3]], [[0, 7]]]);
    const mobs = (text: string) =>
      run(text).guides[0]!.steps.map((s) => s.kills.map((k) => [k.at.line, k.count, k.mobFrom, k.mobs.map((m) => m.npcId)]));
    expect(mobs("step\n#completewith next\n.accept 16\n.complete 16,1 -- @sim mob=1985\nstep\n.turnin 16")).toEqual([
      [],
      [[0, 4, "override", [1985]]],
    ]);
    expect(mobs("step\n.accept 16\n.complete 16,1 -- @sim mob=1985\n.disablecheckbox\nstep\n.turnin 16")).toEqual([
      [],
      [[0, 4, "override", [1985]]],
    ]);
    expect(mobs("step\n#completewith next\n.accept 16\n.complete 16,1\nstep\n.turnin 16")).toEqual([[], []]);
    const run8 = (text: string) => run(text).guides[0]!.steps.map((s) => [s.notes.map((n) => n.kind), s.kills.map((k) => k.mobFrom)]);
    expect(run8("step\n#completewith next\n.accept 16\n.complete 16,1 -- @sim mob=1985\nstep\n.complete 16,1\n.turnin 16")).toEqual([
      [["killsLater"], []],
      [[], ["override"]],
    ]);
    expect(run8("step\n.accept 16\n.complete 16,1,1 -- @sim kills=1\n.complete 16,1\n.turnin 16")).toEqual([
      [[], ["firstDropper", "firstDropper"]],
    ]);
    const later = run("step\n#completewith next\n.accept 3861\n.complete 3861,1 -- @sim mob=1985\nstep\n.complete 3861,1\n.turnin 3861");
    expect([later.warnings, later.guides[0]!.steps[1]!.kills.map((k) => [k.count, k.mobFrom])]).toEqual([[], [[4, "override"]]]);
  });

  it("skips an .isQuestComplete turn-in when no step kills a #completewith line's mobs", () => {
    const text = "step\n.accept 170\nstep\n#completewith next\n.complete 170,1\nstep\n.isQuestComplete 170\n.turnin 170";
    const steps = run(text).guides[0]!.steps;
    expect(steps.map((s) => [s.preview.shown, s.kills.map((k) => k.count)])).toEqual([
      [true, []],
      [true, []],
      [false, []],
    ]);
    expect(steps[2]!.state.log.get(170)!.status).toBe("incomplete");
  });

  it("chooses mobs only from lines that apply to the Warrior", () => {
    const step = (text: string) => run(text).guides[0]!.steps[0]!;
    expect(step("step\n.mob 707 << Mage\n.target 1985 << Warrior\n.xp 2").checkpoints[0]!.kills).toEqual({
      count: 8,
      mobs: [{ npcId: 1985, count: 8 }],
    });
    const dropper = (condition: string) =>
      step(`step\n.accept 86\n.mob 1985 << ${condition}\n.complete 86,1`).kills.map((k) => [k.mobFrom, k.mobs.map((m) => m.npcId)]);
    expect(dropper("Mage")).toEqual([["firstDropper", [113]]]);
    expect(dropper("Warrior")).toEqual([["stepMob", [1985]]]);
  });

  it("raises a line's kill warnings once, and not again at the turn-in", () => {
    const { guides, warnings } = run("step\n.accept 15\n.complete 15,1\n.turnin 15\n-- @sim extra=1 mob=999");
    expect(warnings).toEqual([
      { kind: "noKillTarget", at: { guide: 0, step: 0, line: 1 }, questId: 15, objective: "Kobold Worker", reason: "noMatch" },
      { kind: "unknownSimKey", at: { guide: 0, step: 0, line: 3 }, key: "mob", value: "999", problem: "badValue" },
    ]);
    expect(guides[0]!.steps[0]!.kills).toEqual([]);
  });
});

describe("seeded start", () => {
  const kill = (id: number, name: string, count: number): SimNumberedObjective => ({ index: 1, kind: "monster", ids: [id], count, name });
  const data = simData(
    {
      456: { baseXp: 100, objectives: [kill(2031, "Young Nightsaber", 10)] },
      7: { baseXp: 200, objectives: [kill(6, "Kobold Vermin", 10)] },
      18: { baseXp: 300 },
      33: { baseXp: 400 },
    },
    {},
    {
      6: { levels: { min: 1, max: 2 }, elite: false, zoneIds: [12] },
      2031: { levels: { min: 1, max: 1 }, elite: false, zoneIds: [141] },
    },
  );
  const profile = createProfile({ race: "Human", class: "WARRIOR" });

  it("prices seeded items at base chances and continues their level cursors without awarding seed XP", () => {
    const items = simData(
      { 412: { objectives: [{ index: 1, kind: "item", ids: [3083], count: 3, name: "Restabilization Cog" }] } },
      {},
      { 1211: { levels: { min: 8, max: 10 }, elite: false, zoneIds: [1] } },
      { 3083: { droppers: [{ id: 1211 }], sold: false, objectsOnly: false } },
    );
    const result = simulateRoute([guide("A", "step\n.complete 412,1,2 -- @sim drop=1\nstep\n.complete 412,1\n")], 0, profile, items, 0, {
      log: new Map([[412, [{ count: 1, complete: false }]]]),
      done: new Set(),
    });
    expect(result.guides[0]!.steps.map((step) => [step.xp.kills, step.kills.map((k) => [k.count, k.mobs[0]!.levels])])).toEqual([
      [60, [[1, [{ level: 9, kills: 1 }]]]],
      [
        120,
        [
          [
            2,
            [
              { level: 8, kills: 1 },
              { level: 10, kills: 1 },
            ],
          ],
        ],
      ],
    ]);
  });

  it("carries a seeded quest's progress to its completion and turn-in, leaving the seed unchanged", () => {
    const seed: SimStart = {
      log: new Map([
        [456, [{ count: 4, complete: false }]],
        [7, [{ count: 10, complete: true }]],
      ]),
      done: new Set(),
    };
    const unchanged = structuredClone(seed);
    const sim = simulateRoute([guide("A", "step\n.complete 456,1\n.turnin 456\n.turnin 7")], 0, profile, data, 0, seed);
    expect([...sim.start.log].map(([id, p]) => [id, p.status])).toEqual([
      [456, "partial"],
      [7, "complete"],
    ]);
    const step = sim.guides[0]!.steps[0]!;
    expect(step.kills.map((k) => [k.at.line, k.count])).toEqual([[0, 6]]);
    expect(step.notes).toEqual([]);
    expect(step.turnIns.map((t) => [t.questId, t.xp])).toEqual([
      [456, 100],
      [7, 200],
    ]);
    expect(step.state.log.size).toBe(0);
    expect([...step.state.done]).toEqual([456, 7]);
    expect(seed).toEqual(unchanged);
  });

  it("replaces the earlier guides' turn-ins with the seeded ones, which give no XP again", () => {
    const docs = [guide("P", "step\n.turnin 33", "#next S\n"), guide("S", "step\n.accept 18\n.turnin 18")];
    const sim = simulateRoute(docs, 1, profile, data, 0, { log: new Map(), done: new Set([18]) });
    expect([...sim.start.done]).toEqual([18]);
    const step = sim.guides[0]!.steps[0]!;
    expect(step.xp).toEqual({ quest: 0, kills: 0, checkpoint: 0 });
    expect(step.state.log.size).toBe(0);
    expect(step.state).toMatchObject({ level: 1, xp: 0 });
  });

  it("counts a quest that the seed puts in the log and turns in as turned in", () => {
    const sim = simulateRoute([guide("A", "step\n.turnin 456")], 0, profile, data, 0, {
      log: new Map([[456, [{ count: 4, complete: false }]]]),
      done: new Set([456]),
    });
    expect([[...sim.start.log.keys()], [...sim.start.done]]).toEqual([[], [456]]);
    expect(sim.guides[0]!.steps[0]!.kills).toEqual([]);
  });
});

describe("state= on arrival", () => {
  const kills = { index: 1, kind: "monster" as const, ids: [2031], count: 3, name: "Young Nightsaber" };
  const data = simData(
    { 456: { baseXp: 100, objectives: [kills] }, 458: {} },
    { "Teldrassil,1,1": shadowglen(10, 20) },
    {
      2031: { levels: { min: 1, max: 1 }, elite: false, zoneIds: [] },
    },
  );
  const state = (json: string) => `-- @sim state=${json}`;

  it("sets each field before the step's gates and lines, and keeps the fields it leaves out", () => {
    const patch = `{"level": 5, "xp": 100, "log": {"456": {"1": 2}}, "done": {"458": true}, "flightPaths": {"Theramore": true}, "bind": "Teldrassil,1,1"}`;
    const text = (comment: string) => `step\n.accept 456\nstep\n${comment}\n.isQuestTurnedIn 458\n.complete 456,1\nstep\n.fp Theramore`;
    const { guides, warnings } = simulate(text(state(patch)), data, 2, 30);
    const step = guides[0]!.steps[1]!;
    expect(warnings).toEqual([]);
    expect(step.preview.shown).toBe(true);
    expect(step.before).toEqual({
      level: 5,
      xp: 100,
      position: null,
      log: new Map([[456, { status: "partial", objectives: [{ count: 2, complete: false }] }]]),
      done: new Set([458]),
      bind: shadowglen(10, 20),
      flightPaths: new Set([2, 32]),
    });
    expect(step.kills.map((k) => k.count)).toEqual([1]);
    expect(simulate(text(state(`{"level": 4}`)), data, 2, 30).guides[0]!.steps[1]!).toMatchObject({
      preview: { shown: false },
      before: { level: 4, xp: 30, done: new Set() },
    });
  });

  it("sets the level before the XP, so the XP fits the new level whatever the JSON order", () => {
    const { guides, warnings } = simulate(`step\n${state(`{"xp": 500, "level": 5}`)}\n.accept 456`, data);
    expect(warnings).toEqual([]);
    expect(guides[0]!.steps[0]!.before).toMatchObject({ level: 5, xp: 500 });
  });

  it("marks a quest complete, or takes it out of the log", () => {
    const steps = (json: string) => simulate(`step\n.accept 456\nstep\n${state(json)}\n.complete 456,1`, data).guides[0]!.steps;
    const complete = steps(`{"log": {"456": "complete"}}`)[1]!;
    expect(complete.before.log.get(456)).toEqual({ status: "complete", objectives: [{ count: 3, complete: true }] });
    expect(complete.kills).toEqual([]);
    expect([...steps(`{"log": {"456": false}}`)[1]!.before.log.keys()]).toEqual([]);
  });

  it("keeps a quest in the log or turned in, whichever field applies last", () => {
    const before = (text: string, json: string) => {
      const { log, done } = simulate(`${text}step\n${state(json)}\n.turnin 456`, data).guides[0]!.steps.at(-1)!.before;
      return [[...log.keys()], [...done]];
    };
    expect(before("step\n.accept 456\n", `{"done": {"456": true}}`)).toEqual([[], [456]]);
    expect(before("step\n.accept 456\n.turnin 456\n", `{"log": {"456": {"1": 2}}}`)).toEqual([[456], []]);
    expect(before("", `{"done": {"456": true}, "log": {"456": "complete"}}`)).toEqual([[456], []]);
  });

  describe("under a running #completewith window", () => {
    const camp: SimData = {
      ...simData(
        { 456: { baseXp: 100, objectives: [{ ...kills, count: 7 }] } },
        { "Teldrassil,1,1": shadowglen(0, 0), "Teldrassil,2,2,5": shadowglen(200, 0) },
        { 2031: { levels: { min: 1, max: 1 }, elite: false, zoneIds: [] } },
      ),
      spawns: () => [{ ...shadowglen(100, 20), id: "nightsaber" }],
      npcsWithSpawns: () => [2031],
    };
    const steps = (json: string) =>
      simulate(
        `step\n.goto Teldrassil,1,1\n.accept 456\n.complete 456,1,2\nstep\n#completewith next\n.complete 456,1\nstep\n${state(json)}\n.goto Teldrassil,2,2,5\nstep\n.turnin 456`,
        camp,
      ).guides[0]!.steps;

    it("keeps killing the window's mobs from a changed count, and counts the rest at the turn-in", () => {
      const run = steps(`{"log": {"456": {"1": 3}}}`);
      expect(run.map((s) => [s.kills.map((k) => k.count), s.state.log.get(456)?.objectives[0]!.count ?? null])).toEqual([
        [[2], 2],
        [[], 2],
        [[1], 4],
        [[3], null],
      ]);
      expect(run.flatMap((s) => s.notes.flatMap((n) => (n.kind === "killsLater" ? [n.countedAt] : [])))).toEqual([{ guide: 0, step: 2 }]);
    });

    it("stops the window of a quest that leaves the log", () => {
      expect(steps(`{"log": {"456": false}}`).map((s) => s.kills.map((k) => k.count))).toEqual([[2], [], [], []]);
    });
  });

  it("warns for each field it cannot use and applies the others", () => {
    const text = [
      `-- @sim state={"level": 3}`,
      "step",
      state(`{"lvl": 5, "level": 61, "xp": 5000, "hearth": -1, "done": {"99": true, "458": true}, "log": {"456": {"7": 1}}}`),
      `.accept 456 -- @sim state={"level": 2}`,
      "step",
      state(`{"bind": "Nowhere,1,1", "flightPaths": {"Ratchet": true, "Nowhere": true}}`),
      state(`{"level": 4`),
    ].join("\n");
    const { guides, warnings } = simulate(text, data);
    expect(
      warnings.map((w) => [
        w.kind === "unknownSimKey" && w.key,
        w.kind === "unknownSimKey" && w.value,
        w.kind === "unknownSimKey" && w.problem,
      ]),
    ).toEqual([
      ["state", `{"level": 3}`, "misplaced"],
      ["state.lvl", "5", "unknown"],
      ["state.level", "61", "badValue"],
      ["state.hearth", "-1", "badValue"],
      ["state", `{"level": 2}`, "misplaced"],
      ["state", `{"level": 4`, "badValue"],
      ["state.xp", "5000", "badValue"],
      ["state.done", "99", "badValue"],
      ["state.log", "456.7", "badValue"],
      ["state.bind", "Nowhere,1,1", "badValue"],
      ["state.flightPaths", "Nowhere", "badValue"],
    ]);
    expect(guides[0]!.steps[0]!.before).toMatchObject({ level: 1, xp: 0, done: new Set([458]), log: new Map([[456, expect.anything()]]) });
  });

  it("sets a text row of a quest with no numbered objectives, and reports a row past the last as unknown", () => {
    const text = simData({ 1581: { objectives: BLADELEAF_ELIXIRS } });
    const run = (json: string) => simulate(`step\n.accept 1581\nstep\n${state(json)}\n.complete 1581,1`, text, 4);
    expect(run(`{"log": {"1581": {"2": 1}}}`).guides[0]!.steps[1]!.before.log.get(1581)).toEqual({
      status: "partial",
      objectives: [
        { count: 0, complete: false },
        { count: 1, complete: false },
      ],
    });
    expect(run(`{"log": {"1581": {"3": 1}}}`).warnings.map((w) => w.kind === "unknownSimKey" && [w.key, w.value, w.problem])).toEqual([
      ["state.log", "1581.3", "badValue"],
    ]);
  });

  it("counts state= progress on a text row as kills already made", () => {
    const tarantulas: SimTextObjective = {
      kind: "text",
      name: "Greater Tarantula slain",
      count: 12,
      need: "kills",
      link: { kind: "npc", id: 505 },
    };
    const text = simData({ 1578: { objectives: [tarantulas] } }, {}, { 505: { levels: { min: 19, max: 20 }, elite: false, zoneIds: [] } });
    const steps = simulate(`step\n.accept 1578\nstep\n${state(`{"log": {"1578": {"1": 5}}}`)}\n.complete 1578,1`, text).guides[0]!.steps;
    expect(steps[1]!.kills.map((k) => [k.at.line, k.count])).toEqual([[1, 7]]);
  });
});
