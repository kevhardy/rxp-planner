import {
  nearest,
  within,
  type Dropper,
  type FlightNodes,
  type Spawn,
  type UiMapId,
  type WorldLocation,
  type ZoneId,
} from "../data/index.ts";
import { luaNumber, type CommandLine, type GuideDocument, type Step } from "../guide/index.ts";
import {
  advance,
  objectiveRef,
  withStatus,
  type Act,
  type ActBody,
  type Effect,
  type MobSpawn,
  type PassKill,
  type Target,
} from "./character.ts";
import { commandRule } from "./commands.ts";
import { holds } from "./condition.ts";
import { dropChance, ITEM_TOLERANCE, type DropChance } from "./drops.ts";
import {
  creditDrops,
  partyCount,
  levelOf,
  killSequence,
  lineKills,
  objectiveKills,
  objectiveTargets,
  stepMobs,
  takeKills,
  tallyKills,
  type Kill,
  type KillProgress,
  type ObjectiveCount,
  type StepKills,
  type StepMobs,
} from "./killTargets.ts";
import { TIMELINE_MODEL } from "./model.ts";
import { resolvePlaybackSettings, type PlaybackChoices, type PlaybackSettings } from "./playbackSettings.ts";
import { lineQuest } from "./lineQuest.ts";
import { isOptionalPoint, pointRun } from "./points.ts";
import { hearthGateHolds, type GateState } from "./gates.ts";
import { routeGraph, stepLabels, walkRoute, type GuidePreview, type HideReason, type RouteEnd, type StepPreview } from "./preview.ts";
import type { Faction, Profile } from "./profile.ts";
import { killAreaSettings, killXpSettings, killAreaValue, parseLevelTarget, simDirectives } from "./simComments.ts";
import { applyStatePatch, type Arrival, type Known, type StatePatch } from "./stateOverride.ts";
import type { Location, Warning } from "./validate.ts";
import {
  addXp,
  adjustedKillXp,
  atTotal,
  killXp,
  questXp,
  targetXp,
  totalXp,
  xpToNextLevel,
  type KillXpSettings,
  type LevelTarget,
  type PartySize,
} from "./xp.ts";
import { MAX_LEVEL, type GameRules } from "../data/gameRules.ts";

/** A world position with the zone map the guide named, when known. */
export interface SimPosition extends WorldLocation {
  readonly uiMapId?: UiMapId;
}

/** Game data the simulator reads. Lookups give undefined for an unknown ID. */
export interface SimData {
  quest(id: number): SimQuest | undefined;
  npc(id: number): SimNpc | undefined;
  item(id: number): SimItem | undefined;
  /**
   * The one NPC or item whose name is exactly `name`, for objectives the data
   * has only as text; undefined when none has it.
   */
  entityByName(name: string): NameMatch | undefined;
  /** Where `.goto` arguments point; undefined when they name no one place. */
  locateGoto(args: readonly string[]): SimPosition | undefined;
  /** The flight masters that `.fp` and `.fly` name. */
  flights: FlightNodes;
  rules: GameRules;
  /** The UI map that an RXP zone name or alias names, which `.zoneskip` compares. */
  uiMapNamed(token: string): UiMapId | undefined;
  /** The nearest known Spirit Healer on the death point's world map. */
  nearestSpiritHealer?(from: WorldLocation): SimPosition | undefined;
  /** Where an NPC spawns for a quest's objectives, or with no quest for a grind. */
  spawns?: (npcId: number, questId: number | undefined) => readonly Spawn[];
  /** The NPCs whose records list their spawns, from which a grind with no named mob picks a local one. */
  npcsWithSpawns?(): readonly number[];
  /** Fallback UI map for a position with no guide zone. */
  zoneAt?(at: WorldLocation): UiMapId | undefined;
}

export interface SimQuest {
  name: string;
  /** Turning in any one of these unlocks the quest; empty when none is needed, null when unknown. */
  preAny: readonly number[] | null;
  /** Every one of these must be turned in first; null when unknown. */
  preAll: readonly number[] | null;
  /** The player takes and hands in the quest in one visit, as `QuestInfo.acceptOnTurnIn` says. */
  acceptOnTurnIn: boolean;
  level: number | null;
  /** The level needed to accept it. */
  requiredLevel: number | null;
  /** XP at the quest's level, before scaling by the player's level. */
  baseXp: number | null;
  /** Zones of the giver, objectives, and turn-in. */
  zoneIds: readonly ZoneId[];
  /** Where the quest's NPCs stand, for position after `.accept` and `.turnin`. */
  givers: readonly WorldLocation[];
  enders: readonly WorldLocation[];
  giverNpcs: readonly number[];
  enderNpcs: readonly number[];
  /** The rows `.complete` counts, as `completeRows` selects them. */
  objectives: SimObjectives;
  /** Bits from `GameRules.raceBits`; 0 means any race, null unknown. */
  requiredRaceMask: number | null;
  /** Bits from `CLASS_BITS`; 0 means any class, null unknown. */
  requiredClassMask: number | null;
  /** The faction the quest is for; null when it is open to both or no source says. */
  requiredFaction: Faction | null;
  /** The next quest in its chain, whose taking closes this one; null or 0 when none. */
  nextQuestInChain: number | null;
  /** Taking or turning in any of these closes this quest. */
  exclusiveTo: readonly number[];
  /** The quest that must be in the log; 0 when none. */
  parentQuest: number;
  /** The highest level that can take the quest; 0 when none. */
  requiredMaxLevel: number;
  /** A skill line ID and the skill value needed. */
  requiredSkill: { skill: number; value: number } | null;
  /** A faction ID and the reputation value, in points, needed. */
  requiredMinRep: { faction: number; value: number } | null;
  /** A faction ID and the reputation value, in points, to stay below. */
  requiredMaxRep: { faction: number; value: number } | null;
  /** A profession skill line ID or a specialization spell ID; 0 when none. */
  requiredSpecialization: number;
  /** A holiday or other world event quest, which only its event offers. */
  event: boolean;
}

/** A quest's objective rows: numbered objectives, or text rows that `.complete` numbers by page order. Never both. */
export type SimObjectives = readonly SimNumberedObjective[] | readonly SimTextObjective[];

export type SimObjective = SimNumberedObjective | SimTextObjective;

export interface SimNumberedObjective {
  /** The index in `.complete <quest>,<index>`; null when the data does not establish it. */
  index: number | null;
  /** What the objective names: NPCs for `monster`, items for `item`, and neither for `other`, which needs no kills. */
  kind: "monster" | "item" | "other";
  /** NPC IDs for `monster`, item IDs for `item`. */
  ids: readonly number[];
  count: number | null;
  name: string;
  /**
   * What the objective needs, when the data shows it, as for a text row.
   * Without it, or with `kills`, a `monster` needs kills of `ids` and an
   * `item` the dropper kills that yield its count at their drop chances;
   * `providedItem` and `action` need no kills, though the objective keeps
   * its IDs.
   */
  need?: SimTextObjective["need"];
}

/** An objective row with text only, with no IDs or index; kills come from its link, else from matching its name. */
export interface SimTextObjective {
  kind: "text";
  name: string;
  count: number | null;
  /**
   * `kills`: the row names a mob, or an item mobs drop. `providedItem`: the
   * quest gives the item. `action`: the row needs no kills, such as using an
   * object.
   */
  need: "kills" | "providedItem" | "action";
  /** The one NPC or item the row links, when it links exactly one. */
  link?: { kind: "npc" | "item"; id: number };
}

export interface SimNpc {
  /** Whole levels the NPC spawns at; null when unknown. */
  levels: { min: number; max: number } | null;
  /** null when the data gives no rank. */
  elite: boolean | null;
  /** Zones where it spawns. */
  zoneIds: readonly ZoneId[];
}

export interface SimItem {
  /** NPCs that drop the item, best first. */
  droppers: readonly SimDropper[];
  /** Only objects or containers give the item, such as ore or chests, so it needs no kills. */
  objectsOnly: boolean;
  /** An NPC sells the item, so guides buy it and it needs no kills, even when mobs drop it. */
  sold: boolean;
}

type SimDropper = Pick<Dropper, "id" | "chance" | "guaranteed">;

/** An exact name match: one NPC or item, or several entities sharing the name, with the NPCs among them. */
export type NameMatch = { kind: "npc" | "item"; id: number } | { kind: "ambiguous"; npcIds: readonly number[] };

/**
 * A `-- @sim` directive. A comment after a line applies to that line
 * (`line`); a comment line applies to its step (`step`) or, in the header,
 * to the guide (`guide`). `at` is the line holding the comment.
 */
export type SimDirective = { at: Location; scope: "line" | "step" | "guide" } & SimSetting;

type SimSetting =
  /** Guide default or step multiplier; exact XP is step-only. */
  | { key: "killmult" | "killxp"; value: number }
  /** `kills=N` on a `.complete` line: the kills its objective counts at that line, of `mob=` when given. */
  | { key: "kills"; count: number; mob?: number }
  /** `mob=ID` alone on a `.complete` line: the mob its objective's kills are. */
  | { key: "mob"; mob: number }
  /** Mob IDs or names that override a grind step or line. */
  | { key: "grind"; mobs: readonly string[] }
  /** `drop=P` on a `.complete` line: the drop chance, from 0.01 to 1, for the kills of its item objective at that line. */
  | { key: "drop"; chance: number }
  /** `extra=N mob=ID`: kills that count toward no objective. */
  | { key: "extra"; count: number; mob: number }
  | { key: "level"; target: LevelTarget }
  /** `done=ID,ID`, header only: quests to treat as turned in. */
  | { key: "done"; questIds: readonly number[] }
  /** `party=1` or `party=2`, header only: who plays the guide's steps. */
  | { key: "party"; size: PartySize }
  /** `respawn=S`, header or step: seconds before a killed mob's spawn has a mob again. */
  | { key: "respawn"; seconds: number }
  /** `area=Y`, header or step: the kill area's radius in yards. */
  | { key: "area"; yards: number }
  /** `near=X,Y`, step only: the kill area's center, at map coordinates in the zone of the step's `.goto`. */
  | { key: "near"; x: number; y: number }
  /** `pass=Y`, header or `#completewith` step: how far from the walked line the step's objectives kill passed mobs; 0 kills none. */
  | { key: "pass"; yards: number }
  /** `state={...}`, step only: what the step sets on arrival. */
  | { key: "state"; patch: StatePatch };

/**
 * A step's kill-area settings from `@sim` comments; each absent one takes the
 * timeline's value, and `respawn` and `radius` the Playback settings. `near`
 * is where `near=` points.
 */
export interface KillAreaSettings {
  respawn?: number;
  radius?: number;
  near?: WorldLocation;
}

export interface SimState {
  level: number;
  /** XP into `level`; 0 at level 60. */
  xp: number;
  /**
   * Where the last step ends. That is where its last `.hs`, death skip, or
   * `.fly` landed when no walk follows the landing, else its `.goto`, else
   * the NPC of its last `.accept` or `.turnin`, else where its walk ends.
   * `state=` can also set it.
   */
  position: SimPosition | null;
  /** Quests in the log, in accept order. */
  log: ReadonlyMap<number, QuestProgress>;
  /** Quests turned in, from `done=`, or before the route's start. */
  done: ReadonlySet<number>;
  /** Where `.hs` goes: the last `.home`, else the first place the character travels to; null before that. */
  bind: SimPosition | null;
  /** Flight masters known at character creation or learned with `.fp` or at a `.fly` departure, by taxi node ID. */
  flightPaths: ReadonlySet<number>;
}

export interface QuestProgress {
  /** `complete` once every row is done; a quest with no rows is complete on accept. */
  status: "incomplete" | "partial" | "complete";
  /** Progress on each of `SimQuest.objectives`, in order. */
  objectives: readonly ObjectiveProgress[];
}

/**
 * Kills or items counted toward one objective. `.complete 246,1,1` counts
 * one without completing it; a later `.complete 246,1` or the turn-in counts
 * the rest and completes it. `count` grows even when the required count is
 * unknown.
 */
export interface ObjectiveProgress {
  count: number;
  complete: boolean;
  /**
   * What `.complete` lines have assumed of the objective's kills. Absent
   * until a `.complete` line names the objective.
   */
  kills?: KillProgress;
}

