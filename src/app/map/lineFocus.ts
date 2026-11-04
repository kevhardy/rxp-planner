import {
  locatedSpawns,
  npcSpawns,
  type GameData,
  type MapLocation,
  type QuestPoint,
  type UiMapId,
  type WorldMapData,
  type WorldMapPlace,
  type WorldMapPoi,
  type ZoneId,
} from "../../data/index.ts";
import { getLines, type BodyLine, type EntityId, type GuideDocument, type LinePos, type Step } from "../../guide/index.ts";
import type { Faction, SimData } from "../../rules/index.ts";
import { stepMobs } from "../../rules/killTargets.ts";
import { lineQuest } from "../../rules/lineQuest.ts";
import { lineEntities, type Feature, type FeatureIndex, type FeatureLocation } from "./features.ts";
import { isCoordinateLine, stepLocations } from "../../rules/points.ts";
import { stepObjectives, type StepObjective, type ViewPoint } from "./points.ts";
import type { Surface } from "./surfaces.ts";
import { canvasToView, type Fit } from "./viewport.ts";

export type MapFocusTarget =
  | { kind: "line"; doc: GuideDocument; at: LinePos }
  | { kind: "feature"; feature: Feature; location: FeatureLocation };

interface FocusMark {
  at: ViewPoint;
  label: string;
  pois: readonly WorldMapPoi[];
  place?: WorldMapPlace;
}

interface FocusPath {
  points: readonly ViewPoint[];
  closed: boolean;
}

export interface ResolvedMapFocus {
  fit: Fit;
  map: UiMapId | undefined;
  marks: readonly FocusMark[];
  paths: readonly FocusPath[];
  objective: string | null;
  caption: string;
}

export type FocusResolution = { kind: "located"; focus: ResolvedMapFocus } | { kind: "unavailable"; message: string };

export interface FocusContext {
  data: GameData;
  features: FeatureIndex;
  surface: Surface;
  map: WorldMapData;
  faction: Faction;
  sim: SimData | undefined;
  preferredMap: UiMapId | undefined;
}

const LOCAL_YARDS = 120;
const FEATURE_WIDTH = 6;
const PADDING = 0.15;

export function lineHasMapReference(line: BodyLine): boolean {
  return (
    isCoordinateLine(line) ||
    (line.kind === "command" && (line.name === "accept" || line.name === "turnin" || line.name === "complete")) ||
    lineEntities(line).length > 0
  );
}

export function resolveMapFocus(target: MapFocusTarget, context: FocusContext): FocusResolution {
  return target.kind === "feature" ? featureFocus(target.feature, target.location, context) : lineFocus(target.doc, target.at, context);
}

function featureFocus(feature: Feature, location: FeatureLocation, { data, surface, map }: FocusContext): FocusResolution {
  const at = canvasToView(map, location.at);
  const uiMapId = location.location?.uiMapId;
  const zone = uiMapId === undefined ? undefined : surface.fitMap(uiMapId);
  return located({
    fit: { ...at, width: zone?.width ?? FEATURE_WIDTH },
    map: uiMapId,
    marks: [{ at, label: feature.name, pois: location.pois, ...(feature.place && { place: feature.place }) }],
    paths: [],
    objective: null,
    caption: `${feature.name}: ${uiMapId === undefined ? location.area : data.mapName(uiMapId)} ${location.label}`,
  });
}

interface LocatedPoint {
  location: MapLocation;
  at: ViewPoint;
}

interface Place {
  location: MapLocation;
  label: string;
  pois?: readonly WorldMapPoi[];
  questZone?: boolean;
}

interface TitledPlaces {
  title: string;
  places: Place[];
  objective?: string;
}

function lineFocus(doc: GuideDocument, at: LinePos, context: FocusContext): FocusResolution {
  const line = getLines(doc, at.step)[at.index];
  if (!line) return unavailable("That line is no longer in the guide.");
  const step = at.step === null ? undefined : doc.steps[at.step];
  if (isCoordinateLine(line)) return coordinateFocus(line, context);
  const role = questPlaces(line, at.index, step, context);
  if (role && "places" in role) return placesFocus([role], step, context);
  const found = lineEntities(line).map((entity) => entityPlaces(entity, step, context));
  const placed = found.filter((f) => f.places.length > 0);
  if (placed.length > 0) return placesFocus(placed, step, context);
  if (role) return unavailable(role.missing);
  return unavailable(found[0] ? `The dataset has no location for ${found[0].title}.` : "This line names no place.");
}

