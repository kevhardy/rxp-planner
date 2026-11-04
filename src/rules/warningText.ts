import { guideTextPlain, type TextPart } from "../guide/index.ts";
import type { QuestPointNumber } from "./points.ts";
import type { Location, Warning } from "./validate.ts";
import { QUEST_LOG_SIZE } from "./validate.ts";

const TARGET_REASONS: Record<Extract<Warning, { kind: "noKillTarget" }>["reason"], string> = {
  noMatch: "no mob matches it",
  ambiguous: "several mobs or items share its name",
  noDropper: "no mob drops its item",
  noLevels: "its mob has no level data",
};

const MISPLACED_ADVICE: Partial<Record<string, string>> = {
  done: "in the header",
  drop: "on a .complete line for an item objective",
  party: "in the header",
  extra: "in a step, with mob=",
  killmult: "on a separate comment in the header or a step",
  killxp: "on a separate comment in a step",
  respawn: "on a separate comment in the header or in a step with kills",
  area: "on a separate comment in the header or in a step with kills",
  near: "on a separate comment in a step with kills and a .goto that names a zone",
  pass: "on a separate comment in the header or in a #completewith step",
  state: "in a step, on a separate comment or the step line",
};

const QUEST_POINT_NUMBERS: Record<QuestPointNumber, string> = { radius: "radius", questId: "quest ID", objective: "objective index" };

function parts(strings: TemplateStringsArray, ...values: (string | number | readonly TextPart[])[]): TextPart[] {
  return strings.flatMap((text, i) => {
    const value = values[i];
    return [...(text ? [text] : []), ...(value === undefined ? [] : typeof value === "object" ? value : [String(value)])];
  });
}

const mono = (text: string | number): TextPart[] => [{ mono: String(text) }];

const lowered = (list: readonly TextPart[]) => list.map((part) => (typeof part === "string" ? part.toLowerCase() : part));

const xpText = (xp: number) => `${xp.toLocaleString("en-US")} xp`;

const targetText = (target: { level: number; xp: number }) => `level ${target.level}${target.xp > 0 ? ` + ${xpText(target.xp)}` : ""}`;

export function placeParts(at: Location): [lead: TextPart[], rest: TextPart[]] {
  if (at.step === undefined) return [parts`Header line ${mono((at.line ?? 0) + 1)}`, []];
  return [parts`Step ${mono(at.step + 1)}`, at.line === undefined ? [] : parts`, line ${mono(at.line + 1)}`];
}

/** "Step 3, line 2", "Step 3", or "Header line 4". */
export function placeText(at: Location): string {
  return guideTextPlain(placeParts(at).flat());
}

type NameLookup = (id: number) => { name: string } | undefined;

function questText(lookup: NameLookup, id: number): TextPart[] {
  const name = lookup(id)?.name;
  return name ? parts`${name} (${mono(id)})` : parts`quest ${mono(id)}`;
}

function questList(lookup: NameLookup, ids: readonly number[], word: "and" | "or"): TextPart[] {
  const names = ids.map((id) => questText(lookup, id));
  const last = names.pop() ?? [];
  return names.length === 0 ? last : [...names.flatMap((name, i) => (i > 0 ? [", ", ...name] : name)), ` ${word} `, ...last];
}

/**
 * The quick fixes for a prerequisite warning, each the quests it marks done
 * with `-- @sim done=`: every unmet `allOf` quest, with one `anyOf` candidate
 * per fix when there are any. None when the route turns one in later.
 */
export function prerequisiteFixes(warning: Extract<Warning, { kind: "prerequisite" }>): number[][] {
  if (warning.later) return [];
  return warning.anyOf.length > 0 ? warning.anyOf.map((id) => [...warning.allOf, id]) : [warning.allOf];
}

export function markDoneParts(ids: readonly number[], lookup: NameLookup): TextPart[] {
  return parts`Mark ${questList(lookup, ids, "and")} done in header`;
}

export function warningText(warning: Warning, lookup: NameLookup, guideName: (guide: number) => string): string {
  return guideTextPlain(warningParts(warning, lookup, guideName));
}

/**
 * The warning as a sentence, with each quest ID and piece of guide syntax as
 * a mono part. `guideName` names a guide by its index, for places in other
 * guides.
 */
