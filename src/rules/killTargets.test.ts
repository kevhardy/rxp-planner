import { describe, expect, it } from "vitest";
import { FlightNodes } from "../data/index.ts";
import { parseGuide } from "../guide/index.ts";
import {
  creditDrops,
  killSequence,
  lineKills,
  objectiveKills,
  stepMobs,
  takeKills,
  tallyKills,
  type Kill,
  type KillProgress,
  type StepKills,
} from "./killTargets.ts";
import { simDirectives } from "./simComments.ts";
import type { NameMatch, SimData, SimItem, SimNpc, SimNumberedObjective, SimObjectives, SimQuest, SimTextObjective } from "./simulate.ts";
import { simQuest, testRules } from "./testing.ts";

const npc = (min: number, max: number, zoneIds = [12], elite = false): SimNpc => ({ levels: { min, max }, elite, zoneIds });
const unplaced: SimNpc = { levels: null, elite: false, zoneIds: [] };
const COUNCIL = [2060, 2061, 2062, 2063, 2064, 2065, 2066, 2067, 2068];
const npcs: Record<number, SimNpc> = {
  6: npc(1, 2),
  30: npc(5, 6),
  40: npc(6, 7),
  43: npc(7, 9, [12], true),
  80: npc(3, 4),
  113: npc(5, 6),
  114: npc(14, 15, [40]),
  454: npc(12, 13, [40]),
  476: npc(7, 8),
  505: npc(19, 20, [44]),
  524: npc(7, 8),
  623: npc(17, 18, [40], true),
  624: npc(17, 18, [40], true),
  625: npc(17, 18, [40], true),
  1196: npc(7, 8, [1]),
  1522: npc(7, 8, [85]),
  1765: npc(10, 11, [85, 130]),
  1766: npc(11, 12, [130]),
  1998: npc(5, 6, [141]),
  2060: npc(12, 12, [130], true),
  ...Object.fromEntries(COUNCIL.slice(1, -1).map((id) => [id, npc(13, 13, [130], true)])),
  2068: npc(15, 15, [130], true),
  3098: npc(1, 2, [14]),
  6090: npc(10, 10, [1519]),
  7937: npc(63, 63, [1537], true),
  10556: npc(4, 4, [14]),
  219659: { levels: { min: 63, max: 63 }, elite: null, zoneIds: [] },
  246252: unplaced,
  252088: unplaced,
  260428: npc(9, 12, [85]),
  260430: npc(9, 12, [85]),
  260431: { levels: { min: 8, max: 9 }, elite: null, zoneIds: [] },
  260432: npc(8, 12, [85]),
  271898: npc(18, 19, [44]),
  275703: npc(6, 7, [141]),
  275708: npc(9, 10, [141]),
};
const dropped = (...ids: number[]): SimItem => ({ droppers: ids.map((id) => ({ id })), objectsOnly: false, sold: false });
const items: Record<number, SimItem> = {
  159: { ...dropped(6123, 6), sold: true },
  769: dropped(454, 113, 524),
  1894: dropped(624, 625, 623),
  2320: { ...dropped(), sold: true },
  2455: { ...dropped(117), sold: true },
  2686: { ...dropped(1247), sold: true },
  2845: dropped(),
  3163: dropped(1522, 260432),
  3164: dropped(1766, 1765),
  5465: dropped(1998, 30),
  13872: { ...dropped(), objectsOnly: true },
  15885: { ...dropped(), objectsOnly: true },
  210183: { ...dropped(), objectsOnly: true },
  286017: dropped(275703, 275708),
};
const names: Record<string, NameMatch> = {
  "Blooming Lasher": { kind: "npc", id: 275708 },
  "Dewy Lasher Frond": { kind: "item", id: 286017 },
  "Forest Spider": { kind: "npc", id: 30 },
  "Harvest Watcher": { kind: "npc", id: 114 },
  "High Tinker Mekkatorque": { kind: "ambiguous", npcIds: [7937, 219659] },
  "Ice Claw Bear": { kind: "ambiguous", npcIds: [1196, 252088] },
  "Kobold Vermin": { kind: "ambiguous", npcIds: [6, 246252] },
  "Kobold Worker": { kind: "ambiguous", npcIds: [257, 246258] },
  "Lazy Peon": { kind: "npc", id: 10556 },
  "Mottled Worg": { kind: "npc", id: 1766 },
  "Rockhide Boar": { kind: "npc", id: 524 },
  "Small Spider Leg": { kind: "item", id: 5465 },
  "Webwood Lurker": { kind: "npc", id: 1998 },
  "Shadowvale Lurcher": { kind: "ambiguous", npcIds: [260428, 260431] },
  "Shadowvale Mystic": { kind: "ambiguous", npcIds: [260430, 260432] },
};
const objective = (
  index: number,
  kind: SimNumberedObjective["kind"],
  ids: number[],
  count: number | null,
  name: string,
  need?: SimNumberedObjective["need"],
): SimNumberedObjective => ({ index, kind, ids, count, name, ...(need && { need }) });
const text = (
  name: string,
  count: number | null,
  need: SimTextObjective["need"] = "kills",
  link?: SimTextObjective["link"],
): SimTextObjective => ({
  kind: "text",
  name,
  count,
  need,
  ...(link && { link }),
});
const quest = (name: string, level: number, zoneIds: number[], objectives: SimObjectives) => simQuest({ name, level, zoneIds, objectives });
const quests: Record<number, SimQuest> = {
  7: quest("Kobold Camp Cleanup", 2, [12], [objective(1, "monster", [6], 10, "Kobold Vermin", "kills")]),
  8: quest("A Rogue's Deal", 5, [85], [text("Nondescript Letter", 1, "providedItem", { kind: "item", id: 7628 })]),
  9: quest("The Killing Fields", 15, [40], [text("Harvest Watcher", 20)]),
  15: quest("Investigate Echo Ridge", 3, [12], [text("Kobold Worker", 10)]),
  16: quest("Give Gerard a Drink", 1, [12], [objective(1, "item", [159], 1, "Refreshing Spring Water")]),
  21: quest("Skirmish at Echo Ridge", 5, [12], [objective(1, "monster", [], 12, "Kobold Laborer", "kills")]),
  30: quest("Trial of the Sea Lion", 16, [493], [objective(1, "item", [15885], 1, "Pendant of the Sea Lion", "action")]),
  47: quest("Gold Dust Exchange", 7, [12], [objective(1, "item", [], 10, "Gold Dust", "kills")]),
  62: quest("The Fargodeep Mine", 7, [12], [objective(1, "other", [], null, "Scout through the Fargodeep Mine")]),
  86: quest("Pie for Billy", 6, [12], [objective(1, "item", [769], 4, "Chunk of Boar Meat", "kills")]),
  168: quest("Collecting Memories", 18, [1581], [objective(1, "item", [1894], 4, "Miners' Union Card", "kills")]),
  308: quest("Distracting Jarven", 7, [1], [objective(1, "item", [2686], null, "Thunder Ale")]),
  364: quest(
    "The Mindless Ones",
    2,
    [85],
    [objective(1, "monster", [1501], 8, "Mindless Zombie", "kills"), objective(2, "monster", [1502], 8, "Wretched Zombie", "kills")],
  ),
  375: quest(
    "The Chill of Death",
    8,
    [85],
    [objective(1, "item", [2876], 5, "Duskbat Pelt", "kills"), objective(2, "item", [2320], 1, "Coarse Thread")],
  ),
  426: quest(
    "The Mills Overrun",
    8,
    [85],
    [objective(1, "item", [3162], 5, "Notched Rib", "kills"), objective(2, "item", [3163], 3, "Blackened Skull", "kills")],
  ),
  429: quest("Wild Hearts", 11, [130], [text("Discolored Worg Heart", 3, "kills", { kind: "item", id: 3164 })]),
  452: quest("Pyrewood Ambush", 15, [130], [objective(1, "monster", COUNCIL, null, "Councilman Smithers")]),
  783: quest("A Threat Within", 1, [12], []),
  1073: quest(
    "Ineptitude + Chemicals = Fun",
    21,
    [406],
    [objective(1, "item", [2455], 4, "Minor Mana Potion", "action"), objective(2, "item", [2458], 2, "Elixir of Minor Fortitude")],
  ),
  1578: quest(
    "Supplying the Front",
    12,
    [38, 1537],
    [objective(1, "item", [2845], 6, "Copper Axe"), objective(2, "item", [2851], 6, "Copper Chain Belt")],
  ),
  1640: quest("Beat Bartleby", 10, [1519], [objective(1, "monster", [6090], null, "Bartleby")]),
  4161: quest("Recipe of the Kaldorei", 7, [141], [objective(1, "item", [5465], 7, "Small Spider Leg", "kills")]),
  5441: quest("Lazy Peons", 4, [14], [objective(1, "monster", [10556], 5, "Lazy Peon", "action")]),
  5545: quest("A Bundle of Trouble", 9, [12], [objective(1, "item", [13872], 8, "Bundle of Wood")]),
  6085: quest("Taming the Beast", 10, [], [objective(1, "monster", [1196], null, "Ice Claw Bear", "action")]),
  78261: quest("The Horn of Xelthos", 23, [130], [objective(1, "item", [210183], null, "Horn of Xelthos")]),
  91723: quest("Delicate Instruments", 10, [12], [text("Kobold Geomancer slain", 8, "kills", { kind: "npc", id: 476 })]),
  93963: quest(
    "Exploring the Alliance",
    13,
    [1519],
    [
      text("Recieve Instructions from Randal Emerson", 1, "action", { kind: "npc", id: 275491 }),
      text("Speak with High Tinker Mekkatorque", 1, "action", { kind: "npc", id: 7937 }),
    ],
  ),
  98386: quest(
    "Alther's Mill",
    21,
    [44],
    [text("Greater Tarantula slain", 12), text("Tarantula Egg destroyed", 6, "action", { kind: "npc", id: 271912 })],
  ),
  99050: quest(
    "The Great Tree Provides",
    10,
    [141],
    [
      text("Dewy Lasher Frond", 6),
      text("Empty Vial", 1, "action", { kind: "item", id: 3371 }),
      text("Refreshing Spring Water", 1, "action", { kind: "item", id: 159 }),
    ],
  ),
};

