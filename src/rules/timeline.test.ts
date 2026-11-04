import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FlightNodes, type Spawn, type WorldLocation } from "../data/index.ts";
import { mapToWorld, worldToCanvas } from "../data/maps.ts";
import { MAP_BOUNDS, plannerData } from "../data/plannerFixture.ts";
import { terrainFixture } from "../data/terrainFixture.ts";
import { COMMANDS, extractGuides, guideTextPlain, parseGuide } from "../guide/index.ts";
import { createProfile } from "./profile.ts";
import type { SimData, SimItem, SimNpc, SimQuest } from "./simulate.ts";
import { advance } from "./character.ts";
import { PlaybackRouting } from "../routing/playback.ts";
import { simQuest, testRules } from "./testing.ts";
import { TIMELINE_MODEL } from "./model.ts";
import { validateSimulation } from "./validate.ts";
import { hearthKey, simulateRoute } from "./simulate.ts";
import {
  buildTimeline,
  formatClock,
  mobColor,
  mobsAt,
  momentAt,
  priceRoute,
  reportTitle,
  shownSeconds,
  stepActions,
  stepTitle,
  stepTitleParts,
  straightTravel,
  timelineNpcs,
  type QuestNpc,
  type TimelineStep,
  type TravelLeg,
} from "./timeline.ts";

const loc = (x: number, y: number, instance = 0): WorldLocation => ({ x, y, instance });

function near(origin: WorldLocation) {
  const at = (x: number, y: number, instance = origin.instance): WorldLocation => ({ x: origin.x + x, y: origin.y + y, instance });
  const spot = (x: number, y: number, instance = origin.instance): Spawn => ({ ...at(x, y, instance), id: `${instance}:${x},${y}` });
  const position = (x: number, y: number) => ({ map: origin.instance, x: origin.x + x, y: origin.y + y });
  return { loc: at, spot, position };
}
const SHADOWGLEN = near(loc(831, 10331, 1));
const CAMP_NARACHE = near(loc(-258, -2913, 1));
const DEATHKNELL = near(loc(1642, 1843));
const NORTHSHIRE = near(loc(-158, -8898));
const GOLDSHIRE = near(loc(16, -9462));
const COLDRIDGE = near(loc(334, -6215));
const PYREWOOD = near(loc(1497, -416));

const QUEST_NAMES: Record<number, string> = {
  7: "Kobold Camp Cleanup",
  33: "Wolves Across the Border",
  179: "Dwarven Outfitters",
  374: "Proof of Demise",
  452: "Pyrewood Ambush",
  456: "The Balance of Nature",
  457: "The Balance of Nature",
  747: "The Hunt Begins",
  748: "Poison Water",
  916: "Webwood Venom",
  1470: "Piercing the Veil",
  2459: "Ferocitas the Dream Eater",
  3521: "Iverron's Antidote",
  3901: "Rattling the Rattlecages",
};
function questName(id: number): string {
  const name = QUEST_NAMES[id];
  if (name === undefined) throw new Error(`No name for quest ${id}`);
  return name;
}

function simData(
  quests: Record<number, Partial<SimQuest>>,
  places: Record<string, WorldLocation>,
  npcs: Record<number, SimNpc> = {},
  items: Record<number, SimItem> = {},
  spawns?: SimData["spawns"],
): SimData {
  return {
    quest: (id) => quests[id] && simQuest({ name: questName(id), ...quests[id] }),
    npc: (id) => npcs[id],
    item: (id) => items[id],
    rules: testRules,
    entityByName: () => undefined,
    locateGoto: (args) => places[args.join(",")],
    flights: new FlightNodes(),
    uiMapNamed: () => undefined,
    ...(spawns && { spawns }),
  };
}

const timing = (s: TimelineStep) => s.activities.map((a) => [a.kind, a.start, a.seconds, a.effects.map((e) => e.kind)]);
const guide = (text: string, name = "A") => parseGuide(`#group G\n#name ${name}\n${text}\n`);
const duo = (text: string, name = "A") => guide(`-- @sim party=2\n${text}`, name);
const warrior = createProfile({ race: "Human", class: "WARRIOR", level: 1 });
const nightElf = createProfile({ race: "NightElf", class: "WARRIOR", level: 1 });

describe("formatClock", () => {
  it("rounds to the nearest second and adds the hour past 59:59", () => {
    expect([formatClock(59.6), formatClock(3599.5), formatClock(3723.4)]).toEqual(["1:00", "1:00:00", "1:02:03"]);
  });
});

describe("shownSeconds", () => {
  it("rounds a step's end and start, so its start plus its time is the next start", () => {
    expect(shownSeconds({ start: 13.6, seconds: { travel: 18.6, kill: 0, interact: 0, wait: 0, total: 18.6 } })).toEqual({
      travel: 18,
      kill: 0,
      interact: 0,
      wait: 0,
      total: 18,
    });
  });

  it("rounds each part at its own ends, so the parts add up to the total", () => {
    expect(shownSeconds({ start: 0.4, seconds: { travel: 0.3, kill: 0.3, interact: 0, wait: 0, total: 0.6 } })).toEqual({
      travel: 1,
      kill: 0,
      interact: 0,
      wait: 0,
      total: 1,
    });
  });
});

