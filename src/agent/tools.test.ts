import { describe, expect, it } from "vitest";
import { EntityIndex } from "../data/entities.ts";
import { GameData } from "../data/gameData.ts";
import type { QuestPoint } from "../data/model.ts";
import { northshireData, northshireFile, northshireNames } from "../data/northshireFixture.ts";
import { plannerContext, ZONES, zonePoint } from "../data/plannerFixture.ts";
import { callTool, TOOLS, type AgentContext } from "./index.ts";

const ctxWithoutSpawns: AgentContext = { game: northshireData(), entities: new EntityIndex(northshireNames), guides: [] };
const call = (name: string, input: unknown) => callTool(TOOLS, name, input, ctxWithoutSpawns);

const NORTHSHIRE = `#version 1
#group Agent
#name 1-2 Test
step
    .goto Elwynn Forest,48.2,42.8
    .accept 783 >> Pick up A Threat Within
step
    .goto Elwynn Forest,48.9,41.6
    .turnin 783 >> Hand in A Threat Within
    .accept 7 >> Pick up Kobold Camp Cleanup
step
    .goto Elwynn Forest,49.0,36.4
    .complete 7,1 --Kobold Vermin (10)
step
    .goto Elwynn Forest,48.9,41.6
    .turnin 7 >> Hand in Kobold Camp Cleanup
`;

describe("callTool input checks", () => {
  it("names every bad field and the fields that exist", async () => {
    expect(await call("quest_search", { limit: 0, nope: 1 })).toEqual({
      ok: false,
      error:
        "Invalid input: input has unknown field nope; fields: text, zone, minLevel, maxLevel, race, class, faction, limit; input.limit must be from 1 to 50.",
    });
  });

  it("reports a missing field, a value outside the enum, and an unknown tool", async () => {
    expect(await call("guide_check", { guide: NORTHSHIRE, class: "WARRIOR" })).toEqual({
      ok: false,
      error: "Invalid input: input needs race.",
    });
    expect(await call("guide_check", { guide: NORTHSHIRE, race: "Elf", class: "WARRIOR" })).toEqual({
      ok: false,
      error: "Invalid input: input.race must be one of Human, Dwarf, NightElf, Gnome, Orc, Scourge, Tauren, Troll, HighOrder, Windshaper.",
    });
    expect(await call("quest_find", {})).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Unknown tool quest_find\. Tools: rxp_reference, quest_search, /),
    });
  });

  it("fills defaults, so a level 1 simulation needs no level", async () => {
    const result = await call("guide_simulate", { guide: NORTHSHIRE, race: "Human", class: "WARRIOR" });
    expect(result.ok && (result.value as { totals: { startLevel: number } }).totals.startLevel).toBe(1);
  });

  it("turns a domain miss into an error the agent can act on", async () => {
    expect(await call("quest_details", { id: 9_999_999 })).toEqual({
      ok: false,
      error: "No quest 9999999 in the data. Use quest_search to find IDs.",
    });
  });
});

describe("quest tools", () => {
  it("finds the quests a Human Warrior can take by name", async () => {
    const result = await call("quest_search", { text: "Kobold", race: "Human", class: "WARRIOR", limit: 1 });
    expect(result).toEqual({
      ok: true,
      value: {
        total: 2,
        quests: [
          {
            id: 7,
            name: "Kobold Camp Cleanup",
            level: 2,
            requiredLevel: 1,
            zones: ["Elwynn Forest"],
            giver: "Marshal McBride",
            baseXp: 170,
          },
        ],
      },
    });
  });

  it("gives a quest's giver, prerequisite, and next quests for the class", async () => {
    const result = await call("quest_details", { id: 7, race: "Human", class: "WARRIOR", level: 1 });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toMatchObject({
      name: "Kobold Camp Cleanup",
      access: "needs 783 turned in first (for a new character)",
      givers: [{ name: "Marshal McBride", id: 197, goto: "Elwynn Forest,48.80,41.40" }],
      prerequisites: { allOf: [], anyOf: [{ id: 783, name: "A Threat Within" }] },
      next: [
        { id: 15, name: "Investigate Echo Ridge" },
        { id: 3100, name: "Simple Letter" },
      ],
      xp: { level: 1, xp: 170, gray: false },
    });
  });

  it("gives no quest XP at level 60", async () => {
    const result = await call("quest_details", { id: 33, level: 60 });
    expect(result.ok && result.value).toMatchObject({ xp: { level: 60, xp: 0, gray: true } });
  });
});