const data: SimData = {
  quest: (id) => quests[id],
  npc: (id) => npcs[id],
  item: (id) => items[id],
  rules: testRules,
  entityByName: (name) => names[name],
  flights: new FlightNodes(),
  uiMapNamed: () => undefined,
  locateGoto: () => undefined,
};

const at = { guide: 0, step: 0, line: 0 };
const parse = (body: string[]) => parseGuide(["step", ...body].join("\n") + "\n");
const run = (...body: string[]) => {
  const doc = parse(body);
  const step = doc.steps[0]!;
  const { directives } = simDirectives(doc, 0);
  const out: StepKills = { kills: [], counts: [], notes: [], warnings: [] };
  for (const line of [undefined, ...step.body.keys()]) {
    const found = lineKills(step, { guide: 0, step: 0, ...(line !== undefined && { line }) }, directives, data, stepMobs(step, data));
    out.kills.push(...found.kills);
    out.counts.push(...found.counts);
    out.notes.push(...found.notes);
    out.warnings.push(...found.warnings);
  }
  return out;
};
const kill = (...body: string[]) => {
  const { kills, warnings } = run(...body);
  expect(warnings).toEqual([]);
  expect(kills).toHaveLength(1);
  const { at: _, ...rest } = kills[0]!;
  return rest;
};
const mobsOf = (...body: string[]) => {
  const { mobFrom, mobLines, mobs } = kill(...body);
  return { mobFrom, mobLines, kills: mobs.map((m) => [m.npcId, m.levels.reduce((n, l) => n + l.kills, 0)]) };
};
const textRow = (questId: number, row: number, ...body: string[]) =>
  objectiveKills(data, { questId, row }, { at, mobs: stepMobs(parse(body).steps[0]!, data) });

