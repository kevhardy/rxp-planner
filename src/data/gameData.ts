import type { DatasetGeometry, SourceDisplay } from "../../packages/data-contract/manifest.ts";
import { restoreMapBounds } from "../../packages/data-contract/geometry.ts";
import { terrainGeometry, type TerrainGeometry, type WorldMapData } from "../../packages/data-contract/worldMap.ts";

import {
  locateCanvas,
  mapToWorld,
  nearest,
  RXP_ZONE_ALIASES,
  RXP_ZONE_NAMES,
  worldToMap,
  yards,
  type WorldBounds,
  type WorldLocation,
} from "./maps.ts";
import type {
  BundleSource,
  Continent,
  Dropper,
  FactionField,
  FieldOrigin,
  GameDataFile,
  GameVersion,
  Npc,
  NpcField,
  NpcRecord,
  Provenance,
  Quest,
  QuestField,
  QuestPoint,
  QuestRow,
  Seller,
  Zone,
} from "../../packages/data-contract/model.ts";
import type { Faction, FieldValue, SourceKey, UiMapId, ZoneId } from "../../packages/data-contract/shared.ts";
import type { GameRules } from "./gameRules.ts";
import { readRaceClasses, type RaceClasses } from "./races.ts";
import { FlightNodes } from "./flightNodes.ts";

export interface RuntimeDatasetContext {
  rules: GameRules;
  geometry: DatasetGeometry;
  terrain: TerrainGeometry & { readonly pois?: WorldMapData["pois"] };
  sources?: Readonly<Record<string, SourceDisplay>>;
}

export { decodeJson } from "../../packages/data-contract/json.ts";

export interface QuestQuery {
  text?: string;
  zoneId?: ZoneId;
  minLevel?: number;
  maxLevel?: number;
  faction?: Faction;
}

export type GotoForm =
  | "name"
  | "map-id"
  /** `<uiMapId>/<instance>` with HereBeDragons world coordinates. */
  | "world";

export type GotoFailure =
  /** RXP does not know the zone name, or neither the data nor the client knows the map ID. */
  | "unknown-zone"
  | "no-bounds"
  | "bad-coordinates"
  | "outside-map"
  /**
   * World coordinates whose instance is not the map's. RXP pins the point on
   * the map but points its arrow at the given instance, so there is no one place.
   */
  | "wrong-instance";

export interface MapLocation {
  uiMapId: UiMapId;
  /** Percentages of that map, after RXP's alias conversions; 0 to 100 inside it. */
  x: number;
  y: number;
  world: WorldLocation;
}

export interface GotoLocation extends MapLocation {
  ok: true;
  form: GotoForm;
}

export interface GotoError {
  ok: false;
  form: GotoForm;
  reason: GotoFailure;
  message: string;
  uiMapId?: UiMapId;
}

export class SourceRegistry {
  readonly #sets: ReadonlyMap<SourceKey, BundleSource>;

  constructor(sources: readonly BundleSource[]) {
    this.#sets = new Map(sources.map((s) => [s.source, s]));
  }

  origin<F extends string>(provenance: Provenance<F> | undefined, field: F): FieldOrigin | undefined {
    const won = provenance?.fields[field];
    if (!won) return undefined;
    const set = this.#sets.get(won.source);
    const evidence = provenance.evidence && Object.hasOwn(provenance.evidence, won.source) ? provenance.evidence[won.source] : undefined;
    return {
      ...won,
      ...(set && { pins: set.pins, ...(set.derivedFrom && { derivedFrom: set.derivedFrom }) }),
      ...(evidence && { evidence }),
    };
  }
}

type QuestViews = Record<Faction | "shared", Quest>;

function valueFor<V>(value: FieldValue<V>, faction?: Faction): V | undefined {
  if (value && typeof value === "object" && "byFaction" in value) return faction ? value.byFaction[faction] : undefined;
  return value;
}

// The dataset gives some zones the name or map of another zone, such as Westfall. The zone on a continent wins.
function indexZonesPreferringContinent<K>(zones: readonly Zone[], key: (zone: Zone) => K | undefined): Map<K, Zone> {
  const index = new Map<K, Zone>();
  for (const zone of zones) {
    const k = key(zone);
    if (k !== undefined && (zone.continent || !index.has(k))) index.set(k, zone);
  }
  return index;
}

