import { name } from "./checks.ts";
import { QUEST_DEFAULTS, type FactionFacts, type GameDataFile, type QuestRow, type FactionField } from "./model.ts";
import type { BundleSource, Faction, SourceKey } from "./shared.ts";
import { ENTITY_TYPES, type EntityDataFile, type EntityType } from "./entities.ts";

type Unchecked<T> = { [K in keyof T]?: unknown };

/**
 * A quest file that `validateGameDataFile` accepts. Producer intermediates may
 * leave out quest fields, so only the top level and a row's `byFaction` have
 * types. Of a zone or continent entry, only a `provenance` field is checked,
 * and the entry need not be an object. `validateCompleteGameData` checks the rest.
 */
export type GameDataRecords = Unchecked<GameDataFile> &
  Pick<GameDataFile, "source" | "maxLevel" | "npcNames" | "sources"> & {
    quests: (Unchecked<QuestRow> & { byFaction?: Record<Faction, Unchecked<FactionFacts>> })[];
    zones: unknown[];
    continents: unknown[];
  };

export class SourceValidation {
  protected readonly sets: ReadonlyMap<SourceKey, BundleSource>;

  constructor(sources: unknown = []) {
    if (!Array.isArray(sources)) throw new Error("Invalid bundle sources");
    if (!sources.every(bundleSource)) throw new Error("Invalid bundle source");
    this.sets = new Map(sources.map((s) => [s.source, s]));
    if (this.sets.size !== sources.length) throw new Error("A source set appears twice");
  }

  requireDeclared(source: SourceKey, where: string): void {
    if (!this.sets.has(source)) throw new Error(`${where}: ${source} is not among the bundle's sources`);
  }

  require(source: SourceKey, where: string): void {
    if (typeof source !== "string") throw new Error(`${where}: invalid source`);
    if (!source.startsWith("override:")) this.requireDeclared(source, where);
  }

  check(provenance: unknown, where: string): void {
    if (provenance === undefined) return;
    if (!isObject(provenance) || !isObject(provenance.fields)) throw new Error(`${where}: invalid provenance`);
    for (const [field, won] of Object.entries(provenance.fields)) {
      if (!isObject(won) || typeof won.source !== "string" || (won.reason !== undefined && typeof won.reason !== "string"))
        throw new Error(`${where}.${field}: invalid field source`);
      this.require(won.source, `${where}.${field}`);
    }
    if (provenance.evidence !== undefined) {
      if (!isObject(provenance.evidence)) throw new Error(`${where}: invalid evidence`);
      for (const [source, evidence] of Object.entries(provenance.evidence)) {
        this.require(source, where);
        if (!Array.isArray(evidence) || evidence.some((e) => typeof e !== "string")) throw new Error(`${where}: invalid evidence`);
      }
    }
  }
}

const bundleSource = (set: unknown): set is BundleSource =>
  isObject(set) &&
  typeof set.source === "string" &&
  stringMap(set.pins) &&
  (set.derivedFrom === undefined ||
    (Array.isArray(set.derivedFrom) &&
      set.derivedFrom.every((ref) => isObject(ref) && typeof ref.source === "string" && edition(ref.edition) && stringMap(ref.pins))));

const FACTIONS: readonly Faction[] = ["Alliance", "Horde"];
const POINT_FIELDS = ["startPoints", "endPoints", "objectivePoints"] as const;
const ROW_KEYS: readonly string[] = ["id", "name", "observation", "unresolved", "byFaction", "textObjectives"] satisfies Exclude<
  keyof QuestRow | "unresolved",
  FactionField | "provenance"
>[];