describe("lineKills", () => {
  it.each([
    [113, 524],
    [524, 113],
  ])("keeps varied source allocations when sources are ordered %s then %s", (a, b) => {
    const varied: SimData = {
      ...data,
      quest: () => simQuest({ name: "Pie for Billy", zoneIds: [12], objectives: [objective(1, "item", [769], 1, "Chunk of Boar Meat")] }),
      item: () => ({
        sold: false,
        objectsOnly: false,
        droppers: [a, b].map((id) => ({ id, chance: id === 113 ? 0.5 : 1 })),
      }),
    };
    const found = objectiveKills(varied, { questId: 86, row: 0 }, { at, mobs: stepMobs(parse([]).steps[0]!, varied) });
    expect(
      found.kills.map((k) => [
        k.count,
        k.mobs.toSorted((x, y) => x.npcId - y.npcId).map((m) => [m.npcId, m.levels.reduce((sum, l) => sum + l.kills, 0)]),
      ]),
    ).toEqual([
      [
        2,
        [
          [113, 1],
          [524, 1],
        ],
      ],
    ]);
  });

  it("counts a monster objective's required count at its .complete line, split across the mob's levels", () => {
    expect(run("#xprate 1", ".complete 7,1")).toEqual({
      kills: [
        {
          at: { guide: 0, step: 0, line: 1 },
          objective: { questId: 7, row: 0 },
          eligibleNpcIds: [6],
          count: 10,
          countFrom: "data",
          mobFrom: "objective",
          mobs: [
            {
              npcId: 6,
              levels: [
                { level: 1, kills: 5 },
                { level: 2, kills: 5 },
              ],
            },
          ],
        },
      ],
      counts: [{ at: { guide: 0, step: 0, line: 1 }, count: 10, from: "data" }],
      notes: [],
      warnings: [],
    });
  });

  it("takes the count from kills=, then the data, then the line's text", () => {
    const count = (line: string) => {
      const { count, countFrom } = kill(line);
      return [count, countFrom];
    };
    expect(count(".complete 7,1 -- @sim kills=5")).toEqual([5, "override"]);
    expect(count(".complete 7,1 --Kill Kobold Vermin (x12)")).toEqual([10, "data"]);
    expect(count(".complete 1640,1 --Beat Bartleby (x2)")).toEqual([2, "guideText"]);
    expect(count(".complete 1640,1 --Bartleby (3)")).toEqual([3, "guideText"]);
    expect(count(".complete 1640,1 --Bartleby (3) @sim mob=6090")).toEqual([3, "guideText"]);
    expect(count(".complete 1640,1 >> Bartleby 0/4")).toEqual([4, "guideText"]);
    expect(count(".complete 7,1,3")).toEqual([10, "data"]);
    const last = parseGuide("step\n.complete 1640,1 --Bartleby (3)").steps[0]!;
    expect(lineKills(last, at, [], data, stepMobs(last, data)).kills.map((k) => [k.count, k.countFrom])).toEqual([[3, "guideText"]]);
  });

  it("warns and counts no kills when the count is unknown", () => {
    for (const line of [".complete 1640,1,3", ".complete 1640,1 --Beat Bartleby"]) {
      expect(run(line)).toEqual({
        kills: [],
        counts: [],
        notes: [],
        warnings: [{ kind: "noKillCount", at: { guide: 0, step: 0, line: 0 }, questId: 1640, objective: "Bartleby" }],
      });
    }
  });

  it("chooses an item objective's mob: override, step mob that drops it, zone droppers, then first dropper", () => {
    expect(kill(".complete 4161,1").itemId).toBe(5465);
    expect(mobsOf(".complete 4161,1 -- @sim mob=1998")).toEqual({ mobFrom: "override", kills: [[1998, 14]] });
    expect(mobsOf(".mob Webwood Lurker", ".complete 4161,1")).toEqual({ mobFrom: "stepMob", mobLines: ["mob"], kills: [[1998, 14]] });
    expect(mobsOf(".target 275703", ".complete 4161,1")).toEqual({ mobFrom: "zoneDroppers", kills: [[1998, 14]] });
    expect(mobsOf(".complete 86,1")).toEqual({
      mobFrom: "zoneDroppers",
      kills: [
        [113, 4],
        [524, 4],
      ],
    });
    expect(mobsOf(".complete 168,1")).toEqual({ mobFrom: "firstDropper", kills: [[624, 8]] });
  });

  it("chooses a monster objective's mob from several: override, step mob, else all of them", () => {
    expect(mobsOf(".complete 452,1 -- @sim kills=9")).toEqual({ mobFrom: "objective", kills: COUNCIL.map((id) => [id, 1]) });
    expect(mobsOf(".target 2061", ".complete 452,1 -- @sim kills=9")).toEqual({
      mobFrom: "stepMob",
      mobLines: ["target"],
      kills: [[2061, 9]],
    });
    expect(mobsOf(".unitscan 2061", ".complete 452,1 -- @sim kills=9")).toEqual({
      mobFrom: "stepMob",
      mobLines: ["unitscan"],
      kills: [[2061, 9]],
    });
    expect(mobsOf(".unitscan 2060", ".target 2061", ".complete 452,1 -- @sim kills=1")).toEqual({
      mobFrom: "stepMob",
      mobLines: ["target", "unitscan"],
      kills: [[2060, 1]],
    });
    expect(mobsOf(".mob 2061", ".complete 452,1 -- @sim kills=9 mob=2068")).toEqual({ mobFrom: "override", kills: [[2068, 9]] });
  });

  it("keeps a monster or item objective without IDs to overrides, and warns without one", () => {
    expect(mobsOf(".complete 21,1 -- @sim kills=4 mob=80")).toEqual({ mobFrom: "override", kills: [[80, 4]] });
    expect(kill(".complete 21,1 -- @sim kills=4 mob=80").itemId).toBeUndefined();
    expect(kill(".complete 47,1 -- @sim mob=40").itemId).toBeNull();
    expect(mobsOf(".complete 47,1 -- @sim mob=40")).toEqual({ mobFrom: "override", kills: [[40, 20]] });
    const reasons = (...body: string[]) => run(...body).warnings.map((w) => w.kind === "noKillTarget" && w.reason);
    expect(reasons(".mob 80", ".complete 21,1")).toEqual(["noMatch"]);
    expect(reasons(".complete 47,1")).toEqual(["noDropper"]);
  });

  it("warns when no mob can be found or its levels are unknown", () => {
    const reasons = (line: string) => run(line).warnings.map((w) => w.kind === "noKillTarget" && w.reason);
    expect(reasons(".complete 1578,1")).toEqual(["noDropper"]);
    expect(reasons(".complete 7,1 -- @sim mob=246252")).toEqual(["noLevels"]);
  });

  it("notes an item only objects give, with no kills or warning", () => {
    expect(run(".complete 5545,1")).toEqual({
      kills: [],
      counts: [{ at: { guide: 0, step: 0, line: 0 }, count: 8, from: "data" }],
      notes: [
        {
          kind: "gathered",
          at: { guide: 0, step: 0, line: 0 },
          objective: { questId: 5545, row: 0 },
          itemId: 13872,
          count: 8,
        },
      ],
      warnings: [],
    });
    expect(run(".complete 78261,1")).toEqual({
      kills: [],
      counts: [],
      notes: [{ kind: "gathered", at, objective: { questId: 78261, row: 0 }, itemId: 210183, count: null }],
      warnings: [],
    });
  });

  it("notes a sold item as bought, even when mobs drop it, unless kills= or mob= says otherwise", () => {
    const bought = (questId: number, row: number, itemId: number, count: number | null = 1) => ({
      kind: "bought",
      at,
      objective: { questId, row },
      itemId,
      count,
    });
    expect(run(".complete 308,1")).toEqual({ kills: [], counts: [], notes: [bought(308, 0, 2686, null)], warnings: [] });
    expect(run(".complete 16,1")).toEqual({
      kills: [],
      counts: [{ at, count: 1, from: "data" }],
      notes: [bought(16, 0, 159)],
      warnings: [],
    });
    expect(run(".complete 375,2")).toMatchObject({ kills: [], notes: [bought(375, 1, 2320)], warnings: [] });
    expect(mobsOf(".complete 16,1 -- @sim kills=3")).toEqual({ mobFrom: "zoneDroppers", kills: [[6, 3]] });
    expect(mobsOf(".complete 375,2 -- @sim mob=1522")).toEqual({ mobFrom: "override", kills: [[1522, 2]] });
    expect(run(".complete 375,2 -- @sim kills=2").warnings.map((w) => w.kind === "noKillTarget" && w.reason)).toEqual(["noDropper"]);
  });

  it("counts nothing for objectives needing no kills, kills=0, or unknown quests and indexes", () => {
    const empty = { kills: [], counts: [], notes: [], warnings: [] };
    for (const line of [".complete 62,1", ".complete 3,1", ".complete 7,2"]) {
      expect(run(line)).toEqual(empty);
    }
    expect(run(".complete 7,1 -- @sim kills=0")).toEqual({
      ...empty,
      counts: [{ at: { guide: 0, step: 0, line: 0 }, count: 10, from: "data" }],
    });
  });

  it("counts a quest's Nth text row at .complete q,N when it has no numbered objectives", () => {
    const { kills, warnings } = run(".mob 505", ".complete 98386,1", ".complete 98386,2", ".complete 98386,3");
    expect(kills.map((k) => [k.at.line, k.objective, k.mobFrom, k.mobs.map((m) => m.npcId), k.count])).toEqual([
      [1, { questId: 98386, row: 0 }, "stepMob", [505], 12],
    ]);
    expect(warnings).toEqual([
      { kind: "noKillTarget", at: { guide: 0, step: 0, line: 3 }, questId: 98386, objective: "Objective 3", reason: "noMatch" },
    ]);
  });

  it("warns noMatch at .complete q,1 on a quest with no rows", () => {
    expect(run(".complete 783,1")).toEqual({
      kills: [],
      counts: [],
      notes: [],
      warnings: [{ kind: "noKillTarget", at, questId: 783, objective: "Objective 1", reason: "noMatch" }],
    });
  });

  it("warns on an extra= mob that is unknown or has no known levels", () => {
    expect(run("-- @sim extra=2 mob=246252", "-- @sim extra=2 mob=999")).toEqual({
      kills: [],
      counts: [],
      notes: [],
      warnings: [
        { kind: "unknownSimKey", at: { guide: 0, step: 0, line: 0 }, key: "mob", value: "246252", problem: "badValue" },
        { kind: "unknownSimKey", at: { guide: 0, step: 0, line: 1 }, key: "mob", value: "999", problem: "badValue" },
      ],
    });
  });

  it("adds extra= kills toward no objective, on the step or a line", () => {
    const { kills } = run("-- @sim extra=3 mob=524", ".goto Elwynn Forest,1,2 -- @sim extra=1 mob=6");
    expect(kills).toEqual([
      {
        at: { guide: 0, step: 0, line: 0 },
        count: 3,
        countFrom: "override",
        mobFrom: "override",
        mobs: [
          {
            npcId: 524,
            levels: [
              { level: 7, kills: 2 },
              { level: 8, kills: 1 },
            ],
          },
        ],
      },
      {
        at: { guide: 0, step: 0, line: 1 },
        count: 1,
        countFrom: "override",
        mobFrom: "override",
        mobs: [{ npcId: 6, levels: [{ level: 1, kills: 1 }] }],
      },
    ]);
  });
});

