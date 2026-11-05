import { useMemo, useSyncExternalStore } from "react";
import type { Faction } from "../../rules/index.ts";
import type { ClassName } from "../../data/index.ts";
import { useStores } from "../context.ts";
import { useFaction, usePreviewSettings } from "../preview/settings.ts";
import { loadSaved, saveSaved, type SavedSetting } from "../savedSetting.ts";

export const LAYERS = [
  { id: "guide", name: "Guide points" },
  { id: "references", name: "Step references" },
  { id: "quests", name: "Quests" },
  { id: "zones", name: "Zone and capital labels" },
  { id: "zoneBorders", name: "Zone borders" },
  { id: "landmarks", name: "Landmark labels" },
  { id: "instances", name: "Dungeons and raids" },
  { id: "transport", name: "Transport" },
  { id: "questGivers", name: "Quest givers" },
  { id: "skyborne", name: "Skyborne" },
  { id: "services", name: "Services" },
  { id: "vendors", name: "Repair and vendors" },
  { id: "trainers", name: "Class trainers" },
  { id: "supplies", name: "Training and supplies" },
  { id: "rares", name: "Rare NPCs" },
] as const;

export type LayerId = (typeof LAYERS)[number]["id"];

export const CATEGORIES = {
  guide: "guide",
  "objective-spawns": "guide",
  references: "references",
  "quest-available": "quests",
  "quest-turn-in": "quests",
  zones: "zones",
  "zone-borders": "zoneBorders",
  landmarks: "landmarks",
  dungeon: "instances",
  raid: "instances",
  ship: "transport",
  zeppelin: "transport",
  tram: "transport",
  routes: "transport",
  "dungeon-quest-giver": "questGivers",
  "quest-giver": "questGivers",
  "repeatable-quest-giver": "questGivers",
  "ley-line": "skyborne",
  "elemental-convergence": "skyborne",
  auctioneer: "services",
  banker: "services",
  battlemaster: "services",
  "flight-master": "services",
  graveyard: "services",
  innkeeper: "services",
  "stable-master": "services",
  repair: "vendors",
  food: "vendors",
  general: "vendors",
  trade: "vendors",
  "class-trainer-druid": "trainers",
  "class-trainer-hunter": "trainers",
  "class-trainer-mage": "trainers",
  "class-trainer-paladin": "trainers",
  "class-trainer-priest": "trainers",
  "class-trainer-rogue": "trainers",
  "class-trainer-shaman": "trainers",
  "class-trainer-warlock": "trainers",
  "class-trainer-warrior": "trainers",
  ammunition: "supplies",
  "library-book": "supplies",
  reagents: "supplies",
  "weapon-trainer": "supplies",
  rare: "rares",
  "rare-elite": "rares",
} as const satisfies Record<string, LayerId>;

export type CategoryId = keyof typeof CATEGORIES;

export function isCategoryId(key: string): key is CategoryId {
  return Object.hasOwn(CATEGORIES, key);
}

const DOT_LAYERS: ReadonlySet<LayerId> = new Set<LayerId>(["services", "vendors", "trainers", "supplies"]);

/**
 * Whether an unmarked point of this category draws as its layer's dot where
 * the map is too crowded for sprites. A flight master is a travel point, so it
 * keeps its sprite like the transport layer.
 */
export const drawsAsDot = (layer: LayerId, category: string): boolean => DOT_LAYERS.has(layer) && category !== "flight-master";

export function layerCategories(layer: LayerId): CategoryId[] {
  return (Object.keys(CATEGORIES) as CategoryId[]).filter((id) => CATEGORIES[id] === layer);
}

export interface MapProfile {
  class: ClassName;
  faction: Faction;
}

export function useMapProfile(): MapProfile {
  const cls = usePreviewSettings().class;
  const faction = useFaction();
  return useMemo(() => ({ class: cls, faction }), [cls, faction]);
}

const ON = new Set<CategoryId>([
  "guide",
  "objective-spawns",
  "references",
  "quest-available",
  "quest-turn-in",
  "zones",
  "dungeon",
  "raid",
  "ship",
  "zeppelin",
  "tram",
  "routes",
  "repair",
  "innkeeper",
  "flight-master",
]);

const SUPPLIES: Readonly<Record<ClassName, { ammunition: boolean; reagents: boolean }>> = {
  DRUID: { ammunition: false, reagents: true },
  HUNTER: { ammunition: true, reagents: false },
  MAGE: { ammunition: false, reagents: true },
  PALADIN: { ammunition: false, reagents: true },
  PRIEST: { ammunition: false, reagents: true },
  ROGUE: { ammunition: true, reagents: true },
  SHAMAN: { ammunition: false, reagents: true },
  WARLOCK: { ammunition: false, reagents: true },
  WARRIOR: { ammunition: true, reagents: false },
};

