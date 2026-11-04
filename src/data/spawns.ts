import type { Faction } from "../../packages/data-contract/shared.ts";
import type { GameData, MapLocation } from "./gameData.ts";
import type { WorldLocation, ZoneId } from "./maps.ts";
import type { Quest, QuestObjective, QuestPoint, TextObjective } from "./model.ts";

export type Spawn = WorldLocation & { readonly id: string; readonly z?: number; readonly interior?: string };

export type SpawnsOf = (npcId: number, questId: number | undefined) => readonly Spawn[];

export function npcSpawns(game: GameData, faction: Faction): SpawnsOf {
  const recorded = new Map<number, readonly Spawn[] | undefined>();
  return (npcId, questId) => {
    if (!recorded.has(npcId)) {
      const spawns = game
        .npc(npcId)
        ?.spawns?.map((s): Spawn =>
          "guid" in s
            ? { ...s.world, id: `npc:${npcId}:${s.guid}`, z: s.z, ...(s.interior !== undefined && { interior: s.interior }) }
            : place(npcId, s.world),
        );
      recorded.set(
        npcId,
        spawns &&
          collapse(
            spawns,
            () => npcId,
            (s) => s,
          ),
      );
    }
    const spawns = recorded.get(npcId);
    if (spawns) return spawns;
    if (questId === undefined) return [];
    const points = (game.quest(questId, faction)?.objectivePoints ?? []).filter((p) => p.sourceType === "npc" && p.sourceId === npcId);
    return collapseNpcSpawns(points).map((p) => place(npcId, p.world));
  };
}

const place = (npcId: number, at: WorldLocation): Spawn => ({ ...at, id: `npc:${npcId}:${at.instance}:${at.x},${at.y}` });

function collapseNpcSpawns(points: readonly QuestPoint[]): QuestPoint[] {
  return collapse(
    points,
    (p) => (p.sourceType === "npc" ? p.sourceId : undefined),
    (p) => p.world,
    (a, b) => a.uiMapId - b.uiMapId,
  );
}

type Spot = WorldLocation & Pick<Spawn, "z" | "interior">;

// Objective points have no spawn ID, so sightings of one NPC this close count as one spawn. In starting areas, many
// close pairs lie on a 0.2% map grid, less than 10 yd apart.
const SAME_SPAWN_YARDS = 10;

function collapse<T>(
  values: readonly T[],
  npc: (value: T) => number | undefined,
  spot: (value: T) => Spot,
  tie: (a: T, b: T) => number = () => 0,
): T[] {
  const kept = new Set<number>();
  const spawns: T[] = [];
  const ordered = [...values.entries()].sort(([, a], [, b]) => {
    const at = spot(a),
      bt = spot(b);
    return Number(at.z === undefined) - Number(bt.z === undefined) || at.x - bt.x || at.y - bt.y || tie(a, b);
  });
  for (const [i, value] of ordered) {
    const id = npc(value);
    if (id !== undefined) {
      const at = spot(value);
      if (
        spawns.some((p) => {
          const other = spot(p);
          if (npc(p) !== id || other.instance !== at.instance) return false;
          if (at.z !== undefined && other.z !== undefined)
            return at.interior === other.interior && Math.hypot(at.x - other.x, at.y - other.y, at.z - other.z) < SAME_SPAWN_YARDS;
          return Math.hypot(at.x - other.x, at.y - other.y) < SAME_SPAWN_YARDS;
        })
      )
        continue;
      spawns.push(value);
    }
    kept.add(i);
  }
  return values.filter((_, i) => kept.has(i));
}

export function locatedSpawns(
  data: GameData,
  quest: Quest,
  objective: QuestObjective,
  faction?: Faction,
  mobs?: readonly number[],
): Map<QuestPoint, MapLocation> {
  return new Map(
    collapseNpcSpawns(objectivePoints(data, quest, objective, faction, mobs)).map((p) => [p, data.locateQuestPoint(p)] as const),
  );
}

export function centralSpawn(points: QuestPoint[], zoneIds: readonly ZoneId[]): QuestPoint | undefined {
  const groups = new Map<string, QuestPoint[]>();
  for (const p of points) {
    const key = `${p.zoneId}/${p.world.instance}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const all = [...groups.values()];
  const local = all.filter((g) => zoneIds.includes(g[0]!.zoneId));
  const group = (local.length > 0 ? local : all).sort((a, b) => b.length - a.length)[0];
  if (!group) return undefined;
  const cx = group.reduce((sum, p) => sum + p.world.x, 0) / group.length;
  const cy = group.reduce((sum, p) => sum + p.world.y, 0) / group.length;
  const off = (p: QuestPoint) => Math.hypot(p.world.x - cx, p.world.y - cy);
  return group.reduce((best, p) => (off(p) < off(best) ? p : best));
}

export function nearestSpawn(points: readonly QuestPoint[], near: readonly WorldLocation[]): QuestPoint | undefined {
  let nearest: QuestPoint | undefined;
  let least = Infinity;
  for (const p of points)
    for (const n of near) {
      const off = n.instance === p.world.instance ? Math.hypot(p.world.x - n.x, p.world.y - n.y) : Infinity;
      if (off < least) [nearest, least] = [p, off];
    }
  return nearest;
}

export function linkObjective(row: TextObjective): QuestObjective | undefined {
  const { link, name, count, need } = row;
  if (!link) return undefined;
  return { type: link.kind === "npc" ? "monster" : "item", id: link.id, ids: [link.id], name, ...(count !== undefined && { count }), need };
}

const TARGET_TYPES: Readonly<Record<string, string>> = { monster: "npc", object: "object", item: "item", event: "trigger" };

export function objectivePoints(
  data: GameData,
  quest: Quest,
  objective: QuestObjective,
  faction?: Faction,
  mobs: readonly number[] = [],
): QuestPoint[] {
  const points = quest.objectivePoints.filter((p) => p.kind !== "extra");
  if (objective.type === "event" && objective.ids.length === 0) return soleObjectiveTriggers(quest, points);
  const type = TARGET_TYPES[objective.type];
  const dropped = isDropperPoint(data, objective, faction, mobs);
  return points.filter((p) => p.sourceId !== undefined && ((p.sourceType === type && objective.ids.includes(p.sourceId)) || dropped(p)));
}

// A trigger point has no ID to match an objective, so it belongs to a quest's only objective.
const soleObjectiveTriggers = (quest: Quest, points: readonly QuestPoint[]): QuestPoint[] =>
  quest.objectives.length === 1 ? points.filter((p) => p.sourceType === "trigger" && p.sourceId === undefined) : [];

// Sources tag the spawns of an item with the item or with what drops it.
function isDropperPoint(data: GameData, objective: QuestObjective, faction: Faction | undefined, mobs: readonly number[]) {
  if (objective.type !== "item") return () => false;
  const droppers = objective.ids.flatMap((id) => data.droppers(id, faction) ?? []).filter((d) => !d.objectiveExcluded);
  const onMobLines = droppers.filter((d) => d.type === "npc" && mobs.includes(d.id));
  const shown = onMobLines.length ? droppers.filter((d) => d.type !== "npc" || onMobLines.includes(d)) : droppers;
  return (p: QuestPoint) => p.kind === "item" && shown.some((d) => d.type === p.sourceType && d.id === p.sourceId);
}
