import type { StandingRecord } from "../../packages/data-contract/model.ts";
import { CLASS_BITS } from "../data/model.ts";
import type { GameRules } from "../data/gameRules.ts";
import type { Profile } from "./profile.ts";
import type { SimData, SimQuest, SimState } from "./simulate.ts";
import { grayLevel } from "./xp.ts";

/** A requirement whose data is null. It does not lock the quest. */
export type UnknownFact = "race" | "class" | "prerequisites";

export type LockReason =
  | { kind: "level"; requiredLevel: number }
  | { kind: "maxLevel"; maxLevel: number }
  | { kind: "prerequisite"; allOf: number[]; anyOf: number[] }
  | { kind: "parent"; quest: number }
  | { kind: "exclusive"; quests: number[] }
  | { kind: "nextInChain"; quest: number }
  | { kind: "reputation"; faction: number; value: number; standing: StandingRecord }
  | { kind: "maxReputation"; faction: number; value: number; standing: StandingRecord }
  | { kind: "profession"; skill: number; value: number }
  | { kind: "profession"; specialization: number }
  | { kind: "event" };

/**
 * An excluded quest is never for this character. Otherwise `locked` lists
 * what keeps the quest closed now, in a fixed order, and is empty when the
 * quest is open.
 */
export type QuestAccess =
  | { excluded: true; reason: "race" | "class" | "faction" }
  | { excluded: false; locked: LockReason[]; unknown: UnknownFact[] };

type ExclusiveLookup = (id: number) => Pick<SimQuest, "exclusiveTo"> | undefined;

const NEUTRAL = 0;

export function questAccess(
  quest: SimQuest,
  state: Pick<SimState, "level" | "log" | "done">,
  profile: Pick<Profile, "faction" | "race" | "class">,
  data: Pick<SimData, "quest" | "rules">,
): QuestAccess {
  const { rules } = data;
  if (!allows(quest.requiredRaceMask, rules.raceBits[profile.race])) return { excluded: true, reason: "race" };
  if (!allows(quest.requiredClassMask, CLASS_BITS[profile.class])) return { excluded: true, reason: "class" };
  if (quest.requiredFaction !== null && quest.requiredFaction !== profile.faction) return { excluded: true, reason: "faction" };

  const taken = (id: number) => state.log.has(id) || state.done.has(id);
  const locked: LockReason[] = [];
  if (quest.requiredLevel !== null && state.level < quest.requiredLevel) locked.push({ kind: "level", requiredLevel: quest.requiredLevel });
  if (quest.requiredMaxLevel !== 0 && state.level > quest.requiredMaxLevel)
    locked.push({ kind: "maxLevel", maxLevel: quest.requiredMaxLevel });
  const missing = missingPrerequisites(
    quest,
    (id) => state.done.has(id),
    (id) => data.quest(id),
  );
  if (missing) locked.push({ kind: "prerequisite", ...missing });
  if (quest.parentQuest !== 0 && !state.log.has(quest.parentQuest)) locked.push({ kind: "parent", quest: quest.parentQuest });
  const closers = quest.exclusiveTo.filter(taken);
  if (closers.length) locked.push({ kind: "exclusive", quests: closers });
  const next = quest.nextQuestInChain;
  if (next && taken(next) && !closers.includes(next)) locked.push({ kind: "nextInChain", quest: next });
  const { requiredMinRep: min, requiredMaxRep: max } = quest;
  if (min && min.value > NEUTRAL)
    locked.push({ kind: "reputation", faction: min.faction, value: min.value, standing: standingAt(rules, min.value) });
  if (max && max.value <= NEUTRAL)
    locked.push({ kind: "maxReputation", faction: max.faction, value: max.value, standing: standingAt(rules, max.value) });
  const skill = quest.requiredSkill;
  if (skill) locked.push({ kind: "profession", skill: skill.skill, value: skill.value });
  if (locksSpecialization(rules, quest.requiredSpecialization))
    locked.push({ kind: "profession", specialization: quest.requiredSpecialization });
  if (quest.event) locked.push({ kind: "event" });
  return { excluded: false, locked, unknown: unknownFacts(quest) };
}

/**
 * The prerequisites still to turn in, or undefined when none are missing.
 * `done` tells whether a quest is turned in. When the quest lists
 * alternatives (`preAny`), one of them must be turned in, and the group
 * (`preAll`) does not count. Otherwise each group quest must be turned in,
 * or a quest that its `exclusiveTo` names.
 */
export function missingPrerequisites(
  quest: Pick<SimQuest, "preAny" | "preAll">,
  done: (id: number) => boolean,
  lookup: ExclusiveLookup,
): { allOf: number[]; anyOf: number[] } | undefined {
  if (quest.preAny?.length) return quest.preAny.some(done) ? undefined : { allOf: [], anyOf: [...quest.preAny] };
  const allOf = (quest.preAll ?? []).filter((id) => !done(id) && !lookup(id)?.exclusiveTo.some(done));
  return allOf.length ? { allOf, anyOf: [] } : undefined;
}

export function unknownFacts(quest: Pick<SimQuest, "requiredRaceMask" | "requiredClassMask" | "preAll" | "preAny">): UnknownFact[] {
  const unknown: UnknownFact[] = [];
  if (quest.requiredRaceMask === null) unknown.push("race");
  if (quest.requiredClassMask === null) unknown.push("class");
  if (quest.preAll === null || quest.preAny === null) unknown.push("prerequisites");
  return unknown;
}

export function trivialQuest(questLevel: number, playerLevel: number): boolean {
  return questLevel <= grayLevel(playerLevel);
}

function allows(mask: number | null, bit: number): boolean {
  // Division, because bitwise operators keep only 32 bits and the Skyborne races use bits 32 and 33.
  return !mask || Math.floor(mask / bit) % 2 === 1;
}

function standingAt({ standings }: Pick<GameRules, "standings">, value: number): StandingRecord {
  return standings.findLast((standing) => value >= standing.min) ?? standings[0]!;
}

function locksSpecialization({ professions }: Pick<GameRules, "professions">, key: number): boolean {
  const profession = Object.hasOwn(professions, key) ? professions[key] : undefined;
  return profession !== undefined && !profession.noSpecialization;
}
