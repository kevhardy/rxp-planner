/** Game editions a source set can describe; Forever bundles cite Era and SoD sets as fallback lineage. */
export type GameVersion = "era" | "sod" | "forever";

export type Faction = "Alliance" | "Horde";

declare const idSpace: unique symbol;
type IdOf<Space extends string> = number & { readonly [idSpace]?: Space };
/** Questie zone ID. */
export type ZoneId = IdOf<"zone">;
/** WoW UI map ID, as RXP and `.goto` use it. */
export type UiMapId = IdOf<"uiMap">;
/** WoW map (instance) ID: 0 Eastern Kingdoms, 1 Kalimdor, others instances. */
export type InstanceId = IdOf<"instance">;

/** A skill and the rank the quest needs in it. */
export interface SkillRequirement {
  skill: number;
  value: number;
}
/** A faction and a reputation value, which may be negative. */
export interface ReputationRequirement {
  faction: number;
  value: number;
}
/** An inclusive range. */
export interface Range {
  min: number;
  max: number;
}

/**
 * One row of a quest page's objective list, in page order. Unlike a
 * `QuestObjective`, it claims no `.complete` index or quest-log order, and it
 * can name an item the quest provides rather than one to collect.
 */
export interface CapturedObjective {
  /** The row's text, on one line. */
  text: string;
  /** The count the row shows, when it shows one. */
  quantity?: number;
  /** Entities the row links to, in page order, each once. */
  links: EntityLink[];
}
export interface EntityLink {
  type: "npc" | "object" | "item" | "spell";
  id: number;
}

export interface ItemCount {
  item: number;
  count: number;
}
/** A negative value costs reputation. */
export interface ReputationReward {
  faction: number;
  value: number;
}

/** How a source says an entity changed from Classic, as its Forever pages note. */
export interface ChangeNote {
  status: "new" | "updated" | "unchanged" | "unconfirmed";
  /** Kinds of change, such as `level_changed`, sorted. */
  labels: string[];
  /** The note's lines, in the source's order. */
  lines: string[];
  /** Lines the page does not display, in `lines` order. */
  notShown?: string[];
}

/** A value that differs by faction. Both factions are required and must differ. */
export interface FactionValues<V> {
  byFaction: Record<Faction, V>;
}
export type FieldValue<V> = V | FactionValues<V>;

export type SourceKey = string;

export interface SourceRef {
  source: string;
  edition: GameVersion;
  /** Versions, commits, builds, or hashes that fix the input, by name. */
  pins: Record<string, string>;
}

export interface BundleSource {
  source: SourceKey;
  pins: SourceRef["pins"];
  derivedFrom?: SourceRef[];
}

/** The winning source of one field. */
export interface FieldSource {
  source: SourceKey;
  /** The override’s reason, when an override won. */
  reason?: string;
}
