import { describe, expect, it } from "vitest";
import { createProfile, type Profile } from "./profile.ts";
import type { PlayableRace } from "../data/races.ts";
import { questAccess, trivialQuest, type QuestAccess } from "./questAccess.ts";
import type { QuestProgress, SimQuest, SimState } from "./simulate.ts";
import { simQuest, testRules } from "./testing.ts";

const undeadMage = createProfile({ race: "Scourge", class: "MAGE" });
const inLog: QuestProgress = { status: "incomplete", objectives: [] };

const mageQuest = { level: 10, requiredLevel: 10, requiredClassMask: 128, requiredFaction: "Horde" } as const;
const others: Record<number, SimQuest> = {
  1882: simQuest({ name: "The Balnir Farmstead", ...mageQuest, requiredRaceMask: 144, exclusiveTo: [1884] }),
  1884: simQuest({ name: "Ju-Ju Heaps", ...mageQuest, requiredRaceMask: 146, exclusiveTo: [1882] }),
};

function access(
  fields: Partial<SimQuest>,
  at: { level?: number; log?: number[]; done?: number[] } = {},
  profile: Profile = undeadMage,
): QuestAccess {
  const state: SimState = {
    level: at.level ?? 10,
    xp: 0,
    position: null,
    log: new Map((at.log ?? []).map((id) => [id, inLog])),
    done: new Set(at.done ?? []),
    bind: null,
    flightPaths: new Set(),
  };
  return questAccess(
    simQuest({
      name: "WANTED: Maggot Eye",
      level: 10,
      requiredLevel: 6,
      requiredRaceMask: 178,
      requiredFaction: "Horde",
      zoneIds: [85],
      ...fields,
    }),
    state,
    profile,
    { quest: (id) => others[id], rules: testRules },
  );
}
const standing = (name: string) => testRules.standings.find((s) => s.name === name);
const locked = (...args: Parameters<typeof access>) => {
  const result = access(...args);
  if (result.excluded) throw new Error(`excluded for ${result.reason}`);
  return result.locked;
};

