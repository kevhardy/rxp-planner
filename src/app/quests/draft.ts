import { centralSpawn, locatedSpawns, type GameData, type MapLocation, type Quest, type QuestPoint } from "../../data/index.ts";
import type { Faction } from "../../rules/index.ts";
import type { DraftPoint, QuestDraft } from "../../rules/questInsertion.ts";

/**
 * The draft for a quest as `faction` sees it. Points go through
 * `GameData.locateQuestPoint`, as the map's quest markers do, so each `.goto`
 * lands on its marker. When a step's `.mob` lines narrow away an item
 * objective's drafted spawn, the map marks the narrowed spawn nearest the
 * `.goto` instead; see `questSpots`.
 */
export function questDraft(data: GameData, quest: Quest, faction?: Faction): QuestDraft {
  const draftPoint = (p: QuestPoint, at: MapLocation): DraftPoint => {
    const args = data.formatLocation(at);
    return { label: `${p.sourceName} · ${args.join(",")}`, args };
  };
  const points = (list: QuestPoint[]) => list.map((p) => draftPoint(p, data.locateQuestPoint(p)));
  const givers = points(quest.startPoints);
  const enders = points(quest.endPoints);
  const objectives = quest.objectives.map((objective) => {
    const located = locatedSpawns(data, quest, objective, faction);
    const center = centralSpawn([...located.keys()], quest.zoneIds);
    return { objective, ...(center && { point: draftPoint(center, located.get(center)!) }) };
  });
  return { quest, givers, enders, objectives };
}