describe("lineKills for a numbered objective's need", () => {
  it("counts no kills, count, or warning for actions, whatever the step or line names", () => {
    const empty = { kills: [], counts: [], notes: [], warnings: [] };
    const units = [".mob Lazy Peon", ".target Lazy Peon", ".unitscan Lazy Peon"];
    for (const line of [".complete 5441,1", ".complete 5441,1 -- @sim kills=3", ".complete 5441,1 -- @sim mob=3098"]) {
      expect(run(...units, line)).toEqual(empty);
    }
    expect(run(".complete 30,1")).toEqual(empty);
    expect(run(".complete 1073,1")).toEqual(empty);
    expect(mobsOf(".complete 5441,1 -- @sim extra=2 mob=3098")).toEqual({ mobFrom: "override", kills: [[3098, 2]] });
  });

  it("counts kills of an objective's own IDs when it needs kills", () => {
    expect(kill(".complete 7,1")).toMatchObject({
      objective: { questId: 7, row: 0 },
      count: 10,
      countFrom: "data",
      mobFrom: "objective",
      mobs: [{ npcId: 6 }],
    });
  });
});

describe("objectiveKills for text rows", () => {
  it("matches a row's name to an NPC or an item", () => {
    expect(textRow(9, 0).kills.map((k) => [k.mobFrom, k.mobs[0]!.npcId, k.count])).toEqual([["nameMatch", 114, 20]]);
    expect(textRow(99050, 0, ".mob Blooming Lasher").kills.map((k) => [k.mobFrom, k.mobs[0]!.npcId, k.count])).toEqual([
      ["stepMob", 275708, 12],
    ]);
  });

  it("resolves a row's link before its name, choosing a linked item's dropper as for an item objective", () => {
    const chosen = (questId: number, ...body: string[]) =>
      textRow(questId, 0, ...body).kills.map((k) => [k.mobFrom, k.mobs.map((m) => m.npcId), k.count]);
    expect(chosen(91723)).toEqual([["objective", [476], 8]]);
    expect(chosen(429, ".mob Mottled Worg")).toEqual([["stepMob", [1766], 6]]);
    expect(chosen(429)).toEqual([["zoneDroppers", [1766, 1765], 6]]);
  });

  it("falls back to the step's .mob lines, else warns why no name matched", () => {
    expect(textRow(98386, 0, ".mob 505;271898").kills.map((k) => [k.mobFrom, k.mobLines, k.mobs.map((m) => m.npcId)])).toEqual([
      ["stepMob", ["mob"], [505, 271898]],
    ]);
    const warning = (questId: number, reason: string) => ({
      kind: "noKillTarget",
      at,
      questId,
      objective: quests[questId]!.objectives[0]!.name,
      reason,
    });
    expect(textRow(15, 0, ".target 257")).toEqual({
      kills: [],
      counts: [{ at, count: 10, from: "data" }],
      notes: [],
      warnings: [warning(15, "ambiguous")],
    });
    expect(textRow(98386, 0)).toEqual({
      kills: [],
      counts: [{ at, count: 12, from: "data" }],
      notes: [],
      warnings: [warning(98386, "noMatch")],
    });
  });

  it("counts no kills and raises no warning for provided items and actions", () => {
    expect(textRow(8, 0)).toEqual({ kills: [], counts: [], notes: [], warnings: [] });
    expect(textRow(99050, 1)).toEqual({ kills: [], counts: [], notes: [], warnings: [] });
  });
});