function coordinateFocus(line: BodyLine, { data, surface }: FocusContext): FocusResolution {
  const own = stepLocations(data, { body: [line] });
  const problem = own.problems[0];
  if (problem) return unavailable(`.${problem.command} is not on the map: ${problem.message}`);
  const path = own.paths[0];
  const points = path ? path.points : own.points;
  const projected = points.flatMap((location) => {
    const at = surface.project(location);
    return at ? [{ location, at }] : [];
  });
  const [first, ...rest] = projected;
  if (!first || projected.length !== points.length)
    return unavailable(`The terrain map does not show ${data.mapName(points[0]?.uiMapId ?? 0)}.`);
  const zone = data.mapName(surface.mapOf(first.location));
  const caption = path ? `.${path.command} path, ${points.length} points in ${zone}` : surface.describe(first.location);
  return located({
    fit: fitAround(surface, first, rest),
    map: surface.mapOf(first.location),
    marks: path ? [] : [{ at: first.at, label: caption, pois: [] }],
    paths: path ? [{ points: projected.map((p) => p.at), closed: path.command === "loop" }] : [],
    objective: null,
    caption,
  });
}

function questPlaces(
  line: BodyLine,
  index: number,
  step: Step | undefined,
  { data, faction, sim }: FocusContext,
): TitledPlaces | { missing: string } | undefined {
  if (line.kind !== "command") return undefined;
  if (line.name === "accept" || line.name === "turnin") {
    const id = lineQuest(line)?.questId;
    const quest = id === undefined ? undefined : data.quest(id, faction);
    if (!quest) return { missing: `The dataset has no quest #${line.args[0] ?? ""}.` };
    const accept = line.name === "accept";
    const points = accept ? quest.startPoints : quest.endPoints;
    const verb = accept ? "Starts" : "Turn in";
    if (points.length === 0) return { missing: `The dataset has no ${accept ? "giver" : "ender"} location for ${quest.name}.` };
    return {
      title: `${verb} ${quest.name}`,
      places: points.map((p) => questPlace(data, p, `${verb} ${quest.name}: ${p.sourceName}`, quest.zoneIds)),
    };
  }
  if (line.name !== "complete") return undefined;
  const named = step && stepObjectives(data, step, faction).get(index);
  if (!named) return { missing: `The dataset has no objective ${line.args[1] ?? ""} for quest #${line.args[0] ?? ""}.` };
  const found = objectivePlaces(named, step, { data, faction, sim });
  return found.places.length > 0 ? found : { missing: `The dataset has no location for ${found.title}.` };
}

function objectivePlaces(
  named: StepObjective,
  step: Step,
  { data, faction, sim }: Pick<FocusContext, "data" | "faction" | "sim">,
): TitledPlaces {
  const { quest, objective } = named;
  const title = `${quest.name}: ${objective.text ?? objective.name}`;
  const mobs = sim ? stepMobs(step, sim).mob : [];
  const spawns = locatedSpawns(data, quest, objective, faction, mobs);
  return {
    title,
    objective: named.key,
    places: [...spawns].map(([point, location]) => ({ location, label: title, questZone: quest.zoneIds.includes(point.zoneId) })),
  };
}

const questPlace = (data: GameData, point: QuestPoint, label: string, zoneIds: readonly ZoneId[]): Place => ({
  location: data.locateQuestPoint(point),
  label,
  questZone: zoneIds.includes(point.zoneId),
});

function entityPlaces(entity: EntityId, step: Step | undefined, context: FocusContext): TitledPlaces {
  const { data, features, faction } = context;
  const npcName = (id: number) => features.entity({ type: "npc", id })?.name ?? data.npcName(id) ?? `npc #${id}`;
  const name = entity.type === "npc" ? npcName(entity.id) : (features.entity(entity)?.name ?? `${entity.type} #${entity.id}`);
  if (entity.type === "npc") return { title: name, places: npcPlaces(entity.id, name, context) };
  const objectives = step ? [...new Set(stepObjectives(data, step, faction).values())] : [];
  const objective = objectives.find((o) => o.objective.type === entity.type && o.objective.ids.includes(entity.id));
  const fromObjective = objective && step ? objectivePlaces(objective, step, context) : undefined;
  if (entity.type === "object") return fromObjective?.places.length ? fromObjective : { title: name, places: [] };
  const own = featurePlaces(features.entity(entity), name);
  if (own.length > 0) return { title: name, places: own };
  if (fromObjective?.places.length) return fromObjective;
  const npcs = (title: string, verb: string, ids: readonly number[]): TitledPlaces => ({
    title: `${title} ${name}`,
    places: ids.flatMap((id) => npcPlaces(id, `${npcName(id)} ${verb} ${name}`, context)),
  });
  const sold = npcs(
    "Sellers of",
    "sells",
    (data.sellers(entity.id) ?? []).map((s) => s.id),
  );
  if (sold.places.length > 0) return sold;
  const dropped = npcs(
    "Droppers of",
    "drops",
    (data.droppers(entity.id, faction) ?? []).flatMap((d) => (d.type === "npc" ? [d.id] : [])),
  );
  return dropped.places.length > 0 ? dropped : { title: name, places: [] };
}

