import type { WorldBounds, WorldLocation } from "./geometry.ts";
import type {
  Faction,
  CapturedObjective,
  ChangeNote,
  FieldValue,
  ItemCount,
  Range,
  ReputationReward,
  SourceKey,
  BundleSource,
  FieldSource,
  SkillRequirement,
  ReputationRequirement,
  InstanceId,
  UiMapId,
  ZoneId,
} from "./shared.ts";
export type { GameVersion, BundleSource, FieldSource } from "./shared.ts";

export interface GameDataFile {
  /** Where the data came from, for display and rebuilds. */
  source: { name: string; version: string; pack: string };
  maxLevel: number;
  quests: QuestRow[];
  zones: ZoneRecord[];
  continents: ContinentRecord[];
  npcNames: Record<string, string>;
  /**
   * Level ranges, elite status, and spawn zones by NPC ID, for NPCs a source
   * gives levels or a rank, and the spawn zones of the NPCs `droppers` names
   * and quest objectives need; only Forever bundles have them.
   */
  npcs?: Record<string, NpcRecord>;
  /**
   * What drops each item a quest objective or text objective names, by item
   * ID, for items a source says anything about; only Forever bundles have
   * them. `GameData.droppers` reads them.
   */
  droppers?: Record<string, FieldValue<Dropper[]>>;
  /**
   * The NPCs that sell each item a quest objective or text objective names,
   * by item ID, best-ranked source first, then by NPC ID; only Forever
   * bundles have them. One list serves both factions. An empty list: a
   * source says no NPC sells the item. A missing item: no source says.
   * `GameData.sellers` reads them.
   */
  sellers?: Record<string, Seller[]>;
  /** Classes each playable race can create, by race ID, from the client's CharBaseInfo. */
  raceClasses?: Record<string, number[]>;
  /** Taxi nodes where a flight master serves players, by TaxiNodes ID. */
  flightNodes?: Record<string, FlightNodeRecord>;
  /** Reputation faction names, by Faction ID. */
  factionNames?: Record<string, string>;
  /** Playable races, by ChrRaces ID. */
  races?: Record<string, RaceRecord>;
  /** Classes, by ChrClasses ID. */
  classes?: Record<string, ClassRecord>;
  /**
   * Professions and specializations, by the QuestieProfessions key that
   * `requiredSkill.skill` and `requiredSpecialization` use: a SkillLine ID
   * for a profession, a Spell ID for a specialization.
   */
  professions?: Record<string, ProfessionRecord>;
  /** Reputation standings, lowest first. */
  standings?: StandingRecord[];
  /** The XP to leave each level, from level 1 to `maxLevel - 1`. */
  xpToNextLevel?: number[];
  /** Pins and lineage of each set that `provenance` names, once per bundle. */
  sources?: BundleSource[];
}

export interface FlightNodeRecord {
  /** The client's name, such as "Lakeshire, Redridge". `.fp` and `.fly` match against it. */
  name: string;
  /** Absent: flight masters of both factions serve the node. */
  faction?: Faction;
  /** Where a character talks to the flight master, in the axes of `QuestPoint.world`. */
  world: WorldLocation;
}
export interface RaceRecord {
  /** `ClientFileString`, which `UnitRace` returns. Two races of different factions can share it. */
  fileName: string;
  faction: Faction;
  /**
   * ChrRaces `PlayableRaceBit`: `requiredRaceMask` holds `2 ** maskBit`
   * for the race. It does not follow the race ID.
   */
  maskBit?: number;
  /**
   * TaxiNodes IDs, ascending, of the flight masters that a new character of
   * the race knows. Empty when it knows none. Since 0.18.0.
   */
  startingFlightNodes?: number[];
}
export interface ClassRecord {
  /** `Filename`, which `UnitClass` returns. */
  fileName: string;
}
export interface ProfessionRecord {
  name: string;
  /**
   * When `requiredSpecialization` gives this key, it means no specialization
   * in the profession yet, and a character without the profession meets it.
   */
  noSpecialization?: true;
}
export interface StandingRecord {
  name: string;
  /** The standing's lowest value, in points from Neutral, the axis of `requiredMinRep` and `requiredMaxRep`. */
  min: number;
}

/**
 * Where a record's fields came from, keyed by runtime field name. A field
 * without an entry has no recorded source. Pins and lineage live in the
 * bundle's `sources`, not here.
 */
export interface Provenance<F extends string = string> {
  fields: Partial<Record<F, FieldSource>>;
  /** Evidence each winning source cited for the record, as `MergedRecord.evidence`. */
  evidence?: Partial<Record<SourceKey, string[]>>;
}

