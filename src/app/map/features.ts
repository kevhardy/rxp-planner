import type { CanvasPoint, GameData, MapLocation, WorldMapData, WorldMapPlace, WorldMapPoi } from "../../data/index.ts";
import {
  commandEntities,
  findEntityReferences,
  formatEntityReference,
  type BodyLine,
  type EntityId,
  type Step,
} from "../../guide/index.ts";
import type { LayerId } from "./mapSettings.ts";
import { stepLocations } from "../../rules/points.ts";
import { locateOnTerrain } from "./points.ts";
import { layerOf } from "./terrain.ts";

export interface FeatureLocation {
  at: CanvasPoint;
  location?: MapLocation;
  area: string;
  label: string;
  pois: WorldMapPoi[];
}

export interface Feature {
  key: string;
  name: string;
  kind: string;
  entity?: EntityId;
  layer?: LayerId;
  copy: string;
  locations: FeatureLocation[];
  place?: WorldMapPlace;
}

export interface FeatureIndex {
  features: Feature[];
  entity(id: EntityId): Feature | undefined;
  feature(poi: WorldMapPoi): Feature | undefined;
}

const NO_MAP = "Not on a zone map";

export function indexFeatures(data: GameData, map: WorldMapData): FeatureIndex {
  const categories = new Map(map.categories.map((c) => [c.key, c]));
  const locate = (at: CanvasPoint, label?: string, poi?: WorldMapPoi): FeatureLocation => {
    const location = locateOnTerrain(data, map, at);
    return {
      at,
      ...(location && { location }),
      area: location ? data.mapName(location.uiMapId) : NO_MAP,
      label: label ?? (location ? `${location.x.toFixed(2)}, ${location.y.toFixed(2)}` : NO_MAP),
      pois: poi ? [poi] : [],
    };
  };
  const byKey = new Map<string, Feature>();
  const byPoi = new Map<WorldMapPoi, Feature>();
  for (const poi of map.pois) {
    const category = categories.get(poi.category);
    const layer = category && layerOf(category);
    if (!category || !layer) continue;
    const key = poi.entity ? `${poi.entity.type}:${poi.entity.id}` : `poi:${poi.category}:${poi.name}`;
    let feature = byKey.get(key);
    if (!feature) {
      const transport = category.group === "transport";
      byKey.set(
        key,
        (feature = {
          key,
          name: poi.name,
          kind: category.name,
          ...(poi.entity && { entity: poi.entity }),
          layer,
          copy: transport ? `${poi.name} by ${category.key}` : poi.entity ? referenceOrName(poi.entity, poi.name) : poi.name,
          locations: [],
        }),
      );
    }
    byPoi.set(poi, feature);
    const transport = category.group === "transport";
    const locatedAt = (point: CanvasPoint) => feature.locations.find((l) => l.at.x === point.x && l.at.y === point.y);
    const shared = locatedAt(poi);
    if (shared) shared.pois.push(poi);
    else feature.locations.push(locate(poi, transport ? "Departure" : undefined, poi));
    for (const { arrival } of poi.links ?? []) {
      const end = arrival && { x: arrival[0], y: arrival[1] };
      if (!end || locatedAt(end)) continue;
      feature.locations.push(locate(end, "Arrival", poi));
    }
  }
  const places = new Map<string, Feature>();
  for (const place of map.places) {
    const key = `place:${place.kind}:${place.name}`;
    let feature = places.get(key);
    if (!feature) {
      places.set(
        key,
        (feature = {
          key,
          name: place.name,
          kind: { zone: "Zone", capital: "Capital", landmark: "Landmark" }[place.kind],
          copy: place.name,
          locations: [],
          place,
        }),
      );
    }
    feature.locations.push(locate(place));
  }
  const features = [...byKey.values(), ...places.values()];
  const entities = new Map(features.flatMap((f) => (f.entity ? [[f.key, f] as const] : [])));
  return { features, entity: (id) => entities.get(`${id.type}:${id.id}`), feature: (poi) => byPoi.get(poi) };
}

function referenceOrName(entity: EntityId, name: string): string {
  try {
    return formatEntityReference({ ...entity, label: name });
  } catch {
    return name;
  }
}

export function searchFeatures(index: FeatureIndex, query: string): Feature[] {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  const rank = (f: Feature) => {
    const names = [f.name, ...f.locations.flatMap((l) => l.pois.map((p) => p.label ?? ""))].map((n) => n.toLowerCase());
    return names.some((n) => n.startsWith(text)) ? 0 : names.some((n) => n.includes(text)) ? 1 : 2;
  };
  return index.features
    .map((f) => ({ f, rank: rank(f) }))
    .filter(({ rank }) => rank < 2)
    .sort((a, b) => a.rank - b.rank || a.f.name.localeCompare(b.f.name))
    .map(({ f }) => f);
}

export function locationGroups(feature: Feature, preferred: string | undefined): { area: string; locations: FeatureLocation[] }[] {
  const groups = new Map<string, FeatureLocation[]>();
  for (const l of feature.locations) groups.set(l.area, [...(groups.get(l.area) ?? []), l]);
  return [...groups]
    .map(([area, locations]) => ({ area, locations }))
    .sort((a, b) => Number(b.area === preferred) - Number(a.area === preferred));
}

export function stepArea(data: GameData, step: Step): string | undefined {
  const first = stepLocations(data, step).points[0];
  return first && data.mapName(first.uiMapId);
}

export function lineEntities(line: BodyLine): EntityId[] {
  const entities: EntityId[] = [];
  if (line.kind === "text" || line.kind === "command") entities.push(...findEntityReferences(line.text ?? ""));
  if (line.kind === "command") entities.push(...commandEntities(line.name, line.args));
  const seen = new Set<string>();
  return entities.flatMap(({ type, id }) => {
    const key = `${type}:${id}`;
    if ((type !== "npc" && type !== "item" && type !== "object") || seen.has(key)) return [];
    seen.add(key);
    return [{ type, id }];
  });
}

export function stepEntities(step: Step): EntityId[] {
  const seen = new Set<string>();
  return step.body.flatMap(lineEntities).filter(({ type, id }) => !seen.has(`${type}:${id}`) && seen.add(`${type}:${id}`));
}
