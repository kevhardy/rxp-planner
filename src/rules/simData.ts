import { npcSpawns, type EntityIndex, type GameData, type Quest, type QuestPoint, type WorldLocation } from "../data/index.ts";
import { completeRows, pageOrder } from "./completeRows.ts";
import { opportunityData, type OpportunityData } from "./opportunities.ts";
import type { Faction } from "./profile.ts";
import type { SimData, SimNumberedObjective, SimQuest, SimTextObjective } from "./simulate.ts";
import type { QuestInfo, QuestLookup } from "./validate.ts";

const TURN_IN_ONLY = new Set(["repeatable", "city-donation", "reputation-turnin"]);

const EVENT = new Set(["seasonal", "war-effort", "invasion"]);

function acceptsOnTurnIn(quest: Pick<Quest, "types">): boolean {
  return quest.types.some((t) => TURN_IN_ONLY.has(t));
}

export function simData(data: GameData, entities: EntityIndex, faction: Faction): SimData {
  const locate = (points: readonly QuestPoint[]): WorldLocation[] => points.map((point) => point.world);
  const npcsOf = (points: readonly QuestPoint[]): number[] => [
    ...new Set(points.flatMap((point) => (point.sourceType === "npc" && point.sourceId !== undefined ? [point.sourceId] : []))),
  ];
  return {
    quest(id) {
      const quest = data.quest(id, faction);
      if (!quest) return undefined;
      const rows = completeRows(quest);
      return {
        name: quest.name,
        preAny: quest.preQuestSingle,
        preAll: quest.preQuestGroup,
        acceptOnTurnIn: acceptsOnTurnIn(quest),
        level: quest.questLevel,
        requiredLevel: quest.requiredLevel,
        baseXp: quest.baseXp,
        zoneIds: quest.zoneIds,
        givers: locate(quest.startPoints),
        enders: locate(quest.endPoints),
        giverNpcs: npcsOf(quest.startPoints),
        enderNpcs: npcsOf(quest.endPoints),
        objectives: pageOrder(rows)
          ? rows.map(({ objective: t }): SimTextObjective => ({
              kind: "text",
              name: t.name,
              count: t.count ?? null,
              need: t.need,
              ...(t.link && { link: t.link }),
            }))
          : rows.map(({ objective: o }): SimNumberedObjective => ({
              index: o.index ?? null,
              kind: o.type === "monster" || o.type === "item" ? o.type : "other",
              ids: o.ids,
              count: o.count ?? null,
              name: o.name,
              ...(o.need && { need: o.need }),
            })),
        requiredRaceMask: quest.requiredRaceMask,
        requiredClassMask: quest.requiredClassMask,
        requiredFaction: quest.requiredFaction ?? null,
        nextQuestInChain: quest.nextQuestInChain,
        exclusiveTo: quest.exclusiveTo ?? [],
        parentQuest: quest.parentQuest ?? 0,
        requiredMaxLevel: quest.requiredMaxLevel ?? 0,
        requiredSkill: quest.requiredSkill ?? null,
        requiredMinRep: quest.requiredMinRep ?? null,
        requiredMaxRep: quest.requiredMaxRep ?? null,
        requiredSpecialization: quest.requiredSpecialization ?? 0,
        event: quest.types.some((t) => EVENT.has(t)),
      } satisfies SimQuest;
    },
    npc(id) {
      const npc = data.npc(id, faction);
      return npc && { levels: npc.levels ?? null, elite: npc.elite ?? null, zoneIds: npc.zoneIds ?? [] };
    },
    item(id) {
      const droppers = data.droppers(id, faction),
        sellers = data.sellers(id);
      if (!droppers && !sellers) return undefined;
      const eligible = (droppers ?? []).filter((d) => !d.objectiveExcluded),
        npcs = eligible
          .filter((d) => d.type === "npc")
          .map((d) => ({
            id: d.id,
            ...(d.chance !== undefined && { chance: d.chance }),
            ...(d.guaranteed && { guaranteed: d.guaranteed }),
          }));
      return { droppers: npcs, objectsOnly: !npcs.length && !!eligible.length, sold: !!sellers?.length };
    },
    entityByName: (name) => entities.entityByName(name),
    flights: data.flights,
    uiMapNamed: (token) => data.uiMapNamed(token),
    rules: data.rules,
    locateGoto(args) {
      const located = data.locateGoto(args);
      if (!located.ok) return undefined;
      return data.continentByUiMapId(located.uiMapId) ? located.world : { ...located.world, uiMapId: located.uiMapId };
    },
    spiritHealer(from) {
      const at = data.spiritHealer(from);
      if (!at) return undefined;
      const uiMapId = data.locate(at)?.uiMapId;
      return { ...at, ...(uiMapId !== undefined && { uiMapId }) };
    },
    spawns: npcSpawns(data, faction),
    npcsWithSpawns: () => data.npcsWithSpawns(),
    zoneAt: (at) => data.zoneAt(at)?.uiMapId,
  };
}

export function questLookup(data: GameData, faction: Faction): QuestLookup {
  return (id) => {
    const quest = data.quest(id, faction);
    if (!quest || quest.preQuestSingle === null || quest.preQuestGroup === null) return undefined;
    const info: QuestInfo = {
      name: quest.name,
      preAny: quest.preQuestSingle,
      preAll: quest.preQuestGroup,
      exclusiveTo: quest.exclusiveTo ?? [],
    };
    if (acceptsOnTurnIn(quest)) info.acceptOnTurnIn = true;
    return info;
  };
}

export interface FactionData {
  sim: SimData;
  lookup: QuestLookup;
  opportunities: OpportunityData;
}

const factions = new WeakMap<GameData, WeakMap<EntityIndex, Map<Faction, FactionData>>>();

/** The same object while `game`, `entities`, and `faction` stay the same. */
export function factionData(game: GameData, entities: EntityIndex, faction: Faction): FactionData {
  let byEntities = factions.get(game);
  if (!byEntities) factions.set(game, (byEntities = new WeakMap()));
  let byFaction = byEntities.get(entities);
  if (!byFaction) byEntities.set(entities, (byFaction = new Map<Faction, FactionData>()));
  let data = byFaction.get(faction);
  if (!data) {
    const sim = simData(game, entities, faction);
    byFaction.set(faction, (data = { sim, lookup: questLookup(game, faction), opportunities: opportunityData(game, sim, faction) }));
  }
  return data;
}