export type StepShow = "hidden" | "dimmed" | "shown";

export const STEP_SHOWS: readonly StepShow[] = ["hidden", "dimmed", "shown"];

const isStepShow = (value: unknown): value is StepShow => STEP_SHOWS.includes(value as StepShow);

export interface MapSettings {
  categories: Readonly<Partial<Record<CategoryId, boolean>>>;
  allFactions: boolean;
  allClasses: boolean;
  allQuests: boolean;
  legendOpen: boolean;
  previousSteps: StepShow;
  upcomingSteps: StepShow;
}

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  categories: {},
  allFactions: false,
  allClasses: false,
  allQuests: false,
  legendOpen: false,
  previousSteps: "hidden",
  upcomingSteps: "dimmed",
};

export function showsCategory(settings: MapSettings, category: CategoryId, profile: MapProfile): boolean {
  const chosen = settings.categories[category];
  if (chosen !== undefined) return chosen;
  if (category === "ammunition" || category === "reagents") return SUPPLIES[profile.class][category];
  if (category.startsWith("class-trainer-")) return settings.allClasses || category === `class-trainer-${profile.class.toLowerCase()}`;
  return ON.has(category);
}

const OLD_LAYER_DEFAULTS: Readonly<Partial<Record<LayerId, boolean>>> = {
  guide: true,
  references: true,
  zones: true,
  landmarks: false,
  instances: true,
  transport: true,
  questGivers: false,
  services: false,
  trainers: false,
  supplies: false,
  rares: false,
};

export function readMapSettings(saved: unknown): MapSettings {
  const s = record(saved);
  const categories: Partial<Record<CategoryId, boolean>> = {};
  if (s.categories === undefined) {
    const layers = record(s.layers);
    for (const [layer, old] of Object.entries(OLD_LAYER_DEFAULTS) as [LayerId, boolean][]) {
      const on = layers[layer];
      if (typeof on === "boolean" && on !== old) {
        const ids: CategoryId[] = layer === "questGivers" ? ["dungeon-quest-giver"] : layerCategories(layer);
        for (const id of ids) categories[id] = on;
      }
    }
  } else {
    for (const [id, on] of Object.entries(record(s.categories))) if (isCategoryId(id) && typeof on === "boolean") categories[id] = on;
  }
  return {
    categories,
    allFactions: s.allFactions === true,
    allClasses: s.allClasses === true,
    allQuests: s.allQuests === true,
    legendOpen: s.legendOpen === true,
    previousSteps: isStepShow(s.previousSteps) ? s.previousSteps : DEFAULT_MAP_SETTINGS.previousSteps,
    upcomingSteps: isStepShow(s.upcomingSteps) ? s.upcomingSteps : DEFAULT_MAP_SETTINGS.upcomingSteps,
  };
}

const record = (value: unknown) => (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;

const SAVED: SavedSetting<MapSettings> = {
  key: "map",
  unsavedKey: "restedxp-planner:unsaved-map",
  read: readMapSettings,
  defaults: DEFAULT_MAP_SETTINGS,
  name: "the map settings",
};

export function loadMapSettings(): Promise<MapSettings> {
  return loadSaved(SAVED);
}

export class MapSettingsStore {
  #settings: MapSettings;
  readonly #listeners = new Set<() => void>();

  constructor(settings: MapSettings) {
    this.#settings = settings;
  }

  getState = (): MapSettings => this.#settings;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  update(change: Partial<MapSettings>): void {
    this.#publish({ ...this.#settings, ...change });
    saveSaved(SAVED, this.#settings);
  }

  setCategories(ids: readonly CategoryId[], on: boolean): void {
    this.update({ categories: { ...this.#settings.categories, ...Object.fromEntries(ids.map((id) => [id, on])) } });
  }

  resetLegend(): void {
    const { categories, allFactions, allClasses, allQuests, previousSteps, upcomingSteps } = DEFAULT_MAP_SETTINGS;
    this.update({ categories, allFactions, allClasses, allQuests, previousSteps, upcomingSteps });
  }

  #publish(settings: MapSettings): void {
    this.#settings = settings;
    for (const listener of this.#listeners) listener();
  }
}

export function useMapSettingsStore(): MapSettingsStore {
  return useStores().map;
}

export function useMapSettings(): MapSettings {
  const store = useMapSettingsStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}
