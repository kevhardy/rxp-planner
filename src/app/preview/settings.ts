import { useSyncExternalStore } from "react";
import { createProfile, resolveStartLevel, type Faction, type Profile, type StartLevel } from "../../rules/index.ts";
import { MAX_LEVEL, type GameRules } from "../../data/gameRules.ts";
import {
  CLASSES,
  PLAYABLE_RACES,
  RACE_FACTION,
  raceClassOptions,
  type ClassName,
  type GameData,
  type PlayableRace,
  type RaceClasses,
} from "../../data/index.ts";
import { guideMeta, type LevelRange } from "../../rules/registration.ts";
import { xpToNextLevel } from "../../rules/xp.ts";
import { useStores } from "../context.ts";
import { loadSaved, saveSaved, type SavedSetting } from "../savedSetting.ts";
import type { GuideRecord } from "../../guide/index.ts";
import type { EditorStore } from "../store.ts";

export interface PreviewSettings {
  race: PlayableRace;
  class: ClassName;
  startLevel: StartLevel;
  soloSelfFound: boolean;
  /** The XP rate `#xprate` checks; null uses RXP's default, 1. */
  xpRate: number | null;
  start: string | null;
  showAll: boolean;
}

export const DEFAULT_SETTINGS: PreviewSettings = {
  race: "Human",
  class: "WARRIOR",
  startLevel: "auto",
  soloSelfFound: false,
  xpRate: null,
  start: null,
  showAll: false,
};

export { MAX_LEVEL };

export function profileOf(settings: PreviewSettings, range: LevelRange | undefined): Profile {
  const character: Parameters<typeof createProfile>[0] = {
    race: settings.race,
    class: settings.class,
    level: resolveStartLevel(settings.startLevel, range).level,
    soloSelfFound: settings.soloSelfFound,
  };
  if (settings.xpRate !== null) character.xpRate = settings.xpRate;
  return createProfile(character);
}

export function guideProfile(settings: PreviewSettings): (guide: GuideRecord) => Profile {
  return (guide) => profileOf(settings, guideMeta(guide).range);
}

export function maxStartXp(rules: GameRules, level: number): number {
  return Math.max(xpToNextLevel(rules, level) - 1, 0);
}

export function legalClass(race: PlayableRace, cls: ClassName, raceClasses: RaceClasses | undefined): ClassName {
  const classes = raceClassOptions(race, raceClasses);
  return classes.includes(cls) ? cls : classes[0]!;
}

export function readSettings(saved: unknown): PreviewSettings {
  const s = (typeof saved === "object" && saved !== null ? saved : {}) as Record<string, unknown>;
  const pick = <K extends keyof PreviewSettings>(key: K, valid: (v: unknown) => boolean): PreviewSettings[K] =>
    valid(s[key]) ? (s[key] as PreviewSettings[K]) : DEFAULT_SETTINGS[key];
  const bool = (v: unknown) => typeof v === "boolean";
  const race = pick("race", (v) => (PLAYABLE_RACES as readonly unknown[]).includes(v));
  return {
    race,
    class: pick("class", (v) => (CLASSES as readonly unknown[]).includes(v)),
    startLevel: "startLevel" in s ? readStartLevel(s.startLevel) : legacyStartLevel(s.level, s.xp),
    soloSelfFound: pick("soloSelfFound", bool),
    xpRate: pick("xpRate", (v) => v === null || (typeof v === "number" && v > 0)),
    start: pick("start", (v) => v === null || typeof v === "string"),
    showAll: pick("showAll", bool),
  };
}

const validLevel = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_LEVEL;
const validXp = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function readStartLevel(saved: unknown): StartLevel {
  if (typeof saved !== "object" || saved === null) return "auto";
  const { level, xp } = saved as Record<string, unknown>;
  return validLevel(level) ? { level, xp: validXp(xp) ? xp : 0 } : "auto";
}

function legacyStartLevel(savedLevel: unknown, savedXp: unknown): StartLevel {
  const level = validLevel(savedLevel) ? savedLevel : 1;
  const xp = validXp(savedXp) ? savedXp : 0;
  return level === 1 && xp === 0 ? "auto" : { level, xp };
}

const SAVED: SavedSetting<PreviewSettings> = {
  key: "preview",
  unsavedKey: "restedxp-planner:unsaved-preview",
  read: readSettings,
  defaults: DEFAULT_SETTINGS,
  name: "the preview settings",
};

export function loadPreviewSettings(): Promise<PreviewSettings> {
  return loadSaved(SAVED);
}

export class SettingsStore {
  #settings: PreviewSettings;
  readonly #listeners = new Set<() => void>();
  readonly #editor: EditorStore;
  #raceClasses: RaceClasses | undefined;
  #rules: GameRules | undefined;

  constructor(editor: EditorStore, settings: PreviewSettings) {
    this.#editor = editor;
    const start = settings.start && editor.savedGuide(settings.start);
    this.#settings = start ? { ...settings, start } : settings;
    editor.setProfile(guideProfile(settings));
  }

  getState = (): PreviewSettings => this.#settings;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  update(change: Partial<PreviewSettings>): void {
    const next = { ...this.#settings, ...change };
    this.#publish(this.#legal(next));
    saveSaved(SAVED, this.#settings);
  }

  setGame(game: Pick<GameData, "raceClasses" | "rules"> | undefined): void {
    this.#raceClasses = game?.raceClasses;
    this.#rules = game?.rules;
    const { startLevel } = this.#settings;
    let next = this.#legal(this.#settings);
    if (next.startLevel !== startLevel && startLevel !== "auto") next = { ...next, startLevel: { ...startLevel, xp: 0 } };
    if (next.class !== this.#settings.class || next.startLevel !== startLevel) this.#publish(next);
  }

  #legal(settings: PreviewSettings): PreviewSettings {
    const legal = { ...settings, class: legalClass(settings.race, settings.class, this.#raceClasses) };
    const start = settings.startLevel;
    if (start === "auto" || !this.#rules) return legal;
    const xp = Math.min(start.xp, maxStartXp(this.#rules, start.level));
    return xp === start.xp ? legal : { ...legal, startLevel: { ...start, xp } };
  }

  #publish(settings: PreviewSettings): void {
    this.#settings = settings;
    this.#editor.setProfile(guideProfile(settings));
    for (const listener of this.#listeners) listener();
  }
}

export function useSettingsStore(): SettingsStore {
  return useStores().preview;
}

export function usePreviewSettings(): PreviewSettings {
  const store = useSettingsStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}

export function useFaction(): Faction {
  return RACE_FACTION[usePreviewSettings().race];
}