/**
 * A reviewed state to start a route at, in place of the empty log and the
 * turn-ins of the guides that lead to the start, for guides that RXP's links
 * do not reach from level 1. Level and XP stay the profile's and `xp`.
 */
export interface SimStart {
  /**
   * Quests in the log, in accept order, with progress on each of the quest's
   * `objectives`. The status follows from the progress.
   */
  log: ReadonlyMap<number, readonly SeededProgress[]>;
  /** Quests turned in. A quest in `log` too counts as turned in. */
  done: ReadonlySet<number>;
}

/** Objective progress in a `SimStart`. Its `count` counts as progress already made, as `ObjectiveProgress.kills.counted` does. */
type SeededProgress = Pick<ObjectiveProgress, "count" | "complete">;

/** An objective: `objectives[row]` of the quest. */
export interface ObjectiveRef {
  questId: number;
  row: number;
}

export const refKey = (ref: ObjectiveRef): string => `${ref.questId}:${ref.row}`;

export interface XpGain {
  quest: number;
  kills: number;
  /** From `.xp` lines and `level=` checkpoints. */
  checkpoint: number;
}

interface TurnInXp {
  at: Location;
  questId: number;
  xp: number;
}

/** Reaching a level: one per level gained. */
export interface LevelUp {
  level: number;
  /** The line whose XP reached it. */
  at: Location;
  /** For kill XP: kill `n` of `of` in `StepSnapshot.kills[entry]`. */
  kill?: { entry: number; n: number; of: number };
}

/**
 * Where kills' mob came from: a `mob=` or `extra=` override, the objective's
 * own NPCs, the step's unit lines (`KillAssumption.mobLines` names them), the
 * item's droppers in the quest's zones, its first dropper, or a text row's name.
 */
export type MobSource = "override" | "objective" | "stepMob" | "zoneDroppers" | "firstDropper" | "nameMatch";

/** A command that names a step's mobs. */
export type UnitLine = "mob" | "target" | "unitscan";

/** Kills the simulator assumes for one objective, or for an `extra=` directive. */
export interface KillAssumption {
  /** The `.complete` or `.turnin` line where the kills count, or the `extra=` comment. */
  at: Location;
  /** Absent for `extra=` kills. */
  objective?: ObjectiveRef;
  eligibleNpcIds?: readonly number[];
  count: number;
  /**
   * `data`: the objective's count. `guideText`: a count read from the
   * `.complete` line's text. `override`: `kills=` or `extra=`.
   */
  countFrom: "data" | "guideText" | "override";
  mobFrom: MobSource;
  /** For `stepMob`: the commands whose lines named the mobs, in the order `UnitLine` lists them. */
  mobLines?: readonly UnitLine[];
  /**
   * For an item objective: the item, or null when the data names none. Each
   * member needs the item, so the party needs one drop for each member's item.
   */
  itemId?: number | null;
  /**
   * For an item objective: each mob with known levels, in the order that the
   * objective's items are split across them, with its chance per kill to drop
   * the item.
   */
  drops?: readonly { npcId: number; chance: DropChance }[];
  /**
   * The mobs killed, with kills at each mob level; all kills sum to `count`.
   * After simulation, `elite` marks the mobs whose kills earned elite XP.
   */
  mobs: readonly { npcId: number; elite?: true; levels: readonly { level: number; kills: number }[] }[];
  /** Actual rewards, grouped by rate after simulation, including level changes. */
  xp?: { settings: KillXpSettings; rates: { base: number; reward: number; count: number }[] };
}

/** An `.xp` line or `level=` checkpoint, compared with the simulated state before it. */
export interface Checkpoint {
  at: Location;
  kind: "xp" | "level";
  target: LevelTarget;
  /**
   * XP from the simulated state to the target: positive when the simulation
   * jumps up to it, negative when it was already past and keeps its value.
   */
  gap: number;
  /**
   * Kills that close a positive gap, of each mob in turn; null when there is
   * no gap or no mob. One mob unless a grind's `mob=` names several.
   */
  kills: { count: number; mobs: readonly { npcId: number; count: number }[] } | null;
}

export type StepNote =
  /** A `.turnin` counts objectives' kills that no `.complete` line counted. */
  | { kind: "killsAtTurnIn"; at: Location; questId: number; kills: number }
  /**
   * An item objective whose item only objects or containers give, so it
   * counts no kills. `count` is null when the required count is unknown.
   */
  | { kind: "gathered"; at: Location; objective: ObjectiveRef; itemId: number; count: number | null }
  /** An item objective whose item an NPC sells, so it counts no kills; `count` as for `gathered`. */
  | { kind: "bought"; at: Location; objective: ObjectiveRef; itemId: number; count: number | null }
  | KillsLater;

/**
 * A `.complete` line in a `#completewith` step, or followed by
 * `.disablecheckbox`, that counts none of its objective's kills. `countedAt`
 * is the next line or turn-in that counts some, or null when none does.
 */
export interface KillsLater {
  kind: "killsLater";
  at: Location;
  objective: ObjectiveRef;
  reason: "completewith" | "disablecheckbox";
  countedAt: Location | null;
}

/** One step on the route, whether shown or not. */
export interface StepSnapshot {
  /** `GuidePreview.source` and the index into `doc.steps`. */
  guide: number;
  step: number;
  /** The step checked at the simulated state before it. */
  preview: StepPreview;
  /** The state before the step: the previous step's, or the guide's `afterHeader` for the first. */
  before: SimState;
  /** The state after the step; a skipped step, or one in a `hidden` guide, carries it unchanged. */
  state: SimState;
  /** What the character does in the step, in order. Their effects, applied in order to `before`, give `state`. */
  acts: readonly Act[];
  npcs: readonly number[];
  xp: XpGain;
  /** The quest XP of each turn-in that gives some; they sum to `xp.quest`. */
  turnIns: readonly TurnInXp[];
  levelUps: readonly LevelUp[];
  kills: readonly KillAssumption[];
  checkpoints: readonly Checkpoint[];
  notes: readonly StepNote[];
  /** The step's kill-area settings, when its kills have any. */
  killArea?: KillAreaSettings;
  /** What the step's `state=` sets outside `SimState`, as `Arrival` gives it. */
  override?: Pick<Arrival, "hearth" | "position">;
  /** The seconds until the Hearthstone is ready that the step's `.cooldown` gate assumed. */
  hearth?: number;
}

/**
 * Seconds until the Hearthstone is ready at steps with a `.cooldown` gate, by
 * `hearthKey`. Only the priced timeline knows them; a step not listed
 * assumes its `state=` `hearth`, else a ready Hearthstone.
 */
type HearthClock = ReadonlyMap<string, number>;

export const hearthKey = (guide: number, step: number) => `${guide}/${step}`;

export interface GuideSimulation {
  /** `GuidePreview.source`. */
  source: number;
  /** `GuidePreview.hidden`: RXP never runs the guide, so its steps change nothing. */
  hidden?: HideReason;
  /**
   * Who plays the guide's steps, from its header's `party=`. The members are
   * alike, so one `SimState` describes each of them. A guide is for one party size. When two players form a group, a new
   * guide starts, and it assumes that both did the same steps.
   */
  party: PartySize;
  /** The previous guide's end, or the route's start. */
  start: SimState;
  /** After the header's `level=` and `done=`. */
  afterHeader: SimState;
  /** After the last step. */
  end: SimState;
  /** The header's `level=` checkpoints. */
  checkpoints: readonly Checkpoint[];
  /** One per `doc.steps` entry, in order. */
  steps: readonly StepSnapshot[];
  /**
   * The guide as `previewRoute` gives it, with its header read and its steps
   * gated at the simulated state.
   */
  preview: GuidePreview;
}

/** A simulated route, in `RoutePreview.guides` order. */
export interface RouteSimulation {
  /** From the start level and XP, and the `SimStart` when given. */
  start: SimState;
  guides: readonly GuideSimulation[];
  warnings: readonly SimWarning[];
  /** How the route ends, as `RoutePreview.end` says. */
  end?: RouteEnd;
  /** The cooldowns that the simulation was given. */
  hearth: HearthClock;
  /** The Playback settings that the route was simulated with, which pricing reads. */
  readonly settings: PlaybackSettings;
  /** The same route, with the same settings, simulated with other Hearthstone cooldowns. */
  rerun(hearth: HearthClock): RouteSimulation;
}

/** The warnings the simulation raises. Validation that reads the simulated state adds the others. */
export type SimWarning = Extract<
  Warning,
  { kind: "levelTooLow" | "checkpointGap" | "checkpointBehind" | "unknownSimKey" | "noQuestXp" | "noKillTarget" | "noKillCount" }
>;

/**
 * Simulates the route `walkRoute` takes from the guide at `start`, gating
 * each step at the level, XP, and quests reached before it. A step whose
 * `#level` tag, or quest-state, `.xp`, or `.maxlevel` gate, fails is skipped,
 * with a `tag` or `command` reason, and changes nothing, as do the steps an
 * `.xp` or `.maxlevel` label jump passes over, with a `jump` reason. The character starts at
 * `profile.level` with `xp` into it, having turned in every quest that the
 * guides leading to `start` through `#next` turn in. A `seed` replaces that
 * log and those turn-ins; the caller checks it against `data`.
 *
 * Within a step, lines and `level=` checkpoints apply in text order: a
 * checkpoint on the `step` line before the body, one on a comment line where
 * it stands, and one after a line once the line applies. `extra=` kills
 * count at the same place, before its checkpoints. A `.complete` line counts
 * its objective's kills up to a partial line's count, else all that no line
 * has counted, and `kills=N` counts N there instead; a `.turnin` counts the
 * rest before its quest XP. A line in a `#completewith` step or before
 * `.disablecheckbox` counts none without `kills=`. The first line to count
 * kills sets the mob. Kills count one at a time, each at the level reached
 * before it in act order. Pass-by kills can come before the lines, so the XP,
 * the checkpoint gaps with their grinds, the level that an `.accept` checks,
 * and the turn-in XP at level 60 follow act order. A `.collect` line that
 * names a quest has the player hold its items, which count toward the
 * quest's objectives for them while the quest is in the log, or from its
 * accept. Items bought in an `#ah` step need no kills at the turn-in. The
 * position changes after the step. A guide whose
 * header sets `party=2` splits kill XP, and needs a drop for each member's
 * item, but keeps every monster kill count. `choices` are the player's
 * Playback settings; the defaults fill the rest.
 */
export function simulateRoute(
  guides: readonly GuideDocument[],
  start: number,
  profile: Profile,
  data: SimData,
  xp = 0,
  seed?: SimStart,
  choices: PlaybackChoices = {},
): RouteSimulation {
  return simulate(guides, start, profile, data, xp, seed, resolvePlaybackSettings(choices), new Map(), new Map());
}

const clockKey = (clock: HearthClock) =>
  [...clock]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, seconds]) => `${key}=${seconds}`)
    .join(";");

