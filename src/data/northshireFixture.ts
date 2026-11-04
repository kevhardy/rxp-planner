import { percentToWorld } from "../../packages/data-contract/geometry.ts";
import type { EntityDataFile } from "./entities.ts";
import { GameData } from "./gameData.ts";
import type { GameDataFile, QuestPoint, QuestRow } from "./model.ts";
import { MAP_BOUNDS, plannerContext, plannerFile, plannerNames, questRow } from "./plannerFixture.ts";

type Source = [id: number, name: string];
const WILLEM: Source = [823, "Deputy Willem"];
const MCBRIDE: Source = [197, "Marshal McBride"];
const EAGAN: Source = [196, "Eagan Peltskinner"];
const PAXTON: Source = [951, "Brother Paxton"];
const PESTLE: Source = [253, "William Pestle"];
const BOOK: Source = [247834, "Nibbled-On Book"];
const YOUNG_WOLF: Source = [299, "Young Wolf"];
const TIMBER_WOLF: Source = [69, "Timber Wolf"];

function at(x: number, y: number, kind: string, sourceType: string, [sourceId, sourceName]: Source): QuestPoint {
  const placed = percentToWorld([MAP_BOUNDS.get(1429)], x, y);
  if (!placed.ok) throw new Error(placed.reason);
  return { zoneId: 12, uiMapId: 1429, x, y, world: placed.world, kind, sourceType, sourceId, sourceName };
}
const give = (source: Source, x: number, y: number) => ({ startPoints: [at(x, y, "start", "npc", source)] });
const take = (source: Source, x: number, y: number) => ({ endPoints: [at(x, y, "turn-in", "npc", source)] });

const ALLIANCE: Partial<QuestRow> = { requiredRaceMask: 77, raceRequirement: "Alliance", requiredFaction: "Alliance", zoneIds: [12] };

const quests: QuestRow[] = [
  questRow(783, "A Threat Within", {
    ...ALLIANCE,
    types: ["general"],
    nextQuestInChain: 7,
    baseXp: 40,
    ...give(WILLEM, 48.2, 42.8),
    ...take(MCBRIDE, 48.8, 41.4),
  }),
  questRow(5261, "Eagan Peltskinner", {
    ...ALLIANCE,
    questLevel: 2,
    types: ["breadcrumb"],
    preQuestSingle: [783],
    nextQuestInChain: 33,
    baseXp: 85,
    ...give(WILLEM, 48.2, 42.8),
    ...take(EAGAN, 48.8, 40.2),
  }),
  questRow(33, "Wolves Across the Border", {
    ...ALLIANCE,
    questLevel: 2,
    types: ["general"],
    baseXp: 170,
    ...give(EAGAN, 48.8, 40.2),
    ...take(EAGAN, 48.8, 40.2),
    objectives: [{ index: 1, type: "item", id: 750, ids: [750], name: "Tough Wolf Meat", count: 8 }],
    objectivePoints: [at(48.6, 39.6, "item", "npc", YOUNG_WOLF), at(49, 38.8, "item", "npc", TIMBER_WOLF)],
  }),
  questRow(7, "Kobold Camp Cleanup", {
    ...ALLIANCE,
    questLevel: 2,
    types: ["general"],
    preQuestSingle: [783],
    nextQuestInChain: 15,
    baseXp: 170,
    ...give(MCBRIDE, 48.8, 41.4),
    ...take(MCBRIDE, 48.8, 41.4),
    objectives: [{ index: 1, type: "monster", id: 6, ids: [6], name: "Kobold Vermin", count: 10 }],
  }),
  questRow(18, "Brotherhood of Thieves", {
    ...ALLIANCE,
    requiredLevel: 2,
    questLevel: 4,
    types: ["general"],
    preQuestSingle: [783],
    baseXp: 355,
    ...give(WILLEM, 48.2, 42.8),
    ...take(WILLEM, 48.2, 42.8),
  }),
  questRow(60, "Kobold Candles", {
    ...ALLIANCE,
    requiredLevel: 3,
    questLevel: 7,
    types: ["general"],
    ...give(PESTLE, 43.2, 65.8),
    ...take(PESTLE, 43.2, 65.8),
  }),
  questRow(91741, "Nibbled-On Book", {
    ...ALLIANCE,
    questLevel: 2,
    types: ["general"],
    baseXp: 85,
    startPoints: [at(48.89, 36.44, "start", "item", BOOK)],
    ...take(PAXTON, 49.4, 40.4),
  }),
  questRow(15, "Investigate Echo Ridge", { ...ALLIANCE, questLevel: 3, preQuestSingle: [7], baseXp: 250, ...give(MCBRIDE, 48.8, 41.4) }),
  questRow(3100, "Simple Letter", {
    ...ALLIANCE,
    requiredRaceMask: 1,
    requiredClassMask: 1,
    classRequirement: "Warrior",
    types: ["class"],
    preQuestSingle: [7],
    baseXp: 40,
    ...give(MCBRIDE, 48.8, 41.4),
  }),
  questRow(3101, "Consecrated Letter", {
    ...ALLIANCE,
    requiredRaceMask: 1,
    requiredClassMask: 2,
    classRequirement: "Paladin",
    types: ["class"],
    preQuestSingle: [7],
    baseXp: 40,
    ...give(MCBRIDE, 48.8, 41.4),
  }),
  questRow(91745, "Mining Consultant", { ...ALLIANCE, questLevel: 3, preQuestGroup: null, baseXp: 125, ...give(PAXTON, 49.4, 40.4) }),
];

export function northshireFile(): GameDataFile {
  const file = plannerFile();
  return {
    ...file,
    quests,
    npcNames: { ...file.npcNames, "6": "Kobold Vermin" },
    droppers: { ...file.droppers, "750": [YOUNG_WOLF, TIMBER_WOLF].map(([id]) => ({ id, type: "npc" as const })) },
    npcs: { ...file.npcs, "1063": { levels: { min: 47, max: 47 }, elite: true, zoneIds: [8] } },
  };
}

export function northshireData(): GameData {
  return new GameData(northshireFile(), plannerContext);
}

export const northshireNames: EntityDataFile = {
  ...plannerNames,
  entities: {
    ...plannerNames.entities,
    quest: quests.map((q): [number, string] => [q.id, q.name]),
    npc: [...plannerNames.entities.npc, WILLEM, MCBRIDE, PAXTON, PESTLE, [1063, "Jade"]],
    item: [...plannerNames.entities.item, [750, "Tough Wolf Meat"], BOOK, [1529, "Jade"]],
  },
};
