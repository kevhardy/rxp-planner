import { beforeAll, describe, expect, it } from "vitest";
import type { GameData, WorldMapData } from "../../data/index.ts";
import { terrainFixture } from "../../data/terrainFixture.ts";
import { plannerData } from "../../data/plannerFixture.ts";
import { parseGuide } from "../../guide/index.ts";
import { indexFeatures, locationGroups, searchFeatures, stepArea, stepEntities, type FeatureIndex } from "./features.ts";
import { placeFeatures } from "./terrain.ts";

let data: GameData;
let map: WorldMapData;
let index: FeatureIndex;

beforeAll(async () => {
  data = plannerData();
  map = structuredClone(terrainFixture);
  index = indexFeatures(data, map);
});

const firstStep = (body: string) => parseGuide(`#group T\n#name One\nstep\n${body}\n`).steps[0]!;

describe("indexFeatures", () => {
  it.each([
    ["quest-giver", "Quests", "questGivers", "Cook Torka", "kalimdor", 20866.9, 16082.8, "Durotar"],
    ["repeatable-quest-giver", "Repeatable quests", "questGivers", "Telf Joolam", "kalimdor", 20227.3, 16637.8, "Durotar"],
    ["ley-line", "Ley Lines", "skyborne", "Ley Line", "kalimdor", 19615.2, 17404.5, "The Barrens"],
    ["elemental-convergence", "Elemental Convergences", "skyborne", "Elemental Convergence", "kalimdor", 20966.9, 15194.6, "Durotar"],
    ["tram", "Trams", "transport", "To Ironforge", "eastern-kingdoms", 36883, 22349, "Stormwind City"],
  ] as const)("places and finds a %s marker with its dataset icon", (key, name, layer, poi, area, x, y, zone) => {
    const terrain = {
      ...map,
      categories: [{ key, name, group: key === "tram" ? "transport" : "npc", icon: "sample" }],
      icons: { sample: { file: "sample.png", x: 0, y: 0, width: 24 } },
      pois: [{ name: poi, category: key, area, x, y, side: 0, level: 0 }],
      places: [],
    } satisfies Parameters<typeof placeFeatures>[0];
    const placed = placeFeatures(terrain).pois;
    expect.soft(placed.map((p) => [p.poi.name, p.layer, p.icon])).toEqual([[poi, layer, "sample"]]);
    const found = searchFeatures(indexFeatures(data, terrain), poi.toLowerCase());
    expect(found.map((f) => [f.name, f.kind, f.layer, f.locations[0]?.area])).toEqual([[poi, name, layer, zone]]);
  });

  it("groups an entity's pins into one feature with every location, on Forever's maps", () => {
    const emissary = index.entity({ type: "npc", id: 14990 })!;
    expect(emissary.name).toBe("Defilers Emissary");
    expect(emissary.copy).toBe("Defilers Emissary (npc #14990)");
    expect(emissary.locations.map((l) => [l.area, l.label])).toEqual([
      ["Orgrimmar", "50.40, 65.80"],
      ["Thunder Bluff", "44.00, 57.40"],
      ["Undercity", "73.39, 44.20"],
    ]);
    expect(emissary.locations.every((l) => l.location && l.pois.every((p) => p.entity?.id === 14990))).toBe(true);
    expect(index.features.flatMap((f) => f.locations).filter((l) => !l.location)).toHaveLength(0);
  });

  it("lists every spot of a place labeled in several zones as one feature", () => {
    const path = searchFeatures(index, "The Talondeep Path");
    expect(path.map((f) => [f.kind, f.locations.map((l) => l.area)])).toEqual([["Landmark", ["Stonetalon Mountains", "Ashenvale"]]]);
    expect(locationGroups(path[0]!, "Ashenvale").map((g) => g.area)).toEqual(["Ashenvale", "Stonetalon Mountains"]);
    expect(index.features.filter((f) => f.place).map((f) => f.key)).toEqual([
      ...new Set(index.features.filter((f) => f.place).map((f) => f.key)),
    ]);
    expect(index.features.filter((f) => f.name === "Timbermaw Hold").map((f) => [f.kind, f.locations.length])).toEqual([["Landmark", 2]]);
  });

  it("lists an NPC's quests and services at one spot as one location that keeps each pin", () => {
    const grosk = map.pois.find((p) => p.entity?.type === "npc" && p.entity.id === 6928)!;
    const food = { ...grosk, category: "food", label: "Refreshing Spring Water" };
    const quest = { ...grosk, category: "quest-giver" };
    const served = indexFeatures(data, {
      ...map,
      categories: [
        ...map.categories,
        { key: "food", group: "npc", name: "Food & Drink", icon: "food" },
        { key: "quest-giver", group: "npc", name: "Quests", icon: "quest-giver" },
      ],
      pois: [quest, ...map.pois, food],
    });
    const feature = served.entity({ type: "npc", id: 6928 })!;
    expect(feature.locations.map((l) => [l.area, l.label, l.pois.map((p) => p.category)])).toEqual([
      ["Durotar", "51.60, 41.60", ["quest-giver", "innkeeper", "food"]],
    ]);
    expect(feature.kind).toBe("Quests");
    expect(served.feature(food)).toBe(feature);
    expect(searchFeatures(served, "refreshing spring water")).toEqual([feature]);
  });

  it("finds a pin's feature", () => {
    const grosk = map.pois.find((p) => p.entity?.type === "npc" && p.entity.id === 6928)!;
    expect(index.feature(grosk)).toBe(index.entity({ type: "npc", id: 6928 }));
  });

  it("copies plain names for places and instance entrances, and describes transport", () => {
    const zone = index.features.find((f) => f.place?.kind === "zone" && f.name === "Elwynn Forest")!;
    expect([zone.kind, zone.copy, zone.entity]).toEqual(["Zone", "Elwynn Forest", undefined]);
    const deadmines = searchFeatures(index, "Deadmines").find((f) => f.kind === "Dungeons")!;
    expect([deadmines.copy, deadmines.entity, deadmines.locations.length]).toEqual(["Deadmines", undefined, 1]);
  });

  it("offers a transport pin's departure and each route's arrival, never the route's points", () => {
    const ship = searchFeatures(index, "To Booty Bay").find((f) => f.kind === "Ships")!;
    expect(ship.copy).toBe("To Booty Bay by ship");
    expect(ship.locations.map((l) => [l.label, l.area])).toEqual([
      ["Departure", "The Barrens"],
      ["Arrival", "Stranglethorn Vale"],
    ]);
    const route = map.routes.find((r) => r.path === 241)!;
    expect(ship.locations[1]!.at).toEqual({ x: route.points.at(-1)![0], y: route.points.at(-1)![1] });
    expect(ship.locations[1]!.pois).toEqual(ship.locations[0]!.pois);
  });
});