function simulate(
  guides: readonly GuideDocument[],
  start: number,
  profile: Profile,
  data: SimData,
  xp: number,
  seed: SimStart | undefined,
  settings: PlaybackSettings,
  hearth: HearthClock,
  reruns: Map<string, RouteSimulation>,
): RouteSimulation {
  const { rules } = data;
  const carried = carry(profile.faction, settings);
  const log = new Map<number, QuestProgress>();
  for (const [questId, seeded] of seed?.log ?? []) log.set(questId, withStatus(seeded.map(({ count, complete }) => ({ count, complete }))));
  const first = advance(
    {
      ...atTotal(rules, totalXp(rules, profile.level, xp)),
      position: null,
      log,
      done: new Set(),
      bind: null,
      flightPaths: flightPathsAtCreation(rules, profile),
    },
    { kind: "done", questIds: [...(seed ? seed.done : priorTurnIns(guides, start, profile, data, settings))] },
  );
  progressMade(carried, new Map(), first.log);
  let state = first;
  const route: GuideSimulation[] = [];
  const warnings: SimWarning[] = [];
  let directives: SimDirective[] = [];
  let steps: StepSnapshot[] = [];
  let hidden: HideReason | undefined;
  let preview: GuidePreview | undefined;
  let end: RouteEnd | undefined;
  const known: Known = { data, faction: profile.faction };
  let override: StepSnapshot["override"];
  let cooldown: number | undefined;
  const arrive = (g: number, s: number) => {
    cooldown = hearth.get(hearthKey(g, s));
    const patches = directives.filter((d): d is Extract<SimDirective, { key: "state" }> => d.key === "state" && d.at.step === s);
    if (hidden || !patches.length || !holds(guides[g]!.steps[s]!.line.condition, { ...profile, level: state.level })) return;
    const to: Arrival = { state };
    for (const d of patches)
      for (const problem of applyStatePatch(to, d.patch, known)) warnings.push({ kind: "unknownSimKey", at: d.at, ...problem });
    progressMade(carried, state.log, to.state.log);
    if (to.position) carried.at = to.position;
    state = to.state;
    if (to.hearth !== undefined || to.position)
      override = { ...(to.hearth !== undefined && { hearth: to.hearth }), ...(to.position && { position: to.position }) };
  };
  const gateState = (): GateState => {
    const uiMapId = state.position ? (state.position.uiMapId ?? data.zoneAt?.(state.position)) : undefined;
    const zone = uiMapId === undefined ? undefined : { uiMapId, uiMapNamed: (token: string) => data.uiMapNamed(token) };
    const xp = { into: state.xp, toNext: xpToNextLevel(rules, state.level) };
    return { ...state, xp, ...(zone && { zone }), hearth: cooldown ?? override?.hearth ?? 0 };
  };

  for (const event of walkRoute(guides, start, profile, () => state.level, true, gateState, arrive)) {
    if (event.kind === "guide") {
      const { source, doc, headerLines } = event.guide;
      if (route.length > 0) route.at(-1)!.end = state;
      const read = simDirectives(doc, source);
      warnings.push(...read.warnings);
      directives = read.directives.filter((d) => d.at.step !== undefined || headerLines[d.at.line!]);
      carried.party = directives.findLast((d) => d.key === "party")?.size ?? 1;
      carried.windowEnds = windowEnds(doc.steps, profile);
      carried.background = [];
      steps = [];
      hidden = event.guide.hidden;
      preview = { ...event.guide, steps: [], shown: 0 };
      const guideStart = state;
      let checkpoints: Checkpoint[] = [];
      if (!hidden) ({ state, checkpoints } = runHeader(directives, headerLines, state, data, carried, warnings));
      route.push({
        source,
        ...(hidden && { hidden }),
        party: carried.party,
        start: guideStart,
        afterHeader: state,
        end: state,
        checkpoints,
        steps,
        preview,
      });
    } else if (event.kind === "step") {
      const step = event.preview;
      const snapshot =
        hidden || !step.shown
          ? emptySnapshot(event.guide, event.step, step, state)
          : runStep(guides[event.guide]!, event.guide, event.step, step, state, directives, data, carried, warnings);
      state = snapshot.state;
      const assumed = cooldown ?? override?.hearth ?? 0;
      const gated = !hidden && hearthGateHolds(guides[event.guide]!.steps[event.step]!, step.lines, assumed) !== undefined;
      steps.push({ ...snapshot, ...(override && { override }), ...(gated && { hearth: assumed }) });
      override = undefined;
      cooldown = undefined;
      preview!.steps.push(step);
      if (step.shown) preview!.shown++;
    } else end = event.end;
  }
  if (route.length > 0) route.at(-1)!.end = state;
  const simulation: RouteSimulation = {
    start: first,
    guides: route,
    warnings,
    ...(end && { end }),
    hearth,
    settings,
    rerun: (cooldowns) => {
      const key = clockKey(cooldowns);
      let again = reruns.get(key);
      if (!again) reruns.set(key, (again = simulate(guides, start, profile, data, xp, seed, settings, cooldowns, reruns)));
      return again;
    },
  };
  reruns.set(clockKey(hearth), simulation);
  return simulation;
}

interface Carried {
  mob?: number;
  killed: Map<number, number | undefined>;
  owed: Map<number, Map<number, ObjectiveKills>>;
  collected: Map<number, Map<number, number>>;
  bought: Map<number, Map<number, number>>;
  party: PartySize;
  at: SimPosition | null;
  faction: Faction;
  windowEnds: ReadonlyMap<string, number>;
  background: BackgroundKills[];
  readonly settings: PlaybackSettings;
}

const carry = (faction: Faction, settings: PlaybackSettings): Carried => ({
  killed: new Map(),
  owed: new Map(),
  collected: new Map(),
  bought: new Map(),
  party: 1,
  at: null,
  faction,
  windowEnds: new Map(),
  background: [],
  settings,
});

/**
 * An objective that a `#completewith` step's `.collect` or `.complete`
 * line works on while RXP shows the step: through its label's step, or for
 * `next`, through the end that `nextWindowEnd` gives at the steps after it.
 */
interface BackgroundKills {
  guide: number;
  until: number | "next";
  ref: ObjectiveRef;
  to: number;
  total: ObjectiveCount;
  fresh?: KillAssumption;
  reach: number;
}

/** The kill-XP settings that the simulator counts with, for a guide played by `party`. */
export const withParty = (settings: KillXpSettings, party: PartySize): KillXpSettings => (party > 1 ? { ...settings, party } : settings);

interface ObjectiveKills extends KillProgress {
  closed: boolean;
  waiting?: KillsLater[];
  killedOnTheWay?: true;
}

function getOrAdd<K, V>(map: Map<K, V>, key: K, create: () => NoInfer<V>): V {
  let value = map.get(key);
  if (value === undefined) map.set(key, (value = create()));
  return value;
}

function owedFor(route: Carried, ref: ObjectiveRef): ObjectiveKills {
  return getOrAdd(
    getOrAdd(route.owed, ref.questId, () => new Map()),
    ref.row,
    () => ({ counted: 0, closed: false }),
  );
}

function countedKills(owed: ObjectiveKills, at: Location): void {
  for (const note of owed.waiting ?? []) note.countedAt = at;
  delete owed.waiting;
}

function progressMade(route: Carried, before: SimState["log"], after: SimState["log"]): void {
  for (const questId of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(questId);
    const now = after.get(questId);
    if (now === was) continue;
    if (!now) {
      leaveLog(route, questId);
      continue;
    }
    const owed = getOrAdd(route.owed, questId, () => new Map());
    now.objectives.forEach((row, i) => {
      if (row === was?.objectives[i]) return;
      const old = owed.get(i);
      owed.set(i, {
        ...(old?.first && { first: old.first }),
        ...(old?.total && { total: old.total }),
        ...(old?.waiting && { waiting: old.waiting }),
        ...(old?.killedOnTheWay && { killedOnTheWay: old.killedOnTheWay }),
        counted: row.count,
        closed: row.complete,
      });
    });
  }
}

function leaveLog(route: Carried, questId: number): void {
  route.owed.delete(questId);
  route.background = route.background.filter((w) => w.ref.questId !== questId);
}

function runHeader(
  directives: readonly SimDirective[],
  headerLines: readonly boolean[],
  state: SimState,
  data: SimData,
  route: Carried,
  warnings: SimWarning[],
): { state: SimState; checkpoints: Checkpoint[] } {
  const { rules } = data;
  const checkpoints: Checkpoint[] = [];
  for (const d of directives) {
    if (d.at.step !== undefined || !headerLines[d.at.line!]) continue;
    if (d.key === "done") {
      const after = advance(state, { kind: "done", questIds: d.questIds });
      progressMade(route, state.log, after.log);
      state = after;
    } else if (d.key === "level") {
      const check = checkpoint(
        state,
        d.at,
        "level",
        d.target,
        data,
        route.mob === undefined ? [] : [route.mob],
        warnings,
        withParty(killXpSettings(directives), route.party),
      );
      checkpoints.push(check);
      if (check.gap > 0) state = advance(state, { kind: "xp", ...atTotal(rules, totalXp(rules, state.level, state.xp) + check.gap) });
    }
  }
  return { state, checkpoints };
}

function emptySnapshot(guide: number, step: number, preview: StepPreview, state: SimState): StepSnapshot {
  return {
    guide,
    step,
    preview,
    before: state,
    state,
    acts: [],
    npcs: [],
    xp: { quest: 0, kills: 0, checkpoint: 0 },
    turnIns: [],
    levelUps: [],
    kills: [],
    checkpoints: [],
    notes: [],
  };
}

// RXP completes a step when every element is complete, skipped, or textOnly
// (`addon.UpdateStepCompletion` in GuideWindow.lua).
function completeOnArrival(step: Step, state: SimState, data: SimData, route: Carried): boolean {
  const { rules } = data;
  const commandDone = (line: CommandLine): boolean | undefined | "unknown" => {
    const named = lineQuest(line);
    const questId = named?.questId;
    const current = questId === undefined ? undefined : state.log.get(questId);
    switch (pointRun(line) ?? commandRule(line.name)?.arrival ?? "unknown") {
      case "goto": {
        // Only a positive radius on a point that is not optional makes a checkbox;
        // Lua treats a trailing "0" as true (`addon.functions["goto"]` in functions.lua).
        // RXP tests `radius > 0`, which a NaN radius fails too.
        const radius = luaNumber(line.args[3] ?? "") ?? 0;
        if (!(radius > 0) || isOptionalPoint(line)) return undefined;
        const to = data.locateGoto(line.args);
        const from = route.at;
        return !!(to && from && within(to, from, radius));
      }
      case "xp": {
        if (luaNumber(line.args[1] ?? "") !== undefined) return undefined;
        const arg = (line.args[0] ?? "").replaceAll(" ", "");
        const reverse = arg.startsWith("<");
        const target = parseLevelTarget(reverse ? arg.slice(1) : arg);
        return target !== undefined && totalXp(rules, state.level, state.xp) >= targetXp(rules, target) !== reverse;
      }
      case "accept":
        return questId !== undefined && (state.done.has(questId) || state.log.has(questId));
      case "turnin":
        return questId !== undefined && (state.done.has(questId) || turnInSkipped(line, state));
      case "complete": {
        if ((luaNumber(line.args[3] ?? "") ?? 0) % 2 === 1) return undefined;
        if (questId === undefined) return false;
        if (state.done.has(questId) || (named!.skipIfMissing && !current)) return true;
        const obj = luaNumber(line.args[1] ?? "");
        const ref = obj === undefined ? undefined : objectiveRef(data.quest(questId), questId, obj);
        if (!current || !ref) return false;
        const row = current.objectives[ref.row];
        const count = luaNumber(line.args[2] ?? "");
        const owed = route.owed.get(questId)?.get(ref.row);
        if (hasUncountedKills(owed, count !== undefined && count > 0 ? count : Infinity)) return false;
        return !!row && (row.complete || (count !== undefined && count > 0 && row.count >= count));
      }
      case "collect": {
        const flags = luaNumber(line.args[4] ?? "") ?? 0;
        if (flags < 0 || flags % 2 === 1) return undefined;
        const collect = collectLine(line);
        if (
          collect &&
          itemRefs(data.quest(collect.questId), collect.questId, collect.item).some((ref) =>
            hasUncountedKills(route.owed.get(collect.questId)?.get(ref.row), collect.count),
          )
        )
          return false;
        return (
          !!collect && (collectSkipped(collect, state) || (route.collected.get(collect.questId)?.get(collect.item) ?? 0) >= collect.count)
        );
      }
      case "abandon":
        return line.args.every((arg) => {
          const quest = luaNumber(arg);
          return quest !== undefined && !state.log.has(quest);
        });
      case "fp":
        if ((luaNumber(line.args[1] ?? "") ?? 0) % 2 === 1) return undefined;
        const node = data.flights.named(line.args[0] ?? "", route.faction).node;
        return !!node && state.flightPaths.has(node.id);
      case "waypoint":
      case "ingamewaypoint":
      case "pin":
      case "none":
        return undefined;
      case "unknown":
        return "unknown";
    }
  };
  const objectives: boolean[] = [];
  for (const line of step.body) {
    if (line.kind === "other") return false;
    if (line.kind === "command" && line.name === "disablecheckbox") {
      // The modifier attaches across informational lines, except dynamicText
      // elements such as complete/collect, even when their checkbox is hidden
      // (`parseLine` in GuideLoader.lua, `addon.functions.disablecheckbox` in
      // functions.lua).
      if (objectives.length) objectives[objectives.length - 1] = true;
    } else if (line.kind === "command") {
      const done = commandDone(line);
      if (done === "unknown") return false;
      if (done !== undefined || line.name === "complete" || line.name === "collect") objectives.push(done ?? true);
    } else if (line.kind === "text" && line.marker === "+") objectives.push(false);
  }
  return objectives.every(Boolean);
}