describe("stepMobs", () => {
  it("reads IDs, Name::id, and names that match one NPC", () => {
    const step = parse([
      ".mob +Forest Spider;Kobold Vermin::6;Kobold Worker;Small Spider Leg",
      ".target 113;Nobody",
      ".unitscan Rockhide Boar",
    ]).steps[0]!;
    expect(stepMobs(step, data)).toEqual({
      mob: [30, 6],
      target: [113, 524],
      lines: new Map([
        [30, ["mob"]],
        [6, ["mob"]],
        [113, ["target"]],
        [524, ["unitscan"]],
      ]),
    });
  });

  it("reads a name several NPCs share as the one the step's quests name, else the one in their zones", () => {
    const mob = (...body: string[]) => stepMobs(parse(body).steps[0]!, data).mob;
    expect(mob(".mob Kobold Vermin", ".complete 7,1")).toEqual([6]);
    expect(mob(".mob Shadowvale Mystic", ".complete 426,2")).toEqual([260432]);
    expect(stepMobs(parseGuide("step\n.mob Shadowvale Mystic\n.complete 426-- note").steps[0]!, data).mob).toEqual([260432]);
    expect(mobsOf(".mob Shadowvale Mystic", ".complete 426,2")).toEqual({ mobFrom: "stepMob", mobLines: ["mob"], kills: [[260432, 6]] });
    expect(mob(".mob Shadowvale Lurcher", ".turnin 364")).toEqual([260428]);
    expect(mob(".mob Shadowvale Mystic", ".turnin 364")).toEqual([]);
    expect(mob(".mob Shadowvale Mystic")).toEqual([]);
  });

  it("does not read a shared name from rows or objectives that need no kills", () => {
    const target = (...body: string[]) => stepMobs(parse(body).steps[0]!, data).target;
    expect(target(".target High Tinker Mekkatorque", ".complete 93963,2")).toEqual([]);
    expect(target(".target Ice Claw Bear", ".complete 6085,1")).toEqual([]);
  });
});

