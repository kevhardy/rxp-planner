import { luaNumber, type Condition, type ConditionExpr } from "../guide/index.ts";
import { raceToken, type Profile } from "./profile.ts";
import { CLASSES, RACES } from "../data/races.ts";

/** The game that RXP's game tokens name for this planner. */
export const GAME = "FOREVER";

// RXP reads these exact spellings as other names before it compares races,
// factions, and the locale. `DF` in any case reads as `RETAIL`.
const ALIASES: ReadonlyMap<string, string> = new Map([
  ["Undead", "Scourge"],
  ["Haranir", "Harronir"],
]);

/**
 * Whether one condition token holds for the character. Classes, sex, `SOD`,
 * and the game compare without case. Races, factions, and the locale compare
 * with case. A number holds at or below the character's level.
 */
export function tokenHolds(token: string, profile: Profile): boolean {
  const upper = token.toUpperCase();
  const name = upper === "DF" ? "RETAIL" : (ALIASES.get(token) ?? token);
  const level = luaNumber(token);
  return (
    (upper === "DK" ? "DEATHKNIGHT" : upper) === profile.class ||
    ((upper === "MALE" || upper === "FEMALE") && upper.toLowerCase() === profile.sex) ||
    upper === GAME ||
    (upper === "SOD" && profile.season === 2) ||
    name === raceToken(profile.race) ||
    name === profile.faction ||
    name === profile.locale ||
    (level !== undefined && level <= profile.level)
  );
}

/** Whether a condition tree holds for the character. An invalid node never holds. */
export function evaluate(expr: ConditionExpr, profile: Profile): boolean {
  switch (expr.type) {
    case "token":
      return tokenHolds(expr.value, profile);
    case "invalid":
      return false;
    case "not":
      return !evaluate(expr.item, profile);
    case "and":
      return expr.items.every((item) => evaluate(item, profile));
    case "or":
      return expr.items.some((item) => evaluate(item, profile));
  }
}

/** Whether a line applies to the character. A line without a condition applies. */
export function holds(condition: Condition | undefined, profile: Profile): boolean {
  return condition === undefined || evaluate(condition.expr, profile);
}

const ANY_CASE: ReadonlySet<string> = new Set([
  ...CLASSES,
  "DK",
  "MALE",
  "FEMALE",
  "SOD",
  "SKIP",
  GAME,
  "CLASSIC",
  "TBC",
  "WOTLK",
  "CATA",
  "MOP",
  "RETAIL",
  "DF",
]);
const CASED: readonly string[] = [...RACES, "Undead", "Skyborne", "Alliance", "Horde", "Neutral"];
const LOCALES: readonly string[] = ["enUS", "enGB", "deDE", "esES", "esMX", "frFR", "itIT", "koKR", "ptBR", "ruRU", "zhCN", "zhTW"];

/**
 * Checks one token that RXP would read. Returns `undefined` when RXP knows
 * the name, even when it names another game. Returns the cased name for a
 * race or faction with the wrong case, and `""` for a token that names
 * nothing, such as `fRogue`.
 */
export function suspiciousToken(token: string): string | undefined {
  const upper = token.toUpperCase();
  if (ANY_CASE.has(upper) || CASED.includes(token) || LOCALES.includes(token) || luaNumber(token) !== undefined) return undefined;
  return CASED.find((name) => name.toUpperCase() === upper) ?? "";
}