function hasUncountedKills(owed: ObjectiveKills | undefined, target = Infinity): boolean {
  return !!owed && !owed.closed && !!owed.total && owed.counted < Math.min(target, owed.total.count);
}

function turnInSkipped(line: CommandLine, state: SimState): boolean {
  const quest = lineQuest(line);
  if (!quest?.skipIfMissing) return false;
  const current = state.log.get(quest.questId);
  return !current || ((luaNumber(line.args[1] ?? "") ?? 0) > 0 && current.status !== "complete");
}

function collectSkipped(collect: NonNullable<ReturnType<typeof collectLine>>, state: SimState): boolean {
  const current = state.log.get(collect.questId);
  return (
    (!collect.ignoreTurnIn && (state.done.has(collect.questId) || current?.status === "complete")) || (!!current && collect.anyObjective)
  );
}

function expireBackground(route: Carried, guide: number, step: number, preview: StepPreview): void {
  const next = nextWindowEnd(step, preview, route.windowEnds);
  route.background = route.background
    .map((w) => (w.until === "next" ? { ...w, until: next } : w))
    .filter((w) => {
      const owed = route.owed.get(w.ref.questId)?.get(w.ref.row);
      const open = w.guide === guide && (w.until === "next" || windowOpen(w.until, step + 1));
      return open && !!owed && !owed.closed && owed.counted < w.to;
    });
}

type GrindOverride = Extract<SimDirective, { key: "grind" }> & { ids: readonly number[] };

interface StepRun extends StepLedger {
  readonly guide: number;
  readonly s: number;
  readonly step: Step;
  readonly applying: Step;
  readonly preview: StepPreview;
  readonly before: SimState;
  readonly directives: readonly SimDirective[];
  readonly active: readonly SimDirective[];
  readonly overrides: readonly GrindOverride[];
  readonly mobs: StepMobs;
  readonly completewith: string | undefined;
  readonly until: BackgroundKills["until"] | undefined;
  readonly pass: Extract<SimDirective, { key: "pass" }> | undefined;
  readonly data: SimData;
  readonly route: Carried;
  readonly warnings: SimWarning[];
  state: SimState;
  readonly acts: Act[];
  readonly gains: Map<Effect, RecordedGain>;
  readonly grinds: Map<Checkpoint, (level: number) => readonly number[]>;
  readonly requires: Map<Location, { questId: number; requiredLevel: number }>;
  readonly kills: KillAssumption[];
  readonly turnIns: TurnInXp[];
  readonly checkpoints: Checkpoint[];
  readonly notes: StepNote[];
  readonly talks: number[];
  goto: SimPosition | undefined;
  npc: { places: readonly WorldLocation[]; act: number; target: Target } | undefined;
  hunts: boolean;
  readonly collecting: ObjectiveRef[];
  readonly credited: Map<string, number>;
  readonly passedSpawns: Set<string>;
  passKills: number;
  readonly passProgress: Set<Effect>;
}

function runStep(
  doc: GuideDocument,
  guide: number,
  s: number,
  preview: StepPreview,
  before: SimState,
  directives: readonly SimDirective[],
  data: SimData,
  route: Carried,
  warnings: SimWarning[],
): StepSnapshot {
  const snapshot = emptySnapshot(guide, s, preview, before);
  const step = doc.steps[s]!;
  const applying: Step = { ...step, body: step.body.map((line, i) => (preview.lines[i] ? line : { kind: "blank", indent: "" })) };
  const active = directives.filter((d) => d.at.step !== s || d.at.line === undefined || preview.lines[d.at.line]);
  const overrides = grindOverrides(active, s, data, warnings);
  const explicitWork = active.some((d) => d.at.step === s && (d.key === "kills" || d.key === "extra" || d.key === "level"));
  const completewith = preview.tags.get("completewith")?.value;
  const { pass } = killAreaSettings(active, s);
  if (pass?.at.step === s && completewith === undefined)
    warnings.push({ kind: "unknownSimKey", at: pass.at, key: "pass", value: killAreaValue(pass), problem: "misplaced" });
  if (!explicitWork && completeOnArrival(applying, before, data, route)) {
    stepKillArea(active, s, applying, [], data, warnings);
    expireBackground(route, guide, s, preview);
    return snapshot;
  }
  const settings = withParty(killXpSettings(active, s), route.party);
  const until = completewith === "next" ? "next" : completewith === undefined ? undefined : route.windowEnds.get(completewith);
  const run: StepRun = {
    guide,
    s,
    step,
    applying,
    preview,
    before,
    directives,
    active,
    overrides,
    mobs: stepMobs(applying, data),
    completewith,
    until,
    pass,
    data,
    route,
    warnings,
    settings,
    totals: snapshot.xp,
    state: before,
    acts: [],
    gains: new Map(),
    grinds: new Map(),
    requires: new Map(),
    kills: [],
    turnIns: [],
    checkpoints: [],
    notes: [],
    talks: [],
    goto: undefined,
    npc: undefined,
    hunts: false,
    collecting: [],
    credited: new Map(),
    passedSpawns: new Set(),
    passKills: 0,
    passProgress: new Set(),
  };
  const { kills, turnIns, checkpoints, notes, talks } = run;

  afterLine(run, undefined, assumeKills(run, undefined));
  step.body.forEach((line, i) => {
    if (!preview.lines[i]) return;
    const assumed = assumeKills(run, i);
    if (line.kind === "command") runCommand(run, line, { guide, step: s, line: i }, assumed);
    afterLine(run, i, assumed);
  });

  const walked = walkStep(run);
  const ordered = settleXpInActOrder(walked, before, run, data, warnings);
  run.state = { ...run.state, level: ordered.level, xp: ordered.xp };
  const killArea = stepKillArea(active, s, applying, ordered.acts, data, warnings);
  const npcs = new Set(talks);
  for (const [id, lines] of run.mobs.lines) {
    if (lines.includes("target") || lines.includes("mob")) npcs.add(id);
  }
  return {
    ...snapshot,
    state: run.state,
    acts: ordered.acts,
    npcs: [...npcs],
    levelUps: ordered.levelUps,
    turnIns: turnIns.filter((t) => !ordered.maxed.has(t)),
    kills,
    checkpoints,
    notes,
    ...(killArea && { killArea }),
  };
}

function walkStep(run: StepRun): Act[] {
  const { acts, route, before, data, guide, s, preview, passProgress } = run;
  const npcPlace = run.npc?.places.length ? (nearest(run.npc.places, before.position) ?? run.npc.places[0]) : undefined;
  const position = run.goto ?? npcPlace ?? before.position;
  const mode = ownTravelMode(run);
  const place = run.npc?.places.length ? run.npc : undefined;
  const implicit: Act | undefined =
    mode !== "background" && position && !acts.some((a) => a.kind === "go")
      ? { kind: "go", to: position, target: place?.target ?? { kind: "guidePlace" }, at: { guide, step: s }, effects: [] }
      : undefined;
  if (implicit) acts.splice(place?.act ?? 0, 0, implicit);
  const from = route.at;
  const walked = walk(acts, mode, implicit, route, run.state, run.goto, data);
  run.state = walked.state;
  const after = walked.landed ?? run.goto ?? npcPlace ?? walked.acts.findLast((a) => a.kind === "go")?.to ?? before.position;
  const legs = straightLegs(walked.acts, from, mode);
  placePassBy(walked.acts, legs, passBy(run, legs));
  expireBackground(route, guide, s, preview);
  if (after !== before.position) {
    const effect: Effect = { kind: "position", at: after };
    run.state = advance(run.state, effect);
    walked.acts.push({ kind: "update", at: { guide, step: s }, effects: [effect] });
  }
  placePassProgress(walked.acts, passProgress);
  return walked.acts;
}

function assumeKills(run: StepRun, line: number | undefined): StepKills {
  const { applying, guide, s, directives, data, route } = run;
  return lineKills(applying, { guide, step: s, ...(line !== undefined && { line }) }, directives, data, run.mobs, (ref) => {
    const owed = route.owed.get(ref.questId)?.get(ref.row);
    return owed && { ...(owed.total && { total: owed.total }), ...(owed.first && { started: true }) };
  });
}

function afterLine(run: StepRun, line: number | undefined, assumed: StepKills): void {
  const { warnings, directives, s } = run;
  warnings.push(...assumed.warnings);
  assumed.notes.forEach((n) => addNote(run, n));
  for (const a of assumed.kills) {
    if (a.objective) continue;
    const effects: Effect[] = [];
    const counted = recordKills(run, a, killSequence(a.mobs), a.at, effects);
    if (counted) addAct(run, { kind: "kill", kills: [counted] }, a.at, effects);
  }
  for (const d of directives) {
    if (d.at.step !== s || d.at.line !== line) continue;
    if (d.key === "level") grind(run, d.at, "level", d.target);
  }
}

function runCommand(run: StepRun, line: CommandLine, at: Required<Location>, assumed: StepKills): void {
  const { data, route, acts, talks, requires, before, completewith } = run;
  const questId = lineQuest(line)?.questId;
  const quest = questId === undefined ? undefined : data.quest(questId);
  const firstAct = acts.length;
  const effects: Effect[] = [];
  const rule = commandRule(line.name);
  switch (pointRun(line) ?? rule?.effect) {
    case "accept": {
      talks.push(...(quest?.giverNpcs ?? []));
      // RXP completes the line for a quest already turned in, without
      // accepting it again (`addon.functions.accept` in functions.lua).
      if (questId === undefined || run.state.done.has(questId)) break;
      if (quest?.requiredLevel != null) requires.set(at, { questId, requiredLevel: quest.requiredLevel });
      // The game counts the quest's items already in the bags.
      if (!run.state.log.has(questId))
        applyEffect(run, effects, { kind: "accept", questId, progress: holding(quest, progress(quest), route.collected.get(questId)) });
      run.npc = { places: quest?.givers ?? [], act: firstAct, target: { kind: "quest", questId, role: "accept" } };
      break;
    }
    case "complete":
      runComplete(run, line, at, questId, quest, assumed, effects);
      break;
    case "collect":
      runCollect(run, line, at, effects);
      break;
    case "turnin":
      runTurnIn(run, line, at, questId, quest, firstAct, effects);
      break;
    case "abandon":
      // Every listed quest in the log leaves it without XP. `addon.functions.abandon` in functions.lua keeps each
      // ID's sign, so a negative ID names no quest.
      for (const arg of line.args) {
        const n = luaNumber(arg);
        if (n === undefined || !run.state.log.has(n)) continue;
        applyEffect(run, effects, { kind: "abandon", questId: n });
        leaveLog(route, n);
      }
      if (effects.length) addAct(run, { kind: "update" }, at, effects);
      break;
    case "xp": {
      const arg = (line.args[0] ?? "").replaceAll(" ", "");
      const gate = arg.startsWith("<") || luaNumber(line.args[1] ?? "") !== undefined;
      const target = gate ? undefined : parseLevelTarget(arg);
      if (target) grind(run, at, "xp", target);
      break;
    }
    case "goto": {
      if (questPointDone(line, before, data)) break;
      run.goto = data.locateGoto(line.args);
      // RXP still arrows through optional points (`updateArrowData` in map.lua).
      // The timeline omits these detours, retaining the last place as a fallback.
      if (run.goto && !isOptionalPoint(line) && (completewith === undefined || leads(line))) addAct(run, go(run.goto, line), at);
      break;
    }
    case "waypoint": {
      if (questPointDone(line, before, data)) break;
      const to = data.locateGoto(line.args);
      if (to && (completewith === undefined || leads(line))) addAct(run, go(to, line), at);
      break;
    }
    case "ingamewaypoint": {
      // The game's waypoint has no radius, so a `#completewith` step never reaches it.
      const to = data.locateGoto(line.args);
      if (to && completewith === undefined) addAct(run, go(to, line), at);
      break;
    }
    case "deathskip":
      if (!route.settings.ignoreDeathskip) addAct(run, { kind: "deathskip", to: null }, at);
      break;
    case "hearth":
      addAct(run, { kind: "hearth", to: null }, at);
      break;
    case "pin":
    case undefined:
      break;
  }
  const action = rule?.interact;
  if (action) {
    const name = action === "fp" || action === "fly" ? { name: line.args[0] ?? "" } : undefined;
    const ofQuest = (action === "accept" || action === "turnin") && questId !== undefined ? { questId } : undefined;
    addAct(run, { kind: "interact", action, ...ofQuest, ...name }, at, effects);
  }
}