export function warningParts(warning: Warning, lookup: NameLookup, guideName: (guide: number) => string): TextPart[] {
  const quest = (id: number) => questText(lookup, id);
  const list = (ids: number[], word: "and" | "or") => questList(lookup, ids, word);

  switch (warning.kind) {
    case "notAccepted":
      return parts`${warning.command === "turnin" ? "Turns in" : "Completes"} ${quest(warning.questId)} before accepting it`;
    case "prerequisite": {
      const needs = [
        ...(warning.allOf.length > 0 ? [list(warning.allOf, "and")] : []),
        ...(warning.anyOf.length > 0 ? [parts`${warning.anyOf.length > 1 ? "one of " : ""}${list(warning.anyOf, "or")}`] : []),
      ];
      const later = warning.later
        ? parts`; the route turns it in later at ${warning.later.guide === warning.at.guide ? "" : `${guideName(warning.later.guide)}, `}${lowered(placeParts(warning.later).flat())}`
        : [];
      return parts`Accepts ${quest(warning.questId)} before turning in ${needs.flatMap((need, i) => (i > 0 ? [" and ", ...need] : need))}${later}`;
    }
    case "questLogFull":
      return parts`The quest log holds ${warning.count} quests; it fits ${QUEST_LOG_SIZE}`;
    case "missingLabel":
      return parts`No shown step has ${mono(`#label ${warning.label}`)}${warning.hidden ? "; only skipped steps have it" : ""}`;
    case "unknownQuest":
      return lookup(warning.questId)
        ? parts`${quest(warning.questId)} has unverified prerequisite data`
        : parts`Quest ${mono(warning.questId)} is not in the quest data`;
    case "missingNext":
      return parts`${mono(`#next ${warning.next}`)} finds no guide, so the route stops`;
    case "levelTooLow":
      return parts`Accepts ${quest(warning.questId)} at level ${warning.level}; it requires level ${warning.requiredLevel}`;
    case "checkpointGap":
      return parts`Checkpoint ${targetText(warning.target)} is ${xpText(warning.xp)} ahead of the simulation`;
    case "checkpointBehind":
      return parts`Checkpoint ${targetText(warning.target)} is ${xpText(warning.xp)} behind the simulation`;
    case "unknownSimKey":
      if (warning.problem === "unknown") return parts`Unknown ${mono("@sim")} key ${mono(warning.key)}`;
      if (warning.problem === "badValue")
        return parts`${mono(`@sim ${warning.key}=${warning.value}`)} has a value the simulator cannot use`;
      return parts`${mono(`@sim ${warning.key}=`)} does not apply here; it belongs ${MISPLACED_ADVICE[warning.key] ?? "on a .complete line"}`;
    case "noQuestXp":
      return parts`No XP data for ${quest(warning.questId)}, so its turn-in counts 0 xp`;
    case "noKillTarget":
      return parts`No kills counted for ${warning.objective} in ${quest(warning.questId)}: ${TARGET_REASONS[warning.reason]}`;
    case "noKillCount":
      return parts`No kills counted for ${warning.objective} in ${quest(warning.questId)}: its count is unknown`;
    case "unknownCommand":
      return parts`${mono(`.${warning.command}`)} is not an RXP command`;
    case "noHandler":
      return parts`RXP has no handler for ${mono(`.${warning.command}`)} and reports an error`;
    case "droppedPoint":
      return parts`RXP drops this ${mono(`.${warning.command}`)} because its ${QUEST_POINT_NUMBERS[warning.arg]} is not a number`;
    case "unknownDungeon":
      return parts`${mono(warning.dungeon)} is not a dungeon RXP knows`;
    case "unknownTag":
      return parts`${mono(`#${warning.tag}`)} is not an RXP tag`;
    case "misspelledTag":
      return parts`${mono(`#${warning.tag}`)} should be ${mono(`#${warning.correct}`)}; RXP ignores it`;
    case "suspiciousToken":
      return parts`${mono(warning.token)} matches nothing RXP checks${warning.suggestion ? parts`; did you mean ${mono(warning.suggestion)}?` : ""}`;
    case "invalidCondition":
      return parts`${mono(warning.text)} is never true`;
  }
}