describe("questAccess", () => {
  it("is open, with nothing unknown, to a character who meets every requirement", () => {
    expect(access({})).toEqual({ excluded: false, locked: [], unknown: [] });
  });

  it("excludes a quest for other races, reading Scourge as the Undead bit", () => {
    expect(access({ requiredRaceMask: 2 })).toEqual({ excluded: true, reason: "race" });
    expect(access({ requiredRaceMask: 2 | 16 }).excluded).toBe(false);
  });

  it("reads the Skyborne race bits above 32 bits exactly", () => {
    const races: PlayableRace[] = ["HighOrder", "Windshaper", "Human", "Orc", "Scourge", "Troll"];
    const open = (mask: number) =>
      races.filter(
        (race) => !access({ requiredRaceMask: mask, requiredFaction: null }, {}, createProfile({ race, class: "WARRIOR" })).excluded,
      );
    expect(open(4294967296)).toEqual(["HighOrder"]);
    expect(open(8589934592)).toEqual(["Windshaper"]);
    expect(open(12884901888)).toEqual(["HighOrder", "Windshaper"]);
    // Orc and Troll bits with bit 32 above them; truncating to 32 bits would keep only 130.
    expect(open(4294967296 + 130)).toEqual(["HighOrder", "Orc", "Troll"]);
  });

  it("excludes a quest for other classes", () => {
    expect(access({ requiredClassMask: 1 })).toEqual({ excluded: true, reason: "class" });
    expect(access({ requiredClassMask: 128 }).excluded).toBe(false);
  });

  it("excludes a quest for the other faction", () => {
    expect(access({ requiredFaction: "Alliance" })).toEqual({ excluded: true, reason: "faction" });
    expect(access({ requiredFaction: "Horde" }).excluded).toBe(false);
  });

  it("leaves a quest open when its masks or prerequisites are unknown, and names them", () => {
    expect(access({ requiredRaceMask: null, requiredClassMask: null, preAny: null, preAll: null })).toEqual({
      excluded: false,
      locked: [],
      unknown: ["race", "class", "prerequisites"],
    });
  });

  it("locks below the required level", () => {
    expect(locked({ requiredLevel: 11 })).toEqual([{ kind: "level", requiredLevel: 11 }]);
    expect(locked({ requiredLevel: 10 })).toEqual([]);
  });

  it("locks above the highest level", () => {
    expect(locked({ requiredMaxLevel: 9 })).toEqual([{ kind: "maxLevel", maxLevel: 9 }]);
    expect(locked({ requiredMaxLevel: 10 })).toEqual([]);
  });

  it("needs any one of preQuestSingle turned in", () => {
    expect(locked({ preAny: [1, 2] })).toEqual([{ kind: "prerequisite", allOf: [], anyOf: [1, 2] }]);
    expect(locked({ preAny: [1, 2] }, { done: [2] })).toEqual([]);
    expect(locked({ preAny: [1, 2] }, { log: [1] })).toHaveLength(1);
  });

  it("skips preQuestGroup when preQuestSingle lists any quest", () => {
    expect(locked({ preAny: [1], preAll: [2] }, { done: [1] })).toEqual([]);
  });

  it("needs every one of preQuestGroup turned in", () => {
    expect(locked({ preAll: [1, 2] }, { done: [1] })).toEqual([{ kind: "prerequisite", allOf: [2], anyOf: [] }]);
    expect(locked({ preAll: [1, 2] }, { done: [1, 2] })).toEqual([]);
  });

  it("counts a group member done once a quest exclusive with it is turned in", () => {
    expect(locked({ preAll: [1882] }, { done: [1884] })).toEqual([]);
    expect(locked({ preAll: [1882] }, { log: [1884] })).toEqual([{ kind: "prerequisite", allOf: [1882], anyOf: [] }]);
  });

  it("keeps a group member with no record not done", () => {
    expect(locked({ preAll: [30] })).toEqual([{ kind: "prerequisite", allOf: [30], anyOf: [] }]);
  });

  it("locks once an exclusive quest is in the log or turned in", () => {
    expect(locked({ exclusiveTo: [5, 6, 7] }, { log: [5], done: [7] })).toEqual([{ kind: "exclusive", quests: [5, 7] }]);
    expect(locked({ exclusiveTo: [5] })).toEqual([]);
  });

  it("locks once the next quest in the chain is in the log or turned in", () => {
    expect(locked({ nextQuestInChain: 8 }, { log: [8] })).toEqual([{ kind: "nextInChain", quest: 8 }]);
    expect(locked({ nextQuestInChain: 8 }, { done: [8] })).toEqual([{ kind: "nextInChain", quest: 8 }]);
    expect(locked({ nextQuestInChain: 8 })).toEqual([]);
  });

  it("gives one reason for a next quest that is also exclusive", () => {
    expect(locked({ nextQuestInChain: 8, exclusiveTo: [8] }, { log: [8] })).toEqual([{ kind: "exclusive", quests: [8] }]);
  });

  it("locks a child quest until its parent is in the log", () => {
    expect(locked({ parentQuest: 9 })).toEqual([{ kind: "parent", quest: 9 }]);
    expect(locked({ parentQuest: 9 }, { log: [9] })).toEqual([]);
  });

  it("locks a reputation minimum above Neutral, with its standing, and meets the rest", () => {
    expect(locked({ requiredMinRep: { faction: 576, value: 9000 } })).toEqual([
      { kind: "reputation", faction: 576, value: 9000, standing: standing("Honored") },
    ]);
    expect(locked({ requiredMinRep: { faction: 729, value: 1 } })).toHaveLength(1);
    expect(locked({ requiredMinRep: { faction: 729, value: 0 } })).toEqual([]);
    expect(locked({ requiredMinRep: { faction: 729, value: -3000 } })).toEqual([]);
  });

  it("locks a reputation maximum of Neutral or below, which Neutral is not below, and meets the rest", () => {
    expect(locked({ requiredMaxRep: { faction: 21, value: 0 } })).toEqual([
      { kind: "maxReputation", faction: 21, value: 0, standing: standing("Neutral") },
    ]);
    expect(locked({ requiredMaxRep: { faction: 21, value: -5999 } })).toEqual([
      { kind: "maxReputation", faction: 21, value: -5999, standing: standing("Hostile") },
    ]);
    expect(locked({ requiredMaxRep: { faction: 909, value: 1 } })).toEqual([]);
  });

  it("gives the standing each reputation value reaches", () => {
    const standingAt = (value: number) => {
      const [reason] = locked(value > 0 ? { requiredMinRep: { faction: 1, value } } : { requiredMaxRep: { faction: 1, value } });
      return reason && "standing" in reason ? reason.standing.name : undefined;
    };
    expect([-50000, -42000, -6001, -6000, -3001, -3000, -1, 0, 1, 2999, 3000, 9000, 21000, 41999, 42000].map(standingAt)).toEqual([
      "Hated",
      "Hated",
      "Hated",
      "Hostile",
      "Hostile",
      "Unfriendly",
      "Unfriendly",
      "Neutral",
      "Neutral",
      "Neutral",
      "Friendly",
      "Honored",
      "Revered",
      "Revered",
      "Exalted",
    ]);
  });

  it("locks a required skill or specialization", () => {
    expect(locked({ requiredSkill: { skill: 164, value: 250 }, requiredSpecialization: 9787 })).toEqual([
      { kind: "profession", skill: 164, value: 250 },
      { kind: "profession", specialization: 9787 },
    ]);
    expect(locked({ requiredSpecialization: 185 })).toEqual([{ kind: "profession", specialization: 185 }]);
  });

  it("meets a profession key for having no specialization yet", () => {
    expect(locked({ requiredSpecialization: 202 })).toEqual([]);
  });

  it("meets a specialization key it does not recognize", () => {
    expect(locked({ requiredSpecialization: 12345 })).toEqual([]);
  });

  it("locks a world event quest", () => {
    expect(locked({ event: true })).toEqual([{ kind: "event" }]);
  });
});

describe("trivialQuest", () => {
  it("grays a quest at or below the mobs' gray level", () => {
    expect(trivialQuest(1, 5)).toBe(false);
    expect([trivialQuest(4, 10), trivialQuest(5, 10)]).toEqual([true, false]);
    expect([trivialQuest(13, 20), trivialQuest(14, 20)]).toEqual([true, false]);
    expect([trivialQuest(31, 40), trivialQuest(32, 40)]).toEqual([true, false]);
    expect([trivialQuest(51, 60), trivialQuest(52, 60)]).toEqual([true, false]);
  });
});