function runComplete(
  run: StepRun,
  line: CommandLine,
  at: Required<Location>,
  questId: number | undefined,
  quest: SimQuest | undefined,
  assumed: StepKills,
  effects: Effect[],
): void {
  const { route, directives, s, applying, warnings, notes } = run;
  // A negative ID skips the line when the quest is not in the log.
  const current = questId === undefined ? undefined : run.state.log.get(questId);
  const obj = luaNumber(line.args[1] ?? "");
  if (!current || obj === undefined) return;
  const target = luaNumber(line.args[2] ?? "");
  const partial = target !== undefined && target > 0 ? target : undefined;
  const ref = objectiveRef(quest, questId!, obj);
  if (!ref) return;
  const owed = owedFor(route, ref);
  const fresh = assumed.kills.find((a) => a.objective);
  const mine = directives.filter((d) => d.at.step === s && d.at.line === at.line);
  const set = mine.find((d) => d.key === "kills");
  const override = set?.key === "kills" ? set.count : undefined;
  const dropSet = mine.find((d) => d.key === "drop");
  const drop = dropSet?.key === "drop" ? dropSet.chance : undefined;
  const mobs = owed.first ?? fresh;
  if (mobs) run.hunts = true;
  if (drop !== undefined && !mobs?.drops)
    warnings.push({ kind: "unknownSimKey", at, key: "drop", value: String(drop), problem: "misplaced" });
  const [own] = assumed.counts;
  if (own) owed.total = { count: own.count, from: own.from };
  const { total, counted } = owed;
  const deferred = defersKills(applying, at.line);
  if (deferred && override === undefined && !owed.closed && (fresh || owed.first) && total && owed.counted < total.count) {
    const later: KillsLater = { kind: "killsLater", at, objective: ref, reason: deferred, countedAt: null };
    notes.push(later);
    (owed.waiting ??= []).push(later);
    if (deferred === "disablecheckbox") owed.killedOnTheWay = true;
  }
  if (deferred && override === undefined && fresh?.mobFrom === "override") owed.first ??= fresh;
  const background = deferred === "completewith" && override === undefined;
  if (background) leaveRunning(run, ref, partial ?? Infinity, fresh);
  const killed =
    override !== undefined
      ? killOwed(run, owed, { kills: override }, at, "override", effects, fresh, drop)
      : !deferred && !owed.closed && total
        ? killOwed(run, owed, { to: Math.min(partial ?? total.count, total.count) }, at, total.from, effects, fresh, drop)
        : undefined;
  const required = quest!.objectives[ref.row]!.count;
  if (!deferred && (partial === undefined || (required !== null && partial >= required))) owed.closed = true;
  if (!background) applyEffect(run, effects, { kind: "objective", ref, progress: completeObjective(quest!, current, ref, partial, owed) });
  addAct(
    run,
    killed
      ? {
          kind: "kill",
          kills: [killed],
          progress: {
            questId: questId!,
            counted: partyCount(killed, counted, route.party),
            gained: partyCount(killed, owed.counted - counted, route.party),
            of: total ? partyCount(killed, total.count, route.party) : null,
          },
        }
      : { kind: "update" },
    at,
    effects,
  );
}

function runCollect(run: StepRun, line: CommandLine, at: Required<Location>, effects: Effect[]): void {
  const { data, route, preview, until, collecting } = run;
  const collect = collectLine(line);
  if (!collect) return;
  const { questId, item, count } = collect;
  const current = run.state.log.get(questId);
  // RXP completes the line without the items for a quest turned in or
  // complete, unless flag 0x10 is set, and with no objective flags,
  // for one in the log (`addon.functions.collect` in functions.lua).
  if (collectSkipped(collect, run.state)) return;
  // RXP marks auction-house steps `#ah` and hides them with solo
  // self-found (`AHCheck` in RXPGuides.lua).
  const ah = preview.tags.has("ah");
  const background = until !== undefined && !ah;
  const held = getOrAdd(route.collected, questId, () => new Map());
  if (!background) held.set(item, Math.max(held.get(item) ?? 0, count));
  if (ah) {
    const bought = getOrAdd(route.bought, questId, () => new Map());
    bought.set(item, Math.max(bought.get(item) ?? 0, count));
  } else
    for (const ref of itemRefs(data.quest(questId), questId, item)) {
      if (!background) {
        collecting.push(ref);
        continue;
      }
      const owed = owedFor(route, ref);
      const found = objectiveKills(data, ref, {
        at,
        mobs: run.mobs,
        ...(owed.total && { total: owed.total }),
        ...(owed.first && { started: true }),
      });
      const [own] = found.counts;
      if (own) owed.total ??= { count: own.count, from: own.from };
      leaveRunning(run, ref, count, found.kills[0]);
    }
  if (!current || background) return;
  const updated = holding(data.quest(questId), current, held);
  updated.objectives.forEach((row, r) => {
    if (row !== current.objectives[r]) applyEffect(run, effects, { kind: "objective", ref: { questId, row: r }, progress: row });
  });
  if (effects.length) addAct(run, { kind: "update" }, at, effects);
}

function runTurnIn(
  run: StepRun,
  line: CommandLine,
  at: Required<Location>,
  questId: number | undefined,
  quest: SimQuest | undefined,
  firstAct: number,
  effects: Effect[],
): void {
  const { data, route, warnings, notes, talks, turnIns } = run;
  talks.push(...(quest?.enderNpcs ?? []));
  if (questId === undefined) return;
  // A negative ID skips the line when the quest is not in the log, or
  // with a positive second argument, not complete
  // (`addon.functions.turnin` in functions.lua).
  if (turnInSkipped(line, run.state)) return;
  // RXP completes the line for a quest already turned in, without a
  // turn-in (`addon.functions.turnin` in functions.lua).
  if (run.state.done.has(questId)) return;
  if (run.state.log.has(questId) && quest) {
    const walked = turnInKills(questId);
    const unwalked = turnInKills(questId);
    const bought = route.bought.get(questId);
    // The walked act comes first, so its kills count first too, and `route.mob` ends on the last kill of the acts.
    const walkedFirst = (ref: ObjectiveRef) => (route.owed.get(questId)?.get(ref.row)?.killedOnTheWay ? 0 : 1);
    const refs = quest.objectives.map((_, row): ObjectiveRef => ({ questId, row })).sort((a, b) => walkedFirst(a) - walkedFirst(b));
    for (const ref of refs) {
      const owed = owedFor(route, ref);
      const objective = quest.objectives[ref.row]!;
      const paid = heldOf(objective, bought);
      if (owed.closed || (objective.count !== null && paid >= objective.count)) continue;
      const found = owed.first ? undefined : objectiveKills(data, ref, { at, mobs: run.mobs, ...(owed.total && { total: owed.total }) });
      warnings.push(...(found?.warnings ?? []));
      found?.notes.forEach((n) => addNote(run, n));
      const total = owed.total ?? found?.counts[0];
      const counted = owed.counted;
      const act = owed.killedOnTheWay ? walked : unwalked;
      const killed = total && killOwed(run, owed, { to: total.count - paid }, at, total.from, act.effects, found?.kills[0]);
      if (!killed) continue;
      act.kills.push(killed);
      act.credited.push(ref);
      act.progress.counted += partyCount(killed, counted, route.party);
      act.progress.gained += partyCount(killed, owed.counted - counted, route.party);
      act.progress.of += partyCount(killed, total.count, route.party);
    }
    // No step shows when the player made the unwalked kills. The game takes only a complete quest, and RXP keeps a
    // turn-in step until the turn-in (`addon.functions.turnin`). So the kills still give XP and complete their objectives.
    const count = addTurnInKills(run, quest, walked, at) + addTurnInKills(run, quest, unwalked, at, { unproven: true });
    if (count > 0) notes.push({ kind: "killsAtTurnIn", at, questId, kills: count });
  }
  leaveLog(route, questId);
  route.collected.delete(questId);
  route.bought.delete(questId);
  if (quest?.baseXp == null || quest.level === null) warnings.push({ kind: "noQuestXp", at, questId });
  else {
    const { baseXp, level: questLevel } = quest;
    const turnIn = { at, questId, xp: 0 };
    turnIns.push(turnIn);
    gainXp(run, at, effects, { pay: (level) => ({ amount: questXp(baseXp, questLevel, level) }), turnIn });
  }
  applyEffect(run, effects, { kind: "turnin", questId });
  run.npc = { places: quest?.enders ?? [], act: firstAct, target: { kind: "quest", questId, role: "turnin" } };
}

interface TurnInKills {
  kills: KillAssumption[];
  credited: ObjectiveRef[];
  effects: Effect[];
  progress: { questId: number; counted: number; gained: number; of: number };
}

const turnInKills = (questId: number): TurnInKills => ({
  kills: [],
  credited: [],
  effects: [],
  progress: { questId, counted: 0, gained: 0, of: 0 },
});

function addTurnInKills(run: StepRun, quest: SimQuest, act: TurnInKills, at: Location, flag?: { unproven: true }): number {
  for (const ref of act.credited)
    applyEffect(run, act.effects, {
      kind: "objective",
      ref,
      progress: completeObjective(quest, run.state.log.get(ref.questId)!, ref, undefined, owedFor(run.route, ref)),
    });
  if (!act.kills.length) return 0;
  addAct(run, { kind: "kill", kills: act.kills, progress: act.progress, ...flag }, at, act.effects);
  return act.kills.reduce((n, a) => n + a.count, 0);
}

function grindOverrides(active: readonly SimDirective[], s: number, data: SimData, warnings: SimWarning[]): GrindOverride[] {
  return active.flatMap((d) => {
    if (d.key !== "grind" || d.at.step !== s) return [];
    const ids: number[] = [];
    for (const name of d.mobs) {
      const found = /^\d+$/.test(name) ? { kind: "npc", id: Number(name) } : data.entityByName(name);
      if (found?.kind === "npc" && data.npc(found.id)?.levels) ids.push(found.id);
      else warnings.push({ kind: "unknownSimKey", at: d.at, key: "mob", value: name, problem: "badValue" });
    }
    return [{ ...d, ids: [...new Set(ids)] }];
  });
}

function grind(run: StepRun, at: Location, kind: Checkpoint["kind"], target: LevelTarget): void {
  const { rules } = run.data;
  const { acts, route, checkpoints, grinds } = run;
  if (targetXp(rules, target) > totalXp(rules, run.state.level, run.state.xp)) {
    const legs = straightLegs(acts, route.at, ownTravelMode(run));
    placePassBy(acts, legs, passBy(run, legs));
  }
  const mobs = grindMobs(run, at.line);
  const check: Checkpoint = {
    at,
    kind,
    target,
    gap: targetXp(rules, target) - totalXp(rules, run.state.level, run.state.xp),
    kills: null,
  };
  checkpoints.push(check);
  grinds.set(check, mobs);
  const effects: Effect[] = [];
  if (check.gap > 0) applyEffect(run, effects, { kind: "xp", ...atTotal(rules, targetXp(rules, target)) });
  addAct(run, { kind: "grind", checkpoint: check }, at, effects);
}

function grindMobs(run: StepRun, line: number | undefined): (level: number) => readonly number[] {
  const { overrides } = run;
  const named = overrides.findLast((d) => d.scope === "line" && d.at.line === line) ?? overrides.findLast((d) => d.scope === "step");
  if (named) return () => named.ids;
  const mob = nearestMob(run, line);
  return (level) => {
    const id = mob(level);
    return id === undefined ? [] : [id];
  };
}

function nearestMob(run: StepRun, line: number | undefined): (level: number) => number | undefined {
  const { data, route, active, s, applying, settings } = run;
  const named = [...run.mobs.mob, ...run.mobs.target][0];
  if (named !== undefined) return () => named;
  const { spawns } = data;
  const at = route.at;
  if (!spawns || !at) {
    const last = route.mob ?? textMob(run, line);
    return () => last;
  }
  const killed = new Map(route.killed);
  let fallback = textMob(run, line);
  if (route.mob !== undefined) {
    const { area, near } = killAreaSettings(active, s);
    const radius = area?.yards ?? route.settings.area;
    const anchor = (near && nearPoint(applying, near, data).at) ?? at;
    const inArea = spawns(route.mob, route.killed.get(route.mob)).filter((p) => within(p, anchor, radius));
    if (inArea.length >= 2) fallback = route.mob;
  }
  return (level) => localGrindMob(at, level, data, spawns, settings, killed) ?? fallback;
}