describe("buildTimeline", () => {
  it.each(["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"])(
    "ignores unknown command %s in Playback activities and actions",
    async (command) => {
      const data = simData({}, {});
      const result = await buildTimeline([guide(`step\n.${command} 783\nstep\n.vendor`)], 0, warrior, data);
      expect(
        result.steps.map((step) => step.activities.filter((activity) => activity.kind === "interact").map((activity) => activity.action)),
      ).toEqual([[], ["vendor"]]);
      expect(result.steps.map((step) => stepActions(step, result.names))).toEqual([[], [{ kind: "vendor", label: "" }]]);
    },
  );

  const { loc, spot, position } = SHADOWGLEN;
  const places = { "Teldrassil,1,1": loc(0, 0), "Teldrassil,2,2": loc(70, 0) };
  const wolves = { index: 1, kind: "monster" as const, ids: [2031], count: 2, name: "Young Nightsaber" };
  const data = simData({ 456: { baseXp: 100, objectives: [wolves] } }, places, {
    2031: { levels: { min: 1, max: 1 }, elite: false, zoneIds: [] },
  });
  const text = [
    "step\n.goto Teldrassil,1,1\n.accept 456",
    "step\n.goto Teldrassil,2,2\n.complete 456,1",
    "step\n.goto Teldrassil,1,1\n.turnin 456",
  ].join("\n");
  const spawns = () => [spot(70, 0), spot(77, 0)];
  const npcName = (id: number) => (id === 2031 ? "Young Nightsaber" : undefined);

  it.each([
    { body: ".xp 2", travel: 0 },
    { body: ".accept 456", travel: 0 },
    { body: ".turnin 456", travel: 0 },
    { body: ".complete 456,1", travel: 0 },
    { body: ".collect 8050,1,2459", travel: 0 },
    { body: ".abandon 457", travel: 0 },
    { body: ">>A place to look", travel: 0 },
    { body: "#optional\n.xp 2", travel: 0 },
    { body: ".xp 2\n.goto Teldrassil,2,2,10,0", travel: 0 },
    { body: ".xp 2\n.goto Teldrassil,2,2,nan", travel: 0 },
    { body: ".xp 2\n.goto Teldrassil,1,1,10", travel: 0 },
    { body: ".xp 2\n.goto Teldrassil,2,2,10", travel: 12 },
    { body: ".xp 2\n.groundgoto Teldrassil,1,1,10", travel: 0 },
    { body: ".xp 2\n.flygoto Teldrassil,1,1,10", travel: 0 },
    { body: ".xp 2\n.flygoto Teldrassil,2,2,10", travel: 12 },
    { body: ".xp 2\n.questgoto Teldrassil,1,1,10,457,1,1", travel: 0 },
    { body: ".xp 2\n.questwaypoint Teldrassil,2,2,10,457,1,1", travel: 0 },
    { body: ".xp 2\n.questgoto Teldrassil,2,2,10", travel: 0 },
    { body: ".xp 2\n.questwaypoint Teldrassil,2,2,10", travel: 0 },
    { body: ".xp 2\n.pin Teldrassil,2,2", travel: 0 },
    { body: ".xp 2\n.treasure Teldrassil,2,2", travel: 0 },
    { body: ".xp 2\n.rare Teldrassil,2,2,Rare", travel: 0 },
    { body: ".xp 2\n.ingamewaypoint Teldrassil,2,2", travel: 0 },
    { body: "#optional\n.xp 2\n+Speak to the guard", travel: 12 },
    { body: ".xp 2\n.accept 457", travel: 12 },
    { body: ".accept 457\n.complete 456,1,0,1\n.disablecheckbox", travel: 12 },
    { body: ".accept 457\n.collect 8050,1,2459,2,1\n.disablecheckbox", travel: 12 },
    { body: ".xp 2\n.vendor", travel: 12 },
    { body: ".xp 2\n.unknown", travel: 12 },
    { body: ".xp 2\n.unknown\n.disablecheckbox", travel: 12 },
    { body: ".xp 2\nnot understood\n.disablecheckbox", travel: 12 },
  ])("checks all arrival completion elements before travel: $body", async ({ body, travel }) => {
    const input = [
      "step\n.goto Teldrassil,1,1\n.turnin 456\n.turnin 2459",
      `step\n.goto Teldrassil,2,2\n${body}`,
      "step\n.goto Teldrassil,1,1\n+Return to the guard",
    ].join("\n");
    const result = await buildTimeline(
      [guide(input)],
      0,
      nightElf,
      simData(
        { 456: { baseXp: 400 }, 457: {}, 2459: {} },
        {
          ...places,
          "Teldrassil,1,1,10": loc(0, 0),
          "Teldrassil,2,2,10": loc(70, 0),
          "Teldrassil,2,2,10,0": loc(70, 0),
          "Teldrassil,2,2,nan": loc(70, 0),
        },
      ),
    );
    expect(result.steps.map((step) => [step.levelBefore, step.levelAfter, step.seconds.travel])).toEqual([
      [1, 2, 0],
      [2, 2, travel],
      [2, 2, travel],
    ]);
    if (travel === 0) expect(result.steps[1]!.seconds.total).toBe(0);
  });

  describe("arrival completion of each catalog command", () => {
    const NO_OBJECTIVE = [
      "disablecheckbox",
      "questgoto",
      "waypoint",
      "questwaypoint",
      "ingamewaypoint",
      "pin",
      "treasure",
      "rare",
      "line",
      "loop",
      "mob",
      "target",
      "unitscan",
      "maxlevel",
      "isOnQuest",
      "isNotOnQuest",
      "isQuestComplete",
      "isQuestNotComplete",
      "isQuestTurnedIn",
      "isQuestAvailable",
    ];
    const OWN_CHECK: Record<string, readonly [done: string, open: string]> = {
      accept: ["457", "33"],
      turnin: ["456", "7"],
      complete: ["456,1", "7,1"],
      collect: ["8050,1,456", "8050,1,33"],
      abandon: ["33", "7"],
      xp: ["2", "3"],
      fp: ["Stormwind", "Lakeshire"],
      goto: ["Teldrassil,1,1,10", "Teldrassil,2,2,10"],
      groundgoto: ["Teldrassil,1,1,10", "Teldrassil,2,2,10"],
      flygoto: ["Teldrassil,1,1,10", "Teldrassil,2,2,10"],
    };
    const ARGS: Record<string, string> = {
      questgoto: "Teldrassil,2,2,10,457,1",
      waypoint: "Teldrassil,2,2,10",
      questwaypoint: "Teldrassil,2,2,10,457,1",
      ingamewaypoint: "Teldrassil,2,2",
      pin: "Teldrassil,2,2",
      treasure: "Teldrassil,2,2",
      rare: "Teldrassil,2,2,Rare",
      line: "Teldrassil,2,2,3,3",
      loop: "10,Teldrassil,2,2,3,3",
      maxlevel: "60",
      isOnQuest: "7",
      isNotOnQuest: "33",
      isQuestComplete: "457",
      isQuestNotComplete: "7",
      isQuestTurnedIn: "456",
      isQuestAvailable: "33",
    };
    const cases = [...COMMANDS.keys()].flatMap((name) => {
      const own = OWN_CHECK[name];
      if (own)
        return [
          { line: `.${name} ${own[0]}`, travel: 0 },
          { line: `.${name} ${own[1]}`, travel: 12 },
        ];
      return [{ line: `.${name} ${ARGS[name] ?? ""}`.trimEnd(), travel: NO_OBJECTIVE.includes(name) ? 0 : 12 }];
    });
    const flights = new FlightNodes({
      "2": { name: "Stormwind, Elwynn", faction: "Alliance", world: loc(478.62, -8832.77) },
      "5": { name: "Lakeshire, Redridge", faction: "Alliance", world: loc(-2231.4, -9429.1) },
    });
    const kobolds = { index: 1, kind: "monster" as const, ids: [6], count: 10, name: "Kobold Vermin" };
    const map: SimData = {
      ...simData(
        { 456: { baseXp: 400 }, 457: {}, 2459: {}, 7: { objectives: [kobolds] } },
        { ...places, "Teldrassil,1,1,10": loc(0, 0), "Teldrassil,2,2,10": loc(70, 0) },
      ),
      flights,
    };
    const seed = {
      log: new Map([
        [7, [{ count: 0, complete: false }]],
        [457, []],
      ]),
      done: new Set<number>(),
    };

    it.each(cases)("travels $travel s to complete a step with .xp 2 and $line", async ({ line, travel }) => {
      const input = [
        `step\n-- @sim state={"flightPaths": {"Stormwind": true}}\n.goto Teldrassil,1,1\n.turnin 456\n.turnin 2459`,
        `step\n.goto Teldrassil,2,2\n.xp 2\n${line}`,
        "step\n.goto Teldrassil,1,1\n+Return to the guard",
      ].join("\n");
      const profile = { ...nightElf, groupQuests: line === ".group" };
      const result = await buildTimeline([guide(input)], 0, profile, map, { seed });
      expect([result.steps.map((step) => step.step), result.steps[1]!.seconds.travel]).toEqual([[0, 1, 2], travel]);
    });
  });

  it("skips a held-item collect despite unrelated deferred kills", async () => {
    const input = [
      "step\n.goto Teldrassil,1,1\n.accept 2459\n.collect 8050,1,2459,2,0x10",
      "step\n.complete 2459,1\n.disablecheckbox\n+Keep hunting later",
      "step\n.goto Teldrassil,2,2\n.collect 8050,1,2459,2,0x10",
    ].join("\n");
    const result = await buildTimeline(
      [guide(input)],
      0,
      nightElf,
      simData(
        {
          2459: {
            objectives: [
              { index: 1, kind: "monster", ids: [7235], count: 2, name: "Gnarlpine Mystic" },
              { index: 2, kind: "item", ids: [8050], count: 1, name: "Tallonkai's Jewel" },
            ],
          },
        },
        places,
        { 7235: { levels: { min: 6, max: 7 }, elite: false, zoneIds: [] } },
      ),
    );
    expect(result.steps.map((step) => step.seconds.travel)).toEqual([0, 0, 0]);
    expect(result.steps[2]!.seconds.total).toBe(0);
    expect(result.steps[0]!.seconds.total).toBe(5);
  });

  it.each(["Young Nightsaber", "Young Nightsabers"])(
    "uses the grind line's marked enemy %s when no step or killed mob is known",
    async (name) => {
      const named: SimData = { ...data, entityByName: (name) => (name === "Young Nightsaber" ? { kind: "npc", id: 2031 } : undefined) };
      const result = await buildTimeline(
        [guide(`step\n.goto Teldrassil,2,2\n.xp 1+100 >> Kill |cRXP_ENEMY_${name}|r`)],
        0,
        nightElf,
        named,
        { spawns },
      );
      const grind = result.steps[0]!.activities.find((a) => a.kind === "grind")!;
      expect(grind.kind === "grind" && [grind.checkpoint.kills, grind.seconds]).toEqual([
        { count: 2, mobs: [{ npcId: 2031, count: 2 }] },
        30,
      ]);
    },
  );

  it.each([
    { explicit: "", npcId: 3309 },
    { explicit: ".mob Karu::14874", npcId: 14874 },
    { explicit: ".target Karu::14874", npcId: 14874 },
  ])("prefers an exact plural name unless the step names $explicit", async ({ explicit, npcId }) => {
    const named: SimData = {
      ...data,
      npc: () => data.npc(2031),
      entityByName: (name) => (name === "Karus" ? { kind: "npc", id: 3309 } : name === "Karu" ? { kind: "npc", id: 14874 } : undefined),
    };
    const result = await buildTimeline(
      [guide(`step\n.goto Teldrassil,2,2\n${explicit}\n.xp 1+100 >> Kill |cRXP_ENEMY_Karus|r`)],
      0,
      nightElf,
      named,
      { spawns },
    );
    const grind = result.steps[0]!.activities.find((a) => a.kind === "grind")!;
    expect(grind.kind === "grind" && [grind.checkpoint.kills, grind.seconds]).toEqual([{ count: 2, mobs: [{ npcId, count: 2 }] }, 30]);
  });

  it.each([
    { override: "", counts: [[2031, 4]], seconds: 74.285714 },
    { override: "-- @sim mob=1986", counts: [[1986, 3]], seconds: 78.214286 },
    { override: "-- @sim mob=Webwood Spider", counts: [[1986, 3]], seconds: 78.214286 },
    {
      override: "-- @sim mob=2031,Webwood Spider",
      counts: [
        [2031, 2],
        [1986, 2],
      ],
      seconds: 89.285714,
    },
    { override: ".xp 1+160 -- @sim mob=1986", counts: [[1986, 3]], seconds: 78.214286 },
    { override: "-- @sim level=1+160 mob=1986", counts: [[1986, 3]], seconds: 78.214286 },
    { override: "-- @sim mob=1986,1986", counts: [[1986, 3]], seconds: 78.214286 },
  ])("prices the grind override $override ahead of a step mob", async ({ override, counts, seconds }) => {
    const named: SimData = {
      ...data,
      npc: (id) => (id === 1986 ? { levels: { min: 4, max: 4 }, elite: false, zoneIds: [] } : data.npc(id)),
      entityByName: (name) => (name === "Webwood Spider" ? { kind: "npc", id: 1986 } : undefined),
    };
    const result = await buildTimeline([guide(`step\n.goto Teldrassil,1,1\n.mob 2031\n${override}\n.xp 1+160`)], 0, nightElf, named);
    expect(result.steps[0]!.kills!.map((k) => [k.npcId, k.count])).toEqual(counts);
    expect(result.steps[0]!.seconds.kill).toBeCloseTo(seconds, 5);
    expect(momentAt(result, result.totals.seconds)?.character).toMatchObject({ level: 1, xp: 160 });
  });

  it.each([".vendor", ".xp 2,1", ".xp >2"])("warns for unknown mobs and mob= on a non-grind %s step", (line) => {
    const doc = guide(`step\n.mob 2031\n-- @sim mob=999\n.xp 1+100\nstep\n-- @sim mob=2031\n${line}`);
    const sim = simulateRoute([doc], 0, nightElf, data);
    expect(validateSimulation([doc], sim, () => undefined).filter((w) => w.kind === "unknownSimKey")).toEqual([
      { kind: "unknownSimKey", at: { guide: 0, step: 0, line: 1 }, key: "mob", value: "999", problem: "badValue" },
      { kind: "unknownSimKey", at: { guide: 0, step: 1, line: 0 }, key: "mob", value: "2031", problem: "misplaced" },
    ]);
    expect(sim.guides[0]!.steps[0]!.checkpoints[0]).toEqual({
      at: { guide: 0, step: 0, line: 2 },
      kind: "xp",
      target: { kind: "plus", level: 1, xp: 100 },
      gap: 100,
      kills: null,
    });
  });

  it("times travel, interactions, and kills step by step", async () => {
    const result = await buildTimeline([guide(text)], 0, nightElf, data, { spawns, npcName });
    expect(result.steps.map((s) => [s.start, s.seconds])).toEqual([
      [0, { travel: 0, kill: 0, interact: 5, wait: 0, total: 5 }],
      [5, { travel: 12, kill: 30, interact: 0, wait: 0, total: 42 }],
      [47, { travel: 12, kill: 0, interact: 8, wait: 0, total: 20 }],
    ]);
    expect(result.steps[1]!.notes).toEqual(["travel straight×1", "2 kills (2 yellow)"]);
    expect(result.steps[1]!.zone).toBe("Teldrassil");
    expect(result.steps.map(timing)).toEqual([
      [
        ["travel", 0, 0, ["bind"]],
        ["interact", 0, 5, ["accept"]],
        ["update", 5, 0, ["position"]],
      ],
      [
        ["travel", 5, 12, []],
        ["kill", 17, 30, ["xp", "xp", "objective"]],
        ["update", 47, 0, ["position"]],
      ],
      [
        ["travel", 47, 12, []],
        ["interact", 59, 8, ["xp", "turnin"]],
        ["update", 67, 0, ["position"]],
      ],
    ]);
    expect(result.steps[1]!.kills).toEqual([{ npcId: 2031, name: "Young Nightsaber", count: 2 }]);
    expect(result.names).toEqual({ quests: { 456: "The Balance of Nature" }, npcs: { 2031: "Young Nightsaber" }, flights: {} });
    expect(result.totals).toEqual({
      seconds: 67,
      xp: 200,
      xpPerHour: 10746,
      levelStart: 1,
      levelEnd: 1,
      kills: 2,
      questsTurnedIn: 1,
      travelSeconds: 24,
      killSeconds: 30,
    });
  });

  it("splits kill XP but not quest XP in a guide whose header sets party=2, and kills faster", async () => {
    const result = await buildTimeline([duo(text)], 0, nightElf, data, { spawns });
    expect(result.steps.map((s) => s.party)).toEqual([2, 2, 2]);
    expect(result.steps.map((s) => s.xp)).toEqual([
      { quest: 0, kill: 0 },
      { quest: 0, kill: 50 },
      { quest: 100, kill: 0 },
    ]);
    expect(result.steps[1]!.seconds.kill).toBeCloseTo(16.667, 3);
    expect(result.totals.kills).toBe(2);
  });

  it("hearths to the bind, then walks there while the Hearthstone cools down", async () => {
    const far = simData({}, { "Teldrassil,1,1": loc(0, 0), "Teldrassil,2,2": loc(700, 0) });
    const text = "step\n.goto Teldrassil,1,1\n.home\nstep\n.goto Teldrassil,2,2\n.hs\nstep\n.goto Teldrassil,2,2\n.hs";
    const result = await buildTimeline([guide(text)], 0, nightElf, far);
    expect(result.steps.map((s) => [s.seconds.travel, s.seconds.interact, s.seconds.wait])).toEqual([
      [0, 8, 0],
      [120, 10, 0],
      [240, 0, 0],
    ]);
    expect(result.steps[2]!.activities.map((a) => a.kind === "travel" && a.target.kind)).toEqual(["goto", "bind"]);
    expect(result.steps.map((s) => s.position)).toEqual([position(0, 0), position(0, 0), position(0, 0)]);
    expect(result.warnings).toEqual([
      { source: 0, guide: "A", step: 2, message: ".hs 3480 s before the Hearthstone is ready; walked instead" },
    ]);
  });

  it("gives no time to the kills that a turn-in counts when no step went to them, and warns", async () => {
    const text = "step\n.goto Teldrassil,1,1\n.accept 456\nstep\n.goto Teldrassil,1,1\n.turnin 456";
    const result = await buildTimeline([guide(text)], 0, nightElf, data, { spawns, npcName });
    expect(result.steps[1]!.seconds).toEqual({ travel: 0, kill: 0, interact: 8, wait: 0, total: 8 });
    expect(result.steps[1]!.xp).toEqual({ quest: 100, kill: 100 });
    expect(timing(result.steps[1]!)).toEqual([
      ["travel", 5, 0, []],
      ["kill", 5, 0, ["xp", "xp", "objective"]],
      ["interact", 5, 8, ["xp", "turnin"]],
    ]);
    expect(result.warnings).toEqual([
      {
        source: 0,
        guide: "A",
        step: 1,
        message:
          "The Balance of Nature: 2 of 2 Young Nightsaber kills are not counted by any earlier step, so the planner cannot tell if the quest was complete at this turn-in. Their XP is still counted; set -- @sim state= on this step if that is wrong",
      },
    ]);
  });

  it("goes to a kill step's place before its kills, also when its .goto follows them", async () => {
    const after = text.replace(".goto Teldrassil,2,2\n.complete 456,1", ".complete 456,1\n.goto Teldrassil,2,2");
    const result = await buildTimeline([guide(after)], 0, nightElf, data, { spawns });
    expect(timing(result.steps[1]!)).toEqual([
      ["travel", 5, 12, []],
      ["kill", 17, 30, ["xp", "xp", "objective"]],
      ["update", 47, 0, ["position"]],
    ]);
  });

  it("walks a #completewith step only to required waypoints that complete on arrival", async () => {
    const waypoints = {
      "Teldrassil,1,1,5": loc(0, 0),
      "Teldrassil,2,2,10,0": loc(70, 0),
      "Teldrassil,3,3,0": loc(0, 700),
      "Teldrassil,4,4": loc(700, 0),
      "Teldrassil,5,5,15": loc(70, 70),
      "Teldrassil,5,5,0,0": loc(70, 70),
    };
    const route = [
      "step\n.goto Teldrassil,1,1,5",
      "step\n#completewith next\n.goto Teldrassil,2,2,10,0\n.goto Teldrassil,3,3,0\n.goto Teldrassil,4,4\n.goto Teldrassil,5,5,15",
      "step\n.goto Teldrassil,5,5,0,0",
    ].join("\n");
    const result = await buildTimeline([guide(route)], 0, nightElf, simData({}, waypoints));
    const legs = result.steps.map((s) => s.activities.flatMap((a) => (a.kind === "travel" ? [[a.to, Math.round(a.seconds)]] : [])));
    expect(legs).toEqual([[[loc(0, 0), 0]], [[loc(70, 70), 17]], []]);
  });

  it("titles steps with their text, textures, and RXP colors", async () => {
    const text = [
      "step\n.goto Teldrassil,1,1\n>>|Tinterface/worldmap/chatbubble_64grey.blp:20|tSpeak with |cRXP_FRIENDLY_Conservator Ilthalaine|r",
      "step\n.goto Teldrassil,2,2\n.accept 456 >>Pick up |cRXP_LOOT_The Balance of Nature|r",
      "step\n.goto Teldrassil,1,1\n.turnin 456",
    ].join("\n");
    const result = await buildTimeline([guide(text)], 0, nightElf, data);
    const bubble = {
      texture: { key: "interface/worldmap/chatbubble_64grey", args: ":20" },
      written: "interface/worldmap/chatbubble_64grey.blp",
    };
    expect(result.steps.map((s) => s.title)).toEqual([
      [bubble, "Speak with ", { text: "Conservator Ilthalaine", color: "FRIENDLY" }],
      ["Pick up ", { text: "The Balance of Nature", color: "LOOT" }],
      [".goto Teldrassil,1,1"],
    ]);
  });

  it("records when each level is reached", async () => {
    const levelUp = simData({ 456: { baseXp: 400 }, 457: { baseXp: 900, level: 3 } }, places);
    const text = "step\n.goto Teldrassil,1,1\n.turnin 456\nstep\n.goto Teldrassil,2,2\n.turnin 457";
    const result = await buildTimeline([guide(text)], 0, nightElf, levelUp);
    expect(result.byLevel).toEqual([
      { level: 2, reachedAt: 8 },
      { level: 3, reachedAt: 28 },
    ]);
  });
});