function questViews({ byFaction, ...shared }: QuestRow): QuestViews {
  if (byFaction === undefined) return { shared, Alliance: shared, Horde: shared };
  const unresolved = Object.keys(byFaction.Alliance).filter((f) => f !== "provenance") as FactionField[];
  const view = (faction: Faction): Quest => {
    const { provenance, ...facts } = byFaction[faction];
    return { ...shared, ...facts, provenance: { ...shared.provenance, fields: { ...shared.provenance?.fields, ...provenance } } };
  };
  return { shared: { ...shared, unresolved }, Alliance: view("Alliance"), Horde: view("Horde") };
}

export class GameData {
  readonly source: GameDataFile["source"];
  readonly sources: readonly BundleSource[];
  readonly maxLevel: number;
  readonly quests: readonly Quest[];
  readonly zones: readonly Zone[];
  readonly continents: readonly Continent[];
  readonly raceClasses: RaceClasses | undefined;
  readonly flights: FlightNodes;
  readonly rules: GameRules;
  readonly mapBounds: ReadonlyMap<UiMapId, WorldBounds>;

  readonly #quests: ReadonlyMap<number, QuestViews>;
  readonly #rows: readonly QuestViews[];
  readonly #zones: Map<ZoneId, Zone>;
  readonly #zonesByUiMap: Map<UiMapId, Zone>;
  readonly #zonesByName: Map<string, Zone>;
  readonly #rxpMaps = new Map<string, UiMapId>();
  readonly #rxpNames = new Map<UiMapId, string>();
  readonly #continents: Map<UiMapId, Continent>;
  readonly #npcNames: Record<string, string>;
  readonly #factionNames: Readonly<Record<string, string>>;
  readonly #npcs: Record<string, NpcRecord>;
  #withSpawns: readonly number[] | undefined;
  readonly #droppers: Record<string, FieldValue<Dropper[]>>;
  readonly #sellers: Record<string, Seller[]>;
  readonly #registry: SourceRegistry;

  readonly #dataset: RuntimeDatasetContext;