/** A field's winning source with its evidence and, for a source set, the set's pins and lineage. */
export interface FieldOrigin extends FieldSource, Partial<Omit<BundleSource, "source">> {
  evidence?: string[];
}

export interface Quest {
  /** Partial observed Forever data; absent fields/indices must not be inferred. */
  observation?: { source: string; capturedAt: string; partial: true };
  id: number;
  name: string;
  /** Minimum character level to accept the quest; null means unknown. */
  requiredLevel: number | null;
  questLevel: number | null;
  /** Bits of `races[].maskBit`; 0 means any race; null means unknown. */
  requiredRaceMask: number | null;
  /** Bit `2 ** (ChrClasses ID - 1)` of each class; 0 means any class; null means unknown. */
  requiredClassMask: number | null;
  /**
   * The faction a source says the quest is for, kept beside the race mask,
   * which it does not change. `null`: the source shows the quest is open to
   * both factions. Absent: no source says.
   */
  requiredFaction?: Faction | null;
  /** The producer's label for the race mask, such as `Alliance`, `Horde`, or `Any race`. */
  raceRequirement: string;
  /** The producer's label for the class mask, such as `Mage` or `Any class`. */
  classRequirement: string;
  /** Zones of the quest's giver, objectives, and turn-in. */
  zoneIds: ZoneId[];
  /** Quest types that the data producer derives, such as `general`, `class`, `dungeon`, or `elite`. */
  types: string[];
  /** Quests that must all be completed first (Questie `preQuestGroup`); null means unknown. */
  preQuestGroup: number[] | null;
  /** Quests of which any one must be completed first (Questie `preQuestSingle`); null means unknown. */
  preQuestSingle: number[] | null;
  nextQuestInChain: number | null;
  baseXp: number | null;
  /** Where the quest starts: NPCs, objects, or item drops. */
  startPoints: QuestPoint[];
  endPoints: QuestPoint[];
  objectiveText: string[];
  objectives: QuestObjective[];
  objectivePoints: QuestPoint[];
  /** How the quest changed from Classic. */
  changes?: ChangeNote;
  /** Items the quest always gives, in the source's order. */
  rewardItems?: ItemCount[];
  /** Items the player chooses one of, in the source's order. */
  rewardChoices?: ItemCount[];
  rewardReputation?: ReputationReward[];
  /** Copper. */
  rewardMoney?: number;
  /**
   * The quest page's objective rows, in page order. They claim no
   * `.complete` index; `objectives` holds the numbered objectives.
   */
  capturedObjectives?: CapturedObjective[];
  /**
   * The objective rows of the quest's newest captured page that shows any,
   * in page order with repeats, each with what it needs. Present only when no
   * entry of `objectives` has an index. `capturedObjectives` names their
   * source. Absent when the objectives or the rows differ by faction.
   */
  textObjectives?: TextObjective[];
  /**
   * The quest page's objective text up to its first inline element, which
   * may cut it short. It is not `objectiveText` and gives no objective index.
   */
  capturedObjectiveText?: { text: string; limitation: "text-nodes-before-first-element" };
  // Who can take the quest, beyond level, race, class, and prerequisites, as
  // the dataset gives it. Absent: no source says. The Era source gives every
  // quest `exclusiveTo`, but leaves out each other field where the quest has
  // no such requirement, so for those fields absent also covers quests that
  // the source knows have none. `requiredMaxLevel` and
  // `requiredSpecialization` have no other way to say none.
  /** Quest IDs, sorted; taking or completing any of them closes this quest. `[]` means none. */
  exclusiveTo?: number[];
  /** The quest that must be in the quest log. 0 means none. */
  parentQuest?: number;
  /** The highest character level that can take the quest. */
  requiredMaxLevel?: number;
  /** A skill line ID and the lowest skill value that can take the quest. `null`: a source clears the requirement. */
  requiredSkill?: SkillRequirement | null;
  /** A faction ID and the lowest reputation value, in points, that can take the quest. `null`: a source clears it. */
  requiredMinRep?: ReputationRequirement | null;
  /** A faction ID and the reputation value, in points, the character must stay below. `null`: a source clears it. */
  requiredMaxRep?: ReputationRequirement | null;
  /** A QuestieProfessions profession or specialization key the character needs. */
  requiredSpecialization?: number;
  /** Winning sources by field; `GameData.fieldOrigin` resolves them. */
  provenance?: Provenance<QuestField>;
  /**
   * Set only on a quest looked up without a faction whose facts differ by
   * faction: the fields that differ. Each holds its `QUEST_DEFAULTS` value and
   * has no provenance, so it asserts nothing; look the quest up with a
   * faction for its value. A default field not listed here is absent data.
   */
  unresolved?: FactionField[];
}