describe("a duo's item objectives", () => {
  const places = {
    "Elwynn Forest,1,1": NORTHSHIRE.loc(0, 0),
    "Elwynn Forest,2,2": NORTHSHIRE.loc(70, 0),
    "Dun Morogh,1,1": COLDRIDGE.loc(0, 0),
    "Dun Morogh,2,2": COLDRIDGE.loc(70, 0),
  };
  const wolf: SimNpc = { levels: { min: 1, max: 1 }, elite: false, zoneIds: [12] };
  const meat = (count: number) => ({ index: 1, kind: "item" as const, ids: [750], count, name: "Tough Wolf Meat" });
  const data = simData(
    {
      7: { zoneIds: [12], objectives: [{ index: 1, kind: "monster" as const, ids: [6], count: 2, name: "Kobold Vermin" }] },
      33: { baseXp: 100, zoneIds: [12], objectives: [meat(8)] },
      179: { zoneIds: [1], objectives: [meat(8)] },
    },
    places,
    { 6: { ...wolf, levels: { min: 1, max: 2 } }, 299: wolf, 705: { ...wolf, zoneIds: [1] } },
    { 750: { droppers: [{ id: 299 }, { id: 705 }], objectsOnly: false, sold: false } },
  );
  const npcName = (id: number) => (id === 299 ? "Young Wolf" : undefined);
  const quest = (id: number, complete = `.complete ${id},1`) => {
    const zone = id === 179 ? "Dun Morogh" : "Elwynn Forest";
    return `step\n.goto ${zone},1,1\n.accept ${id}\nstep\n.goto ${zone},2,2\n${complete}\nstep\n.goto ${zone},1,1\n.turnin ${id}`;
  };
  const kills = (s: TimelineStep) => s.kills?.reduce((n, k) => n + k.count, 0) ?? 0;

  it("needs a drop for each member's item at the drop chance, and halves each kill's XP", async () => {
    const [solo, pair] = [
      await buildTimeline([guide(quest(33))], 0, warrior, data),
      await buildTimeline([duo(quest(33))], 0, warrior, data),
    ];
    expect([solo, pair].map((r) => r.steps.map(kills))).toEqual([
      [0, 16, 0],
      [0, 32, 0],
    ]);
    expect([solo, pair].map((r) => r.steps[1]!.xp)).toEqual([
      { quest: 0, kill: 752 },
      { quest: 0, kill: 752 },
    ]);
  });

  it("keeps a monster objective's kills and halves their XP", async () => {
    const result = await buildTimeline([duo(quest(7))], 0, warrior, data);
    expect(result.steps.map((s) => [kills(s), s.xp.kill])).toEqual([
      [0, 0],
      [2, 51],
      [0, 0],
    ]);
  });

  it("shows the party's drops over the party's need while it kills, and credits each member's share", async () => {
    const result = await buildTimeline([duo(quest(33))], 0, warrior, data, { npcName });
    const kill = result.steps[1]!.activities.find((a) => a.kind === "kill")!;
    const at = (kills: number) => momentAt(result, kill.start + (kill.seconds * kills) / 32)!;
    const seen = (kills: number) => [at(kills).doing, at(kills).character.xp, at(kills).character.log.get(33)?.objectives[0]?.count];
    expect(seen(6.5)).toEqual(["Killing Young Wolf x32 for Wolves Across the Border (3/16)", 150, 1]);
    expect(seen(13.5)).toEqual(["Killing Young Wolf x32 for Wolves Across the Border (6/16)", 325, 3]);
  });

  const finished = (complete: string) => quest(33, complete).replace(".turnin 33", ".complete 33,1\n.turnin 33");

  it("counts a partial line's items for each member, and the rest at the turn-in", async () => {
    const result = await buildTimeline([duo(quest(33, ".complete 33,1,3"))], 0, warrior, data, { npcName });
    expect(result.steps.map(kills)).toEqual([0, 12, 20]);
    const partial = result.steps[2]!.before.log.get(33)!.objectives[0]!;
    expect([partial.count, partial.kills?.counted]).toEqual([3, 3]);
    const rest = await buildTimeline([duo(finished(".complete 33,1,3"))], 0, warrior, data, { npcName });
    const kill = rest.steps[2]!.activities.find((a) => a.kind === "kill")!;
    expect(momentAt(rest, kill.start + kill.seconds / 20)!.doing).toBe("Killing Young Wolf x20 for Wolves Across the Border (6/16)");
  });

  it("shows whole items after a kills= line credits part of one", async () => {
    const result = await buildTimeline([guide(finished(".complete 33,1,1 -- @sim kills=1"))], 0, warrior, data, { npcName });
    const kill = result.steps[2]!.activities.find((a) => a.kind === "kill")!;
    expect(momentAt(result, kill.start + kill.seconds / 24)!.doing).toBe("Killing Young Wolf x15 for Wolves Across the Border (0/8)");
  });

  it("continues a seeded item objective's kill order after the drops that each member's items took", async () => {
    const mixed = simData(
      {
        374: {
          level: 7,
          requiredLevel: 5,
          zoneIds: [85],
          objectives: [{ index: 1, kind: "item", ids: [2875], count: 8, name: "Scarlet Insignia Ring" }],
        },
      },
      { "Tirisfal Glades,1,1": DEATHKNELL.loc(0, 0), "Tirisfal Glades,2,2": DEATHKNELL.loc(70, 0) },
      { 259433: { ...wolf, levels: { min: 8, max: 11 }, zoneIds: [85] } },
      { 2875: { droppers: [{ id: 259433 }], objectsOnly: false, sold: false } },
    );
    const text = "step\n.goto Tirisfal Glades,2,2\n.complete 374,1\nstep\n.goto Tirisfal Glades,1,1\n.turnin 374";
    const seed = { log: new Map([[374, [{ count: 3, complete: false }]]]), done: new Set<number>() };
    const forsaken = createProfile({ race: "Scourge", class: "WARRIOR", level: 5 });
    const result = await buildTimeline([duo(text)], 0, forsaken, mixed, { seed });
    const kill = result.steps[0]!.activities.find((a) => a.kind === "kill")!;
    expect(kill.kills.flatMap((k) => k.mobs.flatMap((m) => m.levels.map((l) => [l.level, l.kills])))).toEqual([
      [8, 5],
      [9, 5],
      [10, 5],
      [11, 5],
    ]);
  });

  it("takes each guide's party from its own header across #next", async () => {
    const docs = [guide(`#next B\n${quest(179)}`), duo(quest(33), "B")];
    const result = await buildTimeline(docs, 0, warrior, data);
    expect(result.steps.map((s) => [s.guide, s.party, kills(s)])).toEqual([
      ["A", 1, 0],
      ["A", 1, 16],
      ["A", 1, 0],
      ["B", 2, 0],
      ["B", 2, 32],
      ["B", 2, 0],
    ]);
  });
});

describe("the route's guides", () => {
  const { loc } = COLDRIDGE;
  const places = Object.fromEntries([0, 70, 140, 210].map((x, i) => [`Dun Morogh,${i + 1},${i + 1}`, loc(x, 0)]));
  const data = simData({}, places);
  const walk = (n: number) => `step\n.goto Dun Morogh,${n},${n}\n+Walk`;

  it("lists every guide that RXP runs, with time only for the guides it prices", async () => {
    const chain = [guide(`#next B\n${walk(1)}\n${walk(2)}`), guide(`#next C\n${walk(3)}`, "B"), guide(walk(4), "C")];
    const result = await buildTimeline(chain, 0, warrior, data, { maxGuides: 2 });
    expect([result.guides, result.totals.seconds]).toEqual([
      [
        { source: 0, name: "A", levels: { start: 1, end: 1 }, through: 1, priced: { first: 0, count: 2, start: 0, seconds: 12 } },
        { source: 1, name: "B", levels: { start: 1, end: 1 }, through: 2, priced: { first: 2, count: 1, start: 12, seconds: 12 } },
        { source: 2, name: "C", levels: { start: 1, end: 1 }, through: 3 },
      ],
      24,
    ]);
  });

  it("counts a hidden start guide toward maxGuides, and does not list it", async () => {
    const chain = [guide(`<< Horde\n#next A\n${walk(1)}`, "H"), guide(`#next B\n${walk(1)}\n${walk(2)}`), guide(walk(3), "B")];
    const result = await buildTimeline(chain, 0, warrior, data, { maxGuides: 2 });
    expect([result.steps.map((s) => s.source), result.guides.map((g) => [g.name, g.through, g.priced?.count])]).toEqual([
      [1, 1],
      [
        ["A", 2, 2],
        ["B", 3, undefined],
      ],
    ]);
  });
});

describe("priceRoute", () => {
  const { loc } = COLDRIDGE;
  const places = { "Dun Morogh,1,1": loc(0, 0), "Dun Morogh,2,2": loc(70, 0), "Dun Morogh,3,3": loc(70, 70) };
  const data = simData({}, places);
  const text = "step\n.goto Dun Morogh,1,1\n.home\nstep\n.goto Dun Morogh,2,2\n+Walk\nstep\n.hs\nstep\n.goto Dun Morogh,3,3\n+Walk";

  it("resurrects at the Spirit Healer in a softcore completewith step before the next walk", async () => {
    const healer = { ...loc(63, 70), uiMapId: 1426 };
    const data = { ...simData({}, places), spiritHealer: () => healer };
    const docs = [
      guide(
        "step\n.goto Dun Morogh,1,1\n.home\nstep\n.goto Dun Morogh,2,2\n+Enter the cave\nstep\n#softcore\n#completewith next\n.deathskip\nstep\n.goto Dun Morogh,3,3\n+Talk to Durnan",
      ),
    ];
    const simulation = simulateRoute(docs, 0, warrior, data);
    const death = simulation.guides[0]!.steps[2]!;
    expect(death.state.position).toEqual({ ...loc(63, 70), uiMapId: 1426 });
    expect({ ...death.state, position: null }).toEqual({ ...death.before, position: null });
    const result = await priceRoute(simulation, docs, warrior, data);
    expect(result.steps[2]!.seconds).toEqual({ travel: 0, kill: 0, interact: 30, wait: 0, total: 30 });
    expect(result.steps[3]!.activities[0]).toMatchObject({ kind: "travel", from: healer, to: loc(70, 70), seconds: 1.2 });
    expect(momentAt(result, result.steps[3]!.start)!.character.position).toEqual(healer);
  });

  it("warns and keeps its position when no Spirit Healer is known", async () => {
    const result = await buildTimeline([guide("step\n.goto Dun Morogh,2,2\n+Enter cave\nstep\n.deathskip")], 0, warrior, data);
    expect(result.steps[1]!.seconds.total).toBe(30);
    expect(result.warnings).toEqual([
      { source: 0, guide: "A", step: 1, message: ".deathskip with no known Spirit Healer on this world map; position unchanged" },
    ]);
    expect(momentAt(result, 30)!.character.position).toEqual(loc(70, 0));
  });

  it("ignores a death skip when the setting is on, and walks on from the cave", async () => {
    const data = { ...simData({}, places), spiritHealer: () => ({ ...loc(63, 70), uiMapId: 1426 }) };
    const docs = [
      guide(
        "step\n.goto Dun Morogh,1,1\nstep\n.goto Dun Morogh,2,2\n+Enter the cave\nstep\n#softcore\n#completewith next\n.deathskip\n.home\nstep\n.goto Dun Morogh,3,3\n+Talk to Durnan",
      ),
    ];
    const simulation = simulateRoute(docs, 0, warrior, data, 0, undefined, { ignoreDeathskip: true });
    const death = simulation.guides[0]!.steps[2]!;
    expect([death.state.position, death.state.bind]).toEqual([loc(70, 0), loc(70, 0)]);
    const result = await priceRoute(simulation, docs, warrior, data);
    expect(timing(result.steps[2]!)).toEqual([["interact", 0, 8, ["bind"]]]);
    expect(result.steps[3]!.activities[0]).toMatchObject({ kind: "travel", from: loc(70, 0), to: loc(70, 70), seconds: 12 });
  });

  it("ignores the Grik'nir death skip of the bundled Coldridge Valley guide", async () => {
    const source = readFileSync(join(import.meta.dirname, "../../guides/rxp-forever/Alliance-1-14_DwarfGnome.lua"), "utf8");
    const doc = extractGuides(source)
      .map((g) => parseGuide(g.text))
      .find((d) => d.header.some((l) => l.kind === "tag" && l.name === "name" && l.value === "1-5 Coldridge Valley"))!;
    const healer = { ...loc(1, 1), uiMapId: 1426 };
    const data: SimData = {
      ...simData({}, {}),
      locateGoto: (args) => loc(Math.abs(Number(args[1])), Math.abs(Number(args[2]))),
      spiritHealer: () => healer,
    };
    const dwarf = createProfile({ race: "Dwarf", class: "WARRIOR", level: 1 });
    const play = async (choices: { ignoreDeathskip?: boolean }) => {
      const steps = (await priceRoute(simulateRoute([doc], 0, dwarf, data, 0, undefined, choices), [doc], dwarf, data)).steps;
      const death = steps.findIndex((s) => guideTextPlain(s.title).startsWith("Die and respawn"));
      const next = steps[death + 1]!;
      return [
        steps[death]!.step,
        steps[death]!.seconds.total,
        guideTextPlain(next.title),
        next.activities[0]!.kind === "travel" && next.activities[0]!.from,
      ];
    };
    expect(await play({})).toEqual([50, 30, "Talk to Durnan Furcutter", healer]);
    expect(await play({ ignoreDeathskip: true })).toEqual([50, 0, "Talk to Durnan Furcutter", loc(30.489, 80.165)]);
  });

  it("prices one simulation with the travel's ways, from where each leg starts", async () => {
    const guides = [guide(text)];
    const simulation = simulateRoute(guides, 0, warrior, data);
    const way = (from: WorldLocation, to: WorldLocation) => `${from.x},${from.y}>${to.x},${to.y}`;
    const travel = ({ from, to }: TravelLeg) => ({ seconds: 10, source: "test", way: way(from, to) });
    const result = await priceRoute(simulation, guides, warrior, data, { travel });
    const legs = result.steps.flatMap((s) =>
      s.activities.flatMap((a) => (a.kind === "travel" ? [[s.source, a.from, a.way, a.start]] : [])),
    );
    expect(legs).toEqual([
      [0, loc(0, 0), undefined, 0],
      [0, loc(0, 0), way(loc(0, 0), loc(70, 0)), 8],
      [0, loc(0, 0), way(loc(0, 0), loc(70, 70)), 28],
    ]);
  });

  it("reports when the Hearthstone is ready, before a step and at a moment", async () => {
    const result = await priceRoute(simulateRoute([guide(text)], 0, warrior, data), [guide(text)], warrior, data);
    const hearth = result.steps[2]!.activities.find((a) => a.kind === "hearth")!;
    const ready = hearth.start + hearth.seconds + TIMELINE_MODEL.hearthCooldown.value;
    expect([result.steps[2]!.hearthReadyAt, result.steps[3]!.hearthReadyAt]).toEqual([0, ready]);
    expect([momentAt(result, hearth.start)!.hearthReadyAt, momentAt(result, hearth.start + hearth.seconds)!.hearthReadyAt]).toEqual([
      0,
      ready,
    ]);
  });

  it("lists the simulation's levelTooLow warning on the step that accepts the quest", async () => {
    const low = simData({ 7: { requiredLevel: 4 }, 33: {} }, {});
    const docs = [guide("#next B\nstep\n.accept 33\nstep\n.accept 33"), guide("step\n.accept 33\nstep\n.accept 7", "B")];
    const level3 = createProfile({ race: "Human", class: "WARRIOR", level: 3 });
    const result = await priceRoute(simulateRoute(docs, 0, level3, low), docs, level3, low);
    expect(result.warnings).toEqual([
      { source: 1, guide: "B", step: 1, message: "Accepts Kobold Camp Cleanup (7) at level 3; it requires level 4" },
    ]);
  });

  it("carries the Hearthstone cooldown into the next guide of the route", async () => {
    const docs = [
      guide("#next B\nstep\n.goto Dun Morogh,1,1\n.home\nstep\n.goto Dun Morogh,2,2\n+Walk\nstep\n.hs"),
      guide("step\n.goto Dun Morogh,2,2\n+Walk\nstep\n.hs", "B"),
    ];
    const result = await priceRoute(simulateRoute(docs, 0, warrior, data), docs, warrior, data);
    expect(result.steps.map((s) => [s.guide, s.start, s.hearthReadyAt])).toEqual([
      ["A", 0, 0],
      ["A", 8, 0],
      ["A", 20, 0],
      ["B", 30, 3630],
      ["B", 42, 3630],
    ]);
    expect(result.warnings).toEqual([
      { source: 1, guide: "B", step: 1, message: ".hs 3588 s before the Hearthstone is ready; walked instead" },
    ]);
  });
});