describe("kill split", () => {
  const levels = (...body: string[]) => kill(...body).mobs.map((m) => [m.npcId, m.levels.map((l) => [l.level, l.kills])]);

  it("splits kills evenly across mobs, then levels, giving leftovers to low and high levels in turn", () => {
    expect(levels(".complete 7,1 -- @sim kills=5 mob=43")).toEqual([
      [
        43,
        [
          [7, 2],
          [8, 1],
          [9, 2],
        ],
      ],
    ]);
    expect(levels(".complete 86,1 -- @sim kills=3")).toEqual([
      [
        113,
        [
          [5, 1],
          [6, 1],
        ],
      ],
      [524, [[7, 1]]],
    ]);
  });

  it("counts a mob on both .mob and .target once, naming both lines", () => {
    expect(mobsOf(".mob 2060;2061", ".target 2060", ".complete 452,1 -- @sim kills=6")).toEqual({
      mobFrom: "stepMob",
      mobLines: ["mob", "target"],
      kills: [
        [2060, 3],
        [2061, 3],
      ],
    });
    expect(mobsOf(".mob 524;113", ".target 524", ".complete 86,1")).toEqual({
      mobFrom: "stepMob",
      mobLines: ["mob", "target"],
      kills: [
        [524, 4],
        [113, 4],
      ],
    });
  });

  it("gives every kill to the chosen mobs with known levels, and warns only when none has them", () => {
    expect(mobsOf(".mob 505;271988", ".complete 98386,1")).toEqual({ mobFrom: "stepMob", mobLines: ["mob"], kills: [[505, 12]] });
    expect(run(".complete 98386,1 -- @sim mob=271988")).toMatchObject({
      kills: [],
      warnings: [{ kind: "noKillTarget", questId: 98386, objective: "Greater Tarantula slain", reason: "noLevels" }],
    });
  });
});