describe("quests_available", () => {
  it("asks for a place, then lists the nearest quests a new character can take", async () => {
    expect(await call("quests_available", { race: "Human", class: "WARRIOR" })).toEqual({
      ok: false,
      error:
        "Give a place: `near` as a .goto point (npc_find and quest_details give them), `zone`, or a `guide` with .goto lines. Without one, the list mixes every starting zone.",
    });
    const result = await call("quests_available", { race: "Human", class: "WARRIOR", near: "Elwynn Forest,48.2,42.8", limit: 2 });
    expect(result.ok && result.value).toMatchObject({
      level: 1,
      quests: [
        { id: 783, name: "A Threat Within", xp: 40, giver: { name: "Deputy Willem" }, yards: 0 },
        { id: 33, name: "Wolves Across the Border", giver: { name: "Eagan Peltskinner" }, yards: 64 },
      ],
    });
  });
  it("leaves out quests the character turns in without an accept", async () => {
    const file = northshireFile();
    const threat = file.quests.find((q) => q.id === 783)!;
    const donation = { ...threat, id: 7791, name: "A Donation of Wool", types: ["city-donation"], nextQuestInChain: null };
    const game = new GameData({ ...file, quests: [...file.quests, donation] }, plannerContext);
    const ctx: AgentContext = { ...ctxWithoutSpawns, game };
    const result = await callTool(TOOLS, "quests_available", { race: "Human", class: "WARRIOR", near: "Elwynn Forest,48.2,42.8" }, ctx);
    expect(result.ok && (result.value as { quests: { id: number }[] }).quests.map((q) => q.id)).toEqual([783, 33, 91745, 91741]);
  });
});