describe("timelineNpcs", () => {
  it("names a place by a world map landmark only when it gets the map", () => {
    const game = plannerData();
    const at = { instance: 0, ...mapToWorld(MAP_BOUNDS.get(1429)!, 48.2, 42) };
    const landmark = { name: "Northshire Abbey", kind: "landmark" as const, area: "eastern-kingdoms" as const, minZoom: 0 };
    const map = {
      ...terrainFixture,
      places: [...terrainFixture.places, { ...landmark, ...worldToCanvas(game.terrainMap(terrainFixture), at)! }],
    };
    const name = (npcs: ReturnType<typeof timelineNpcs>) => npcs.placeName!(at, []);
    expect([name(timelineNpcs(game, "Alliance")), name(timelineNpcs(game, "Alliance", map))]).toEqual([
      "Elwynn Forest 48.2, 42.0",
      "Northshire Abbey, Elwynn Forest",
    ]);
  });
});

describe("momentAt", () => {
  const { loc, spot } = SHADOWGLEN;
  const places = { "Teldrassil,1,1": loc(0, 0), "Teldrassil,2,2": loc(70, 0) };
  const wolves = { index: 1, kind: "monster" as const, ids: [2031], count: 2, name: "Young Nightsaber" };
  const data = simData({ 456: { baseXp: 100, objectives: [wolves], enders: [loc(0, 0)] } }, places, {
    2031: { levels: { min: 1, max: 1 }, elite: false, zoneIds: [] },
  });
  const text = "step\n.goto Teldrassil,1,1\n.accept 456\nstep\n.goto Teldrassil,2,2\n.complete 456,1\nstep\n.turnin 456";
  const npcName = (id: number) => (id === 2031 ? "Young Nightsaber" : undefined);
  const spawns = () => [spot(70, 0), spot(77, 0)];
  const timeline = () => buildTimeline([guide(text)], 0, nightElf, data, { spawns, npcName });

  it.each([
    [10, "Traveling to Teldrassil,2,2", 0, 0],
    [31.9, "Killing Young Nightsaber x2 for The Balance of Nature (0/2)", 0, 0],
    [32, "Killing Young Nightsaber x2 for The Balance of Nature (1/2)", 50, 1],
    [55, "Traveling to turn in The Balance of Nature", 100, 2],
    [65, "Turning in The Balance of Nature", 100, 2],
  ])("at %s s says %s and credits whole kills with XP and objective counts", async (t, doing, xp, count) => {
    const moment = momentAt(await timeline(), t)!;
    expect([moment.doing, moment.character.xp, moment.character.log.get(456)?.objectives[0]?.count]).toEqual([doing, xp, count]);
  });

  it("names each goto place with the quests that its step accepts and turns in there", async () => {
    const placeName = (at: WorldLocation, quests: readonly QuestNpc[]) =>
      `${at.x},${at.y} for ${quests.map((q) => `${q.role} ${q.questId}`).join(", ") || "no quest"}`;
    const result = await buildTimeline([guide(text)], 0, nightElf, data, { spawns, npcName, placeName });
    const travel = result.steps[0]!.activities[0]!;
    expect([travel.kind === "travel" && travel.place, momentAt(result, 10)!.doing]).toEqual([
      "831,10331 for accept 456",
      "Traveling to 901,10331 for no quest",
    ]);
  });

  it("says what each step does with its quests, once each", async () => {
    const result = await timeline();
    expect(result.steps.map((s) => stepActions(s, result.names))).toEqual([
      [{ kind: "accept", label: "The Balance of Nature" }],
      [{ kind: "complete", label: "The Balance of Nature" }],
      [{ kind: "turnin", label: "The Balance of Nature" }],
    ]);
  });

  it("says where a step with no other action goes", async () => {
    const placeName = (at: WorldLocation) => `place ${at.x},${at.y}`;
    const result = await buildTimeline(
      [guide("step\n.goto Teldrassil,1,1\n.accept 456\nstep\n.goto Teldrassil,2,2\n+Walk to the field")],
      0,
      nightElf,
      data,
      {
        spawns,
        npcName,
        placeName,
      },
    );
    expect(stepActions(result.steps[1]!, result.names)).toEqual([{ kind: "goto", label: "place 901,10331" }]);
  });

  it("is past every activity after the end, with the state the simulator ends at", async () => {
    const moment = momentAt(await timeline(), 1000)!;
    expect(moment.doing).toBe("");
    expect([moment.step, moment.character.xp, moment.character.done]).toEqual([2, 200, new Set([456])]);
  });

  it("folds each step's activities into the next step's state", async () => {
    const { steps } = await timeline();
    const folded = steps.slice(0, -1).map((s) => s.activities.flatMap((a) => a.effects).reduce(advance, s.before));
    expect(folded).toEqual(steps.slice(1).map((s) => s.before));
  });

  it("walks a step with no place of its own to the quest NPC before the turn-in", async () => {
    expect(timing((await timeline()).steps[2]!)).toEqual([
      ["travel", 47, 12, []],
      ["interact", 59, 8, ["xp", "turnin"]],
      ["update", 67, 0, ["position"]],
    ]);
  });
});

describe("mobColor", () => {
  it("follows Classic con colors around a level 10 player", () => {
    expect([15, 13, 12, 8, 7, 5, 4].map((mob) => mobColor(10, mob))).toEqual([
      "red",
      "orange",
      "yellow",
      "yellow",
      "green",
      "green",
      "gray",
    ]);
  });
});

describe("the kill walk", () => {
  const { loc, spot, position } = SHADOWGLEN;
  const places = { "Teldrassil,1,1": loc(0, 0), "Teldrassil,90,0": loc(900, 0) };
  const nightsabers = { index: 1, kind: "monster" as const, ids: [2031], count: 3, name: "Young Nightsaber" };
  const boar = { index: 2, kind: "monster" as const, ids: [1985], count: 1, name: "Thistle Boar" };
  const level1 = { levels: { min: 1, max: 1 }, elite: false, zoneIds: [] };
  const thistleBoar = { ...level1, levels: { min: 2, max: 3 } };
  const data = simData({ 456: { baseXp: 100, objectives: [nightsabers] }, 457: { baseXp: 100, objectives: [boar] } }, places, {
    2031: level1,
    1985: thistleBoar,
  });
  const spawns = (_: number, questId: number | undefined) =>
    questId === 456 ? [spot(17, 0), spot(87, 0), spot(400, 0), spot(5, 0, 0)] : questId === 457 ? [spot(1000, 0)] : [];
  const pinned = (text: string) => guide(`-- @sim respawn=60\n${text}`);
  const npcName = (npcId: number) => (npcId === 1985 ? "Thistle Boar" : "Young Nightsaber");
  const nightsaber = (x: number) => ({ npcId: 2031, spawn: spot(x, 0) });
  const nightsaberSpawns = [17, 87, 400].map((x) => ({ npcId: 2031, at: spot(x, 0) }));
  const timeline = () =>
    buildTimeline([pinned("step\n.goto Teldrassil,1,1\n.accept 456\n.complete 456,1")], 0, nightElf, data, { spawns, npcName });
  const killOf = async () => (await timeline()).steps[0]!.activities.find((a) => a.kind === "kill")!;

  it("walks to the nearest spawn with a mob, and waits for a respawn rather than walk to a far spawn", async () => {
    const kill = await killOf();
    expect([kill.start, kill.seconds]).toEqual([5, 91]);
    expect(kill.kind === "kill" && kill.walk).toEqual({
      from: loc(0, 0),
      kills: [
        { at: loc(7, 0), arrive: 1, end: 16, ...nightsaber(17) },
        { at: loc(77, 0), arrive: 26, end: 41, ...nightsaber(87) },
        { at: loc(27, 0), arrive: 41 + 50 / 7, end: 91, ...nightsaber(17) },
      ],
      spawns: nightsaberSpawns,
    });
    expect((await timeline()).steps[0]!.position).toEqual(position(27, 0));
  });

  it("runs between kills for the seconds that the walk gives, and copies its way", async () => {
    const walk = ({ from, to }: TravelLeg) => ({ seconds: (2 * Math.abs(to.x - from.x)) / 7, way: `${from.x}>${to.x}` });
    const result = await buildTimeline([pinned("step\n.goto Teldrassil,1,1\n.accept 456\n.complete 456,1")], 0, nightElf, data, {
      spawns,
      npcName,
      walk,
    });
    const kill = result.steps[0]!.activities.find((a) => a.kind === "kill")!;
    expect(kill.kind === "kill" && kill.walk).toEqual({
      from: loc(0, 0),
      kills: [
        { at: loc(7, 0), arrive: 2, end: 17, way: "831>838", ...nightsaber(17) },
        { at: loc(77, 0), arrive: 37, end: 52, way: "838>908", ...nightsaber(87) },
        { at: loc(27, 0), arrive: 52 + 100 / 7, end: 92, way: "908>858", ...nightsaber(17) },
      ],
      spawns: nightsaberSpawns,
    });
  });

  it("starts the next travel where each price of one simulation ends its kills", async () => {
    const guides = [guide("step\n.goto Teldrassil,1,1\n.accept 456\n.complete 456,1\nstep\n.goto Teldrassil,90,0\n+Walk")];
    const simulation = simulateRoute(guides, 0, nightElf, data);
    const price = async (walk?: () => { seconds: number }) => {
      const result = await priceRoute(simulation, guides, nightElf, data, { spawns, npcName, ...(walk && { walk }) });
      const kill = result.steps[0]!.activities.find((a) => a.kind === "kill");
      const travel = result.steps[1]!.activities.find((a) => a.kind === "travel");
      return [kill?.kind === "kill" && kill.walk?.kills.map((k) => k.spawn?.id), travel?.kind === "travel" && travel.from];
    };
    expect(await price()).toEqual([["1:17,0", "1:87,0", "1:400,0"], loc(390, 0)]);
    expect(await price(() => ({ seconds: 400 }))).toEqual([["1:17,0", "1:87,0", "1:17,0"], loc(27, 0)]);
    expect(simulation.guides[0]!.steps[0]!.state.position).toMatchObject(loc(0, 0));
  });

  it.each([
    [5 + 40, "Killing Young Nightsaber x3 for The Balance of Nature (1/3)"],
    [5 + 41, "Killing Young Nightsaber x3 for The Balance of Nature (2/3)"],
    [5 + 90, "Killing Young Nightsaber x3 for The Balance of Nature (2/3)"],
  ])("counts the kills whose fights ended at %s s", async (t, doing) => {
    expect(momentAt(await timeline(), t)!.doing).toBe(doing);
  });

  it("grinds at the spawns of the quest that last killed the mob, after their respawns", async () => {
    const text = "step\n.goto Teldrassil,1,1\n.accept 456\n.complete 456,1\nstep\n.xp 1+300";
    const result = await buildTimeline([pinned(text)], 0, nightElf, data, { spawns, npcName });
    const grind = result.steps[1]!.activities[0]!;
    expect([grind.kind, grind.start, grind.seconds]).toEqual(["grind", 96, 100]);
    expect(grind.kind === "grind" && grind.walk).toEqual({
      from: loc(27, 0),
      kills: [
        { at: loc(77, 0), arrive: 50 / 7, end: 25, ...nightsaber(87) },
        { at: loc(27, 0), arrive: 25 + 50 / 7, end: 75, ...nightsaber(17) },
        { at: loc(77, 0), arrive: 75 + 50 / 7, end: 100, ...nightsaber(87) },
      ],
      spawns: nightsaberSpawns,
    });
  });

  it("adds the fight time of an NPC with no spawn in the area without a walk, and warns", async () => {
    const text = "step\n.goto Teldrassil,1,1\n.accept 456\n.accept 457\n.complete 456,1\n.complete 457,2";
    const result = await buildTimeline([pinned(text)], 0, nightElf, data, { spawns, npcName });
    const [nightsaberKills, boarKill] = result.steps[0]!.activities.filter((a) => a.kind === "kill");
    expect(nightsaberKills!.kind === "kill" && nightsaberKills!.walk!.kills.map((k) => k.at)).toEqual([loc(7, 0), loc(77, 0), loc(27, 0)]);
    expect([boarKill!.start, boarKill!.seconds]).toEqual([101, 25 / 7 + 15]);
    expect(boarKill!.kind === "kill" && boarKill!.walk).toEqual({
      from: loc(27, 0),
      kills: [{ at: loc(27, 0), arrive: 25 / 7, end: 25 / 7 + 15, npcId: 1985 }],
      spawns: [],
    });
    expect(result.warnings).toEqual([
      {
        source: 0,
        guide: "A",
        step: 0,
        message:
          "no Thistle Boar spawn is in the 500 yd kill area, so the fight time of 1 kill is added without a walk to the mob; add a step that goes to Thistle Boar",
      },
    ]);
  });

  const venomSac = { index: 1, kind: "item" as const, ids: [5166], count: 1, name: "Webwood Venom Sac" };
  const ichor = { index: 3, kind: "item" as const, ids: [10640], count: 1, name: "Webwood Ichor" };
  const spiderDrops = simData(
    { 916: { baseXp: 100, requiredLevel: 3, objectives: [venomSac] }, 3521: { baseXp: 100, requiredLevel: 2, objectives: [ichor] } },
    places,
    { 1986: { ...level1, levels: { min: 3, max: 4 } } },
    {
      5166: { droppers: [{ id: 1986 }], objectsOnly: false, sold: false },
      10640: { droppers: [{ id: 1986 }], objectsOnly: false, sold: false },
    },
  );
  const level3 = createProfile({ race: "NightElf", class: "WARRIOR", level: 3 });
  const bothDrops =
    "step\n.goto Teldrassil,1,1\n.accept 916\n.accept 3521\n.complete 916,1 -- @sim drop=1\n.complete 3521,3 -- @sim drop=1";
  const webwoodSpider = (x: number) => ({ npcId: 1986, spawn: spot(x, 0) });

  it("waits for the respawn of a spawn that another quest's kill took", async () => {
    const result = await buildTimeline([guide(bothDrops)], 0, level3, spiderDrops, { spawns: () => [spot(17, 0)] });
    const kills = result.steps[0]!.activities.filter((a) => a.kind === "kill");
    expect(kills.map((a) => [a.start, a.kind === "kill" && a.walk!.kills])).toEqual([
      [10, [{ at: loc(7, 0), arrive: 1, end: 16, ...webwoodSpider(17) }]],
      [26, [{ at: loc(7, 0), arrive: 0, end: 315, ...webwoodSpider(17) }]],
    ]);
  });

  it("keeps two spawns at one spot apart", async () => {
    const rows = [
      { ...loc(17, 0), id: "npc:1986:45750" },
      { ...loc(17, 0), id: "npc:1986:45751" },
    ];
    const result = await buildTimeline([guide(bothDrops)], 0, level3, spiderDrops, { spawns: () => rows });
    const kills = result.steps[0]!.activities.filter((a) => a.kind === "kill");
    expect(kills.map((a) => a.kind === "kill" && a.walk!.kills)).toEqual([
      [{ at: loc(7, 0), arrive: 1, end: 16, npcId: 1986, spawn: rows[0] }],
      [{ at: loc(7, 0), arrive: 0, end: 15, npcId: 1986, spawn: rows[1] }],
    ]);
  });

  const killsWith = async (setting: string, text = "step\n.goto Teldrassil,1,1\n.accept 456\n.complete 456,1") => {
    const result = await buildTimeline([pinned(`${text}\n-- @sim ${setting}`)], 0, nightElf, data, { spawns, npcName });
    const kills = result.steps[0]!.activities.filter((a) => a.kind === "kill");
    return { kills: kills.map((a) => a.kind === "kill" && a.walk!.kills), warnings: result.warnings.map((w) => w.message) };
  };

  it("respawns after respawn= seconds", async () => {
    expect((await killsWith("respawn=30")).kills).toEqual([
      [
        { at: loc(7, 0), arrive: 1, end: 16, ...nightsaber(17) },
        { at: loc(77, 0), arrive: 26, end: 41, ...nightsaber(87) },
        { at: loc(27, 0), arrive: 41 + 50 / 7, end: 56 + 50 / 7, ...nightsaber(17) },
      ],
    ]);
  });

  it("walks only to the spawns within area= yards", async () => {
    expect((await killsWith("area=50")).kills).toEqual([
      [
        { at: loc(7, 0), arrive: 1, end: 16, ...nightsaber(17) },
        { at: loc(7, 0), arrive: 16, end: 91, ...nightsaber(17) },
        { at: loc(7, 0), arrive: 91, end: 166, ...nightsaber(17) },
      ],
    ]);
  });

  it("centers the area at near=", async () => {
    const text = "step\n.goto Teldrassil,1,1\n.accept 456\n.accept 457\n.complete 456,1\n.complete 457,2";
    const { kills, warnings } = await killsWith("near=90,0 area=420", text);
    expect(kills.map((walk) => walk && walk.map((k) => [k.at.x - loc(0, 0).x, k.arrive.toFixed(3), k.end.toFixed(3)]))).toEqual([
      [
        [0, "3.571", "18.571"],
        [0, "22.143", "37.143"],
        [0, "40.714", "55.714"],
      ],
      [[990, "141.429", "156.429"]],
    ]);
    expect(warnings).toEqual([
      "no Young Nightsaber spawn is in the 420 yd kill area, so the fight time of 3 kills is added without a walk to the mob; add a step that goes to Young Nightsaber",
    ]);
  });

  it("warns on a kill-area setting with no kills to apply to, and on a near= it cannot place", () => {
    const text = [
      "step\n.goto Teldrassil,1,1\n.accept 456\n.accept 457\n-- @sim area=100 respawn=30",
      "step\n.goto Teldrassil,1,1\n.complete 456,1\n-- @sim near=47,48",
      "step\n.complete 457,2\n-- @sim near=90,0",
    ].join("\n");
    const { warnings } = simulateRoute([guide(text)], 0, nightElf, data);
    expect(warnings.map((w) => w.kind === "unknownSimKey" && [w.at, w.key, w.value, w.problem])).toEqual([
      [{ guide: 0, step: 0, line: 3 }, "respawn", "30", "misplaced"],
      [{ guide: 0, step: 0, line: 3 }, "area", "100", "misplaced"],
      [{ guide: 0, step: 1, line: 2 }, "near", "47,48", "badValue"],
      [{ guide: 0, step: 2, line: 1 }, "near", "90,0", "misplaced"],
    ]);
  });

  it.each([
    [30, [{ x: 17, dead: [21, 81] }, { x: 87 }, { x: 400 }]],
    [90, [{ x: 17 }, { x: 87, dead: [46, 106] }, { x: 400 }]],
    [
      100,
      [
        { x: 87, dead: [46, 106] },
        { x: 17, dead: [96, 156] },
      ],
    ],
    [156, []],
  ])("shows at %s s the kill area's Young Nightsabers, and each killed one until its respawn", async (t, mobs) => {
    const result = await timeline();
    const shown = mobsAt(result, t, momentAt(result, t)!.activity);
    expect(shown).toEqual(
      mobs.map(({ x, dead }) => ({ npcId: 2031, at: spot(x, 0), ...(dead && { dead: { since: dead[0], until: dead[1] } }) })),
    );
  });

  it("holds a killed mob dead for the step's respawn=", async () => {
    const result = await buildTimeline(
      [guide("step\n.goto Teldrassil,1,1\n.accept 456\n.complete 456,1\n-- @sim respawn=30")],
      0,
      nightElf,
      data,
      {
        spawns,
        npcName,
      },
    );
    expect(result.steps[0]!.respawn).toBe(30);
    expect(mobsAt(result, 50, undefined)).toEqual([
      { npcId: 2031, at: spot(17, 0), dead: { since: 21, until: 51 } },
      { npcId: 2031, at: spot(87, 0), dead: { since: 46, until: 76 } },
    ]);
  });

  it.each([
    { header: "", line: "", respawn: undefined, step: 300, third: [spot(400, 0), "100.714"], inArea: [17, 87, 400] },
    { header: "", line: "", respawn: 30, step: 30, third: [spot(17, 0), "63.143"], inArea: [17, 87, 400] },
    { header: "-- @sim respawn=90", line: "", respawn: 30, step: 90, third: [spot(400, 0), "100.714"], inArea: [17, 87, 400] },
    {
      header: "-- @sim respawn=90",
      line: "-- @sim respawn=30",
      respawn: 120,
      step: 30,
      third: [spot(17, 0), "63.143"],
      inArea: [17, 87, 400],
    },
    { header: "", line: "-- @sim area=50", respawn: 30, step: 30, third: [spot(17, 0), "106.000"], inArea: [17] },
  ])(
    "takes respawn $step with header '$header', step '$line', and setting $respawn",
    async ({ header, line, respawn, step, third, inArea }) => {
      const docs = [guide(`${header}\nstep\n.goto Teldrassil,1,1\n.accept 456\n.complete 456,1\n${line}`)];
      const simulation = simulateRoute(docs, 0, nightElf, data, 0, undefined, respawn === undefined ? {} : { respawn });
      const result = await priceRoute(simulation, docs, nightElf, data, { spawns, npcName });
      const kill = result.steps[0]!.activities.find((a) => a.kind === "kill")!;
      const walk = kill.kind === "kill" && kill.walk!;
      const last = walk && walk.kills[2]!;
      expect([result.steps[0]!.respawn, last && [last.spawn, last.end.toFixed(3)], walk && walk.spawns.map((s) => s.at)]).toEqual([
        step,
        third,
        inArea.map((x) => spot(x, 0)),
      ]);
    },
  );

  it.each([
    { choices: {}, header: "", line: "", inArea: [17, 87, 400] },
    { choices: { area: 100 }, header: "", line: "", inArea: [17, 87] },
    { choices: { area: 100 }, header: "", line: "-- @sim area=50", inArea: [17] },
    { choices: { area: 100 }, header: "-- @sim area=450", line: "", inArea: [17, 87, 400] },
  ])("takes the area with setting $choices.area, header '$header', and step '$line'", async ({ choices, header, line, inArea }) => {
    const docs = [guide(`${header}\nstep\n.goto Teldrassil,1,1\n.accept 456\n.complete 456,1\n${line}`)];
    const simulation = simulateRoute(docs, 0, nightElf, data, 0, undefined, choices);
    const result = await priceRoute(simulation, docs, nightElf, data, { spawns, npcName });
    const kill = result.steps[0]!.activities.find((a) => a.kind === "kill")!;
    expect(kill.kind === "kill" && kill.walk!.spawns.map((s) => s.at)).toEqual(inArea.map((x) => spot(x, 0)));
  });

  it.each([300, 30])("holds the spawns within 500 yd at respawn %s", async (respawn) => {
    const docs = [guide("step\n.goto Teldrassil,1,1\n.accept 456\n.complete 456,1")];
    const simulation = simulateRoute(docs, 0, nightElf, data, 0, undefined, { respawn });
    const result = await priceRoute(simulation, docs, nightElf, data, { spawns: () => [spot(450, 0), spot(550, 0)], npcName });
    const kill = result.steps[0]!.activities.find((a) => a.kind === "kill")!;
    expect(kill.kind === "kill" && kill.walk!.spawns).toEqual([{ npcId: 2031, at: spot(450, 0) }]);
  });
});

