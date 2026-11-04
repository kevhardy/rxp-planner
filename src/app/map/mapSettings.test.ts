// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSetting } from "../../storage/index.ts";
import type { ClassName } from "../../data/index.ts";
import {
  CATEGORIES,
  DEFAULT_MAP_SETTINGS,
  layerCategories,
  LAYERS,
  loadMapSettings,
  MapSettingsStore,
  readMapSettings,
  showsCategory,
  type CategoryId,
  type MapProfile,
  type MapSettings,
} from "./mapSettings.ts";

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(async () => {
  localStorage.clear();
  await saveSetting("map", {});
});

afterEach(() => vi.restoreAllMocks());

const profile = (cls: ClassName): MapProfile => ({ class: cls, faction: "Alliance" });
const shown = (cls: ClassName, settings: MapSettings = DEFAULT_MAP_SETTINGS) =>
  (Object.keys(CATEGORIES) as CategoryId[]).filter((id) => showsCategory(settings, id, profile(cls)));

const OLD_DEFAULTS = {
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

describe("map settings", () => {
  it("shows every character quest markers, repair, inns, flight masters, and its own trainer, with ammunition and reagents by class", () => {
    const always = [
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
      "flight-master",
      "innkeeper",
      "repair",
    ];
    const table: [ClassName, ammunition: boolean, reagents: boolean][] = [
      ["DRUID", false, true],
      ["HUNTER", true, false],
      ["MAGE", false, true],
      ["PALADIN", false, true],
      ["PRIEST", false, true],
      ["ROGUE", true, true],
      ["SHAMAN", false, true],
      ["WARLOCK", false, true],
      ["WARRIOR", true, false],
    ];
    for (const [cls, ammunition, reagents] of table) {
      const expected = [
        ...always,
        `class-trainer-${cls.toLowerCase()}`,
        ...(ammunition ? ["ammunition"] : []),
        ...(reagents ? ["reagents"] : []),
      ];
      expect(new Set(shown(cls)), cls).toEqual(new Set(expected));
    }
  });

  it("shows every class's trainers with all classes on, unless the user turned one off", () => {
    const settings = { ...DEFAULT_MAP_SETTINGS, allClasses: true, categories: { "class-trainer-mage": false } };
    expect(shown("WARRIOR", settings).filter((id) => CATEGORIES[id] === "trainers")).toEqual(
      layerCategories("trainers").filter((id) => id !== "class-trainer-mage"),
    );
  });

  it("keeps the user's choices when the class changes, and the profile decides the rest", () => {
    const settings = { ...DEFAULT_MAP_SETTINGS, categories: { ammunition: true, "class-trainer-warrior": true, innkeeper: false } };
    const mage = shown("MAGE", settings);
    expect(mage).toEqual(expect.arrayContaining(["ammunition", "class-trainer-warrior", "class-trainer-mage", "reagents"]));
    expect(mage).not.toContain("innkeeper");
    expect(shown("HUNTER", settings)).not.toContain("class-trainer-mage");
  });

  it("keeps saved choices and drops unknown fields, categories, and values", () => {
    const saved = {
      style: "parchment",
      coverage: false,
      categories: {
        banker: true,
        guide: false,
        "quest-giver": true,
        "repeatable-quest-giver": true,
        "ley-line": true,
        "elemental-convergence": true,
        tram: false,
        herbs: true,
        zones: "yes",
      },
      allFactions: true,
      allClasses: 1,
    };
    expect(readMapSettings(saved)).toEqual({
      ...DEFAULT_MAP_SETTINGS,
      categories: {
        banker: true,
        guide: false,
        "quest-giver": true,
        "repeatable-quest-giver": true,
        "ley-line": true,
        "elemental-convergence": true,
        tram: false,
      },
      allFactions: true,
    });
    expect(readMapSettings(null)).toEqual(DEFAULT_MAP_SETTINGS);
  });

  it("keeps a saved choice for each category ID that browsers already saved", () => {
    const savedIds = [
      "guide",
      "objective-spawns",
      "references",
      "quest-available",
      "quest-turn-in",
      "zones",
      "zone-borders",
      "landmarks",
      "dungeon",
      "raid",
      "ship",
      "zeppelin",
      "tram",
      "routes",
      "dungeon-quest-giver",
      "quest-giver",
      "repeatable-quest-giver",
      "ley-line",
      "elemental-convergence",
      "auctioneer",
      "banker",
      "battlemaster",
      "flight-master",
      "graveyard",
      "innkeeper",
      "stable-master",
      "repair",
      "food",
      "general",
      "trade",
      "class-trainer-druid",
      "class-trainer-hunter",
      "class-trainer-mage",
      "class-trainer-paladin",
      "class-trainer-priest",
      "class-trainer-rogue",
      "class-trainer-shaman",
      "class-trainer-warlock",
      "class-trainer-warrior",
      "ammunition",
      "library-book",
      "reagents",
      "weapon-trainer",
      "rare",
      "rare-elite",
    ];
    const categories = Object.fromEntries(savedIds.map((id) => [id, false]));
    expect(readMapSettings({ categories }).categories).toEqual(categories);
  });

  it("starts with the legend closed, and a saved open legend stays open", () => {
    expect(readMapSettings(null).legendOpen).toBe(false);
    expect(readMapSettings({ legendOpen: true }).legendOpen).toBe(true);
  });

  it("reads each old layer as a choice for its categories only where it differed from the layer's default", () => {
    expect(readMapSettings({ layers: OLD_DEFAULTS })).toEqual(DEFAULT_MAP_SETTINGS);
    for (const [layer, on] of Object.entries(OLD_DEFAULTS)) {
      if (layer === "questGivers") continue;
      const ids = layerCategories(layer as keyof typeof OLD_DEFAULTS);
      expect(ids.length, layer).toBeGreaterThan(0);
      const { categories } = readMapSettings({ layers: { ...OLD_DEFAULTS, [layer]: !on } });
      expect(categories, layer).toEqual(Object.fromEntries(ids.map((id) => [id, !on])));
    }
    expect(readMapSettings({ layers: { services: true, trainers: "yes" } }).categories).toEqual(
      Object.fromEntries(layerCategories("services").map((id) => [id, true])),
    );
    expect(LAYERS.filter((l) => !(l.id in OLD_DEFAULTS)).map((l) => l.id)).toEqual(["quests", "zoneBorders", "skyborne", "vendors"]);
  });

  it("keeps legacy quest giver choices limited to dungeons and applies hidden transport to trams", () => {
    const settings = readMapSettings({ layers: { questGivers: true, transport: false } });
    expect(settings.categories).toEqual({ "dungeon-quest-giver": true, ship: false, zeppelin: false, tram: false, routes: false });
    expect(shown("WARRIOR", settings).filter((id) => layerCategories("questGivers").includes(id))).toEqual(["dungeon-quest-giver"]);
    expect(readMapSettings({ layers: { questGivers: false } }).categories).toEqual({});
  });

  it("reads settings saved before step states and quest markers as their defaults", () => {
    const old = { categories: { guide: true }, allFactions: false, allClasses: false, legendOpen: true };
    const read = readMapSettings(old);
    expect(read).toMatchObject({ previousSteps: "hidden", upcomingSteps: "dimmed", allQuests: false });
    expect(shown("WARRIOR", read)).toEqual(expect.arrayContaining(["quest-available", "quest-turn-in"]));
    expect(readMapSettings({ previousSteps: "shown", upcomingSteps: "faded" })).toMatchObject({
      previousSteps: "shown",
      upcomingSteps: "dimmed",
    });
  });

  it("resets to the profile's defaults and keeps the legend open", () => {
    const store = new MapSettingsStore({
      ...DEFAULT_MAP_SETTINGS,
      legendOpen: true,
      allFactions: true,
      allClasses: true,
      allQuests: true,
      previousSteps: "shown",
      upcomingSteps: "hidden",
    });
    store.setCategories(layerCategories("services"), true);
    expect(shown("WARRIOR", store.getState())).toContain("banker");
    store.resetLegend();
    expect(store.getState()).toEqual({ ...DEFAULT_MAP_SETTINGS, legendOpen: true });
  });

  it("loads the saved settings and saves changes for the next visit", async () => {
    await saveSetting("map", { legendOpen: true });
    const store = new MapSettingsStore(await loadMapSettings());
    expect(store.getState()).toEqual({ ...DEFAULT_MAP_SETTINGS, legendOpen: true });

    store.setCategories(["innkeeper", "banker"], false);
    store.update({ allClasses: true });
    await settled();
    expect(await loadMapSettings()).toEqual({
      ...DEFAULT_MAP_SETTINGS,
      categories: { innkeeper: false, banker: false },
      allClasses: true,
      legendOpen: true,
    });
  });

  it("writes the unsaved copy of a change at its key, and loads its valid fields over the saved settings", async () => {
    new MapSettingsStore(DEFAULT_MAP_SETTINGS).update({ allFactions: true });
    expect(JSON.parse(localStorage.getItem("restedxp-planner:unsaved-map")!)).toMatchObject({ allFactions: true });
    await vi.waitFor(() => expect(localStorage.getItem("restedxp-planner:unsaved-map")).toBeNull());

    await saveSetting("map", { allFactions: true, categories: { banker: false } });
    localStorage.setItem("restedxp-planner:unsaved-map", '{"allFactions":"yes","categories":{"banker":true}}');
    const settings = await loadMapSettings();
    expect([settings.allFactions, settings.categories]).toEqual([false, { banker: true }]);
  });
});