function checkFactionRow({ byFaction, ...shared }: Record<string, unknown>, where: string): void {
  if (byFaction === undefined) return;
  const [alliance, horde] = FACTIONS.map((f) => (isObject(byFaction) ? byFaction[f] : undefined));
  if (!isObject(byFaction) || Object.keys(byFaction).length !== 2 || !isObject(alliance) || !isObject(horde))
    throw new Error(`${where}: byFaction needs Alliance and Horde`);
  const unresolved = Object.keys(alliance).filter((f) => f !== "provenance") as FactionField[];
  const listed = (facts: Record<string, unknown>) =>
    JSON.stringify(
      Object.keys(facts)
        .filter((f) => f !== "provenance")
        .sort(),
    );
  if (!unresolved.length || listed(alliance) !== listed(horde) || unresolved.some((f) => ROW_KEYS.includes(f))) {
    throw new Error(`${where}: byFaction needs the same faction fields for both factions`);
  }
  for (const [faction, facts] of [
    ["Alliance", alliance],
    ["Horde", horde],
  ] as const) {
    const cited = isObject(facts.provenance) ? Object.keys(facts.provenance) : [];
    if (cited.some((f) => !unresolved.includes(f as FactionField))) {
      throw new Error(`${where} (${faction}): byFaction cites a source for a field it does not give`);
    }
  }
  const sourced = isObject(shared.provenance) && isObject(shared.provenance.fields) ? shared.provenance.fields : {};
  for (const field of unresolved) {
    const fallback = (QUEST_DEFAULTS as Partial<Record<FactionField, unknown>>)[field];
    if (JSON.stringify(shared[field]) !== JSON.stringify(fallback) || sourced[field]) {
      throw new Error(`${where}.${field}: a field that differs by faction holds its default and no source outside byFaction`);
    }
  }
}

export function validateGameDataFile(input: unknown): asserts input is GameDataRecords {
  if (!isObject(input) || !Array.isArray(input.quests)) throw new Error("A game data file needs a quest list");
  if (
    !isObject(input.source) ||
    ![input.source.name, input.source.version, input.source.pack].every((v) => typeof v === "string") ||
    typeof input.maxLevel !== "number" ||
    !Number.isFinite(input.maxLevel) ||
    !Array.isArray(input.zones) ||
    !Array.isArray(input.continents) ||
    !stringMap(input.npcNames)
  )
    throw new Error("Invalid game data schema");
  const registry = new SourceValidation(input.sources);
  const quests: readonly unknown[] = input.quests;
  const seen = new Set<unknown>();
  for (const row of quests) {
    if (!isObject(row)) throw new Error("A quest row is not an object");
    const where = `Quest ${String(row.id)}`;
    const { byFaction } = row;
    const stored = [
      [where, row.provenance, row] as const,
      ...FACTIONS.flatMap((f) => {
        const facts: unknown = isObject(byFaction) ? byFaction[f] : undefined;
        return isObject(facts) ? [[`${where} (${f})`, { fields: facts.provenance ?? {} }, facts] as const] : [];
      }),
    ];
    for (const [at, provenance, facts] of stored) {
      registry.check(provenance, at);
      for (const field of POINT_FIELDS) {
        const points: unknown = facts[field];
        if (points === undefined) continue;
        if (!Array.isArray(points)) throw new Error(`${at}.${field} is not a list`);
        const bad = points.findIndex((p) => !isObject(p));
        if (bad >= 0) throw new Error(`${at}.${field}[${bad}] is not a point`);
      }
    }

    checkFactionRow(row, where);
    if (Object.hasOwn(row, "unresolved")) throw new Error(`${where}: only lookups mark fields unresolved`);
    if (seen.has(row.id)) throw new Error(`${where} has two rows`);
    seen.add(row.id);
  }
  for (const [id, npc] of entries(input.npcs)) registry.check(propertiesOf(npc, `NPC ${id}`).provenance, `NPC ${id}`);
  for (const [id, value] of entries(input.droppers)) {
    const byFaction = propertiesOf(value, `Item ${id}`).byFaction;
    for (const f of FACTIONS) {
      const list: unknown = Array.isArray(value) || byFaction === undefined ? value : propertiesOf(byFaction, `Item ${id}`)[f];
      if (list === undefined || list === null) continue;
      if (!Array.isArray(list)) throw new Error(`Item ${id}: droppers is not a list`);
      list.forEach((d: unknown, i) => {
        const where = `Item ${id}.droppers[${i}]`;
        const dropper = propertiesOf(d, where);
        const guaranteed = dropper.guaranteed;
        if (guaranteed !== undefined) {
          if (dropper.type !== "npc" || !isObject(guaranteed) || !name(guaranteed.source))
            throw new Error(`${where}: invalid guaranteed drop`);
          registry.requireDeclared(guaranteed.source, where);
        }
      });
    }
  }

  for (const c of input.continents) {
    const continent = propertiesOf(c, "Continent");
    registry.check(continent.provenance, `Continent ${String(continent.uiMapId)}`);
  }
  for (const z of input.zones) {
    const zone = propertiesOf(z, "Zone");
    registry.check(zone.provenance, `Zone ${String(zone.id)}`);
  }
}

