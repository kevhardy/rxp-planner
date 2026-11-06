import type { ClassRecord, RaceRecord } from "../../packages/data-contract/model.ts";
import type { Faction } from "../../packages/data-contract/shared.ts";

export const CLASSES = ["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID"] as const;

/** Class file name from `UnitClass`, as RXP compares it. */
export type ClassName = (typeof CLASSES)[number];

/** The Classic races, by the race file name `UnitRace` returns; Undead is `Scourge`. */
export const RACES = ["Human", "Dwarf", "NightElf", "Gnome", "Orc", "Scourge", "Tauren", "Troll"] as const;

export type Race = (typeof RACES)[number];

/**
 * The two Skyborne races of the Forever client: High Order (race 95,
 * Alliance) and Windshaper (race 96, Horde). The player picks one at
 * character creation, so each has a fixed faction. `UnitRace` returns
 * `Skyborne` for both, so the names here are the planner's own.
 */
const SKYBORNE_RACES = ["HighOrder", "Windshaper"] as const;

type SkyborneRace = (typeof SKYBORNE_RACES)[number];

export type PlayableRace = Race | SkyborneRace;

export const PLAYABLE_RACES: readonly PlayableRace[] = [...RACES, ...SKYBORNE_RACES];

export const RACE_FACTION: Readonly<Record<PlayableRace, Faction>> = {
  Human: "Alliance",
  Dwarf: "Alliance",
  NightElf: "Alliance",
  Gnome: "Alliance",
  Orc: "Horde",
  Scourge: "Horde",
  Tauren: "Horde",
  Troll: "Horde",
  HighOrder: "Alliance",
  Windshaper: "Horde",
};

export type RaceClasses = Readonly<Record<PlayableRace, readonly ClassName[]>>;

export function readRaceClasses(
  ids: Readonly<Record<string, readonly number[]>>,
  races: Readonly<Record<string, RaceRecord>>,
  classes: Readonly<Record<string, ClassRecord>>,
): RaceClasses {
  const byRace: Partial<Record<PlayableRace, ClassName[]>> = {};
  for (const [raceId, classIds] of Object.entries(ids)) {
    const record = Object.hasOwn(races, raceId) ? races[raceId] : undefined;
    if (!record) throw new Error(`Race classes name unknown race ID ${raceId}.`);
    const race = playableRace(record);
    if (!race) throw new Error(`Race ${raceId} has unknown file name ${record.fileName}.`);
    if (RACE_FACTION[race] !== record.faction) throw new Error(`Race ${raceId} is ${race}, which is not ${record.faction}.`);
    byRace[race] = classIds.map((classId) => {
      const fileName = Object.hasOwn(classes, classId) ? classes[classId]!.fileName : undefined;
      if (fileName === undefined) throw new Error(`Race classes give race ID ${raceId} unknown class ID ${classId}.`);
      if (!isClassName(fileName)) throw new Error(`Class ${classId} has unknown file name ${fileName}.`);
      return fileName;
    });
  }
  const missing = PLAYABLE_RACES.filter((race) => !byRace[race]);
  if (missing.length) throw new Error(`Race classes lack ${missing.join(", ")}.`);
  return byRace as RaceClasses;
}

// `UnitRace` returns `Skyborne` for both Skyborne races, so the faction picks one.
export function playableRace({ fileName, faction }: RaceRecord): PlayableRace | undefined {
  if (fileName === "Skyborne") return faction === "Alliance" ? "HighOrder" : "Windshaper";
  return (RACES as readonly string[]).includes(fileName) ? (fileName as Race) : undefined;
}

const isClassName = (fileName: string): fileName is ClassName => (CLASSES as readonly string[]).includes(fileName);

export function raceClassOptions(race: PlayableRace, raceClasses: RaceClasses | undefined): readonly ClassName[] {
  return raceClasses?.[race] ?? CLASSES;
}