function textMob(run: StepRun, line: number | undefined): number | undefined {
  const { step, applying, data } = run;
  const source = line === undefined ? step.line : applying.body[line];
  const text = source && "text" in source ? source.text : source?.comment;
  for (const match of (text ?? "").matchAll(/\|cRXP_ENEMY_([^|]+)\|r/g)) {
    const name = match[1]!.trim();
    const found = data.entityByName(name) ?? (name.endsWith("s") ? data.entityByName(name.slice(0, -1)) : undefined);
    if (found?.kind === "npc") return found.id;
  }
  return undefined;
}

function ownTravelMode(run: StepRun): TravelMode {
  const walksAmongMobs = run.hunts || run.kills.length > run.passKills || run.notes.some((n) => n.kind === "killsLater");
  return travelMode(run.step, walksAmongMobs, run.before, run.data);
}

function leaveRunning(run: StepRun, ref: ObjectiveRef, to: number, found: KillAssumption | undefined): void {
  const { route, until, pass, guide } = run;
  const owed = owedFor(route, ref);
  const { total } = owed;
  if (until === undefined || owed.closed || !total || !(owed.first ?? found)) return;
  if (found?.mobFrom === "stepMob") owed.first ??= found;
  const reach = pass?.yards ?? TIMELINE_MODEL.passReach.value;
  route.background.push({ guide, until, ref, to: Math.min(to, total.count), total, ...(found && { fresh: found }), reach });
}

// RXP tells the player to kill `#completewith` mobs on the way, not to go out of the way. So each spawn near the walk
// gives one kill, in the order the walk passes it, and the walk never waits for a respawn.
function passBy(run: StepRun, legs: readonly WalkLeg[]) {
  const { data, route, guide, s, settings, kills, collecting, credited, passedSpawns, passProgress } = run;
  const works = route.background.filter((w) => w.guide === guide && (w.until === "next" || windowOpen(w.until, s)));
  const refs = new Map([...collecting, ...works.map((w) => w.ref)].map((ref) => [refKey(ref), ref]));
  creditSharedDrops(run, [...refs.values()]);
  const mobsOf = (w: BackgroundKills) => (owedFor(route, w.ref).first ?? w.fresh)!;
  const npcsOf = (w: BackgroundKills) => (mobsOf(w).drops ?? mobsOf(w).mobs).map((m) => m.npcId);
  const open = (w: BackgroundKills) => {
    const owed = owedFor(route, w.ref);
    return !owed.closed && owed.counted < w.to && !run.state.done.has(w.ref.questId);
  };
  const spawns = new Map<string, MobSpawn & { off: number; along: number; leg: number }>();
  for (const w of works)
    for (const npcId of w.reach > 0 && open(w) ? npcsOf(w) : [])
      for (const p of data.spawns?.(npcId, w.ref.questId) ?? []) {
        const key = p.id;
        const near = passing(legs, p);
        if (!passedSpawns.has(key) && near && near.off <= w.reach && near.off < (spawns.get(key)?.off ?? Infinity))
          spawns.set(key, { npcId, at: p, ...near });
      }
  const before = new Map(works.map((w) => [w, owedFor(route, w.ref).counted]));
  const slices = new Map<BackgroundKills, { kills: PassKill[]; legs: number[]; order: number[] }>();
  let order = 0;
  const killed = new Map<number, number>();
  for (const [key, { npcId, at: spawn, off, leg }] of [...spawns].sort((a, b) => a[1].along - b[1].along)) {
    const work = works.find((w) => w.reach >= off && open(w) && npcsOf(w).includes(npcId));
    if (!work) continue;
    passedSpawns.add(key);
    const n = killed.get(npcId) ?? 0;
    killed.set(npcId, n + 1);
    const slice = slices.get(work) ?? slices.set(work, { kills: [], legs: [], order: [] }).get(work)!;
    slice.kills.push({ npcId, at: spawn, level: levelOf(data.npc(npcId)!.levels!, n) });
    slice.legs.push(leg);
    slice.order.push(order++);
    for (const w of works) {
      const owed = owedFor(route, w.ref);
      const objective = objectiveOf(data, w.ref);
      if (!open(w) || !objective) continue;
      if (mobsOf(w).itemId !== undefined)
        Object.assign(owed, creditDrops(owed, w.total.count, chanceOf(data, objective, npcId), route.party));
      else if (npcsOf(w).includes(npcId)) owed.counted += 1;
    }
  }
  const at = { guide, step: s };
  const runs: PassRun[] = [];
  for (const [work, slice] of slices) {
    const owed = owedFor(route, work.ref);
    const first = mobsOf(work);
    owed.first ??= first;
    countedKills(owed, at);
    const effects: Effect[] = [];
    const counted = recordKills(run, { ...first, countFrom: work.total.from }, slice.kills, at, effects)!;
    run.passKills++;
    const progress = {
      questId: work.ref.questId,
      counted: partyCount(counted, before.get(work)!, route.party),
      gained: partyCount(counted, owed.counted - before.get(work)!, route.party),
      of: partyCount(counted, work.total.count, route.party),
    };
    for (let start = 0; start < slice.kills.length;) {
      let end = start + 1;
      while (end < slice.kills.length && slice.legs[end] === slice.legs[start] && slice.order[end] === slice.order[end - 1]! + 1) end++;
      const selected = slice.kills.slice(start, end);
      const entry = {
        ...counted,
        count: selected.length,
        mobs: tallyKills(selected).map((m) => (data.npc(m.npcId)?.elite ? { ...m, elite: true as const } : m)),
        xp: { settings, rates: [] },
      };
      runs.push({
        leg: slice.legs[start]!,
        order: slice.order[start]!,
        act: {
          kind: "kill",
          kills: [entry],
          progress: {
            ...progress,
            counted: progress.counted + (progress.gained * start) / slice.kills.length,
            gained: (progress.gained * selected.length) / slice.kills.length,
          },
          passBy: { kills: selected, eligibleNpcIds: first.eligibleNpcIds ?? npcsOf(work) },
          at,
          effects: effects.slice(start, end),
        },
      });
      start = end;
    }
  }
  for (const ref of works.map((w) => w.ref)) credited.set(refKey(ref), kills.length);
  const rows: Effect[] = [];
  showProgress(
    run,
    works.map((w) => w.ref),
    rows,
  );
  for (const effect of rows) passProgress.add(effect);
  return { runs: runs.sort((a, b) => a.order - b.order), progress: { kind: "update" as const, at, effects: rows } };
}

function creditSharedDrops(run: StepRun, refs: readonly ObjectiveRef[]): void {
  const { kills, credited, data, route } = run;
  for (const ref of refs) {
    const key = refKey(ref);
    const made = kills.slice(credited.get(key) ?? 0);
    credited.set(key, kills.length);
    const objective = objectiveOf(data, ref);
    const owed = owedFor(route, ref);
    const count = objective?.count ?? owed.total?.count;
    if (!objective || count === undefined || owed.closed || run.state.done.has(ref.questId)) continue;
    let expected = 0;
    for (const a of made) {
      if (a.objective && a.objective.questId === ref.questId && a.objective.row === ref.row) continue;
      for (const mob of a.mobs) expected += mob.levels.reduce((n, l) => n + l.kills, 0) * chanceOf(data, objective, mob.npcId);
    }
    Object.assign(owed, creditDrops(owed, count, expected, route.party));
  }
}

function showProgress(run: StepRun, refs: readonly ObjectiveRef[], effects: Effect[]): void {
  const { data, route } = run;
  for (const ref of refs) {
    const quest = data.quest(ref.questId);
    const objective = objectiveOf(data, ref);
    const owed = owedFor(route, ref);
    const n = Math.floor(owed.counted + ITEM_TOLERANCE);
    const current = run.state.log.get(ref.questId);
    if (!quest || !objective || n <= 0) continue;
    if (current) {
      const row = current.objectives[ref.row]!;
      if (n > row.count) applyEffect(run, effects, { kind: "objective", ref, progress: completeObjective(quest, current, ref, n, owed) });
      continue;
    }
    const [item] = objectiveTargets(objective).items;
    if (item === undefined) continue;
    const held = getOrAdd(route.collected, ref.questId, () => new Map());
    held.set(item, Math.max(held.get(item) ?? 0, n));
  }
}

const objectiveOf = (data: SimData, ref: ObjectiveRef) => data.quest(ref.questId)?.objectives[ref.row];

function chanceOf(data: SimData, objective: SimObjective, npcId: number): number {
  const dropper = objectiveTargets(objective)
    .items.flatMap((id) => data.item(id)?.droppers ?? [])
    .find((d) => d.id === npcId);
  return dropper ? dropChance(dropper).value : 0;
}

function applyEffect(run: StepRun, effects: Effect[], effect: Effect): void {
  run.state = advance(run.state, effect);
  effects.push(effect);
}

function addAct(run: StepRun, body: ActBody, at: Location, effects: Effect[] = []): void {
  run.acts.push({ ...body, at, effects });
}

function addNote(run: StepRun, n: StepNote): void {
  run.notes.push(n);
  if (n.kind === "gathered") addAct(run, { kind: "interact", action: "gather", questId: n.objective.questId, count: n.count ?? 1 }, n.at);
}

function gainXp(run: StepRun, at: Location, effects: Effect[], recorded: Omit<RecordedGain, "at">): void {
  const { level, xp } = addXp(run.data.rules, run.state.level, run.state.xp, recorded.pay(run.state.level).amount);
  const effect: Effect = { kind: "xp", level, xp };
  run.gains.set(effect, { at, ...recorded });
  applyEffect(run, effects, effect);
}

function recordKills(run: StepRun, a: KillAssumption, slice: readonly Kill[], at: Location, effects: Effect[]) {
  if (slice.length === 0) return undefined;
  const { data, route, settings } = run;
  const mobs = tallyKills(slice).map((m) => (data.npc(m.npcId)?.elite ? { ...m, elite: true as const } : m));
  const counted: KillAssumption = { ...a, at, count: slice.length, mobs, xp: { settings, rates: [] } };
  const entry = run.kills.push(counted) - 1;
  slice.forEach((k, n) => {
    route.mob = k.npcId;
    route.killed.set(k.npcId, a.objective?.questId ?? route.killed.get(k.npcId));
    const elite = data.npc(k.npcId)?.elite ?? false;
    const pay = (level: number) => {
      const base = level >= MAX_LEVEL ? 0 : killXp(level, k.level, elite);
      return { base, amount: level >= MAX_LEVEL ? 0 : adjustedKillXp(base, settings) };
    };
    gainXp(run, at, effects, { kill: { entry, n: n + 1, of: slice.length }, pay });
  });
  return counted;
}

function killOwed(
  run: StepRun,
  owed: ObjectiveKills,
  goal: { to: number } | { kills: number },
  at: Location,
  countFrom: KillAssumption["countFrom"],
  effects: Effect[],
  fresh?: KillAssumption,
  drop?: number,
) {
  const taken = takeKills(owed, goal, run.route.party, run.data, { fresh, drop });
  if (!taken) return undefined;
  Object.assign(owed, taken.progress);
  if (taken.kills.length === 0) return undefined;
  countedKills(owed, at);
  return recordKills(run, { ...taken.mobs, countFrom }, taken.kills, at, effects);
}

interface RecordedGain {
  at: Location;
  pay: (level: number) => { amount: number; base?: number };
  kill?: LevelUp["kill"];
  turnIn?: TurnInXp;
}

interface StepLedger {
  gains: ReadonlyMap<Effect, RecordedGain>;
  grinds: ReadonlyMap<Checkpoint, (level: number) => readonly number[]>;
  requires: ReadonlyMap<Location, { questId: number; requiredLevel: number }>;
  kills: readonly KillAssumption[];
  turnIns: readonly TurnInXp[];
  totals: StepSnapshot["xp"];
  settings: KillXpSettings;
}

