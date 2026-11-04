import type { QuestPoint } from "../../packages/data-contract/model.ts";
import { pointLabel, type GameData } from "./gameData.ts";
import { worldToCanvas, type WorldLocation } from "./maps.ts";
import type { WorldMapData } from "./worldMap.ts";

const NPC_YARDS = 30;
const LANDMARK_YARDS = 100;

export function placeName(
  data: GameData,
  map: WorldMapData | undefined,
  at: WorldLocation,
  npcs: readonly QuestPoint[],
): string | undefined {
  const location = data.locate(at);
  if (!location) return undefined;
  const zone = data.mapName(location.uiMapId);
  const name = nearestNpc(data, at, npcs) ?? (map && nearestLandmark(data, map, at));
  if (name) return name === zone ? name : `${name}, ${zone}`;
  return `${zone} ${pointLabel(location.x, location.y)}`;
}

function nearestNpc(data: GameData, at: WorldLocation, npcs: readonly QuestPoint[]): string | undefined {
  let best: { id: number; yards: number } | undefined;
  for (const p of npcs) {
    if (p.sourceType !== "npc" || p.sourceId === undefined || p.world.instance !== at.instance) continue;
    const yards = Math.hypot(p.world.x - at.x, p.world.y - at.y);
    if (yards <= NPC_YARDS && (!best || yards < best.yards)) best = { id: p.sourceId, yards };
  }
  return best && data.npcName(best.id);
}

function nearestLandmark(data: GameData, map: WorldMapData, at: WorldLocation): string | undefined {
  const terrain = data.terrainMap(map);
  const point = worldToCanvas(terrain, at);
  const area = map.areas.find((a) => a.map === at.instance)?.key;
  if (!point || !area) return undefined;
  const yardsPerPixel = map.yardsPerChunk / map.pxPerChunk;
  let best: { name: string; yards: number } | undefined;
  for (const place of map.places) {
    if (place.kind === "zone" || place.area !== area) continue;
    const yards = Math.hypot(place.x - point.x, place.y - point.y) * yardsPerPixel;
    if (yards <= LANDMARK_YARDS && (!best || yards < best.yards)) best = { name: place.name, yards };
  }
  return best?.name;
}