describe("guide tools", () => {
  it("checks a guide and names a point that does not resolve", async () => {
    expect(await call("guide_check", { guide: NORTHSHIRE, race: "Human", class: "WARRIOR" })).toEqual({
      ok: true,
      value: { ok: true, steps: 4, shownSteps: 4, problems: [] },
    });
    const broken = NORTHSHIRE.replace("Elwynn Forest,49.0,36.4", "Northshire,49.0,36.4");
    const result = await call("guide_check", { guide: broken, race: "Human", class: "WARRIOR" });
    expect(
      result.ok &&
        (result.value as { problems: string[] }).problems.some((p) => p.startsWith("Step 3, line 1: .goto Northshire,49.0,36.4: ")),
    ).toBe(true);
  });

  it("names a .line or .loop point that does not resolve", async () => {
    const guide = `#group Agent
#name 1-2 Test
step
    .goto Elwynn Forest,48.2,42.8
    .line Elwynn Forest,48.2,42.8,48.9,41.6
    .line Nowhere,1,1,2,2
    .loop 20,Nowhere,1,1,2,2
    .accept 783
`;
    // RXP draws neither path. `addon.functions.line` and `addon.functions.loop` in `functions.lua` drop a path whose zone has no map.
    expect(await call("guide_check", { guide, race: "Human", class: "WARRIOR" })).toEqual({
      ok: true,
      value: {
        ok: false,
        steps: 1,
        shownSteps: 1,
        problems: [
          'Step 1, line 3: .line Nowhere,1,1,2,2: RXP has no zone named "Nowhere".',
          'Step 1, line 4: .loop 20,Nowhere,1,1,2,2: RXP has no zone named "Nowhere".',
        ],
      },
    });
  });

  it("lists gaps in the quest data apart from guide problems", async () => {
    const guide = `#group Agent\n#name Book\nstep\n    .accept 91745 >> Pick up Mining Consultant\nstep\n    .turnin 91745 >> Hand in Mining Consultant\n`;
    expect(await call("guide_check", { guide, race: "Human", class: "WARRIOR" })).toEqual({
      ok: true,
      value: {
        ok: true,
        steps: 2,
        shownSteps: 2,
        problems: [],
        dataGaps: ["Step 1, line 1 and 1 more place: Mining Consultant (91745) has unverified prerequisite data"],
      },
    });
  });

  it("names a step that a runtime gate skips by the gate's phrase", async () => {
    const guide = `#group Agent\n#name Gate\nstep\n    .isOnQuest 7\n    .accept 783 >> Pick up A Threat Within\n`;
    const result = await call("guide_simulate", { guide, race: "Human", class: "WARRIOR" });
    expect(result.ok && result.value).toMatchObject({ rows: [{ step: 1, skipped: "Only while Kobold Camp Cleanup is in your log" }] });
  });

  it("simulates quest and kill XP per step", async () => {
    const result = await call("guide_simulate", { guide: NORTHSHIRE, race: "Human", class: "WARRIOR" });
    expect(result.ok && result.value).toMatchObject({
      rows: [
        { step: 1, does: "accept 783", level: 1, xp: 0 },
        { step: 2, does: "turnin 783; accept 7", level: 1, xp: 40, turnIns: ["783 +40"] },
        { step: 3, does: "complete 7,1", level: 2, xp: 147, kills: ["10 Kobold Vermin"], dings: [2] },
        { step: 4, does: "turnin 7", level: 2, xp: 317, turnIns: ["7 +170"] },
      ],
      totals: { startLevel: 1, endLevel: 2, endXp: 317, questXp: 210, killXp: 507, kills: 10, turnIns: 2 },
    });
  });

  it("lists only the lines that change the character in a step's summary", async () => {
    const guide = `#group Agent\n#name Summary\nstep\n    .goto Elwynn Forest,48.9,41.6\n    .target Marshal McBride\n    .vendor >> Sell junk\n    .abandon 7\n    .hs >> Hearth\n`;
    const result = await call("guide_simulate", { guide, race: "Human", class: "WARRIOR" });
    expect(result.ok && result.value).toMatchObject({ rows: [{ step: 1, does: "vendor; abandon 7; hs" }] });
  });
});