  constructor(file: GameDataFile, dataset: RuntimeDatasetContext) {
    this.#dataset = dataset;
    this.mapBounds = restoreMapBounds(dataset.geometry.bounds);
    this.source = file.source;
    this.sources = file.sources ?? [];
    this.#registry = new SourceRegistry(this.sources);
    this.#rows = file.quests.map(questViews);
    this.#quests = new Map(this.#rows.map((views) => [views.shared.id, views]));
    this.maxLevel = file.maxLevel;
    this.raceClasses = file.raceClasses && readRaceClasses(file.raceClasses, file.races ?? {}, file.classes ?? {});
    this.flights = new FlightNodes(file.flightNodes);
    this.rules = dataset.rules;
    this.quests = this.#rows.map((views) => views.shared);
    this.#npcNames = file.npcNames;
    this.#factionNames = file.factionNames ?? {};
    this.#npcs = file.npcs ?? {};
    this.#droppers = file.droppers ?? {};
    this.#sellers = file.sellers ?? {};
    this.continents = file.continents.map((c) => ({ ...c, bounds: requireBounds(c.uiMapId, this.mapBounds) }));
    this.#continents = new Map(this.continents.map((c) => [c.uiMapId, c]));
    const byInstance = new Map(this.continents.map((c) => [c.instance, c]));

    this.zones = file.zones.map((record) => {
      const zone: Zone = { ...record };
      const bounds = (record.uiMapId !== undefined && this.mapBounds.get(record.uiMapId)) || record.bounds;
      delete zone.bounds;
      if (bounds) zone.bounds = bounds;
      const continent = byInstance.get(record.instance);
      if (continent) zone.continent = continent;
      return zone;
    });
    this.#zones = new Map(this.zones.map((z) => [z.id, z]));
    this.#zonesByUiMap = indexZonesPreferringContinent(this.zones, (zone) => zone.uiMapId);
    this.#zonesByName = indexZonesPreferringContinent(this.zones, (zone) => zone.name);
    const named = new Map<string, Set<number>>();
    for (const { name, uiMapId } of [...this.zones, ...this.continents]) {
      if (uiMapId !== undefined) named.set(name, (named.get(name) ?? new Set()).add(uiMapId));
    }
    for (const name of RXP_ZONE_NAMES) {
      const [uiMapId, ...more] = named.get(name) ?? [];
      if (more.length) throw new Error(`The dataset gives RXP zone ${name} UI maps ${[uiMapId, ...more].join(", ")}.`);
      if (uiMapId === undefined) continue;
      this.#rxpMaps.set(name, uiMapId);
      if (!this.#rxpNames.has(uiMapId)) this.#rxpNames.set(uiMapId, name);
    }
    for (const [alias, { zone }] of Object.entries(RXP_ZONE_ALIASES)) {
      const uiMapId = this.#rxpMaps.get(zone);
      if (uiMapId !== undefined) this.#rxpMaps.set(alias, uiMapId);
    }
    for (const [token, uiMapId] of this.#rxpMaps) {
      const zone = this.#zonesByUiMap.get(uiMapId);
      if (zone) this.#zonesByName.set(token, zone);
    }
  }

  terrainMap<T extends TerrainGeometry>(map: T): T {
    return { ...map, ...terrainGeometry(this.#dataset.terrain) };
  }

  spiritHealer(from: WorldLocation): WorldLocation | undefined {
    const terrain = this.#dataset.terrain;
    const graveyards = (terrain.pois ?? []).flatMap((poi) => {
      if (poi.category !== "graveyard") return [];
      const located = locateCanvas(terrain, poi.area, poi);
      return located.ok && yards(located.world, from) < Infinity ? [located.world] : [];
    });
    return nearest(graveyards, from);
  }

  sourceLabel(key: string, edition?: GameVersion): string {
    const sources = this.#dataset.sources;
    return sources && Object.hasOwn(sources, key) ? sources[key]!.name : legacySourceLabel(edition ? `${key}:${edition}` : key);
  }

  quest(id: number, faction?: Faction): Quest | undefined {
    return this.#quests.get(id)?.[faction ?? "shared"];
  }

  fieldOrigin<F extends QuestField | NpcField>(record: { provenance?: Provenance<F> }, field: NoInfer<F>): FieldOrigin | undefined {
    return this.#registry.origin(record.provenance, field);
  }

  npcName(id: number): string | undefined {
    return this.#npcNames[id];
  }

  factionName(id: number): string {
    return Object.hasOwn(this.#factionNames, id) ? this.#factionNames[id]! : `faction ${id}`;
  }

  npc(id: number, faction?: Faction): Npc | undefined {
    const record = this.#npcs[id];
    if (!record?.zoneIds) return record as Npc | undefined;
    const { zoneIds, ...facts } = record,
      zones = valueFor(zoneIds, faction);
    return zones ? { ...facts, zoneIds: zones } : facts;
  }

  npcsWithSpawns(): readonly number[] {
    return (this.#withSpawns ??= Object.entries(this.#npcs).flatMap(([id, record]) => (record.spawns ? [Number(id)] : [])));
  }

  droppers(item: number, faction?: Faction): readonly Dropper[] | undefined {
    const value = this.#droppers[item];
    return value && valueFor(value, faction);
  }

  sellers(item: number): readonly Seller[] | undefined {
    return this.#sellers[item];
  }

  searchQuests(query: QuestQuery): Quest[] {
    const text = query.text?.trim().toLowerCase() ?? "";
    const { zoneId, minLevel = -Infinity, maxLevel = Infinity, faction } = query;
    return this.#rows
      .map((views) => views[faction ?? "shared"])
      .filter(
        (q) =>
          (text === "" || String(q.id) === text || q.name.toLowerCase().includes(text)) &&
          (zoneId === undefined || q.zoneIds.includes(zoneId)) &&
          (q.questLevel === null ? minLevel === -Infinity && maxLevel === Infinity : q.questLevel >= minLevel && q.questLevel <= maxLevel),
      )
      .sort((a, b) => (a.questLevel ?? Infinity) - (b.questLevel ?? Infinity) || a.name.localeCompare(b.name) || a.id - b.id);
  }

  zone(id: ZoneId): Zone | undefined {
    return this.#zones.get(id);
  }

  zoneByUiMapId(uiMapId: UiMapId): Zone | undefined {
    return this.#zonesByUiMap.get(uiMapId);
  }

  /**
   * The UI map that an RXP zone name or alias names in this dataset. A name
   * that only the dataset has, such as Warsong Gulch, names none, as in RXP.
   */
  uiMapNamed(token: string): UiMapId | undefined {
    return this.#rxpMaps.get(token);
  }

  zoneByName(name: string): Zone | undefined {
    return this.#zonesByName.get(name);
  }

  continentByUiMapId(uiMapId: UiMapId): Continent | undefined {
    return this.#continents.get(uiMapId);
  }

  zoneAtContinentPoint(continent: Continent, x: number, y: number): Zone | undefined {
    const { crop, hitGrid: grid } = continent;
    const col = Math.floor(((x - crop.left) / crop.width) * grid.width);
    const row = Math.floor(((y - crop.top) / crop.height) * grid.height);
    if (col < 0 || col >= grid.width || row < 0 || row >= grid.height) return undefined;
    const index = grid.alphabet.indexOf(grid.rows[row]?.[col] ?? "");
    const id = index > 0 ? grid.zoneIds[index] : undefined;
    return id === undefined ? undefined : this.zone(id);
  }

  /**
   * Where `.goto` or `.waypoint` arguments (zone, x, y, ...) put a point on
   * Forever, following RXP's `.goto` handler in `functions.lua` and
   * `GetMapInfo` in `map.lua`. RXP takes zone percentages as written,
   * even outside 0 to 100; HereBeDragons rejects world coordinates outside the
   * map. An alias's transform applies to world coordinates too.
   */
  locateGoto(args: readonly string[]): GotoLocation | GotoError {
    const [zoneArg = "", xArg, yArg] = args;
    // RXP matches `(.-)/(%d+)`: text before the first slash that has digits
    // after it, and the digits, the instance.
    const worldMatch = /^(.*?)\/(\d+)/.exec(zoneArg);
    const key = worldMatch ? worldMatch[1]! : zoneArg;
    const named = this.uiMapNamed(key);
    const form: GotoForm = worldMatch ? "world" : named !== undefined ? "name" : "map-id";
    const fail = (reason: GotoFailure, message: string, uiMapId?: UiMapId): GotoError => ({
      ok: false,
      form,
      reason,
      message,
      ...(uiMapId !== undefined && { uiMapId }),
    });

    const uiMapId = named ?? luaNumber(key);
    if (uiMapId === undefined) return fail("unknown-zone", `RXP has no zone named "${key}".`);
    let x = luaNumber(xArg);
    let y = luaNumber(yArg);
    if (x === undefined || y === undefined) {
      return fail("bad-coordinates", `Coordinates "${xArg ?? ""},${yArg ?? ""}" are not numbers.`, uiMapId);
    }
    const transform = Object.hasOwn(RXP_ZONE_ALIASES, key) ? RXP_ZONE_ALIASES[key]!.transform : undefined;
    if (transform) [x, y] = [x * transform.xScale + transform.xOffset, y * transform.yScale + transform.yOffset];

    const bounds = this.mapBounds.get(uiMapId);
    const mapName = this.mapName(uiMapId);
    if (!bounds) {
      if (!this.continentByUiMapId(uiMapId) && !this.zoneByUiMapId(uiMapId) && !this.#rxpNames.has(uiMapId)) {
        return fail("unknown-zone", `UI map ${uiMapId} is not a known zone.`, uiMapId);
      }
      return fail("no-bounds", `${mapName} has no world position on Forever.`, uiMapId);
    }

    if (worldMatch) {
      const world = { x, y };
      ({ x, y } = worldToMap(bounds, world));
      // HereBeDragons rejects world points outside the map.
      if (x < 0 || x > 100 || y < 0 || y > 100) {
        return fail("outside-map", `World point ${xArg},${yArg} is outside ${mapName}.`, uiMapId);
      }
      const instance = Number(worldMatch[2]);
      if (instance !== bounds.instance) {
        return fail(
          "wrong-instance",
          `World point ${xArg},${yArg} names instance ${instance}, but ${mapName} is on instance ${bounds.instance}.`,
          uiMapId,
        );
      }
      return { ok: true, form, uiMapId, x, y, world: { instance, ...world } };
    }
    return { ok: true, form, uiMapId, x, y, world: { instance: bounds.instance, ...mapToWorld(bounds, x, y) } };
  }

  locateQuestPoint(point: QuestPoint): MapLocation {
    const { uiMapId, world } = point;
    return { uiMapId, ...worldToMap(requireBounds(uiMapId, this.mapBounds), world), world };
  }

  mapName(uiMapId: UiMapId): string {
    return (
      this.zoneByUiMapId(uiMapId)?.name ?? this.continentByUiMapId(uiMapId)?.name ?? this.#rxpNames.get(uiMapId) ?? `UI map ${uiMapId}`
    );
  }

  /**
   * The zone map under a world position on a continent, as RXP places a
   * continent `.goto`. Zone map rectangles overlap, so this prefers the zone
   * the hit grid names, then the zone whose map has the point nearest its
   * center. Undefined off the continents and where no zone map covers it.
   * The result is an estimate. It can name a neighbor far from a border, such as Felwood at Auberdine, so it can differ
   * from `C_Map.GetBestMapForUnit` in RXP.
   */
  zoneAt(world: WorldLocation): Zone | undefined {
    const continent = this.continents.find((c) => c.instance === world.instance);
    if (!continent) return undefined;
    const ui = worldToMap(continent.bounds, world);
    const hit = this.zoneAtContinentPoint(continent, ui.x, ui.y);
    let best: { zone: Zone; score: number } | undefined;
    for (const zone of this.zones) {
      if (zone.continent !== continent || !zone.bounds) continue;
      const pos = worldToMap(zone.bounds, world);
      if (pos.x < 0 || pos.x > 100 || pos.y < 0 || pos.y > 100) continue;
      const score = zone === hit ? -1 : Math.max(Math.abs(pos.x - 50), Math.abs(pos.y - 50));
      if (!best || score < best.score) best = { zone, score };
    }
    return best?.zone;
  }

  locate(world: WorldLocation, prefer?: UiMapId): MapLocation | undefined {
    const on = (uiMapId: UiMapId | undefined): MapLocation | undefined => {
      const b = uiMapId === undefined ? undefined : this.mapBounds.get(uiMapId);
      const pos = b?.instance === world.instance ? onMap(worldToMap(b, world)) : undefined;
      return pos && { uiMapId: uiMapId!, ...pos, world };
    };
    const area = (b: WorldBounds) => (b.maxX - b.minX) * (b.maxY - b.minY);
    const smallest = [...this.mapBounds]
      .filter(([id, b]) => b.instance === world.instance && !this.continentByUiMapId(id) && on(id))
      .sort(([, a], [, b]) => area(a) - area(b))[0]?.[0];
    return on(prefer) ?? on(this.zoneAt(world)?.uiMapId) ?? on(smallest);
  }

  /**
   * Formats a location as `.goto` arguments: RXP's name for its map, or the
   * map ID for maps RXP has no name for, which RXP also accepts, and map
   * percentages with two decimals.
   */
  formatLocation(location: Pick<MapLocation, "uiMapId" | "x" | "y">): string[] {
    const { uiMapId, x, y } = location;
    return [this.#rxpNames.get(uiMapId) ?? String(uiMapId), x.toFixed(2), y.toFixed(2)];
  }
}

/**
 * Labels map percentages with one decimal, such as "24.6, 74.7". A
 * percentage read back from a world position can carry a float error, as
 * 24.55 comes back as 24.549999999999997, so this drops that error before it
 * rounds. Halves round away from zero, so -1.25 shows as -1.3;
 * RXP accepts percentages outside 0 to 100. `.goto` arguments keep two
 * decimals (formatLocation).
 */
export function pointLabel(x: number, y: number): string {
  const tenth = (value: number) => ((Math.sign(value) * Math.round(Math.abs(Number((value * 10).toPrecision(12))))) / 10).toFixed(1);
  return `${tenth(x)}, ${tenth(y)}`;
}

const EDGE = 1e-9;

function onMap(p: { x: number; y: number }): { x: number; y: number } | undefined {
  const inside = (n: number) => n >= -EDGE && n <= 100 + EDGE;
  return inside(p.x) && inside(p.y) ? { x: clampPercent(p.x), y: clampPercent(p.y) } : undefined;
}

const clampPercent = (n: number) => Math.min(100, Math.max(0, n));

function requireBounds(uiMapId: UiMapId, table: ReadonlyMap<UiMapId, WorldBounds>): WorldBounds {
  const bounds = table.get(uiMapId);
  if (!bounds) throw new Error(`No world bounds for UI map ${uiMapId}.`);
  return bounds;
}

/** Lua's `tonumber` for decimal text; `undefined` where it returns nil. */
function luaNumber(text: string | undefined): number | undefined {
  if (text === undefined || text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

const SOURCE_NAMES: Readonly<Record<string, string>> = {
  override: "Override",
  recorder: "Recorder",
  wago: "Wago",
  questie: "Questie",
  rxp: "RXP",
  legacy: "Legacy",
};
const EDITION_NAMES: Readonly<Record<string, string>> = { era: "Era", sod: "SoD", forever: "Forever" };

function legacySourceLabel(key: string) {
  const [id, edition, extra] = key.split(":");
  if (
    id === undefined ||
    edition === undefined ||
    extra !== undefined ||
    !Object.hasOwn(SOURCE_NAMES, id) ||
    !Object.hasOwn(EDITION_NAMES, edition)
  )
    return key;
  return `${SOURCE_NAMES[id]} ${EDITION_NAMES[edition]}`;
}