describe("kills that a #completewith step leaves running", () => {
  const zones = { Teldrassil: SHADOWGLEN, Mulgore: CAMP_NARACHE, "Tirisfal Glades": DEATHKNELL };
  const places = Object.fromEntries(
    Object.entries(zones).flatMap(([zone, { loc }]) => [
      [`${zone},1,1`, loc(0, 0)],
      [`${zone},2,2`, loc(-500, 0)],
      [`${zone},5,5`, loc(0, 1000)],
    ]),
  );
  const tauren = createProfile({ race: "Tauren", class: "WARRIOR", level: 4 });
  const warlock = createProfile({ race: "Scourge", class: "WARLOCK", level: 1 });
  const level1 = { levels: { min: 1, max: 1 }, elite: false, zoneIds: [141] };
  const youngThistleBoar = { ...level1, levels: { min: 1, max: 2 } };
  const skeleton = { levels: { min: 2, max: 3 }, elite: false, zoneIds: [85] };
  const plainstrider = { levels: { min: 1, max: 2 }, elite: false, zoneIds: [215] };
  const adultPlainstrider = { levels: { min: 6, max: 7 }, elite: false, zoneIds: [215] };
  const boars = { index: 2, kind: "monster" as const, ids: [1984], count: 5, name: "Young Thistle Boar" };
  const talons = { index: 2, kind: "item" as const, ids: [4759], count: 3, name: "Plainstrider Talon" };
  const skeletons = { index: 1, kind: "monster" as const, ids: [1890], count: 5, name: "Rattlecage Skeleton" };
  const skulls = { index: 1, kind: "item" as const, ids: [6281], count: 2, name: "Rattlecage Skull" };
  const zoneOf = (npcId: number) => (npcId === 1984 ? SHADOWGLEN : npcId === 1890 ? DEATHKNELL : CAMP_NARACHE);
  const spawns = (npcId: number) =>
    npcId === 2956 ? [CAMP_NARACHE.spot(0, 2500)] : [0, 2, 4, 6, 8].map((x) => zoneOf(npcId).spot(-500 - x, 0));
  const data = simData(
    {
      456: { zoneIds: [141], objectives: [boars] },
      748: { level: 5, requiredLevel: 4, zoneIds: [215], objectives: [talons] },
      1470: { zoneIds: [85], objectives: [skulls] },
      3901: { zoneIds: [85], objectives: [skeletons] },
    },
    places,
    { 1984: youngThistleBoar, 1890: skeleton, 2955: plainstrider, 2956: adultPlainstrider },
    {
      4759: { droppers: [{ id: 2955 }, { id: 2956 }], objectsOnly: false, sold: false },
      6281: { droppers: [{ id: 1890 }], objectsOnly: false, sold: false },
    },
    spawns,
  );
  const NPC_NAMES: Record<number, string> = {
    1890: "Rattlecage Skeleton",
    1984: "Young Thistle Boar",
    2955: "Plainstrider",
    2956: "Adult Plainstrider",
  };
  const npcName = (npcId: number) => NPC_NAMES[npcId];
  const timeline = (text: string, profile = nightElf) => buildTimeline([guide(text)], 0, profile, data, { spawns, npcName });
  const killed = (s: TimelineStep) => [s.seconds.kill, s.kills];
  const lineSpawns = Array.from({ length: 24 }, (_, i) => CAMP_NARACHE.spot(-20 * (i + 1), 0));
  const shared = simData(
    {
      748: { level: 5, requiredLevel: 4, zoneIds: [215], objectives: [{ ...talons, count: 6 }] },
      747: { level: 2, zoneIds: [215], objectives: [{ ...talons, ids: [4740], count: 4, name: "Plainstrider Feather" }] },
    },
    places,
    { 2955: plainstrider },
    {
      4759: { droppers: [{ id: 2955 }], objectsOnly: false, sold: false },
      4740: { droppers: [{ id: 2955 }], objectsOnly: false, sold: false },
    },
    () => lineSpawns,
  );

  it("keeps background kills after travel when a checkpoint is already satisfied", async () => {
    const text = [
      "step\n.goto Teldrassil,1,1\n.accept 456",
      "step\n#completewith Town\n.complete 456,2\n.mob Young Thistle Boar::1984",
      "step\n.xp 1\n.goto Teldrassil,2,2\n.complete 456,2",
      "step\n#label Town\n.goto Teldrassil,1,1\n.turnin 456",
    ].join("\n");
    const result = await timeline(text);
    expect(result.steps[2]!.activities.filter((a) => a.kind === "kill" || a.kind === "travel").map((a) => a.kind)).toEqual([
      "travel",
      "kill",
    ]);
    expect(killed(result.steps[2]!)).toEqual([75, [{ npcId: 1984, name: "Young Thistle Boar", count: 5 }]]);
  });

  it.each([".xp 4+700", "-- @sim level=4+700"])("counts shared background kills before %s", async (checkpoint) => {
    const text = [
      "step\n.goto Mulgore,1,1\n.accept 748\n.accept 747",
      "step\n#completewith Town\n.collect 4740,4,747,2\n.collect 4759,6,748,2\n.mob Plainstrider::2955",
      `step\n.goto Mulgore,2,2\n-- @sim killxp=50\n${checkpoint}`,
      "step\n#label Town\n.goto Mulgore,1,1\n.turnin 748\n.turnin 747",
    ].join("\n");
    const result = await buildTimeline([guide(text)], 0, tauren, shared, { spawns: () => lineSpawns, npcName });
    const activities = result.steps[2]!.activities.filter((a) => a.kind === "kill" || a.kind === "grind");
    expect(
      activities.map((a) => [
        a.kind,
        a.kind === "grind" ? a.checkpoint.kills : a.kills.reduce((n, k) => n + k.count, 0),
        Number(a.seconds.toFixed(6)),
      ]),
    ).toEqual([
      ["kill", 8, 121.428571],
      ["kill", 4, 61.428571],
      ["grind", { count: 2, mobs: [{ npcId: 2955, count: 2 }] }, 34.285714],
    ]);
    expect(result.steps[3]!.kills).toEqual([]);
  });

  it.each([
    { party: 1, count: 12 },
    { party: 2, count: 24 },
  ])("rounds shared item kills once for a party of $party", async ({ party, count }) => {
    const text = [
      `-- @sim party=${party}`,
      "step\n.goto Mulgore,1,1\n.accept 748\n.accept 747",
      "step\n#completewith Town\n.collect 4740,4,747,2\n.collect 4759,6,748,2\n.mob Plainstrider::2955",
      "step\n.goto Mulgore,2,2\n+Walk to the field",
      "step\n#label Town\n.goto Mulgore,1,1\n.turnin 748\n.turnin 747",
    ].join("\n");
    const result = await buildTimeline([guide(text)], 0, tauren, shared, { spawns: () => lineSpawns, npcName });
    expect(result.steps.map((s) => s.kills)).toEqual([[], [], [{ npcId: 2955, name: "Plainstrider", count }], []]);
  });

  it.each([
    { line: ".complete 747,2", kills: 8, remaining: 4 },
    { line: ".complete 747,2,1 -- @sim kills=7 drop=0.5", kills: 7, remaining: 6 },
  ])("keeps shared fractions for the turn-in after $line without crediting its own kills twice", async ({ line, kills, remaining }) => {
    const text = [
      "step\n.goto Mulgore,1,1\n.accept 748\n.accept 747",
      `step\n.goto Mulgore,2,2\n.collect 4740,4,747,2\n${line}\n.collect 4759,6,748,2`,
      "step\n.goto Mulgore,1,1\n.turnin 747\n.turnin 748",
    ].join("\n");
    const result = await buildTimeline([guide(text)], 0, tauren, shared, { spawns, npcName });
    expect(result.steps.map((s) => s.kills)).toEqual([
      [],
      [{ npcId: 2955, name: "Plainstrider", count: kills }],
      [{ npcId: 2955, name: "Plainstrider", count: remaining }],
    ]);
  });

  it("keeps shared fractions after a partial objective selects multiple droppers", async () => {
    const multiple: SimData = {
      ...shared,
      npc: (id) => (id === 2956 ? adultPlainstrider : plainstrider),
      item: (id) => (id === 4759 ? { droppers: [{ id: 2955 }, { id: 2956 }], objectsOnly: false, sold: false } : shared.item(id)),
    };
    const text = [
      "step\n.goto Mulgore,1,1\n.accept 748\n.accept 747",
      "step\n.goto Mulgore,2,2\n.complete 748,2,1\n.collect 4759,6,748,2,16",
      "step\n.goto Mulgore,2,2\n.complete 747,2\n.collect 4759,6,748,2,16",
      "step\n.goto Mulgore,1,1\n.turnin 748\n.turnin 747",
    ].join("\n");
    const result = await buildTimeline([guide(text)], 0, tauren, multiple, { spawns, npcName });
    expect(result.steps.map((s) => s.kills)).toEqual([
      [],
      [
        { npcId: 2955, name: "Plainstrider", count: 1 },
        { npcId: 2956, name: "Adult Plainstrider", count: 1 },
      ],
      [{ npcId: 2955, name: "Plainstrider", count: 8 }],
      [
        { npcId: 2955, name: "Plainstrider", count: 1 },
        { npcId: 2956, name: "Adult Plainstrider", count: 1 },
      ],
    ]);
  });

  it("leaves the kills to a turn-in without .isQuestComplete when no step in the window passes the mobs", async () => {
    const text = [
      "step\n.goto Mulgore,1,1\n.accept 748",
      "step\n#completewith next\n.collect 4759,3,748,2\n.mob Plainstrider::2955",
      "step\n.goto Mulgore,5,5",
      "step\n.goto Mulgore,2,2\n+Walk to the field",
      "step\n.goto Mulgore,1,1\n.turnin 748",
    ].join("\n");
    const result = await timeline(text, tauren);
    expect(result.steps.map(killed)).toEqual([
      [0, []],
      [0, []],
      [0, []],
      [0, []],
      [0, [{ npcId: 2955, name: "Plainstrider", count: 6 }]],
    ]);
    expect(result.warnings.map((w) => w.message)).toEqual([
      "Poison Water: 6 kills for Plainstrider Talon are not counted by any earlier step, so the planner cannot tell if the quest was complete at this turn-in. Their XP is still counted; set -- @sim state= on this step if that is wrong",
    ]);
  });

  it("leaves the kills of a line with a hidden checkbox to the later line", async () => {
    const text = [
      "step\n.goto Teldrassil,1,1\n.accept 456",
      "step\n#completewith Later\n.complete 456,2\n.disablecheckbox\n.mob Young Thistle Boar::1984",
      "step\n.goto Teldrassil,2,2\n+Walk to the field",
      "step\n#label Later\n.goto Teldrassil,2,2\n.complete 456,2",
      "step\n.goto Teldrassil,1,1\n.turnin 456",
    ].join("\n");
    const result = await timeline(text);
    expect(result.steps.map(killed)).toEqual([
      [0, []],
      [0, []],
      [0, []],
      [75, [{ npcId: 1984, name: "Young Thistle Boar", count: 5 }]],
      [0, []],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("skips the travel of a kill step that background kills finished", async () => {
    const text = [
      "step\n.goto Teldrassil,1,1\n.accept 456",
      "step\n#completewith Hunt\n.complete 456,2\n.mob Young Thistle Boar::1984",
      "step\n.goto Teldrassil,2,2\n+Walk to the field",
      "step\n#label Hunt\n.goto Teldrassil,1,1\n.goto Teldrassil,5,5\n.complete 456,2",
    ].join("\n");
    const result = await timeline(text);
    expect(result.steps.map((s) => [Number(s.seconds.kill.toFixed(6)), Number(s.seconds.travel.toFixed(6))])).toEqual([
      [0, 0],
      [0, 0],
      [Number((75 + 498 / 7).toFixed(6)), Number((2.4 / 7).toFixed(6))],
      [0, 0],
    ]);
  });

  it("credits a step's kills with the drops of an item that the step collects", async () => {
    const text = [
      "step\n.goto Tirisfal Glades,1,1\n.accept 1470\n.accept 3901",
      "step\n.goto Tirisfal Glades,2,2\n.complete 3901,1\n.collect 6281,2,1470,1",
      "step\n.goto Tirisfal Glades,1,1\n.turnin 1470",
    ].join("\n");
    const result = await timeline(text, warlock);
    expect(result.steps.map(killed)).toEqual([
      [0, []],
      [62.1, [{ npcId: 1890, name: "Rattlecage Skeleton", count: 5 }]],
      [0, []],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("credits the party's drops in a duo", async () => {
    const text = [
      "step\n.goto Tirisfal Glades,1,1\n.accept 1470\n.accept 3901",
      "step\n.goto Tirisfal Glades,2,2\n.complete 3901,1\n.collect 6281,2,1470,1",
      "step\n.goto Tirisfal Glades,1,1\n.turnin 1470",
    ].join("\n");
    const result = await buildTimeline([duo(text)], 0, warlock, data, { spawns, npcName });
    expect(result.steps.map((s) => s.kills)).toEqual([
      [],
      [{ npcId: 1890, name: "Rattlecage Skeleton", count: 5 }],
      [{ npcId: 1890, name: "Rattlecage Skeleton", count: 3 }],
    ]);
  });
});

describe("kills of the mobs that a step's walk passes", () => {
  const { loc, spot } = SHADOWGLEN;
  const places = {
    "Teldrassil,1,1": loc(0, 0),
    "Teldrassil,2,2": loc(500, 0),
    "Silverpine Forest,1,1": PYREWOOD.loc(0, 0),
    "Silverpine Forest,2,2": PYREWOOD.loc(500, 0),
  };
  const level1 = { levels: { min: 1, max: 1 }, elite: false, zoneIds: [141] };
  const youngThistleBoar = { ...level1, levels: { min: 1, max: 2 } };
  const thistleBoar = { ...level1, levels: { min: 2, max: 3 } };
  const boars = { index: 2, kind: "monster" as const, ids: [1984], count: 5, name: "Young Thistle Boar" };
  const ichor = { index: 3, kind: "item" as const, ids: [10640], count: 1, name: "Webwood Ichor" };
  const spawns = () => [spot(100, 20), spot(200, -20), spot(300, 40)];
  const data = simData(
    { 3521: { requiredLevel: 2, zoneIds: [141], objectives: [ichor] }, 456: { baseXp: 100, zoneIds: [141], objectives: [boars] } },
    places,
    { 1984: youngThistleBoar, 1986: { ...level1, levels: { min: 3, max: 4 } } },
    { 10640: { droppers: [{ id: 1986 }], objectsOnly: false, sold: false } },
    spawns,
  );
  const NPC_NAMES: Record<number, string> = {
    1984: "Young Thistle Boar",
    2060: "Councilman Smithers",
    2061: "Councilman Thatcher",
    1986: "Webwood Spider",
  };
  const npcName = (npcId: number) => NPC_NAMES[npcId];
  const level2 = createProfile({ race: "NightElf", class: "WARRIOR", level: 2 });
  const councilIds = [2060, 2061, 2062, 2063, 2064, 2065, 2066, 2067, 2068];
  const council = { index: 1, kind: "monster" as const, ids: councilIds, count: 5, name: "Councilman Smithers" };
  const councilLevel = (npcId: number) => (npcId === 2060 ? 12 : npcId === 2068 ? 15 : 13);
  const councilmen = Object.fromEntries(
    councilIds.map((id) => [id, { levels: { min: councilLevel(id), max: councilLevel(id) }, elite: true, zoneIds: [130] }]),
  );
  const ambusher = createProfile({ race: "Scourge", class: "WARRIOR", level: 13 });
  const ambush = () =>
    walk(".complete 452,1")
      .replaceAll("456", "452")
      .replaceAll("Teldrassil", "Silverpine Forest")
      .replace(".accept 3521\n", "")
      .replace(".mob Young Thistle Boar::1984", "");
  const walk = (background: string, header = "") =>
    [
      header,
      "step\n.goto Teldrassil,1,1\n.accept 3521\n.accept 456",
      `step\n#completewith Town\n${background}\n.mob Young Thistle Boar::1984`,
      "step\n.goto Teldrassil,2,2\n+Walk to the field",
      "step\n#label Town\n.goto Teldrassil,1,1\n.isQuestComplete 456\n.turnin 456",
    ].join("\n");
  const ichorWalk = (extra = "") => walk(`.collect 10640,1,3521,3${extra}`).replace("Young Thistle Boar::1984", "Webwood Spider::1986");
  const killCount = (s: TimelineStep) => (s.kills ?? []).reduce((n, k) => n + k.count, 0);
  const fieldStep = async (text: string, g = guide) => {
    const result = await buildTimeline([g(text)], 0, level2, data, { spawns, npcName });
    return result.steps.find((s) => s.step === 2)!;
  };

  it.each([
    { header: "", line: "", count: 2, seconds: 58.312608 },
    { header: "", line: "-- @sim pass=0", count: 0, seconds: 0 },
    { header: "", line: "-- @sim pass=60", count: 3, seconds: 89.494919 },
    { header: "-- @sim pass=60", line: "", count: 3, seconds: 89.494919 },
    { header: "-- @sim pass=60", line: "-- @sim pass=0", count: 0, seconds: 0 },
  ])(
    "kills the spawns within reach of the walked line with header '$header' and step '$line'",
    async ({ header, line, count, seconds }) => {
      const step = await fieldStep(walk(`.complete 456,2\n${line}`, header));
      expect([killCount(step), Number(step.seconds.kill.toFixed(6))]).toEqual([count, seconds]);
    },
  );

  it("keeps walking when state= completes a background objective after a partial kill", async () => {
    const text = [
      "step\n.goto Teldrassil,1,1\n.accept 456\n.complete 456,2,1",
      "step\n#completewith Town\n.complete 456,2",
      'step\n-- @sim state={"log":{"456":"complete"}}\n.goto Teldrassil,2,2\n+Walk to the field',
      "step\n#label Town\n.goto Teldrassil,1,1\n.turnin 456",
    ].join("\n");
    const docs = [guide(text)];
    const simulation = simulateRoute(docs, 0, level2, data);
    const result = await priceRoute(simulation, docs, level2, data, { spawns, npcName });
    expect(result.steps.map(killCount)).toEqual([1, 0, 0, 0]);
    expect(result.steps[2]!.activities.filter((a) => a.kind === "travel").map((a) => a.to)).toEqual([loc(500, 0)]);
  });

  it("shows both eligible species when only one objective kill is needed", async () => {
    const { spot } = PYREWOOD;
    const selected = spot(100, 20);
    const nearby = spot(100, 80);
    const population = (npcId: number) => (npcId === 2060 ? [selected] : npcId === 2061 ? [nearby] : []);
    const mixed = simData({ 452: { zoneIds: [130], objectives: [{ ...council, count: 1 }] } }, places, councilmen, {}, population);
    const docs = [guide(ambush())];
    const simulation = simulateRoute(docs, 0, ambusher, mixed);
    const result = await priceRoute(simulation, docs, ambusher, mixed, { spawns: population });
    const kills = result.steps.flatMap((s) => s.activities).find((a) => a.kind === "kill" && a.passBy)!;
    expect(result.steps.map(killCount)).toEqual([0, 0, 1, 0]);
    expect(kills.kind === "kill" && kills.walk?.kills.map((k) => [k.npcId, k.spawn?.id])).toEqual([[2060, "0:100,20"]]);
    expect(mobsAt(result, kills.start, kills)).toEqual([
      { npcId: 2060, at: selected },
      { npcId: 2061, at: nearby },
    ]);
  });

  it("waits for a spawn killed on the approach before a later hunt", async () => {
    const spawn = spot(100, 0);
    const data = simData(
      { 456: { objectives: [{ ...boars, count: 2 }] } },
      { "Teldrassil,1,1": loc(0, 0), "Teldrassil,2,2": loc(90, 0) },
      { 1984: youngThistleBoar },
      {},
      () => [spawn],
    );
    const text =
      "step\n.goto Teldrassil,1,1\n.accept 456\nstep\n#completewith Camp\n.complete 456,2\n.mob Young Thistle Boar::1984\nstep\n#label Camp\n.goto Teldrassil,2,2\n+Arrive\nstep\n.goto Teldrassil,2,2\n.complete 456,2";
    const result = await buildTimeline([guide(text)], 0, level2, data, { spawns: () => [spawn] });
    const hunts = result.steps.flatMap((s) => s.activities).filter((a) => a.kind === "kill");
    expect(
      hunts.map((a) => [
        Number(a.seconds.toFixed(6)),
        a.walk?.kills.map((k) => [k.at, Number(k.arrive.toFixed(6)), Number(k.end.toFixed(6))]),
      ]),
    ).toEqual([
      [27.857143, [[loc(90, 0), 12.857143, 27.857143]]],
      [315, [[loc(90, 0), 0, 315]]],
    ]);
  });

  it("shows nearby objective councilmen across floors, and each killed councilman dead when its kill counts", async () => {
    const { spot } = PYREWOOD;
    const cave = { ...spot(550, 40), z: -80, interior: "den" };
    const outside = { ...spot(100, 80), z: 12 };
    const selected = [{ ...spot(100, 20), z: -15, interior: "den" }, spot(200, -20)];
    const population = (npcId: number, questId?: number) =>
      questId !== 452
        ? []
        : npcId === 2060
          ? [...selected, spot(300, 40)]
          : npcId === 2061
            ? [cave, outside, spot(900, 40), spot(100, 80, 1)]
            : [];
    const mixed = simData({ 452: { zoneIds: [130], objectives: [council] } }, places, councilmen, {}, population);
    const docs = [guide(ambush())];
    const simulation = simulateRoute(docs, 0, ambusher, mixed, 0, undefined, { respawn: 60 });
    const result = await priceRoute(simulation, docs, ambusher, mixed, {
      spawns: (npcId, questId) => population(npcId, questId).map((p) => (p.id === selected[0]!.id ? { ...p, z: 999 } : p)),
      npcName,
    });
    const kills = result.steps
      .flatMap((s) => s.activities)
      .filter((a) => a.kind === "kill")
      .find((a) => a.passBy)!;
    const [first, end] = kills.walk!.kills.map((k) => kills.start + k.end) as [number, number];
    expect([first, end, kills.seconds].map((t) => t.toFixed(6))).toEqual(["63.140056", "123.312608", "118.312608"]);
    expect([kills.walk?.kills.map((k) => [k.npcId, k.spawn?.id]), kills.progress]).toEqual([
      [
        [2060, "0:100,20"],
        [2060, "0:200,-20"],
      ],
      { questId: 452, counted: 0, gained: 2, of: 5 },
    ]);
    expect(mobsAt(result, first, kills)).toEqual([
      { npcId: 2060, at: selected[0], dead: { since: first, until: first + 60 } },
      { npcId: 2060, at: selected[1] },
      { npcId: 2060, at: spot(300, 40) },
      { npcId: 2061, at: cave },
      { npcId: 2061, at: outside },
    ]);
    expect(mobsAt(result, end, undefined)).toEqual([{ npcId: 2060, at: selected[1], dead: { since: end, until: end + 60 } }]);
  });

  it.each([
    { settings: "area=50", shown: ["1:100,20", "1:100,60"] },
    { settings: "area=50 near=2,2", shown: ["1:100,20", "1:100,60"] },
    { settings: "area=5", shown: ["1:100,20"] },
  ])("bounds pass-by display with $settings and keeps a later hunt's anchor", async ({ settings, shown }) => {
    const population = (npcId: number) => (npcId === 1984 ? [spot(100, 20), spot(100, 60), spot(500, 40)] : [spot(500, 0), spot(0, 0)]);
    const mixed = simData(
      {
        456: { objectives: [boars] },
        457: { objectives: [{ ...boars, ids: [1985], count: 1, index: 2, name: "Thistle Boar" }] },
      },
      places,
      { 1984: youngThistleBoar, 1985: thistleBoar },
      {},
      population,
    );
    const text = walk(".complete 456,2")
      .replace(".accept 456", ".accept 456\n.accept 457")
      .replace("+Walk to the field", `.complete 457,2\n-- @sim ${settings}`);
    const result = await buildTimeline([guide(text)], 0, level2, mixed, { spawns: population });
    const fights = result.steps.find((s) => s.step === 2)!.activities.filter((a) => a.kind === "kill");
    expect(fights.map((a) => a.walk?.spawns.map((m) => m.at.id))).toEqual([shown, ["1:500,0"]]);
    expect(fights.map((a) => a.walk?.kills.map((k) => k.spawn?.id))).toEqual([["1:100,20"], ["1:500,0"]]);
  });

  it("leaves the objective unfinished and skips its .isQuestComplete turn-in until a later step hunts the rest", () => {
    const text = [walk(".complete 456,2"), "step\n.goto Teldrassil,2,2\n.complete 456,2", "step\n.goto Teldrassil,1,1\n.turnin 456"].join(
      "\n",
    );
    const steps = simulateRoute([guide(text)], 0, level2, data).guides[0]!.steps;
    expect(steps.map((s) => [s.preview.shown, s.kills.map((k) => k.count)])).toEqual([
      [true, []],
      [true, []],
      [true, [2]],
      [false, []],
      [true, [3]],
      [true, []],
    ]);
    expect(steps[2]!.state.log.get(456)!.objectives[0]).toMatchObject({ count: 2, complete: false });
    expect(steps[5]!.turnIns).toEqual([{ at: { guide: 0, step: 5, line: 1 }, questId: 456, xp: 100 }]);
  });

  it("holds only the items that the passed kills drop for a #completewith .collect line", () => {
    const steps = simulateRoute([guide(ichorWalk())], 0, level2, data).guides[0]!.steps;
    expect(steps.map((s) => s.state.log.get(3521)?.objectives[0]?.count)).toEqual([0, 0, 1, 1]);
    expect(steps[2]!.kills.map((k) => k.count)).toEqual([2]);
  });

  it.each([
    { tag: "#completewith Town", kills: [0, 0, 0, 2, 3] },
    { tag: "", kills: [0, 0, 0, 0, 5] },
  ])("kills along a walk while the window's step '$tag' still shows", ({ tag, kills }) => {
    const text = [
      "step\n.goto Teldrassil,1,1\n.accept 456",
      "step\n#completewith Bunker\n.complete 456,2\n.mob Young Thistle Boar::1984",
      `step\n#label Bunker\n${tag}`,
      "step\n.goto Teldrassil,2,2\n+Walk to the field",
      "step\n#label Town\n.goto Teldrassil,1,1\n.turnin 456",
    ].join("\n");
    const steps = simulateRoute([guide(text)], 0, level2, data).guides[0]!.steps;
    expect(steps.map((s) => s.kills.reduce((n, k) => n + k.count, 0))).toEqual(kills);
  });

  it.each([
    { line: "", passed: 2, grind: 4 },
    { line: "-- @sim pass=60", passed: 3, grind: 3 },
  ])("counts the XP of $passed passed kills before the grind's", async ({ line, passed, grind }) => {
    const text = [
      "step\n.goto Teldrassil,1,1\n.accept 456",
      `step\n#completewith Town\n.complete 456,2\n${line}\n.mob Young Thistle Boar::1984`,
      "step\n-- @sim killxp=50\n.goto Teldrassil,2,2\n.xp 2+300",
      "step\n#label Town\n.goto Teldrassil,1,1\n.turnin 456",
    ].join("\n");
    const result = await buildTimeline([guide(text)], 0, level2, data, { spawns, npcName });
    const activities = result.steps[2]!.activities.filter((a) => a.kind === "kill" || a.kind === "grind");
    expect(activities.map((a) => [a.kind, a.kind === "grind" ? a.checkpoint.kills : a.kills.reduce((n, k) => n + k.count, 0)])).toEqual([
      ["kill", passed],
      ["grind", { count: grind, mobs: [{ npcId: 1984, count: grind }] }],
    ]);
  });

  it.each([
    { party: guide, kills: 2, seconds: 58.312608237370746, ichor: 1 },
    { party: duo, kills: 3, seconds: 69.49491919618671, ichor: 0 },
  ])("stops when the objective is done, and needs a drop for each member in a duo", async ({ party, kills, seconds, ichor }) => {
    const text = ichorWalk("\n-- @sim pass=60");
    const step = await fieldStep(text, party);
    expect(killCount(step)).toBe(kills);
    expect(step.seconds.kill).toBeCloseTo(seconds, 9);
    const steps = simulateRoute([party(text)], 0, level2, data).guides[0]!.steps;
    expect(steps[2]!.state.log.get(3521)!.objectives[0]!.count).toBe(ichor);
  });

  it("warns on pass= outside the header and #completewith steps, and on a bad value", () => {
    const text =
      "step\n-- @sim pass=20\n.goto Teldrassil,1,1\nstep\n#completewith next\n-- @sim pass=-1\n.complete 456,2\n.goto Teldrassil,1,1 -- @sim pass=5";
    const { warnings } = simulateRoute([guide(text)], 0, level2, data);
    expect(warnings.flatMap((w) => (w.kind === "unknownSimKey" ? [[w.at, w.value, w.problem]] : []))).toEqual([
      [{ guide: 0, step: 1, line: 1 }, "-1", "badValue"],
      [{ guide: 0, step: 1, line: 3 }, "5", "misplaced"],
      [{ guide: 0, step: 0, line: 0 }, "20", "misplaced"],
    ]);
  });
});

describe("travel gates", () => {
  const [elwynn, westfall] = [loc(1200, -9500), loc(1900, -9500)];
  const map: SimData = {
    ...simData({}, { "Elwynn Forest,1,1": elwynn, "Westfall,2,2": westfall }),
    zoneAt: (at) => (at.x < 1535 ? 1429 : 1436),
    uiMapNamed: (token) => (token === "Elwynn Forest" ? 1429 : undefined),
  };
  const shown = async (text: string) => (await buildTimeline([guide(text)], 0, warrior, map)).steps.map((s) => s.step);
  const home = "step\n.goto Elwynn Forest,1,1\n.home\nstep\n.goto Westfall,2,2\n+Walk away";
  const used = "step\n.goto Elwynn Forest,1,1\n.home\nstep\n.goto Westfall,2,2\n.hs\nstep\n.goto Westfall,2,2\n+Walk away";
  const hearthOrFly =
    "step\n.hs\n.cooldown item,6948,>2,1\n.zoneskip Elwynn Forest\nstep\n.goto Westfall,2,2\n+Fly\n.zoneskip Elwynn Forest";

  // `.cooldown` completes a step when the remaining cooldown is above the
  // threshold, or below it with `<`, and a threshold under 2 s is 2 s
  // (`addon.functions.cooldown` in functions.lua). `.zoneskip` completes it
  // when the character's map is one of the listed maps, or is none of them
  // with flag 1 (`addon.functions.zoneskip`).
  it("hearths when the Hearthstone is ready, and lands in the bind's zone", async () => {
    expect(await shown(`${home}\n${hearthOrFly}`)).toEqual([0, 1, 2]);
  });

  it("skips the hearth while the Hearthstone cools down, and takes the other way", async () => {
    expect(await shown(`${used}\n${hearthOrFly}`)).toEqual([0, 1, 2, 4]);
  });

  it("keeps the Playback settings when the clock's cooldown simulates the route again", async () => {
    const docs = [guide(`${used}\n${hearthOrFly}\nstep\n.deathskip\nstep\n.goto Elwynn Forest,1,1\n+Walk back`)];
    const simulation = simulateRoute(docs, 0, warrior, map, 0, undefined, { respawn: 30, ignoreDeathskip: true });
    expect(simulation.guides[0]!.steps.map((s) => s.preview.shown)).toEqual([true, true, true, true, false, true, true]);
    const result = await priceRoute(simulation, docs, warrior, map);
    expect(result.steps.map((s) => [s.step, s.seconds.total, s.respawn])).toEqual([
      [0, 8, 30],
      [1, 130, 30],
      [2, 120, 30],
      [4, 0, 30],
      [5, 0, 30],
      [6, 120, 30],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("gives one simulation for the same cooldowns, in any order", () => {
    const simulation = simulateRoute([guide(`${used}\n${hearthOrFly}`)], 0, warrior, map);
    const gate = hearthKey(0, 3);
    const cooling = simulation.rerun(
      new Map([
        [gate, 600],
        [hearthKey(0, 0), 0],
      ]),
    );
    expect(
      simulation.rerun(
        new Map([
          [hearthKey(0, 0), 0],
          [gate, 600],
        ]),
      ),
    ).toBe(cooling);
    expect(cooling.rerun(new Map())).toBe(simulation);
    expect([simulation, cooling].map((s) => s.guides[0]!.steps.map((step) => step.preview.shown))).toEqual([
      [true, true, true, true, false],
      [true, true, true, false, true],
    ]);
  });

  it("pauses before each step and before the rerun, and stops when the pause throws", async () => {
    const docs = [guide(`${used}\n${hearthOrFly}`)];
    const simulation = simulateRoute(docs, 0, warrior, map);
    const log: string[] = [];
    const options = {
      travel: (leg: TravelLeg) => (log.push("travel"), straightTravel(leg)),
      pause: () => void log.push("pause"),
    };
    await priceRoute(simulation, docs, warrior, map, options);
    const first = ["pause", "pause", "travel", "pause", "travel", "pause"];
    const again = ["pause", "pause", "travel", "pause", "travel", "pause", "pause", "travel"];
    expect(log).toEqual([...first, "pause", ...again]);
    const stop = new DOMException("Replaced", "AbortError");
    const thrower = (n: number) => () => {
      if (--n === 0) throw stop;
      return undefined;
    };
    await expect(priceRoute(simulation, docs, warrior, map, { pause: thrower(2) })).rejects.toBe(stop);
  });

  it("reads the remaining cooldown from state=", async () => {
    const set = hearthOrFly.replace("step\n", 'step\n-- @sim state={"hearth": 600}\n');
    expect(await shown(`${home}\n${set}`)).toEqual([0, 1, 3]);
  });

  it.each([
    { gate: ".cooldown item,6948,<0", ready: false, cooling: true },
    { gate: ".cooldown item,6948,>1m", ready: true, cooling: false },
    { gate: ".cooldown spell,1259416,>0", ready: true, cooling: true },
    { gate: ".zoneskip Elwynn Forest", ready: true, cooling: true },
    { gate: ".zoneskip Elwynn Forest,1", ready: false, cooling: false },
    { gate: ".zoneskip Elwynn Forest/1436", ready: false, cooling: false },
  ])("$gate", async ({ gate, ready, cooling }) => {
    const step = `step\n${gate}\n+Check`;
    expect((await shown(`${home}\n${step}`)).includes(2)).toBe(ready);
    expect((await shown(`${used}\n${step}`)).includes(3)).toBe(cooling);
  });

  it("puts the character at the bind after .hs", () => {
    const run = simulateRoute([guide(`${home}\nstep\n.hs`)], 0, warrior, map);
    expect(run.guides[0]!.steps.map((s) => s.state.position)).toEqual([elwynn, westfall, elwynn]);
  });
});

describe("flight paths", () => {
  const flights = new FlightNodes({
    "2": { name: "Stormwind, Elwynn", faction: "Alliance", world: loc(478.62, -8832.77) },
    "5": { name: "Lakeshire, Redridge", faction: "Alliance", world: loc(-2231.4, -9429.1) },
    "6": { name: "Ironforge, Dun Morogh", faction: "Alliance", world: loc(-1155.44, -4821.78) },
    "58": { name: "Zoram'gar Outpost, Ashenvale", faction: "Horde", world: loc(996.97, 3374.71, 1) },
    "61": { name: "Splintertree Post, Ashenvale", faction: "Horde", world: loc(-2524.55, 2302.39, 1) },
  });
  const master = (id: number) => flights.node(id).at;
  const map: SimData = {
    ...simData(
      {},
      {
        "Stormwind City,1,1": master(2),
        "Stormwind City,2,2": { ...master(2), x: master(2).x + 89 },
        "Ironforge,1,1": master(6),
        "Redridge Mountains,1,1": master(5),
        "Dun Morogh,1,1": COLDRIDGE.loc(0, 0),
        "Dun Morogh,2,2": { ...master(6), x: master(6).x + 300 },
      },
    ),
    flights,
  };
  const run = (text: string, profile = warrior) => buildTimeline([guide(text)], 0, profile, map);
  const known = (result: Awaited<ReturnType<typeof run>>) => result.steps.map((s) => [...s.before.flightPaths]);
  const legs = (result: Awaited<ReturnType<typeof run>>) =>
    result.steps.flatMap((s) =>
      s.activities.flatMap((a) =>
        a.kind === "travel" || a.kind === "flight" ? [[s.step, a.kind, a.target.kind, Math.round(a.seconds * 10) / 10]] : [],
      ),
    );
  const ironforge = `-- @sim state={"flightPaths": {"Ironforge": true}}`;

  it("learns the node of each .fp and the departure of each .fly, never the destination", async () => {
    const result = await run(
      "step\n.goto Ironforge,1,1\n.fp Ironforge\nstep\n.goto Stormwind City,1,1\n.fly Dun Morogh\nstep\n.goto Dun Morogh,2,2\n+Land",
    );
    expect(known(result)).toEqual([[2], [2, 6], [2, 6]]);
    expect(result.warnings).toEqual([]);
  });

  it("warns with the node's name for a .fly before its .fp, and walks to the flight master at walking time", async () => {
    const result = await run("step\n.goto Stormwind City,1,1\n.fly Dun Morogh\nstep\n.goto Dun Morogh,2,2\n+Land");
    expect(known(result)).toEqual([[2], [2]]);
    expect(result.warnings.map((w) => w.message)).toEqual([".fly Dun Morogh before .fp Ironforge, Dun Morogh; walked"]);
    expect(legs(result)).toEqual([
      [0, "travel", "goto", 0],
      [0, "travel", "flight", 742.5],
      [1, "travel", "goto", 51.4],
    ]);
    expect(result.names.flights).toEqual({ 6: "Ironforge, Dun Morogh" });
  });

  it("flies with no .fp to a flight master that the race knows at character creation, until state= unlearns it", async () => {
    const dwarf = createProfile({ race: "Dwarf", class: "WARRIOR", level: 1 });
    const fly = (comment = "") => `step\n${comment}.goto Stormwind City,1,1\n.fly Dun Morogh\nstep\n.goto Dun Morogh,2,2\n+Land`;
    const result = await run(fly(), dwarf);
    expect(known(result)).toEqual([[6], [6, 2]]);
    expect(result.warnings).toEqual([]);
    expect(legs(result)).toEqual([
      [0, "travel", "goto", 0],
      [0, "flight", "flight", 204.5],
      [1, "travel", "goto", 51.4],
    ]);
    const walked = [".fly Dun Morogh before .fp Ironforge, Dun Morogh; walked"];
    expect((await run(fly(), warrior)).warnings.map((w) => w.message)).toEqual(walked);
    const unlearned = await run(fly(`-- @sim state={"flightPaths": {"Ironforge": false}}\n`), dwarf);
    expect(unlearned.warnings.map((w) => w.message)).toEqual(walked);
  });

  it("flies to the flight master that the .fly names, in the .fly step, then walks to the next place", async () => {
    const result = await run(`step\n${ironforge}\n.goto Stormwind City,1,1\n.fly Dun Morogh\nstep\n.goto Dun Morogh,2,2\n+Land`);
    expect(result.warnings).toEqual([]);
    expect(legs(result)).toEqual([
      [0, "travel", "goto", 0],
      [0, "flight", "flight", 204.5],
      [1, "travel", "goto", 51.4],
    ]);
    expect(result.steps[0]!.activities.find((a) => a.kind === "flight")).toMatchObject({
      name: "Ironforge, Dun Morogh",
      from: master(2),
      to: master(6),
    });
    expect(result.steps[0]!.notes).toEqual(["travel flight×1", "flew to Ironforge, Dun Morogh"]);
  });

  it("takes off at the step's flight master in a #completewith step, whose walk does not go there", async () => {
    const text = `step\n${ironforge}\n.goto Stormwind City,2,2\n+Wait\nstep\n#completewith next\n.goto Stormwind City,1,1\n.fly Dun Morogh\nstep\n.goto Dun Morogh,2,2\n+Land`;
    const result = await run(text);
    expect(result.warnings).toEqual([]);
    expect(legs(result).map(([step, kind]) => [step, kind])).toEqual([
      [0, "travel"],
      [1, "flight"],
      [2, "travel"],
    ]);
  });

  it("walks a .fly with no flight master in reach", async () => {
    const result = await run(`step\n${ironforge}\n.goto Dun Morogh,1,1\n.fly Dun Morogh\nstep\n+Done`);
    expect(result.warnings.map((w) => w.message)).toEqual([".fly Dun Morogh with no Alliance flight master within 60 yd; walked"]);
    expect(legs(result).map(([, kind, target]) => [kind, target])).toEqual([
      ["travel", "goto"],
      ["travel", "flight"],
    ]);
  });

  it("leaves a background .fly in place until a later step reaches the flight master", async () => {
    const result = await run(
      `step\n${ironforge}\n.goto Stormwind City,2,2\n+Wait\nstep\n#completewith next\n.fly Dun Morogh\nstep\n.goto Stormwind City,1,1\n.fly Dun Morogh`,
    );
    expect(legs(result)).toEqual([
      [0, "travel", "goto", 0],
      [2, "travel", "goto", 15.3],
      [2, "flight", "flight", 204.5],
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.steps[1]!.activities.map((a) => a.kind)).toEqual(["interact"]);
  });

  it.each([
    { name: "Dun Morogh", warnings: [] },
    { name: "Moonbrook", warnings: [".fly Moonbrook names no Alliance flight master"] },
  ])("carries no .fly $name to a later step or the next guide", async ({ name, warnings }) => {
    const docs = [
      guide(`#next B\nstep\n${ironforge}\n.goto Stormwind City,1,1\n.fly ${name}\nstep\n+Wait`),
      guide("step\n.goto Dun Morogh,2,2\n+Walk", "B"),
    ];
    const result = await buildTimeline(docs, 0, warrior, map);
    expect(result.warnings.map((w) => w.message)).toEqual(warnings);
    expect(result.steps.at(-1)!.activities.map((a) => a.kind)).toEqual(["travel", "update"]);
  });

  it("reads a zone name, and learns the flight master in reach for a name that matches none", async () => {
    expect(known(await run("step\n.goto Redridge Mountains,1,1\n.fp Redridge Mountains\nstep\n+Done"))).toEqual([[2], [2, 5]]);
    const result = await run("step\n.goto Redridge Mountains,1,1\n.fp Goldshire\nstep\n+Done");
    expect([known(result), result.warnings]).toEqual([[[2], [2, 5]], []]);
  });

  it("warns for a name that matches no flight master, or several, and learns nothing from it", async () => {
    const unknown = await run("step\n.goto Dun Morogh,1,1\n.fp Nowhere\nstep\n+Done");
    expect(known(unknown)).toEqual([[2], [2]]);
    expect(unknown.warnings.map((w) => w.message)).toEqual([".fp Nowhere names no Alliance flight master"]);
    const orc = createProfile({ race: "Orc", class: "WARRIOR", level: 1 });
    const several = await run("step\n.goto Dun Morogh,1,1\n.fly Ashenvale\nstep\n+Done", orc);
    expect(several.warnings.map((w) => w.message)).toEqual([
      ".fly Ashenvale names more than one Horde flight master: Zoram'gar Outpost, Ashenvale; Splintertree Post, Ashenvale",
    ]);
  });

  it("completes a .fp step on arrival when the character knows its node", async () => {
    const text = `step\n-- @sim state={"flightPaths": {"Dun Morogh": true}}\n+Start\nstep\n.goto Ironforge,1,1\n.fp Ironforge\nstep\n+Done`;
    expect((await run(text)).steps.map((s) => [s.step, [...s.before.flightPaths], s.activities.map((a) => a.kind)])).toEqual([
      [0, [2, 6], []],
      [1, [2, 6], []],
      [2, [2, 6], []],
    ]);
  });
});

describe("state= in the timeline", () => {
  const { loc } = GOLDSHIRE;
  const far = simData({}, { "Elwynn Forest,1,1": loc(0, 0), "Elwynn Forest,2,2": loc(700, 0) });
  const route = (comment: string) =>
    buildTimeline([guide(`step\n.goto Elwynn Forest,1,1\n.home\nstep\n${comment}\n.goto Elwynn Forest,2,2\n.hs`)], 0, warrior, far);

  it("starts the Hearthstone cooldown and prices the step at the level that it sets", async () => {
    const plain = await route("");
    const set = await route(`-- @sim state={"hearth": 600, "level": 5}`);
    expect([plain.totals.seconds, set.totals.seconds]).toEqual([138, 248]);
    expect([set.steps[1]!.levelBefore, set.steps[1]!.hearthReadyAt]).toEqual([5, 608]);
    expect(set.warnings).toEqual([
      { source: 0, guide: "A", step: 1, message: ".hs 480 s before the Hearthstone is ready; walked instead" },
    ]);
  });

  it("puts the character at its position with no travel", async () => {
    const data = simData({}, { "Elwynn Forest,1,1": loc(0, 0), "Elwynn Forest,2,2": loc(100, 0) });
    const guides = [guide(`step\n.goto Elwynn Forest,1,1\n+Walk\nstep\n-- @sim state={"position": "Elwynn Forest,2,2"}\n.vendor`)];
    const simulation = simulateRoute(guides, 0, warrior, data);
    const playback = await new PlaybackRouting(null).play({ simulation, guides, profile: warrior, data, npcs: {} }, Infinity, () => 0);
    const end = playback.timeline.totals.seconds;
    expect(playback.timeline.steps[1]!.activities.map((a) => [a.kind, a.seconds])).toEqual([["interact", 20]]);
    expect([1, end].map((t) => playback.at(t)!.place)).toEqual([loc(100, 0), loc(100, 0)]);
  });
});

describe("travel to step NPCs", () => {
  it.each([
    {
      name: ".target passes Bixi's spawn",
      body: ".target +Bixi Wobblebonk\n.goto Ironforge,1,1",
      expected: [{ id: "npc:13084:1", instance: 0, x: 30, y: 60, z: 508.901 }],
    },
    {
      name: ".accept passes the giver's spawn",
      body: ".goto Ironforge,1,1\n.accept 7",
      expected: [{ id: "npc:13084:1", instance: 0, x: 30, y: 60, z: 508.901 }],
    },
    {
      name: "two gotos receive their own NPC",
      body: ".target +Bixi Wobblebonk\n.goto Ironforge,1,1\n.train 2567\n.goto Ironforge,2,2\n.train 199\n.target +Buliwyf Stonehand",
      expected: [
        { id: "npc:13084:1", instance: 0, x: 30, y: 60, z: 508.901 },
        { id: "npc:11865:1", instance: 0, x: 40, y: 60, z: 509 },
      ],
    },
    { name: ".unitscan passes nothing", body: ".unitscan Bixi Wobblebonk\n.goto Ironforge,1,1", expected: [null] },
    {
      name: "a spawn 3 yd away passes",
      body: ".target +Bixi Wobblebonk\n.goto Ironforge,1,1",
      bixi: [loc(33, 60)],
      expected: [{ id: "npc:13084:1", instance: 0, x: 33, y: 60, z: 508.901 }],
    },
    {
      name: "a spawn 5 yd away passes nothing",
      body: ".target +Bixi Wobblebonk\n.goto Ironforge,1,1",
      bixi: [loc(35, 60)],
      expected: [null],
    },
    {
      name: "a spawn in another instance passes nothing",
      body: ".target +Bixi Wobblebonk\n.goto Ironforge,1,1",
      bixi: [loc(30, 60, 1)],
      expected: [null],
    },
    {
      name: "the nearer of two spawns passes",
      body: ".target +Bixi Wobblebonk\n.goto Ironforge,1,1",
      bixi: [loc(31, 60), loc(32, 60)],
      expected: [{ id: "npc:13084:1", instance: 0, x: 31, y: 60, z: 508.901 }],
    },
    {
      name: "the later of two spawns at the same distance passes",
      body: ".target +Bixi Wobblebonk\n.goto Ironforge,1,1",
      bixi: [loc(29, 60), loc(31, 60)],
      expected: [{ id: "npc:13084:2", instance: 0, x: 31, y: 60, z: 508.901 }],
    },
  ])("$name", async ({ body, bixi = [loc(30, 60)], expected }) => {
    const data: SimData = {
      ...simData(
        { 7: { givers: [loc(30, 60)], giverNpcs: [13084] } },
        {
          "Ironforge,0,0": loc(0, 0),
          "Ironforge,1,1": loc(30, 60),
          "Ironforge,2,2": loc(40, 60),
        },
      ),
      entityByName: (name) =>
        name === "Bixi Wobblebonk" ? { kind: "npc", id: 13084 } : name === "Buliwyf Stonehand" ? { kind: "npc", id: 11865 } : undefined,
    };
    const destinations: (Spawn | null)[] = [];
    await buildTimeline([guide(`step\n.goto Ironforge,0,0\n+Walk\nstep\n${body}\n+Walk`)], 0, warrior, data, {
      spawns: (id) =>
        id === 13084
          ? bixi.map((at, i) => ({ ...at, id: `npc:13084:${i + 1}`, z: 508.901 }))
          : id === 11865
            ? [{ ...loc(40, 60), id: "npc:11865:1", z: 509 }]
            : [],
      travel: ({ toward }) => {
        destinations.push(toward ?? null);
        return { seconds: 10, source: "test" };
      },
    });
    expect(destinations).toEqual(expected);
  });
});

describe("stepTitleParts", () => {
  const title = (body: string) => stepTitleParts(guide(`step\n${body}`).steps[0]!);
  const icon = { texture: { key: "134414", args: ":0" }, written: "134414" };

  it("keeps the whole text and textures, and trims markers and spaces around textures", () => {
    const words = "Kill wolves and boars near the river until the quest is done".repeat(2);
    expect(title(`>> |T134414:0|t >>${words.slice(0, 58)}|T134414:0|t${words.slice(58)}  `)).toEqual([
      icon,
      words.slice(0, 58),
      icon,
      words.slice(58),
    ]);
    expect(title(">>|T134414:0|t  ")).toEqual([icon]);
  });

  it("trims markers and spaces inside a colored run at either end, and keeps the spaces between runs", () => {
    expect(title(">> |cRXP_FRIENDLY_ Sam Sarsaparilla|r waits by the |cRXP_PICK_fire |r")).toEqual([
      { text: "Sam Sarsaparilla", color: "FRIENDLY" },
      " waits by the ",
      { text: "fire", color: "PICK" },
    ]);
  });
});

describe("reportTitle", () => {
  const words = "Kill wolves and boars near the river until the quest is done".repeat(2);

  it("cuts the text to 60 units and drops textures, which cost no length", () => {
    expect(stepTitle(guide(`step\n>> |T134414:0|t >>${words.slice(0, 58)}|T134414:0|t${words.slice(58)}`).steps[0]!)).toBe(
      "Kill wolves and boars near the river until the quest is done",
    );
  });

  it("counts colored text toward the 60 units", () => {
    expect(reportTitle(["Kill ", { text: words, color: "ENEMY" }])).toBe(`Kill ${words.slice(0, 55)}`);
  });

  it("does not split a surrogate pair at the cut", () => {
    expect(reportTitle([`${"a".repeat(59)}😀 later`])).toBe("a".repeat(59));
  });
});
