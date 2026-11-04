import { beforeAll, describe, expect, it } from "vitest";
import type { GameData } from "../../data/index.ts";
import { plannerData } from "../../data/plannerFixture.ts";
import { terrainFixture } from "../../data/terrainFixture.ts";
import { indexFeatures, type FeatureIndex } from "./features.ts";
import { searchAll, type SearchGroup, type SearchQuery } from "./search.ts";

let data: GameData;
let index: FeatureIndex;

beforeAll(() => {
  data = plannerData();
  const farley = terrainFixture.pois.find((p) => p.name === "Innkeeper Farley")!;
  index = indexFeatures(data, {
    ...terrainFixture,
    categories: [...terrainFixture.categories, { key: "quest-giver", group: "quests", name: "Quests", icon: "quest-giver" }],
    pois: [
      ...terrainFixture.pois,
      { ...farley, name: "Wolf Tamer", category: "quest-giver", entity: { type: "npc", id: 783 } },
      { ...farley, name: "Supply Crate", entity: { type: "item", id: 783 } },
    ],
  });
});

const search = (query: Partial<SearchQuery>) => names(searchAll(data, index, { text: "", ...query }));

const names = (groups: SearchGroup[] | null) =>
  groups?.map((g) => [g.title, g.results.map((r) => (r.kind === "quest" ? `${r.quest.id} ${r.quest.name}` : r.feature.name))]);

describe("searchAll", () => {
  it("lists quests first, then features by kind in the index's order, and names the map's quest givers", () => {
    expect(search({ text: "wol" })).toEqual([
      ["Quests", ["33 Wolves Across the Border"]],
      ["Quest givers", ["Wolf Tamer"]],
    ]);
    expect(search({ text: "keeper" })).toEqual([
      ["Innkeepers", ["Innkeeper Farley", "Innkeeper Grosk", "Innkeeper Kauth"]],
      ["Quest Givers", ["Keeper Bel'dugur"]],
    ]);
  });

  it("finds a quest, an NPC, and an item by a number or #ID, and a typed ID's type only", () => {
    const matches = [
      ["Quests", ["783 A Threat Within"]],
      ["Innkeepers", ["Supply Crate"]],
      ["Quest givers", ["Wolf Tamer"]],
    ];
    expect(search({ text: "#783" })).toEqual(matches);
    expect(search({ text: " 783 " })).toEqual(matches);
    expect(search({ text: "quest #783" })).toEqual([matches[0]]);
    expect(search({ text: "Wolf Tamer (npc #783)" })).toEqual([matches[2]]);
    expect(search({ text: "item 783" })).toEqual([["Innkeepers", ["Supply Crate"]]]);
  });

  it("narrows quests and features to a zone, and lists the zone's quests without a query", () => {
    expect(search({ text: "innkeeper", zoneId: 12 })).toEqual([["Innkeepers", ["Innkeeper Farley"]]]);
    expect(search({ text: "innkeeper", zoneId: 14 })).toEqual([["Innkeepers", ["Innkeeper Grosk"]]]);
    expect(search({ zoneId: 12, minLevel: 5, maxLevel: 5 })).toEqual([
      ["Quests", ["6 Bounty on Garrick Padfoot", "54 Report to Goldshire", "2158 Rest and Relaxation", "21 Skirmish at Echo Ridge"]],
    ]);
  });

  it("leaves the features out while a level is set", () => {
    expect(search({ text: "wol", minLevel: 1 })).toEqual([["Quests", ["33 Wolves Across the Border"]]]);
    expect(search({ text: "keeper", maxLevel: 60 })).toEqual([]);
  });

  it("asks for nothing without text, zone, or level", () => {
    expect(search({ text: "  " })).toBeUndefined();
  });
});