// Pass-by kills join the acts only once the walk is known, and the walk needs every line of the step. So the lines run in
// line order first, and this settles each result that reads the level or XP.
function settleXpInActOrder(acts: readonly Act[], before: SimState, ledger: StepLedger, data: SimData, warnings: SimWarning[]) {
  const { rules } = data;
  let { level, xp } = before;
  const levelUps: LevelUp[] = [];
  const paid = new Map<Effect, { amount: number; base?: number }>();
  const maxed = new Set<TurnInXp>();
  const totals = ledger.totals;
  totals.checkpoint = 0;
  const reach = (amount: number, at: Location, kill?: LevelUp["kill"]): Effect => {
    const next = addXp(rules, level, xp, amount);
    for (const level of next.reached) levelUps.push({ level, at, ...(kill && { kill }) });
    ({ level, xp } = next);
    return { kind: "xp", level, xp };
  };
  const settled: Act[] = [];
  for (const act of acts) {
    const need = act.kind === "interact" && act.action === "accept" ? ledger.requires.get(act.at) : undefined;
    if (need && level < need.requiredLevel)
      warnings.push({ kind: "levelTooLow", at: act.at, questId: need.questId, level, requiredLevel: need.requiredLevel });
    if (act.kind === "grind") {
      const check = act.checkpoint;
      const mobs = ledger.grinds.get(check)!(level);
      Object.assign(
        check,
        checkpoint(
          { level, xp },
          check.at,
          check.kind,
          check.target,
          data,
          mobs,
          check.kind === "level" ? warnings : undefined,
          ledger.settings,
        ),
      );
      if (check.gap <= 0) continue;
      totals.checkpoint += check.gap;
      settled.push({ ...act, effects: [reach(check.gap, check.at)] });
      continue;
    }
    const effects = act.effects.flatMap((effect) => {
      const gain = ledger.gains.get(effect);
      if (!gain) return [effect];
      if (gain.turnIn && level >= MAX_LEVEL) {
        maxed.add(gain.turnIn);
        return [];
      }
      const pay = gain.pay(level);
      paid.set(effect, pay);
      if (gain.turnIn) gain.turnIn.xp = pay.amount;
      return [reach(pay.amount, gain.at, gain.kill)];
    });
    if (act.kind === "kill" && act.passBy) rateKills(act.kills[0]!, act.effects, paid);
    settled.push({ ...act, effects });
  }
  const byEntry = new Map<number, Effect[]>();
  totals.quest = 0;
  totals.kills = 0;
  for (const [effect, gain] of ledger.gains) {
    const amount = paid.get(effect)?.amount ?? 0;
    if (gain.turnIn) totals.quest += amount;
    if (!gain.kill) continue;
    totals.kills += amount;
    (byEntry.get(gain.kill.entry) ?? byEntry.set(gain.kill.entry, []).get(gain.kill.entry)!).push(effect);
  }
  for (const [entry, effects] of byEntry) rateKills(ledger.kills[entry]!, effects, paid);
  return { acts: settled, levelUps, level, xp, maxed };
}

function rateKills(entry: KillAssumption, effects: readonly Effect[], paid: ReadonlyMap<Effect, { amount: number; base?: number }>) {
  const rates = entry.xp?.rates;
  if (!rates) return;
  rates.length = 0;
  for (const effect of effects) {
    const pay = paid.get(effect);
    if (pay?.base === undefined) continue;
    const rate = rates.find((r) => r.base === pay.base && r.reward === pay.amount);
    if (rate) rate.count++;
    else rates.push({ base: pay.base, reward: pay.amount, count: 1 });
  }
}

interface PassRun {
  leg: number;
  order: number;
  act: Extract<Act, { kind: "kill" }>;
}

function placePassBy(acts: Act[], legs: readonly WalkLeg[], result: { runs: PassRun[]; progress: Act }) {
  for (let i = legs.length - 1; i >= 0; i--) acts.splice(legs[i]!.act, 0, ...result.runs.filter((r) => r.leg === i).map((r) => r.act));
  if (result.progress.effects.length) acts.push(result.progress);
}

function placePassProgress(acts: Act[], progress: ReadonlySet<Effect>) {
  for (const [index, update] of acts.entries()) {
    for (const effect of update.effects) {
      if (effect.kind !== "objective" || !progress.has(effect)) continue;
      const run = acts
        .slice(0, index)
        .findLastIndex(
          (a) =>
            a.kind === "kill" &&
            a.passBy &&
            a.kills.some((k) => k.objective?.questId === effect.ref.questId && k.objective.row === effect.ref.row),
        );
      if (run < 0) continue;
      const later = acts
        .slice(run + 1)
        .some((a) =>
          a.effects.some(
            (e) =>
              !progress.has(e) &&
              (e.kind === "accept" || e.kind === "turnin" || e.kind === "abandon"
                ? e.questId === effect.ref.questId
                : e.kind === "objective" && e.ref.questId === effect.ref.questId),
          ),
        );
      if (later) continue;
      acts[run] = { ...acts[run]!, effects: [...acts[run]!.effects, effect] };
      acts[index] = { ...acts[index]!, effects: acts[index]!.effects.filter((e) => e !== effect) };
    }
  }
}

function stepKillArea(
  directives: readonly SimDirective[],
  s: number,
  step: Step,
  acts: readonly Act[],
  data: SimData,
  warnings: SimWarning[],
): KillAreaSettings | undefined {
  const { respawn, area, near } = killAreaSettings(directives, s);
  const misplaced = (d: SimDirective, value: string) =>
    warnings.push({ kind: "unknownSimKey", at: d.at, key: d.key, value, problem: "misplaced" });
  if (!acts.some((a) => a.kind === "kill" || a.kind === "grind")) {
    for (const d of [respawn, area, near]) if (d?.at.step === s) misplaced(d, killAreaValue(d));
    return undefined;
  }
  let at: WorldLocation | undefined;
  if (near) {
    const zone = nearPoint(step, near, data);
    at = zone.at;
    if (!zone.zone) misplaced(near, killAreaValue(near));
    else if (!at) warnings.push({ kind: "unknownSimKey", at: near.at, key: "near", value: killAreaValue(near), problem: "badValue" });
  }
  const settings = {
    ...(respawn && { respawn: respawn.seconds }),
    ...(area && { radius: area.yards }),
    ...(at && { near: at }),
  };
  return Object.keys(settings).length ? settings : undefined;
}

function nearPoint(step: Step, near: { x: number; y: number }, data: SimData): { zone: boolean; at?: WorldLocation } {
  const zone = step.body.findLast((l) => l.kind === "command" && (l.name === "goto" || l.name === "waypoint") && l.args.length > 2);
  if (zone?.kind !== "command") return { zone: false };
  const at = data.locateGoto([zone.args[0]!, String(near.x), String(near.y)]);
  return { zone: true, ...(at && { at }) };
}

interface WalkLeg {
  from: WorldLocation;
  to: WorldLocation;
  act: number;
}

function straightLegs(acts: readonly Act[], from: WorldLocation | null, mode: TravelMode): WalkLeg[] {
  const legs: WalkLeg[] = [];
  let at = from;
  let traveled = false;
  for (const [act, a] of acts.entries()) {
    if (a.kind === "go") {
      if (mode === "first" && traveled) continue;
      traveled = true;
      if (at && a.target.kind !== "flight" && at.instance === a.to.instance && !samePlace(at, a.to)) legs.push({ from: at, to: a.to, act });
      at = a.to;
    } else if (a.kind === "hearth") at = a.to;
    else if (a.kind === "deathskip" && a.to) at = a.to;
  }
  return legs;
}

/**
 * The last step of each label's `#completewith` window, by label. RXP makes
 * every `#completewith` step that is not `#tip` sticky (`addon:LoadGuide` in
 * GuideWindow.lua), and a window that names a sticky step ends only when that
 * step completes (`addon.UpdateStepCompletion`). So a window that names a
 * `#completewith` step lasts through that step's own window. `next` skips a
 * step that its `step <<` condition drops, because RXP drops the step before
 * it numbers the steps (`addon.ParseGuide` in GuideLoader.lua).
 */
export function windowEnds(steps: readonly Step[], profile: Profile): Map<string, number> {
  const labels = stepLabels(steps, profile);
  const after = (i: number) => {
    const next = steps.findIndex((step, j) => j > i && holds(step.line.condition, profile));
    return next < 0 ? undefined : next;
  };
  const end = (i: number, seen: Set<number>): number => {
    const tag = steps[i]!.body.find((l) => l.kind === "tag" && l.name === "completewith" && holds(l.condition, profile));
    const next = tag?.kind !== "tag" || seen.has(i) ? undefined : tag.value === "next" ? after(i) : labels.get(tag.value);
    return next === undefined ? i : end(next, seen.add(i));
  };
  return new Map([...labels].map(([label, i]) => [label, end(i, new Set())]));
}

/**
 * Whether a window that `windowEnds` ends at step `end` is open at step `s`.
 * RXP completes the window's step once the current step is past `end`
 * (`addon.UpdateStepCompletion` in GuideWindow.lua).
 */
export const windowOpen = (end: number, s: number): boolean => s <= end;

/**
 * The end of a `#completewith next` window that reaches shown step `s`: still
 * `next` at a `#completewith next` step, the label's `windowEnds` end at a
 * `#completewith <label>` step, else `s`. RXP makes every `#completewith`
 * step that is not `#tip` sticky, and ends a window that names a sticky step
 * when that step completes (`addon:LoadGuide` and `addon.UpdateStepCompletion`
 * in GuideWindow.lua). A lone `#sticky` step ends the window, because the
 * simulation completes its lines at the step.
 */
export function nextWindowEnd(s: number, preview: StepPreview, ends: ReadonlyMap<string, number>): number | "next" {
  const until = preview.tags.get("completewith")?.value;
  return until === "next" ? "next" : until === undefined ? s : (ends.get(until) ?? s);
}

function passing(legs: readonly WalkLeg[], p: WorldLocation): { off: number; along: number; leg: number } | undefined {
  let best: { off: number; along: number; leg: number } | undefined;
  for (const [i, { from: a, to: b }] of legs.entries()) {
    if (a.instance !== p.instance) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    const off = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
    if (!best || off < best.off) best = { off, along: i + t, leg: i };
  }
  return best;
}

function walk(
  acts: readonly Act[],
  mode: TravelMode,
  implicit: Act | undefined,
  route: Carried,
  state: SimState,
  goto: SimPosition | undefined,
  data: SimData,
): { acts: Act[]; state: SimState; landed?: SimPosition } {
  const walked: Act[] = [];
  let traveled = false;
  let landed: SimPosition | undefined;
  const learn = (a: Act, effect: Effect): Act => {
    state = advance(state, effect);
    return { ...a, effects: [...a.effects, effect] };
  };
  const bind = (a: Act, at: SimPosition) => learn(a, { kind: "bind", at });
  for (const a of mode === "first" ? travelFirst(acts) : acts) {
    if (a.kind === "go") {
      if (mode === "first" && traveled) continue;
      if (a === implicit && route.at && samePlace(route.at, a.to)) continue;
      traveled = true;
      route.at = a.to;
      landed = undefined;
      walked.push(state.bind ? a : bind(a, a.to));
    } else if (a.kind === "interact" && a.action === "home") walked.push(route.at ? bind(a, route.at) : a);
    else if (a.kind === "hearth") {
      walked.push({ ...a, to: state.bind });
      route.at = state.bind ?? route.at;
      landed = state.bind ?? landed;
    } else if (a.kind === "deathskip") {
      const to = route.at ? data.nearestSpiritHealer?.(route.at) : undefined;
      walked.push(to ? learn({ ...a, to }, { kind: "position", at: to }) : a);
      route.at = to ?? route.at;
      landed = to ?? landed;
    } else if (a.kind === "interact" && (a.action === "fp" || a.action === "fly")) {
      const master = (at: WorldLocation | null | undefined) => (at ? data.flights.at(at, route.faction) : undefined);
      const near = master(route.at) ?? master(goto);
      // In game, talking to a flight master learns it, whatever the `.fp` line's name.
      const match = data.flights.named(a.name!, route.faction);
      const fp = match.node ?? (near && (!match.nodes.length || match.nodes.includes(near)) ? near : undefined);
      const named = a.action === "fp" ? fp : match.node;
      // A `.fly` learns the flight master it takes off from, never the one it lands at.
      const learned = a.action === "fp" ? named : near;
      const act = named ? { ...a, node: named.id } : a;
      walked.push(learned ? learn(act, { kind: "flightPath", node: learned.id }) : act);
      if (a.action === "fly" && named && route.at && (mode !== "background" || near)) {
        const target = { kind: "flight" as const, name: a.name!, ...(learned && { from: learned.id }), to: named.id };
        walked.push({ kind: "go", to: named.at, target, at: a.at, effects: [] });
        route.at = named.at;
        landed = named.at;
      }
    } else walked.push(a);
  }
  return { acts: walked, state, ...(landed && { landed }) };
}