describe("killSequence", () => {
  it("gives the whole allocation across consecutive slices", () => {
    const sequence = killSequence(kill(".complete 7,1").mobs);
    const total = (kills: Kill[]) => tallyKills(kills).flatMap((m) => m.levels.map((l) => [l.level, l.kills]));
    expect(total(sequence.slice(0, 1))).toEqual([[1, 1]]);
    expect(total(sequence.slice(1))).toEqual([
      [1, 4],
      [2, 5],
    ]);
    expect(tallyKills(sequence)).toEqual(kill(".complete 7,1").mobs);
  });
});

describe("takeKills", () => {
  const vermin = run(".complete 7,1").kills[0]!;
  const legs = run(".mob 1998", ".complete 4161,1").kills[0]!;
  const levels = (kills: readonly Kill[]) => kills.map((k) => k.level);
  const killsPerLine = (fresh: typeof vermin, party: 1 | 2, ...to: number[]) => {
    let progress: KillProgress = { counted: 0 };
    return to.map((n) => {
      const taken = takeKills(progress, { to: n }, party, data, { fresh })!;
      progress = taken.progress;
      return { kills: taken.kills.length, counted: progress.counted };
    });
  };

  it("continues the first line's kill order, and counts none past the goal", () => {
    const first = takeKills({ counted: 0 }, { to: 3 }, 1, data, { fresh: vermin })!;
    expect(levels(first.kills)).toEqual([1, 2, 1]);
    expect(first.progress).toMatchObject({ counted: 3, first: vermin });
    const rest = takeKills(first.progress, { to: 10 }, 1, data)!;
    expect(levels(rest.kills)).toEqual([2, 1, 2, 1, 2, 1, 2]);
    const done = takeKills(rest.progress, { to: 10 }, 1, data)!;
    expect(done.kills).toEqual([]);
    expect(done.progress.counted).toBe(10);
    expect(takeKills({ counted: 0 }, { to: 10 }, 1, data)).toBeUndefined();
  });

  it("rounds the running expected drops, so one-item lines kill as many as one whole line", () => {
    expect(killsPerLine(legs, 1, 1, 2, 3)).toEqual([
      { kills: 2, counted: 1 },
      { kills: 2, counted: 2 },
      { kills: 2, counted: 3 },
    ]);
    expect(killsPerLine(legs, 1, 3)).toEqual([{ kills: 6, counted: 3 }]);
  });

  it("needs a drop for each member's item in a duo, and the same kills of a monster", () => {
    expect(killsPerLine(legs, 2, 3)).toEqual([{ kills: 12, counted: 3 }]);
    expect(killsPerLine(vermin, 2, 10)).toEqual([{ kills: 10, counted: 10 }]);
  });

  it("counts seeded items as made without kills, and continues each mob's levels after them", () => {
    const taken = takeKills({ counted: 2 }, { to: 3 }, 1, data, { fresh: legs })!;
    expect(levels(taken.kills)).toEqual([5, 6]);
    expect(taken.progress.counted).toBe(3);
  });

  it("sets every dropper's chance with drop= for its own kills only", () => {
    const sure = takeKills({ counted: 0 }, { to: 1 }, 1, data, { fresh: legs, drop: 1 })!;
    expect(sure.kills).toHaveLength(1);
    expect(sure.mobs.drops).toEqual([{ npcId: 1998, chance: { value: 1, source: { kind: "override" } } }]);
    const rest = takeKills(sure.progress, { to: 3 }, 1, data)!;
    expect(rest.kills).toHaveLength(4);
    expect(rest.mobs.drops).toEqual([{ npcId: 1998, chance: { value: 0.5, source: { kind: "default" } } }]);
  });

  it("counts kills=, whatever the progress", () => {
    const taken = takeKills({ counted: 4, first: vermin }, { kills: 2 }, 1, data)!;
    expect(levels(taken.kills)).toEqual([1, 2]);
    expect(taken.progress.counted).toBe(6);
  });
});

