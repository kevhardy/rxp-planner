import type { EntityType, GameData, Quest, QuestQuery, UiMapId } from "../../data/index.ts";
import { searchFeatures, type Feature, type FeatureIndex } from "./features.ts";

export type SearchResult = { kind: "quest"; quest: Quest } | { kind: "feature"; feature: Feature };

export interface SearchGroup {
  title: string;
  results: SearchResult[];
}

export interface SearchQuery extends Pick<QuestQuery, "zoneId" | "minLevel" | "maxLevel" | "faction"> {
  text: string;
}

const QUESTS = "Quests";
/** The dataset release names its quest-giver map category "Quests", the same as the quest results. */
const QUEST_GIVERS = "Quest givers";

const TYPED_ID = /(?:^|\()\s*(item|quest|npc|spell|object)\s*#?\s*([1-9]\d*)\s*\)?\s*$/i;
const ANY_ID = /^\s*#?\s*([1-9]\d*)\s*$/;

type Parsed = { kind: "id"; id: number; types: readonly EntityType[] } | { kind: "text"; text: string };

function parse(text: string): Parsed {
  const typed = TYPED_ID.exec(text);
  if (typed) return { kind: "id", id: Number(typed[2]), types: [typed[1]!.toLowerCase() as EntityType] };
  const any = ANY_ID.exec(text);
  if (any) return { kind: "id", id: Number(any[1]), types: ["quest", "npc", "item"] };
  return { kind: "text", text: text.trim() };
}

export function searchAll(data: GameData, index: FeatureIndex | null, query: SearchQuery): SearchGroup[] | null {
  const parsed = parse(query.text);
  const { text: _, ...filters } = query;
  const questsOnly = query.minLevel !== undefined || query.maxLevel !== undefined;
  if (parsed.kind === "text" && parsed.text === "" && query.zoneId === undefined && !questsOnly) return null;

  const quests =
    parsed.kind === "text"
      ? data.searchQuests({ ...filters, text: parsed.text })
      : parsed.types.includes("quest")
        ? data.searchQuests({ ...filters, text: String(parsed.id) }).filter((q) => q.id === parsed.id)
        : [];
  const groups: SearchGroup[] = [{ title: QUESTS, results: quests.map((quest) => ({ kind: "quest", quest })) }];

  if (index && !questsOnly) {
    const found =
      parsed.kind === "text"
        ? searchFeatures(index, parsed.text)
        : parsed.types.flatMap((type) => index.entity({ type, id: parsed.id }) ?? []);
    const uiMapId = query.zoneId === undefined ? undefined : data.zone(query.zoneId)?.uiMapId;
    const byKind = new Map(index.features.map((f) => [f.kind, [] as SearchResult[]]));
    for (const feature of found) {
      if (uiMapId === undefined || inMapOrUnplaced(feature, uiMapId)) byKind.get(feature.kind)!.push({ kind: "feature", feature });
    }
    for (const [kind, results] of byKind) groups.push({ title: kind === QUESTS ? QUEST_GIVERS : kind, results });
  }
  return groups.filter((g) => g.results.length > 0);
}

const inMapOrUnplaced = (feature: Feature, uiMapId: UiMapId) =>
  feature.locations.every((l) => !l.location) || feature.locations.some((l) => l.location?.uiMapId === uiMapId);
