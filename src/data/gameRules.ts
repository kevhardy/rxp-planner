import type { ProfessionRecord, RaceRecord, StandingRecord } from "../../packages/data-contract/model.ts";
import { PLAYABLE_RACES, playableRace, type PlayableRace } from "./races.ts";

export const MAX_LEVEL = 60;

export interface GameRules {
  raceBits: Readonly<Record<PlayableRace, number>>;
  startingFlightNodes: Readonly<Record<PlayableRace, readonly number[]>>;
  professions: Readonly<Record<string, ProfessionRecord>>;
  standings: readonly StandingRecord[];
  xpToNextLevel: readonly number[];
}

export type RuleRace = RaceRecord & { maskBit: number; startingFlightNodes: number[] };

export interface RuleTables {
  races: Readonly<Record<string, RuleRace>>;
  professions: Readonly<Record<string, ProfessionRecord>>;
  standings: readonly StandingRecord[];
  xpToNextLevel: readonly number[];
}

export function readGameRules({ races, professions, standings, xpToNextLevel }: RuleTables): GameRules {
  const raceBits: Partial<Record<PlayableRace, number>> = {};
  const startingFlightNodes: Partial<Record<PlayableRace, readonly number[]>> = {};
  for (const record of Object.values(races)) {
    const race = playableRace(record);
    if (!race) continue;
    raceBits[race] = 2 ** record.maskBit;
    startingFlightNodes[race] = record.startingFlightNodes;
  }
  const missing = PLAYABLE_RACES.filter((race) => raceBits[race] === undefined);
  if (missing.length) throw new Error(`The dataset's races lack ${missing.join(", ")}.`);
  if (xpToNextLevel.length !== MAX_LEVEL - 1)
    throw new Error(`The dataset's XP table ends at level ${xpToNextLevel.length + 1}, not at level ${MAX_LEVEL}.`);
  return {
    raceBits: raceBits as GameRules["raceBits"],
    startingFlightNodes: startingFlightNodes as GameRules["startingFlightNodes"],
    professions,
    standings,
    xpToNextLevel,
  };
}
