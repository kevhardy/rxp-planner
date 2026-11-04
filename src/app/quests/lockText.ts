import type { LockReason } from "../../rules/index.ts";
import type { GameRules } from "../../data/index.ts";

type Standing = GameRules["standings"][number];

export interface LockNames {
  quest: (id: number) => string;
  faction: (id: number) => string;
  rules: Pick<GameRules, "professions" | "standings">;
}

export function lockText(reasons: readonly LockReason[], names: LockNames): string {
  return reasons.map((r) => reasonText(r, names)).join(" · ");
}

function reasonText(r: LockReason, { quest: questName, faction: factionName, rules }: LockNames): string {
  switch (r.kind) {
    case "level":
      return `level ${r.requiredLevel}`;
    case "maxLevel":
      return `level ${r.maxLevel} or lower`;
    case "prerequisite": {
      const allOf = names(r.allOf, questName);
      const anyOf = names(r.anyOf, questName);
      const parts = [];
      if (allOf.length > 0) parts.push(allOf.join(" and "));
      if (anyOf.length > 0) parts.push(anyOf.length === 1 ? anyOf[0] : `one of ${anyOf.join(", ")}`);
      return `after ${parts.join(" and ")}`;
    }
    case "parent":
      return `with ${questName(r.quest)} in the log`;
    case "exclusive":
      return `closed by ${names(r.quests, questName).join(", ")}`;
    case "nextInChain":
      return `closed by next quest ${questName(r.quest)}`;
    case "reputation":
      return `${reputation(r)} with ${factionName(r.faction)}`;
    case "maxReputation":
      return `${ceiling(rules, r)} or lower with ${factionName(r.faction)}`;
    case "profession":
      return "skill" in r ? `${profession(rules, r.skill)} ${r.value}` : profession(rules, r.specialization);
    case "event":
      return "world event";
  }
}

const names = (ids: readonly number[], questName: (id: number) => string) => [...new Set(ids.map(questName))];
const profession = ({ professions }: LockNames["rules"], id: number) =>
  (Object.hasOwn(professions, id) ? professions[id]?.name : undefined) ?? `profession ${id}`;
function reputation(r: { value: number; standing: Standing }): string {
  const above = r.value - r.standing.min;
  return `${r.standing.name}${above > 0 ? ` +${above}` : ""}`;
}
function ceiling({ standings }: LockNames["rules"], r: { value: number; standing: Standing }): string {
  const below = r.value === r.standing.min ? standings[standings.indexOf(r.standing) - 1]?.name : undefined;
  return below ?? `${String(r.value - 1).replace("-", "\u2212")} reputation`;
}