export type QuestField = Exclude<keyof Quest, "id" | "observation" | "provenance" | "unresolved" | "textObjectives">;
/** Quest fields that can differ by faction. A name cannot, since search and every lookup name the quest by it. */
export type FactionField = Exclude<QuestField, "name">;

/**
 * A quest as the bundle stores it. Fields both factions
 * share sit at the top. A field whose sources give each faction its own value
 * sits in both `byFaction` entries, each with its winning source, and at the
 * top holds its `QUEST_DEFAULTS` value without provenance. `GameData` gives
 * each faction's view, or the shared one with `unresolved`, never a row.
 */
export interface QuestRow extends Omit<Quest, "unresolved"> {
  byFaction?: Record<Faction, FactionFacts>;
}

/** One faction's values for the fields that differ by faction, and their winning sources. Both factions list the same fields. */
export type FactionFacts = Partial<Pick<Quest, FactionField>> & { provenance?: Partial<Record<FactionField, FieldSource>> };

/** One objective of a quest, in the order its source lists them. */
export interface QuestObjective {
  /**
   * 1-based index, as in `.complete <quest>,<index>`, only when the source
   * establishes it. Absent means unknown: never derive it from list position
   * or type grouping. Every objective from the Era source has one.
   */
  index?: number;
  /** Objective kind: `item`, `monster`, `object`, `event`, `spell`, or `reputation`. */
  type: string;
  id: number | null;
  /** IDs that satisfy the objective; `QuestPoint.sourceId` refers to these. */
  ids: number[];
  name: string;
  text?: string;
  /**
   * The required count: the quantity of the one captured objective row that
   * links one of `ids` as the objective's type, when that row links no other
   * objective. A faction's view counts from its own objectives and captured
   * rows; a view whose objectives both factions share but whose captured rows
   * differ by faction has no count. `capturedObjectives` names the source.
   * Absent means unknown.
   */
  count?: number;
  /**
   * What the objective needs, set only when evidence shows it. Absent means
   * the consumer keeps its default reading (a `monster` objective needs kills),
   * not unknown, and is not evidence of kills.
   */
  need?: ObjectiveNeed;
}

/** A captured objective row that no numbered objective stands for. */
export interface TextObjective {
  /** The row's text without the source's count marks or `(Provided)` mark. */
  name: string;
  /** The quantity the row shows; absent when it shows none. */
  count?: number;
  need: ObjectiveNeed;
  /** The one NPC or item the row links, when it links exactly one of either and none of the other. */
  link?: { kind: "npc" | "item"; id: number };
}
/**
 * What an objective needs:
 * - `kills`: killing a target, or getting an item by kills, as evidence shows.
 * - `providedItem`: an item the quest gives; the source marks the row `(Provided)`.
 * - `action`: a task other than kills, such as talk, heal, find, resurrect,
 *   emote, buy, gather, or use. It may link an NPC or item.
 *
 * A link alone shows neither a kill nor an action. A text objective always has
 * a need: `kills` only with kill evidence, `providedItem` for the `(Provided)`
 * mark, and `action` for any other row, linked or not.
 */
export type ObjectiveNeed = "kills" | "providedItem" | "action";

export interface QuestPoint {
  /** The zone the source lists the point under. */
  zoneId: ZoneId;
  /**
   * The UI map the source placed the point on; an area can have several.
   * Its source's own map geometry settled `world`.
   */
  uiMapId: UiMapId;
  world: WorldLocation;
  /** Percentages of `uiMapId` on the source's client, 0 to 100 inside it. */
  x: number;
  y: number;
  /** `start`, `turn-in`, `mob`, `item`, `object`, `trigger`, or `extra`. */
  kind: string;
  /** `npc`, `object`, `item`, `trigger`, or `extra`. */
  sourceType: string;
  /** NPC, object, or item ID, when the source has one. */
  sourceId?: number;
  sourceName: string;
  /**
   * For an `extra` point, the objective its entry goes with, as the source
   * numbers it (`ExtraObjective.association`); 0 names none. Never an RXP
   * `.complete` index.
   */
  association?: number;
}