describe("searchFeatures", () => {
  it("finds by name, names that start with the text first, and by a pin's shorter label", () => {
    const names = searchFeatures(index, "keeper").map((f) => f.name);
    expect(names).toEqual(["Keeper Bel'dugur", "Innkeeper Farley", "Innkeeper Grosk", "Innkeeper Kauth"]);
    expect(searchFeatures(index, "GROSK").map((f) => f.name)).toContain("Innkeeper Grosk");
    const gadrin = searchFeatures(index, "the spider god");
    expect(gadrin.map((f) => [f.name, f.locations[0]!.pois[0]!.label])).toEqual([["Master Gadrin", "The Spider God (Zul'Farrak)"]]);
  });
});

describe("locationGroups", () => {
  it("puts the step's area first and keeps the others in order", () => {
    const emissary = index.entity({ type: "npc", id: 14990 })!;
    expect(locationGroups(emissary, undefined).map((g) => g.area)).toEqual(["Orgrimmar", "Thunder Bluff", "Undercity"]);
    expect(locationGroups(emissary, "Undercity").map((g) => g.area)).toEqual(["Undercity", "Orgrimmar", "Thunder Bluff"]);
    expect(locationGroups(emissary, "Undercity").flatMap((g) => g.locations)).toHaveLength(3);
    expect(stepArea(data, firstStep(".goto Undercity,50,50"))).toBe("Undercity");
    expect(stepArea(data, firstStep(".accept 1"))).toBeUndefined();
  });
});

describe("stepEntities", () => {
  it("reads typed references in text and command arguments, each once, and never a name", () => {
    const step = firstStep(
      ">>Talk to Innkeeper Grosk (npc #6928) about Grosk\n.target Innkeeper Grosk\n.vendor 6928\n.collect 6948,1 >>Get Hearthstone (item #6948)\n.accept 33 >>Wolves (quest #33)\n>>Open the Crate (object #6928)",
    );
    expect(stepEntities(step)).toEqual([
      { type: "npc", id: 6928 },
      { type: "item", id: 6948 },
      { type: "object", id: 6928 },
    ]);
  });
});