describe("measuring tools", () => {
  it("times self-found steps and skips auction-house steps", async () => {
    const guide = `#group Agent
#name Self-found policy
step
    #ah
    .vendor 77
step
    #ssf
    .vendor 78
step
    .vendor 79
`;
    expect(await call("guide_timeline", { guide, race: "Human", class: "WARRIOR" })).toMatchObject({
      ok: true,
      value: {
        steps: 2,
        slowest: [
          { step: 2, title: ".vendor 78" },
          { step: 3, title: ".vendor 79" },
        ],
      },
    });
  });

  it("times a guide and lists its slowest steps", async () => {
    const result = await call("guide_timeline", { guide: NORTHSHIRE, race: "Human", class: "WARRIOR", slowest: 1 });
    expect(result.ok && result.value).toEqual({
      totals: {
        party: 1,
        time: "4:19",
        seconds: 259,
        levelStart: 1,
        levelEnd: 2,
        xp: 717,
        xpPerHour: 9954,
        kills: 10,
        questsTurnedIn: 2,
        travelSeconds: 48,
        killSeconds: 186,
        otherSeconds: 26,
      },
      byLevel: [{ level: 2, at: "3:51", seconds: 231 }],
      steps: 4,
      travelLegs: "straight 3",
      slowest: [
        {
          step: 3,
          title: ".goto Elwynn Forest,49.0,36.4",
          level: 1,
          seconds: { travel: 21, kill: 186, interact: 0, wait: 0, total: 206 },
          kills: "10 Kobold Vermin",
        },
      ],
      warnings: [],
    });
  });

  it("names each travel leg's source in the order the guide first uses it", async () => {
    let calls = 0;
    const travel: NonNullable<AgentContext["travel"]> = () => Promise.resolve(calls++ ? undefined : { seconds: 9, yards: 63 });
    const result = await callTool(
      TOOLS,
      "guide_timeline",
      { guide: NORTHSHIRE, race: "Human", class: "WARRIOR" },
      { ...ctxWithoutSpawns, travel },
    );
    expect(result.ok && result.value).toMatchObject({ travelLegs: "routing 1, straight (no route) 2" });
  });

  it("asks the host for a ground route only on one map below mount level", async () => {
    const legs: number[] = [];
    const travel: NonNullable<AgentContext["travel"]> = (_, to) => {
      legs.push(to.instance);
      return Promise.resolve({ seconds: 9, yards: 63 });
    };
    const ctx = { ...ctxWithoutSpawns, travel };
    const toDurotar = `${NORTHSHIRE}step\n    .goto Durotar,50.0,50.0\n    .vendor 77\n`;
    expect(await callTool(TOOLS, "guide_timeline", { guide: toDurotar, race: "Human", class: "WARRIOR", level: 39 }, ctx)).toMatchObject({
      ok: true,
      value: { travelLegs: "routing 3, crossing 1" },
    });
    expect(legs).toEqual([0, 0, 0]);
    expect(await callTool(TOOLS, "guide_timeline", { guide: NORTHSHIRE, race: "Human", class: "WARRIOR", level: 40 }, ctx)).toMatchObject({
      ok: true,
      value: { travelLegs: "straight 3" },
    });
    expect(legs).toEqual([0, 0, 0]);
  });

  it("compares two versions, names the removed step, and warns that it cannot tell if the quest was complete", async () => {
    const after = NORTHSHIRE.replace("step\n    .goto Elwynn Forest,49.0,36.4\n    .complete 7,1 --Kobold Vermin (10)\n", "");
    const result = await call("guide_compare", { before: NORTHSHIRE, after, race: "Human", class: "WARRIOR" });
    expect(result.ok && result.value).toMatchObject({
      verdict: "after reaches level 2 3:18 sooner (0:32 against 3:51).",
      delta: { seconds: -227, kills: 0, travelSeconds: -42 },
      byLevel: [{ level: 2, before: "3:51", after: "0:32", deltaSeconds: -198 }],
      added: { count: 0, steps: [] },
      removed: { count: 1, steps: [{ step: 3, title: ".goto Elwynn Forest,49.0,36.4" }] },
      warnings: {
        before: 0,
        after: 1,
        new: [
          "Step 3: Kobold Camp Cleanup: 10 of 10 Kobold Vermin kills are not counted by any earlier step, so the planner cannot tell if the quest was complete at this turn-in. Their XP is still counted; set -- @sim state= on this step if that is wrong",
        ],
      },
    });
  });

  it("says when the host cannot tell floors, and gives the note when it can", async () => {
    expect(await call("floor_hint", { point: "Elwynn Forest,48.2,42.8" })).toMatchObject({
      ok: true,
      value: { available: false, why: "This host has no routing data, so it cannot tell the floors." },
    });
    const stacked: AgentContext = { ...ctxWithoutSpawns, floorHint: () => Promise.resolve({ kind: "stacked", floors: [0, 7.3] }) };
    expect(await callTool(TOOLS, "floor_hint", { point: "Elwynn Forest,48.2,42.8" }, stacked)).toMatchObject({
      ok: true,
      value: {
        available: true,
        kind: "stacked",
        floors: [0, 7.3],
        note: "Stacked floors here: the NPC may be upstairs. Floors: 0, 7.3 yd from the ground floor.",
      },
    });
  });
});

describe("quest_steps", () => {
  it("writes the accept, objective, and turn-in steps, with a floor note where floors stack and no objective .goto without spawns", async () => {
    const stacked: AgentContext = { ...ctxWithoutSpawns, floorHint: () => Promise.resolve({ kind: "stacked", floors: [0, 7.3] }) };
    const result = await callTool(TOOLS, "quest_steps", { id: 7 }, stacked);
    const talk = [
      "    .goto Elwynn Forest,48.80,41.40",
      "    >>|Tinterface/worldmap/chatbubble_64grey.blp:20|tTalk to |cRXP_FRIENDLY_Marshal McBride|r",
      "    >>|cRXP_WARN_Stacked floors here: the NPC may be upstairs.|r",
    ];
    expect(result.ok && (result.value as { text: string }).text.split("\n")).toEqual([
      "step",
      ...talk,
      "    .accept 7 >> Accept Kobold Camp Cleanup",
      "    .target Marshal McBride",
      "step",
      "    >>Kill |cRXP_ENEMY_Kobold Vermin|r",
      "    .complete 7,1 --Kill Kobold Vermin (x10)",
      "step",
      ...talk,
      "    .turnin 7 >> Turn in Kobold Camp Cleanup",
      "    .target Marshal McBride",
    ]);
  });
});

