import type { BundleSource, ChangeNote } from "./shared.ts";
import type { Provenance } from "./model.ts";

export const ENTITY_TYPES = ["item", "quest", "npc", "spell", "object"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Names are plain text, never HTML. Identity is the pair (type, id). */
export interface Entity {
  readonly type: EntityType;
  readonly id: number;
  readonly name: string;
  /** Source spell rank or other subtext, such as "Rank 1" or "Racial". */
  readonly subtext?: string;
  /** How an NPC or item changed from Classic. */
  readonly changes?: ChangeNote;
  /**
   * Winning sources by field; `EntityIndex.fieldOrigin` resolves them. A
   * `subtext` entry without a subtext means its source shows the spell has none.
   */
  readonly provenance?: Provenance<EntityField>;
}

export type EntityField = "name" | "subtext" | "changes";

export type EntityDetails = Pick<Entity, "changes" | "provenance">;

export interface NamedEntity {
  kind: "npc" | "item";
  id: number;
}

/** Compact wire format; each type contains [ID, English name, optional spell subtext]. */
export interface EntityDataFile {
  version: 2;
  entities: Record<EntityType, [number, string, string?][]>;
  /** Details by type, then entity ID, for entities that have them. */
  details?: Partial<Record<EntityType, Record<string, EntityDetails>>>;
  /** Pins and lineage of each set that `provenance` names, once per bundle. */
  sources?: BundleSource[];
}