/** An NPC's gameplay facts. A field no source gives is absent, never a default. */
export interface NpcRecord {
  /** Inclusive level range. */
  levels?: Range;
  /** Whether the NPC's rank is elite, rare elite, or boss (`isElite`). */
  elite?: boolean;
  /**
   * Zones of the NPC's spawns, ascending, placed or not: the zones
   * of its merged whole `spawns` list and of the spawn observations that
   * outrank it, as the data producer ranks them. Its provenance names the highest
   * source that gives a zone, else the whole list's; `provenance.evidence`
   * cites each source that gives one. Empty when a source says the NPC spawns
   * nowhere. `GameData.npc` resolves a value that differs by faction.
   */
  zoneIds?: FieldValue<ZoneId[]>;
  /**
   * Where players find the NPC, for both factions. Absent when no spawn row
   * is confirmed; never empty. Confirmed spawns come first by `guid`, then
   * places by world x, then y. When the NPC has a Forever place, the producer confirms a row only when a place is within
   * 50 yd horizontally of its spawn or patrol point, on the same map. Consumers do not repeat that check.
   */
  spawns?: NpcSpawn[];
  /** Winning sources by field; `GameData.fieldOrigin` resolves them. */
  provenance?: Provenance<NpcField>;
}
export type NpcField = "levels" | "elite" | "zoneIds" | "spawns";

/**
 * A confirmed spawn row, at its respawn point with its height `z` in world
 * yards, or a place where players see the NPC that no confirmed row explains.
 * `guid` is the spawn row's ID, unique in one NPC's list. `interior` is the
 * `Interior.id` whose surfaces hold the spawn.
 */
export type NpcSpawn = { world: WorldLocation; z: number; guid: number; interior?: string } | { world: WorldLocation };
/** An NPC for one faction, or the zones both factions share; `zoneIds` is absent when they differ and no faction is known. */
export type Npc = Omit<NpcRecord, "zoneIds"> & { zoneIds?: ZoneId[] };

export interface Dropper {
  type: "npc" | "object" | "item";
  id: number;
  /** The producer excludes this dropper for objectives of the item. Absent means eligible. */
  objectiveExcluded?: true;
  /**
   * The estimated chance that one loot of this dropper holds the item, above
   * 0 and at most 1. Absent when the dataset has no estimate.
   */
  chance?: number;
  /** One item per NPC kill while the quest needs it, backed by a declared bundle source. */
  guaranteed?: { source: SourceKey };
}

export interface Seller {
  id: number;
}

export type ZoneCategory = "city" | "zone" | "dungeon" | "raid" | "battleground" | "other";

/** A rectangle in percentages of an enclosing map. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ZoneRecord {
  /** World bounds from the zone's pinned source; the dataset geometry's win for its `uiMapId`. */
  bounds?: WorldBounds;
  /** `QuestPoint.zoneId` refers to this. */
  id: ZoneId;
  uiMapId?: UiMapId;
  name: string;
  category: ZoneCategory;
  instance: InstanceId;
  minLevel?: number;
  maxLevel?: number;
  provenance?: Provenance<ZoneDisplayField>;
}
export type ZoneDisplayField = "category" | "minLevel" | "maxLevel";
export type ContinentDisplayField = "crop" | "hitGrid";

export interface ContinentRecord {
  /** 0 Eastern Kingdoms or 1 Kalimdor. */
  instance: InstanceId;
  uiMapId: UiMapId;
  name: string;
  /** Part of the continent's UI map that `hitGrid` covers. */
  crop: Rect;
  hitGrid: ZoneHitGrid;
  provenance?: Provenance<ContinentDisplayField>;
}

/** A zone with the world bounds and continent that `GameData` attaches. */
export interface Zone extends ZoneRecord {
  /** World bounds: the dataset geometry's for its UI map, else the record's. */
  bounds?: WorldBounds;
  /** The continent for zones on Eastern Kingdoms or Kalimdor. */
  continent?: Continent;
}

export interface Continent extends ContinentRecord {
  bounds: WorldBounds;
}

/**
 * Which zone covers each cell of a continent's `crop`. Row `r`, column `c`
 * holds a character whose index in `alphabet` selects from `zoneIds`; index
 * 0 means no zone.
 */
export interface ZoneHitGrid {
  width: number;
  height: number;
  alphabet: string;
  zoneIds: ZoneId[];
  rows: string[];
}

/**
 * A quest field's value when no source gives it, or when it differs by
 * faction and no faction is known. The optional fields are absent instead.
 */
export const QUEST_DEFAULTS = {
  requiredLevel: null,
  questLevel: null,
  requiredRaceMask: null,
  requiredClassMask: null,
  raceRequirement: "Race requirement unknown",
  classRequirement: "Class requirement unknown",
  zoneIds: [],
  types: [],
  preQuestGroup: null,
  preQuestSingle: null,
  nextQuestInChain: null,
  baseXp: null,
  startPoints: [],
  endPoints: [],
  objectiveText: [],
  objectives: [],
  objectivePoints: [],
} as const satisfies Partial<Record<FactionField, unknown>>;
