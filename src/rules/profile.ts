import type { Faction } from "../../packages/data-contract/shared.ts";
export type { Faction } from "../../packages/data-contract/shared.ts";
import { RACE_FACTION, type ClassName, type PlayableRace } from "../data/races.ts";
// The character and settings RXP's guide checks read.
//
// Defaults follow RXP on a Classic Forever (`camelot`) client, where
// `addon.game` is `FOREVER` (the client version check in RXPGuides.lua); the
// season and phase checks below do not read it. RXP sets the season to
// `addon.GetSeason()`: the realm's season when it is 1 (Season of Mastery) or
// 2 (Season of Discovery) and the realm is not hardcore, otherwise 0
// (RXPGuides.lua). It sets the phase to 1 on Anniversary realms
// (seasons 11 and 12) and to 6 elsewhere, and to 6 in Season of Discovery
// (`addon.settings:DetectXPRate` in SettingsPanel.lua, `addon:OnInitialize`
// in RXPGuides.lua). RXP has no Forever-specific season code, so a Forever
// realm gets season 0 and phase 6 unless it reports an Anniversary season.
// Group quests, solo self-found, and dungeons start off
// (`settingsDBDefaults` in SettingsPanel.lua).
//
// Hardcore mode is always off: RXP clears it on load unless `addon.game` is
// `CLASSIC` (`addon:OnInitialize` in RXPGuides.lua), its toggle acts only on
// `CLASSIC` (`addon.HardcoreToggle` in RXPGuides.lua), and loading a guide
// treats it as `#softcore` outside `CLASSIC` (`addon:LoadGuide` in
// GuideWindow.lua). So `HardcoreCheck` in RXPGuides.lua hides `#hardcore`
// steps and shows `#softcore` ones. The realm check reads the client instead,
// so it applies on Forever too.

/** The race file name `UnitRace` returns, which race tokens in conditions compare against. */
export function raceToken(race: PlayableRace): string {
  return race === "HighOrder" || race === "Windshaper" ? "Skyborne" : race;
}

export interface Profile {
  faction: Faction;
  race: PlayableRace;
  class: ClassName;
  sex: "male" | "female";
  /** Player level. Numeric condition tokens and `#maxlevel` compare against it. */
  level: number;
  /** The realm runs hardcore rules: shows `#hardcoreserver` steps and hides `#softcoreserver` ones. */
  hardcoreRealm: boolean;
  /** Solo self-found: shows `#ssf` steps and hides `#ah` ones. */
  soloSelfFound: boolean;
  /** RXP's "Show group quests": shows `.group` steps and hides `.solo` ones. */
  groupQuests: boolean;
  /** Dungeon tags chosen in RXP's settings, such as `SM`; see `DUNGEONS`. */
  dungeons: readonly string[];
  /** 0 for Era and Forever, 1 for Season of Mastery, 2 for Season of Discovery. */
  season: 0 | 1 | 2;
  /** Content phase, 1 to 6. */
  phase: number;
  /** Client locale, such as `enUS`; condition tokens can name it. */
  locale: string;
  /** The XP rate RXP's settings would hold; unset means RXP's default, 1. See `xpRate`. */
  xpRate?: number;
}

/** A profile with RXP's Forever defaults for the given character. */
export function createProfile(character: Pick<Profile, "race" | "class"> & Partial<Profile>): Profile {
  return {
    faction: RACE_FACTION[character.race],
    sex: "male",
    level: 1,
    hardcoreRealm: false,
    soloSelfFound: false,
    groupQuests: false,
    dungeons: [],
    season: 0,
    phase: 6,
    locale: "enUS",
    ...character,
  };
}

/**
 * The XP rate `#xprate` checks against: the profile's rate, else 1. Outside
 * `CLASSIC`, Forever included, RXP reads the saved rate, which defaults to 1
 * (`XpRateCheck` in RXPGuides.lua, `settingsDBDefaults` in SettingsPanel.lua).
 * Only `CLASSIC` derives the rate from the season and hides the rate slider
 * (`addon.settings:CreateAceOptionsPanel`). Season detection on Classic
 * clients never sets the rate (`addon.settings:DetectXPRate`).
 */
export function xpRate(profile: Profile): number {
  return profile.xpRate ?? 1;
}

/**
 * The XP rates RXP's slider lets the player set on `game`, an `addon.game`
 * value: 1 to 5 on `RETAIL` and 1 to 2 elsewhere, in steps of 0.05, and none
 * on `CLASSIC`, which hides the slider (`addon.settings:CreateAceOptionsPanel`
 * in SettingsPanel.lua). The slider limits only a rate the player sets
 * (AceConfigDialog-3.0.lua): a saved rate outside it stays, and `#xprate`
 * reads it as is.
 */
export function xpRateOptions(game: string): number[] {
  if (game === "CLASSIC") return [];
  const max = game === "RETAIL" ? 5 : 2;
  // Counted in hundredths, so each rate is the number its literal gives.
  return Array.from({ length: (max - 1) * 20 + 1 }, (_, i) => (100 + i * 5) / 100);
}

/**
 * Dungeon tags and their area IDs from RXPGuides DB/forever/db.lua.
 * `.dungeon` accepts a tag, an alternate name, or an area ID.
 */
export const DUNGEONS: ReadonlyMap<string, number> = new Map([
  ["RFC", 2437],
  ["DM", 1581],
  ["WC", 718],
  ["SFK", 209],
  ["BFD", 719],
  ["STOCKS", 717],
  ["GNOMER", 133],
  ["RFK", 491],
  ["SM", 796],
  ["RFD", 722],
  ["ULDA", 1337],
  ["ZF", 978],
  ["MARA", 2100],
  ["ST", 1417],
  ["BRD", 1584],
  ["DME", 2557],
  ["SCHOLO", 2057],
  ["STRAT", 2017],
  ["LBRS", 1583],
  ["HOT", 16919],
  ["ROL", 153],
  ["ES", 16732],
  ["COD", 16544],
  ["TDC", 17853],
  ["KS", 17780],
  ["AP", 2079],
  ["BH", 1216],
  ["TST", 16985],
]);

const DUNGEON_ALIASES: ReadonlyMap<string, string> = new Map([
  ["DEADMINES", "DM"],
  ["VC", "DM"],
  ["STOCKADES", "STOCKS"],
  ["TEMPLE OF ATAL'HAKKAR", "ST"],
  ["DMW", "DME"],
  ["DMN", "DME"],
  ["BMH", "BH"],
  ["SHT", "TST"],
  ["SH", "TDC"],
  ["DC", "TDC"],
  ["ESW", "ES"],
  ["AI", "AP"],
  ...[...DUNGEONS].map(([tag, area]) => [String(area), tag] as const),
]);

/** The dungeon tag RXP's `GetDungeonName` finds for a `.dungeon` argument. */
export function dungeonTag(instance: string): string | undefined {
  const upper = instance.toUpperCase();
  return DUNGEONS.has(upper) ? upper : DUNGEON_ALIASES.get(upper);
}