describe("objective points", () => {
  const wolfMeat = (points: QuestPoint[], droppers?: number[]): AgentContext => {
    const file = northshireFile();
    const quests = file.quests.map((q) => (q.id === 33 ? { ...q, objectivePoints: points } : q));
    const dropperFile = droppers && { droppers: { ...file.droppers, "750": droppers.map((id) => ({ id, type: "npc" as const })) } };
    return { ...ctxWithoutSpawns, game: new GameData({ ...file, quests, ...dropperFile }, plannerContext) };
  };
  const at = (x: number, y: number, kind: string, sourceType: string, sourceId: number) =>
    zonePoint(ZONES.elwynn, x, y, { kind, sourceType, sourceId, sourceName: `${sourceType} ${sourceId}` });
  const firstObjective = async (ctx: AgentContext) => {
    const result = await callTool(TOOLS, "quest_details", { id: 33, faction: "Alliance" }, ctx);
    return result.ok
      ? (result.value as { objectives: { spawns: number; mobs: { id: number; spawns: number }[] }[] }).objectives[0]
      : undefined;
  };

  it("counts only the points of an objective's type and its droppers' item points, not extra points or other entities with the same ID", async () => {
    const objective = await firstObjective(
      wolfMeat([
        at(48.6, 39.6, "item", "npc", 299),
        at(49, 38.8, "item", "npc", 69),
        at(60, 60, "extra", "npc", 299),
        at(30, 30, "item", "npc", 750),
        at(30.1, 30.1, "item", "object", 750),
      ]),
    );
    expect(objective?.spawns).toBe(2);
    expect(objective?.mobs.map((m) => m.id)).toEqual([299, 69]);
  });

  it("counts sightings of one NPC under 10 yd apart as one spawn", async () => {
    const objective = await firstObjective(
      wolfMeat([at(48.6, 39.6, "item", "npc", 299), at(48.6005, 39.6005, "item", "npc", 299), at(49, 38.8, "item", "npc", 69)]),
    );
    expect(objective?.spawns).toBe(2);
    expect(objective?.mobs.map((m) => [m.id, m.spawns])).toEqual([
      [299, 1],
      [69, 1],
    ]);
  });

  it("puts an objective's .goto at the spawn the quest browser drafts", async () => {
    const ctx = wolfMeat([
      at(40, 40, "item", "npc", 299),
      at(40.2, 40, "item", "npc", 299),
      at(40.4, 40, "item", "npc", 299),
      at(55, 55, "item", "npc", 69),
      at(55.2, 55, "item", "npc", 69),
    ]);
    const result = await callTool(TOOLS, "quest_steps", { id: 33, faction: "Alliance" }, ctx);
    const steps = result.ok ? (result.value as { steps: { kind: string; at?: string }[] }).steps : [];
    expect(steps.find((s) => s.kind === "objective")?.at).toBe("Elwynn Forest,40.40,40.00");
  });

  it("names the NPC at an objective's .goto in its .mob lines when three other droppers have more spawns", async () => {
    const ctx = wolfMeat(
      [
        at(44, 40, "item", "npc", 299),
        at(44, 42, "item", "npc", 299),
        at(36, 40, "item", "npc", 69),
        at(36, 42, "item", "npc", 69),
        at(40, 37, "item", "npc", 6),
        at(40, 45, "item", "npc", 6),
        at(40, 41, "item", "npc", 113),
      ],
      [299, 69, 6, 113],
    );
    const result = await callTool(TOOLS, "quest_steps", { id: 33, faction: "Alliance" }, ctx);
    const step = result.ok
      ? (result.value as { steps: { kind: string; text: string; at?: string }[] }).steps.find((s) => s.kind === "objective")
      : undefined;
    expect(step?.at).toBe("Elwynn Forest,40.00,41.00");
    expect(step?.text.split("\n").filter((l) => l.trim().startsWith(".mob"))).toEqual([
      "    .mob npc 299",
      "    .mob npc 69",
      "    .mob npc 6",
      "    .mob npc 113",
    ]);
  });
});

