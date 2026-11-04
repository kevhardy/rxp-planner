import { MAX_LEVEL, type GameRules } from "../data/gameRules.ts";

/** The players who share kill XP. Quest XP is not shared. */
export type PartySize = 1 | 2;

export interface KillXpSettings {
  /** Scales the solo XP. */
  multiplier?: number;
  /** Replaces the solo XP, and wins over `multiplier`. */
  exact?: number;
  party?: PartySize;
}

/**
 * `.xp`'s level forms, used by `.xp` lines and `-- @sim level=`: `8`,
 * `8+1200` (1200 XP into level 8), `8.5` (half of level 8), or `8-300`
 * (300 XP short of level 8).
 */
export type LevelTarget =
  | { kind: "level"; level: number }
  | { kind: "plus"; level: number; xp: number }
  | { kind: "fraction"; level: number; fraction: number }
  | { kind: "minus"; level: number; xp: number };

// The first player level of each zero-difference bracket, highest first. Below
// level 8 the zero difference is 5
// (https://warcraft.wiki.gg/wiki/Mob_experience#Lower_Level_Mobs).
const ZERO_DIFFERENCE: readonly (readonly [fromLevel: number, levels: number])[] = [
  [60, 17],
  [55, 16],
  [50, 15],
  [45, 14],
  [40, 13],
  [30, 12],
  [20, 11],
  [16, 9],
  [12, 8],
  [10, 7],
  [8, 6],
];

// An elite in an instance gives 2.5 times the XP of a normal mob, and an elite
// elsewhere gives twice the XP
// (https://warcraft.wiki.gg/wiki/Mob_experience#Elite_Mobs). The planner has
// no instance flag, so it uses the instance factor for every elite.
const ELITE_XP_FACTOR = 2.5;

/**
 * The XP that a quest with reward `base` at `questLevel` gives at
 * `playerLevel`, or its full XP for a null `playerLevel`. Each level above the
 * quest level past five takes away a fifth of the reward, down to a tenth
 * (https://warcraft.wiki.gg/wiki/Experience_point#Quest_XP). None at the
 * level cap.
 */
export function questXp(base: number, questLevel: number, playerLevel: number | null): number {
  if (playerLevel !== null && playerLevel >= MAX_LEVEL) return 0;
  const tenths = playerLevel === null ? 10 : Math.min(10, Math.max(1, 20 + 2 * (questLevel - playerLevel)));
  const xp = (base * tenths) / 10;
  const step = questXpStep(xp);
  return Math.floor((xp + Math.floor(step / 2)) / step) * step;
}

function questXpStep(xp: number): number {
  if (xp <= 100) return 5;
  if (xp <= 500) return 10;
  if (xp <= 1000) return 25;
  return 50;
}

/** The XP that each party member gets for a kill of solo XP `base`, after the guide's overrides. */
export function adjustedKillXp(base: number, settings: KillXpSettings = {}): number {
  const solo = settings.exact ?? Math.min(Math.round(base * (settings.multiplier ?? 1)), Number.MAX_SAFE_INTEGER);
  return Math.round(solo / (settings.party ?? 1));
}

/**
 * The XP of one kill for a solo player
 * (https://warcraft.wiki.gg/wiki/Mob_experience). The game server computes it
 * in 32-bit floats and rounds half to even. In doubles, a result can be one
 * higher or lower.
 */
export function killXp(playerLevel: number, mobLevel: number, elite: boolean): number {
  if (mobLevel <= grayLevel(playerLevel)) return 0;
  const f = Math.fround;
  const factor =
    mobLevel >= playerLevel
      ? f(1 + f(f(0.05) * Math.min(mobLevel - playerLevel, 4)))
      : f(1 - f((playerLevel - mobLevel) / zeroDifference(playerLevel)));
  const xp = f(factor * (5 * playerLevel + 45));
  return roundHalfEven(elite ? f(xp * ELITE_XP_FACTOR) : xp);
}

function zeroDifference(playerLevel: number): number {
  return ZERO_DIFFERENCE.find(([fromLevel]) => playerLevel >= fromLevel)?.[1] ?? 5;
}

function roundHalfEven(x: number): number {
  const down = Math.floor(x);
  const rest = x - down;
  return rest > 0.5 || (rest === 0.5 && down % 2 !== 0) ? down + 1 : down;
}

/** The highest mob level that gives no XP (https://warcraft.wiki.gg/wiki/Mob_experience#Con_Colors). */
export function grayLevel(playerLevel: number): number {
  if (playerLevel <= 5) return 0;
  if (playerLevel <= 39) return playerLevel - 5 - Math.floor(playerLevel / 10);
  if (playerLevel <= 59) return playerLevel - 1 - Math.floor(playerLevel / 5);
  return playerLevel - 9;
}

export function xpToNextLevel(rules: Pick<GameRules, "xpToNextLevel">, level: number): number {
  return rules.xpToNextLevel[level - 1] ?? 0;
}

// XP from level 1 that a target names, capped at level 60.
export function targetXp(rules: GameRules, target: LevelTarget): number {
  const { level } = target;
  const total = (() => {
    switch (target.kind) {
      case "level":
        return totalXp(rules, level, 0);
      case "plus":
        return totalXp(rules, level, target.xp);
      case "fraction":
        return totalXp(rules, level, Math.ceil(xpToNextLevel(rules, level) * target.fraction));
      case "minus":
        return Math.max(0, totalXp(rules, level, 0) - target.xp);
    }
  })();
  return Math.min(total, totalXp(rules, MAX_LEVEL, 0));
}

// XP from level 1 to `xp` into `level`.
export function totalXp(rules: GameRules, level: number, xp: number): number {
  let total = xp;
  for (let l = 1; l < level; l++) total += xpToNextLevel(rules, l);
  return total;
}

// The level and XP into it after `total` XP from level 1; XP stops at 60.
export function atTotal(rules: GameRules, total: number): { level: number; xp: number } {
  let level = 1;
  while (level < MAX_LEVEL && total >= xpToNextLevel(rules, level)) total -= xpToNextLevel(rules, level++);
  return { level, xp: level >= MAX_LEVEL ? 0 : total };
}

export function addXp(rules: GameRules, level: number, xp: number, amount: number) {
  const reached: number[] = [];
  if (level < MAX_LEVEL) {
    xp += amount;
    while (level < MAX_LEVEL && xp >= xpToNextLevel(rules, level)) {
      xp -= xpToNextLevel(rules, level++);
      reached.push(level);
    }
    if (level >= MAX_LEVEL) xp = 0;
  }
  return { level, xp, reached };
}
