import { SourceRegistry } from "./gameData.ts";
import type { BundleSource, FieldOrigin } from "../../packages/data-contract/model.ts";
import {
  ENTITY_TYPES,
  type EntityDataFile,
  type EntityType,
  type Entity,
  type EntityField,
  type NamedEntity,
} from "../../packages/data-contract/entities.ts";
export * from "../../packages/data-contract/entities.ts";

export class EntityIndex {
  readonly #byType = new Map<EntityType, Map<number, Entity>>();
  readonly #search = new Map<EntityType, { entity: Entity; key: string }[]>();
  readonly #names = new Map<string, NamedEntity | AmbiguousName>();
  readonly #registry: SourceRegistry;
  readonly sources: readonly BundleSource[];

  constructor(input: EntityDataFile) {
    const { details = {}, sources = [] } = input;
    this.sources = sources;
    this.#registry = new SourceRegistry(sources);
    for (const type of ENTITY_TYPES) {
      const byId = new Map<number, Entity>();
      for (const [id, name, subtext] of input.entities[type]) {
        byId.set(id, { type, id, name, ...(subtext && { subtext }), ...details[type]?.[id] });
      }
      for (const entity of byId.values()) Object.freeze(entity);
      this.#byType.set(type, byId);
      this.#search.set(
        type,
        [...byId.values()]
          .map((entity) => ({ entity, key: entity.name.toLowerCase() }))
          .sort((a, b) => compare(a.key, b.key) || a.entity.id - b.entity.id),
      );
      if (type === "npc" || type === "item")
        for (const { entity, key } of this.#search.get(type)!) {
          const known = this.#names.get(key);
          if (!known) this.#names.set(key, { kind: type, id: entity.id });
          else {
            const npcIds = known.kind === "ambiguous" ? known.npcIds : known.kind === "npc" ? [known.id] : [];
            this.#names.set(key, { kind: "ambiguous", npcIds: type === "npc" ? [...npcIds, entity.id] : npcIds });
          }
        }
    }
  }

  fieldOrigin(entity: Entity, field: EntityField): FieldOrigin | undefined {
    return this.#registry.origin(entity.provenance, field);
  }

  lookup(type: EntityType, id: number): Entity | undefined {
    return this.#byType.get(type)?.get(id);
  }

  entityByName(name: string): NamedEntity | AmbiguousName | undefined {
    return this.#names.get(name.trim().toLowerCase());
  }

  search(type: EntityType, query: string, limit = 20): readonly Entity[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Limit must be 1–100");
    const key = query.trim().toLowerCase();
    if (!key) return [];
    const exact = /^[1-9]\d*$/.test(key) ? this.lookup(type, Number(key)) : undefined;
    const result: Entity[] = exact ? [exact] : [];
    const rows = this.#search.get(type) ?? [];
    for (let rank = 0; rank < 3; rank++) {
      for (const { entity, key: name } of rows) {
        if (result.length >= limit) return result;
        const nameRank = name === key ? 0 : name.startsWith(key) ? 1 : name.includes(key) ? 2 : -1;
        if (entity !== exact && nameRank === rank) result.push(entity);
      }
    }
    return result;
  }
}

export interface AmbiguousName {
  kind: "ambiguous";
  npcIds: readonly number[];
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