type TravelMode = "each" | "first" | "background";

function travelMode(step: Step, walksAmongMobs: boolean, before: SimState, data: SimData): TravelMode {
  const tag = (name: string) => step.body.some((l) => l.kind === "tag" && l.name === name);
  if (tag("completewith")) return "background";
  // RXP marks a kill loop with `#loop` or lines that run as `.waypoint`. A done quest point leads nowhere.
  const killLoop =
    tag("loop") || step.body.some((l) => l.kind === "command" && pointRun(l) === "waypoint" && !questPointDone(l, before, data));
  return walksAmongMobs || killLoop ? "first" : "each";
}

// RXP shows every line of a step at once, and its arrow leads to the step's
// first waypoint (`generatePins` and `updateArrowData` in map.lua). So a step
// that walks among mobs goes to its first place before its kills, wherever
// its `.goto` line stands.
function travelFirst(acts: readonly Act[]): readonly Act[] {
  const fight = acts.findIndex((a) => (a.kind === "kill" && !a.passBy) || (a.kind === "grind" && a.checkpoint.gap > 0));
  const go = acts.findIndex((a) => a.kind === "go");
  if (fight < 0 || go < fight) return acts;
  return [...acts.slice(0, fight), acts[go]!, ...acts.slice(fight, go), ...acts.slice(go + 1)];
}

// RXP lists the showing `#completewith` steps before the current step
// (`addon.SetStep` in GuideWindow.lua), and its arrow leads to their
// waypoints first (`generatePins` and `updateArrowData` in map.lua). A
// waypoint with a positive radius completes when the player comes that near
// (`addon.UpdateGotoSteps` in map.lua). A radius of 0 with no flag has no
// arrow (`addon.functions["goto"]` in functions.lua), and a waypoint with no
// radius never completes, so the walk leaves both out.
function leads(line: CommandLine): boolean {
  const radius = luaNumber(line.args[3] ?? "");
  return radius !== undefined && radius > 0;
}

// `QuestWP` in functions.lua skips a quest point once the character is on the quest and has `objMax` of its
// objective, and `generatePins` in map.lua gives a skipped point no pin and no arrow. RXP also runs the handler when
// the step becomes active (`addon.BindActiveStepElement` in GuideWindow.lua). So the walk reads the counts that the
// step starts with, because the player makes the step's own kills after the arrow leads there.
function questPointDone(line: CommandLine, state: SimState, data: SimData): boolean {
  if (!commandRule(line.name)?.point?.quest) return false;
  const [questId, index, max] = [4, 5, 6].map((i) => luaNumber(line.args[i] ?? ""));
  if (questId === undefined || index === undefined || max === undefined || max <= 0) return false;
  const ref = objectiveRef(data.quest(questId), questId, index);
  const row = ref && state.log.get(questId)?.objectives[ref.row];
  return !!row && row.count >= max;
}

const samePlace = (a: WorldLocation, b: WorldLocation) => a.instance === b.instance && a.x === b.x && a.y === b.y;

function go(to: SimPosition, line: CommandLine): ActBody {
  return { kind: "go", to, target: { kind: "goto", label: line.args.join(","), ...(line.args.length > 2 && { zone: line.args[0]! }) } };
}

/**
 * `.collect itemId,qty,questId,objFlags,flags` as RXP parses it
 * (`addon.functions.collect` in functions.lua): the quest and the one item
 * the player holds `qty` of, default 1, once the line completes.
 * `anyObjective` is a zero `objFlags`, and `ignoreTurnIn` flag 0x10.
 * Undefined when the line names no quest or several items, or when a flag
 * other than 0x10 changes the count RXP asks for or makes the line optional.
 */
export function collectLine(
  line: CommandLine,
): { questId: number; item: number; count: number; anyObjective: boolean; ignoreTurnIn: boolean } | undefined {
  const items = (line.args[0] ?? "").match(/\d+/g);
  const count = Math.ceil(luaNumber(line.args[1] ?? "") ?? 1);
  const questId = luaNumber(line.args[2] ?? "");
  const flags = luaNumber(line.args[4] ?? "") ?? 0;
  if (!/^\d/.test(line.args[0] ?? "") || items?.length !== 1 || count <= 0) return undefined;
  if (questId === undefined || !Number.isInteger(questId) || questId <= 0) return undefined;
  if (!Number.isInteger(flags) || flags < 0 || (flags & ~0x10) !== 0) return undefined;
  return {
    questId,
    item: Number(items[0]),
    count,
    anyObjective: (luaNumber(line.args[3] ?? "") ?? 0) === 0,
    ignoreTurnIn: (flags & 0x10) !== 0,
  };
}

// The game counts held items toward each objective, numbered or text, that
// names the item, up to its required count.
function holding(quest: SimQuest | undefined, current: QuestProgress, held: ReadonlyMap<number, number> | undefined): QuestProgress {
  if (!quest || !held?.size) return current;
  return withStatus(
    current.objectives.map((old, row) => {
      const objective = quest.objectives[row]!;
      const have = heldOf(objective, held);
      const n = objective.count === null ? have : Math.min(have, objective.count);
      return n > old.count ? { ...old, count: n, complete: old.complete || (objective.count !== null && n >= objective.count) } : old;
    }),
  );
}

function heldOf(objective: SimObjective, held: ReadonlyMap<number, number> | undefined): number {
  return Math.max(0, ...objectiveTargets(objective).items.map((id) => held?.get(id) ?? 0));
}

function itemRefs(quest: SimQuest | undefined, questId: number, item: number): ObjectiveRef[] {
  if (!quest) return [];
  return quest.objectives.flatMap((o, row) => (objectiveTargets(o).items.includes(item) ? [{ questId, row }] : []));
}

function progress(quest: SimQuest | undefined): QuestProgress {
  const none: ObjectiveProgress = { count: 0, complete: false };
  return withStatus(quest?.objectives.map(() => none) ?? []);
}

// A hidden checkbox wins over `#completewith`, since the guide does not expect the line to finish while the step shows. So
// the line still completes its objective, and starts no window.
function defersKills(step: Step, line: number): KillsLater["reason"] | undefined {
  const next = step.body.slice(line + 1).find((l) => l.kind === "command");
  if (next?.kind === "command" && next.name === "disablecheckbox") return "disablecheckbox";
  return step.body.some((l) => l.kind === "tag" && l.name === "completewith") ? "completewith" : undefined;
}

function completeObjective(
  quest: SimQuest,
  current: QuestProgress,
  { row }: ObjectiveRef,
  target: number | undefined,
  { counted, total, first, items }: ObjectiveKills,
): ObjectiveProgress {
  const required = quest.objectives[row]!.count;
  const old = current.objectives[row]!;
  const count = target === undefined ? (required ?? old.count) : Math.max(old.count, target);
  const complete = target === undefined || old.complete || (required !== null && count >= required);
  return { count, complete, kills: { counted, ...(total && { total }), ...(first && { first }), ...(items && { items }) } };
}

function localGrindMob(
  at: WorldLocation,
  level: number,
  data: SimData,
  spawns: NonNullable<SimData["spawns"]>,
  settings: KillXpSettings,
  killed: ReadonlyMap<number, number | undefined>,
): number | undefined {
  const reach = TIMELINE_MODEL.grindReach.value;
  const candidates = new Map(killed);
  for (const npcId of data.npcsWithSpawns?.() ?? []) if (!candidates.has(npcId)) candidates.set(npcId, undefined);
  let best: { npcId: number; count: number; yards: number } | undefined;
  for (const [npcId, questId] of candidates) {
    const npc = data.npc(npcId);
    if (!npc?.levels || npc.elite || adjustedKillXp(killXp(level, npc.levels.max, false), settings) === 0) continue;
    const near = spawns(npcId, questId).filter((p) => within(p, at, reach));
    if (near.length < 2) continue;
    const yards = Math.min(...near.map((p) => Math.hypot(p.x - at.x, p.y - at.y)));
    if (!best || near.length > best.count || (near.length === best.count && yards < best.yards))
      best = { npcId, count: near.length, yards };
  }
  return best?.npcId;
}

function checkpoint(
  state: Pick<SimState, "level" | "xp">,
  at: Location,
  kind: Checkpoint["kind"],
  target: LevelTarget,
  data: SimData,
  mobs: readonly number[],
  warnings?: SimWarning[],
  settings: KillXpSettings = {},
): Checkpoint {
  const { rules } = data;
  const goal = targetXp(rules, target);
  const gap = goal - totalXp(rules, state.level, state.xp);
  const kills = gap > 0 ? killsToClose(state, gap, mobs, data, settings) : null;
  if (warnings && gap !== 0) {
    const where = atTotal(rules, goal);
    warnings.push(
      gap > 0 ? { kind: "checkpointGap", at, target: where, xp: gap, kills } : { kind: "checkpointBehind", at, target: where, xp: -gap },
    );
  }
  return { at, kind, target, gap, kills };
}

// Kills of `npcIds` that give `gap` XP from `state`, one at a time: one of
// each mob in turn, as `killSequence` mixes a step's mobs, and each mob
// through its levels in turn. Mobs with unknown levels take no kills. Null
// when no mob has known levels or all mobs stop giving XP first.
export function killsToClose(
  state: Pick<SimState, "level" | "xp">,
  gap: number,
  npcIds: readonly number[],
  data: SimData,
  settings: KillXpSettings = {},
): Checkpoint["kills"] {
  const { rules } = data;
  const mobs = npcIds.flatMap((npcId) => {
    const npc = data.npc(npcId);
    return npc?.levels ? [{ npcId, ...npc.levels, elite: npc.elite ?? false, count: 0 }] : [];
  });
  if (!mobs.length) return null;
  let { level, xp } = state;
  let count = 0;
  while (gap > 0) {
    const mob = mobs[count % mobs.length]!;
    if (level >= MAX_LEVEL || mobs.every((m) => adjustedKillXp(killXp(level, m.max, m.elite), settings) === 0)) return null;
    const reward = adjustedKillXp(killXp(level, mob.min + (mob.count % (mob.max - mob.min + 1)), mob.elite), settings);
    mob.count += 1;
    count += 1;
    gap -= reward;
    xp += reward;
    while (level < MAX_LEVEL && xp >= xpToNextLevel(rules, level)) xp -= xpToNextLevel(rules, level++);
  }
  return { count, mobs: mobs.flatMap(({ npcId, count }) => (count ? [{ npcId, count }] : [])) };
}

// The server grants these when it creates the character, so no `.fp` learns them.
const flightPathsAtCreation = (rules: GameRules, profile: Profile): Set<number> => new Set(rules.startingFlightNodes[profile.race]);

function priorTurnIns(
  guides: readonly GuideDocument[],
  start: number,
  profile: Profile,
  data: SimData,
  settings: PlaybackSettings,
): Set<number> {
  const { next } = routeGraph(guides, profile);
  const leadsToStart = (g: number) => {
    const seen = new Set<number>();
    let at: number | undefined = g;
    while (at !== undefined && at !== start && !seen.has(at)) {
      seen.add(at);
      at = next[at];
    }
    return at === start;
  };
  const done = new Set<number>();
  guides.forEach((_, g) => {
    if (g === start || !leadsToStart(g)) return;
    let state: SimState = {
      level: profile.level,
      xp: 0,
      position: null,
      log: new Map(),
      done: new Set(),
      bind: null,
      flightPaths: flightPathsAtCreation(data.rules, profile),
    };
    const kills = carry(profile.faction, settings);
    for (const event of walkRoute(
      guides,
      g,
      profile,
      () => profile.level,
      true,
      () => ({ log: state.log, done: state.done }),
    )) {
      if (event.kind === "guide") {
        const { source, doc, headerLines } = event.guide;
        if (source === start) {
          state.done.forEach((id) => done.add(id));
          return;
        }
        state = runHeader(simDirectives(doc, source).directives, headerLines, state, data, carry(profile.faction, settings), []).state;
      }
      if (event.kind === "step" && event.preview.shown) {
        state = runStep(guides[event.guide]!, event.guide, event.step, event.preview, state, [], data, kills, []).state;
      }
    }
  });
  return done;
}