describe("built-in guide excerpts", () => {
  const builtIn = (text: string): AgentContext => ({ ...ctxWithoutSpawns, guides: [{ id: "northshire", order: 0, text }] });
  const NORTHSHIRE_BUILT_IN = [
    "#version 1",
    "#group RestedXP Alliance 1-20",
    "#name 1-6 Northshire",
    "#next 6-10 Elwynn Forest",
    "<< Human",
    "-- header note",
    "",
    "step << Warrior",
    "    .train 6673 >> Train Battle Shout",
    "step",
    "    .goto Elwynn Forest,48.2,42.8",
    "    .accept 783 >> Accept A Threat Within",
    "",
    "step",
    "    #completewith next",
    "    +Talk to Deputy Willem",
    "step",
    "    .turnin 783 >> Turn in A Threat Within",
    "",
  ].join("\r\n");
  const ctx = builtIn(NORTHSHIRE_BUILT_IN);

  it("lists each built-in guide with its step count", async () => {
    expect(await callTool(TOOLS, "guide_example", {}, ctx)).toEqual({
      ok: true,
      value: { guides: [{ name: "1-6 Northshire", group: "RestedXP Alliance 1-20", steps: 4, next: "6-10 Elwynn Forest" }] },
    });
  });

  it("returns the header and a range of steps as the guide writes them", async () => {
    expect(await callTool(TOOLS, "guide_example", { name: "northshire", fromStep: 2, count: 2 }, ctx)).toEqual({
      ok: true,
      value: {
        name: "1-6 Northshire",
        group: "RestedXP Alliance 1-20",
        steps: 4,
        header: "#version 1\n#group RestedXP Alliance 1-20\n#name 1-6 Northshire\n#next 6-10 Elwynn Forest\n<< Human\n-- header note",
        text: [
          { step: 2, text: "step\n    .goto Elwynn Forest,48.2,42.8\n    .accept 783 >> Accept A Threat Within" },
          { step: 3, text: "step\n    #completewith next\n    +Talk to Deputy Willem" },
        ],
      },
    });
  });

  it("quotes the header and the unconditional quest steps of Northshire in the reference", async () => {
    expect(await callTool(TOOLS, "rxp_reference", { topic: "example" }, ctx)).toEqual({
      ok: true,
      value: {
        example:
          "#version 1\n#group RestedXP Alliance 1-20\n#name 1-6 Northshire\n#next 6-10 Elwynn Forest\n<< Human\n\n" +
          "step\n    .goto Elwynn Forest,48.2,42.8\n    .accept 783 >> Accept A Threat Within\n" +
          "step\n    .turnin 783 >> Turn in A Threat Within",
      },
    });
  });

  it("quotes unconditional steps whose quest commands RXP reads, not those named in a comment", async () => {
    const ctx = builtIn(
      "#name 1-6 Northshire\nstep -- first\n    .accept 783\nstep\n    -- .turnin 783 next\n    .goto Elwynn Forest,48.2,42.8\nstep << Warrior\n    .turnin 783\n",
    );
    expect(await callTool(TOOLS, "rxp_reference", { topic: "example" }, ctx)).toEqual({
      ok: true,
      value: { example: "#name 1-6 Northshire\n\nstep -- first\n    .accept 783" },
    });
  });

  it("quotes the header of the first guide when Northshire is missing and that guide has no steps", async () => {
    const ctx = builtIn("#version 1\n#group G\n#name Random Stuff\n<< Alliance\n-- note\n");
    expect(await callTool(TOOLS, "rxp_reference", { topic: "example" }, ctx)).toEqual({
      ok: true,
      value: { example: "#version 1\n#group G\n#name Random Stuff\n<< Alliance\n\n" },
    });
  });

  it("starts a step at any line that begins with step, as RXP does", async () => {
    const ctx = builtIn("#group G\n#name N\nstep\n    .accept 783\nsteps\n    .turnin 783\n");
    expect(await callTool(TOOLS, "guide_example", { name: "N" }, ctx)).toMatchObject({
      ok: true,
      value: {
        steps: 2,
        text: [
          { step: 1, text: "step\n    .accept 783" },
          { step: 2, text: "steps\n    .turnin 783" },
        ],
      },
    });
  });

  describe("with two guides that share a name in different groups", () => {
    const ctx: AgentContext = {
      ...ctxWithoutSpawns,
      guides: [
        { id: "leveling", order: 0, text: "#group RestedXP Forever Guide (A)\n#name 1-6 Northshire\nstep\n    .accept 783\n" },
        { id: "dungeon", order: 1, text: "#group RestedXP Forever Dungeon Guide (A)\n#name 1-6 Northshire\nstep\n    .turnin 783\n" },
      ],
    };

    it("returns the guide in the group the caller names", async () => {
      expect(await callTool(TOOLS, "guide_example", { name: "1-6 Northshire", group: "RestedXP Forever Guide (A)" }, ctx)).toEqual({
        ok: true,
        value: {
          name: "1-6 Northshire",
          group: "RestedXP Forever Guide (A)",
          steps: 1,
          header: "#group RestedXP Forever Guide (A)\n#name 1-6 Northshire",
          text: [{ step: 1, text: "step\n    .accept 783" }],
        },
      });
      expect(await callTool(TOOLS, "guide_example", { name: "1-6 Northshire", group: "RestedXP Forever Dungeon Guide (A)" }, ctx)).toEqual({
        ok: true,
        value: {
          name: "1-6 Northshire",
          group: "RestedXP Forever Dungeon Guide (A)",
          steps: 1,
          header: "#group RestedXP Forever Dungeon Guide (A)\n#name 1-6 Northshire",
          text: [{ step: 1, text: "step\n    .turnin 783" }],
        },
      });
    });

    it("matches the group exactly", async () => {
      expect(await callTool(TOOLS, "guide_example", { name: "1-6 Northshire", group: "restedxp forever guide (a)" }, ctx)).toEqual({
        ok: false,
        error:
          'No built-in guide in group "restedxp forever guide (a)" is named "1-6 Northshire". Call guide_example without a name to list them.',
      });
    });

    it("rejects an empty group", async () => {
      expect(await callTool(TOOLS, "guide_example", { group: "" }, ctx)).toEqual({
        ok: false,
        error: "Invalid input: input.group must be at least 1 character.",
      });
    });

    it("lists only the guides in the group", async () => {
      expect(await callTool(TOOLS, "guide_example", { group: "RestedXP Forever Dungeon Guide (A)" }, ctx)).toEqual({
        ok: true,
        value: { guides: [{ name: "1-6 Northshire", group: "RestedXP Forever Dungeon Guide (A)", steps: 1 }] },
      });
    });

    it("names both groups when the caller gives no group", async () => {
      expect(await callTool(TOOLS, "guide_example", { name: "1-6 Northshire" }, ctx)).toEqual({
        ok: false,
        error:
          '"1-6 Northshire" matches 2 guides: 1-6 Northshire (RestedXP Forever Guide (A)); 1-6 Northshire (RestedXP Forever Dungeon Guide (A)). Pass group to pick one.',
      });
    });

    it("says when no guide with the name is in the group", async () => {
      expect(await callTool(TOOLS, "guide_example", { name: "1-6 Northshire", group: "RestedXP Forever Guide (H)" }, ctx)).toEqual({
        ok: false,
        error:
          'No built-in guide in group "RestedXP Forever Guide (H)" is named "1-6 Northshire". Call guide_example without a name to list them.',
      });
    });
  });
});