describe("creditDrops", () => {
  const legs = run(".mob 1998", ".complete 4161,1").kills[0]!;
  const afterOne = takeKills({ counted: 0 }, { to: 1 }, 1, data, { fresh: legs })!.progress;

  it("credits items that other kills drop, so later lines need fewer kills", () => {
    const credited = creditDrops(afterOne, 3, 0.5, 1);
    expect(credited.counted).toBe(1.5);
    expect(takeKills(credited, { to: 3 }, 1, data)!.kills).toHaveLength(3);
    expect(takeKills(afterOne, { to: 3 }, 1, data)!.kills).toHaveLength(4);
  });

  it("credits no more than the objective's count, in each member's items", () => {
    expect(creditDrops(afterOne, 3, 5, 1).counted).toBe(3);
    expect(creditDrops({ counted: 1 }, 3, 1, 2).counted).toBe(1.5);
    expect(creditDrops(afterOne, 3, 0, 1).counted).toBe(1);
  });

  it("advances the progress with no kills when the rounded total does not grow", () => {
    const credited = creditDrops(afterOne, 3, 1.8, 1);
    const taken = takeKills(credited, { to: 3 }, 1, data)!;
    expect(taken.kills).toEqual([]);
    expect(taken.progress.counted).toBe(3);
  });
});