function featurePlaces(feature: Feature | undefined, label: string): Place[] {
  return (feature?.locations ?? []).flatMap((l) => (l.location ? [{ location: l.location, label, pois: l.pois }] : []));
}

function npcPlaces(id: number, label: string, { data, features, faction }: FocusContext): Place[] {
  const places = featurePlaces(features.entity({ type: "npc", id }), label);
  const seen = new Set(places.map((p) => worldKey(p.location)));
  for (const spawn of npcSpawns(data, faction)(id, undefined)) {
    const location = data.locate(spawn);
    if (!location || seen.has(worldKey(location))) continue;
    seen.add(worldKey(location));
    places.push({ location, label });
  }
  return places;
}

const worldKey = (l: MapLocation) => `${l.world.instance}:${l.world.x}:${l.world.y}`;

type LocatedPlace = LocatedPoint & { place: Place };
type ZonePlaces = [LocatedPlace, ...LocatedPlace[]];

function placesFocus(found: readonly TitledPlaces[], step: Step | undefined, context: FocusContext): FocusResolution {
  const { data, surface } = context;
  const groups = new Map<UiMapId, ZonePlaces>();
  const seen = new Set<string>();
  let hidden: UiMapId | undefined;
  for (const place of found.flatMap((f) => f.places)) {
    const key = worldKey(place.location);
    if (seen.has(key)) continue;
    seen.add(key);
    const at = surface.project(place.location);
    if (!at) {
      hidden ??= place.location.uiMapId;
      continue;
    }
    const zone = surface.mapOf(place.location);
    const group = groups.get(zone);
    const locatedPlace = { place, location: place.location, at };
    if (group) group.push(locatedPlace);
    else groups.set(zone, [locatedPlace]);
  }
  const selected = chooseZone(groups, step, context);
  if (!selected) return unavailable(`The terrain map does not show ${data.mapName(hidden ?? 0)}.`);
  const [zone, chosen] = selected;
  const [first, ...rest] = chosen;
  const others = groups.size - 1;
  const count = `${chosen.length} ${chosen.length === 1 ? "location" : "locations"}`;
  return located({
    fit: fitAround(surface, first, rest),
    map: zone,
    marks: chosen.map(({ place, at }) => ({ at, label: place.label, pois: place.pois ?? [] })),
    paths: [],
    objective: found.find((f) => f.objective)?.objective ?? null,
    caption: `${found.map((f) => f.title).join("; ")}: ${count} in ${data.mapName(zone)}${others > 0 ? `, more in ${others} other ${others === 1 ? "zone" : "zones"}` : ""}`,
  });
}

function chooseZone(
  groups: Map<UiMapId, ZonePlaces>,
  step: Step | undefined,
  { data, surface, preferredMap }: FocusContext,
): [UiMapId, ZonePlaces] | undefined {
  const preferred = preferredMap === undefined ? undefined : groups.get(preferredMap);
  if (preferredMap !== undefined && preferred) return [preferredMap, preferred];
  if (step) {
    const own = stepLocations(data, step);
    for (const p of [...own.points, ...own.paths.flatMap((path) => path.points)]) {
      const zone = surface.mapOf(p);
      const group = groups.get(zone);
      if (group) return [zone, group];
    }
  }
  const ranked = [...groups].sort(
    ([a, x], [b, y]) => Number(y.some((c) => c.place.questZone)) - Number(x.some((c) => c.place.questZone)) || y.length - x.length || a - b,
  );
  return ranked[0];
}

function fitAround(surface: Surface, first: LocatedPoint, rest: readonly LocatedPoint[]): Fit {
  const width = localWidth(surface, first.location, first.at);
  if (rest.length === 0) return { ...first.at, width };
  const ats = [first.at, ...rest.map((p) => p.at)];
  const xs = ats.map((a) => a.x);
  const ys = ats.map((a) => a.y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = Math.max((right - left) * (1 + 2 * PADDING), width);
  const h = Math.max((bottom - top) * (1 + 2 * PADDING), width * surface.aspect);
  return { left: (left + right) / 2 - w / 2, top: (top + bottom) / 2 - h / 2, width: w, height: h };
}

function localWidth(surface: Surface, location: MapLocation, at: ViewPoint): number {
  const { world } = location;
  const ends = [
    surface.projectOutline({ ...world, x: world.x + LOCAL_YARDS }),
    surface.projectOutline({ ...world, y: world.y + LOCAL_YARDS }),
  ];
  return 2 * Math.max(...ends.map((e) => (e ? Math.abs(e.x - at.x) : 0)));
}

const located = (focus: ResolvedMapFocus): FocusResolution => ({ kind: "located", focus });
const unavailable = (message: string): FocusResolution => ({ kind: "unavailable", message });