export function validateEntityDataFile(input: unknown): asserts input is EntityDataFile {
  if (
    !input ||
    typeof input !== "object" ||
    !("version" in input) ||
    input.version !== 2 ||
    !("entities" in input) ||
    !input.entities ||
    typeof input.entities !== "object"
  ) {
    throw new Error("Invalid entity data schema");
  }
  const { details = {}, sources = [] } = input as Partial<EntityDataFile>;
  if (!isObject(details) || !Array.isArray(sources)) throw new Error("Invalid entity data schema");
  const registry = new SourceValidation(sources);
  for (const type of Object.keys(details)) {
    if (!ENTITY_TYPES.includes(type as EntityType) || !isObject(details[type as EntityType])) throw new Error(`Invalid ${type} details`);
  }
  for (const type of ENTITY_TYPES) {
    const rows = (input.entities as Record<string, unknown>)[type];
    if (!Array.isArray(rows) || !rows.length) throw new Error(`Missing ${type} data`);
    const byId = new Set<number>();
    for (const row of rows) {
      if (
        !Array.isArray(row) ||
        (row.length !== 2 && row.length !== 3) ||
        !Number.isSafeInteger(row[0]) ||
        row[0] <= 0 ||
        typeof row[1] !== "string" ||
        !row[1] ||
        row[1] !== row[1].trim() ||
        /[\x00-\x1f\x7f]/.test(row[1]) ||
        byId.has(row[0] as number) ||
        (row.length === 3 &&
          (type !== "spell" || typeof row[2] !== "string" || !row[2] || row[2] !== row[2].trim() || /[\x00-\x1f\x7f]/.test(row[2])))
      ) {
        throw new Error(`Invalid or duplicate ${type} record`);
      }
      byId.add(row[0] as number);
    }
    for (const [id, extra] of Object.entries(details[type] ?? {})) {
      const known = byId.has(Number(id)),
        where = `${type} ${id}`;
      if (!known || String(Number(id)) !== id) throw new Error(`Details for unknown ${where}`);
      if (
        !isObject(extra) ||
        !Object.keys(extra).length ||
        Object.keys(extra).some((k) => k !== "changes" && k !== "provenance") ||
        (extra.changes !== undefined && ((type !== "npc" && type !== "item") || !isObject(extra.changes))) ||
        (extra.provenance !== undefined && (!isObject(extra.provenance) || !isObject(extra.provenance.fields)))
      ) {
        throw new Error(`Invalid details for ${where}`);
      }
      registry.check(extra.provenance, where);
    }
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function propertiesOf(value: unknown, where: string): Record<string, unknown> {
  if (value === null || value === undefined) throw new Error(`${where} is null`);
  return isObject(value) ? value : {};
}

function entries(value: unknown): [string, unknown][] {
  return value === null || value === undefined ? [] : Object.entries(value);
}

const stringMap = (v: unknown): boolean => isObject(v) && Object.values(v).every((s) => typeof s === "string");
const edition = (v: unknown): boolean => v === "era" || v === "sod" || v === "forever";
