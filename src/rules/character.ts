import type { Spawn } from "../data/index.ts";
import { completeRow } from "./completeRows.ts";
import type {
  Checkpoint,
  KillAssumption,
  ObjectiveProgress,
  ObjectiveRef,
  QuestProgress,
  SimPosition,
  SimQuest,
  SimState,
} from "./simulate.ts";
import type { Location } from "./validate.ts";

/**
 * A change to the character. Values are absolute ("the count is now 3"),
 * never deltas, so an effect applied twice gives the state it gave once.
 */
export type Effect =
  | { kind: "accept"; questId: number; progress: QuestProgress }
  | { kind: "objective"; ref: ObjectiveRef; progress: ObjectiveProgress }
  | { kind: "turnin"; questId: number }
  | { kind: "abandon"; questId: number }
  | { kind: "xp"; level: number; xp: number }
  /** Where `.hs` goes. */
  | { kind: "bind"; at: SimPosition }
  /** A flight master learned, by taxi node ID. */
  | { kind: "flightPath"; node: number }
  /** A guide header's `@sim done=`: quests to treat as turned in. */
  | { kind: "done"; questIds: readonly number[] }
  /** `SimState.position` after a step. */
  | { kind: "position"; at: SimPosition | null };

export type Target =
  /** A `.goto` or `.waypoint` line; `zone` when the line names one. */
  | { kind: "goto"; label: string; zone?: string }
  | { kind: "quest"; questId: number; role: "accept" | "turnin" }
  /** Back to the place that an earlier step left the guide at. */
  | { kind: "guidePlace" }
  /**
   * A `.fly` line's flight, by taxi node: `name` is the line's name, `from`
   * the flight master in reach where it takes off, and `to` the one it names.
   */
  | { kind: "flight"; name: string; from?: number; to: number };

export type InteractAction = "accept" | "turnin" | "train" | "vendor" | "home" | "fp" | "fly" | "gather";

/** A kill act's quest objectives: what they counted before the act, and what they need. */
export interface KillProgress {
  questId: number;
  counted: number;
  /** What the act's kills add: kills of a monster objective, or the drops that they are expected to give. */
  gained: number;
  /** null when the needed count is unknown. */
  of: number | null;
}

export interface MobSpawn {
  npcId: number;
  at: Spawn;
}

export type PassKill = MobSpawn & { level: number };

export type ActBody =
  | { kind: "go"; to: SimPosition; target: Target }
  /** `to` is the bind; null when the character has none. */
  | { kind: "hearth"; to: SimPosition | null }
  | { kind: "deathskip"; to: SimPosition | null }
  /**
   * `questId` for accept, turnin, and gather; `count` items for gather. For
   * fp and fly, `name` is the line's name and `node` the taxi node of the
   * flight master that the line learns or flies to, when one is known.
   */
  | { kind: "interact"; action: InteractAction; questId?: number; name?: string; node?: number; count?: number }
  /**
   * Kills for quest objectives or `extra=`. `unproven`: a turn-in counts kills
   * that no earlier step counted, so the timeline gives them no time and warns.
   * `passBy`: a `#completewith` objective's kills of the spawns that the
   * step's walked line passes, in walk order.
   */
  | {
      kind: "kill";
      kills: readonly KillAssumption[];
      progress?: KillProgress;
      unproven?: true;
      passBy?: { kills: readonly PassKill[]; eligibleNpcIds: readonly number[] };
    }
  /** Kills that close an `.xp` or `level=` gap. */
  | { kind: "grind"; checkpoint: Checkpoint }
  /** A state change with no play, such as a `.complete` line that counts no kills. */
  | { kind: "update" };

/**
 * One thing the character does. `at` is the line, comment, or step that
 * caused it. A kill act has one `xp` effect for each kill, in order.
 */
export type Act = ActBody & { at: Location; effects: readonly Effect[] };

export function advance(state: SimState, effect: Effect): SimState {
  switch (effect.kind) {
    case "accept":
      return { ...state, log: new Map(state.log).set(effect.questId, effect.progress) };
    case "objective": {
      const { questId, row } = effect.ref;
      const quest = state.log.get(questId);
      if (!quest) return state;
      return { ...state, log: new Map(state.log).set(questId, withStatus(quest.objectives.with(row, effect.progress))) };
    }
    case "turnin":
    case "abandon": {
      const log = new Map(state.log);
      log.delete(effect.questId);
      return { ...state, log, ...(effect.kind === "turnin" && { done: new Set(state.done).add(effect.questId) }) };
    }
    case "xp":
      return { ...state, level: effect.level, xp: effect.xp };
    case "bind":
      return { ...state, bind: effect.at };
    case "flightPath":
      return { ...state, flightPaths: new Set(state.flightPaths).add(effect.node) };
    case "done":
      return { ...state, done: new Set([...state.done, ...effect.questIds]) };
    case "position":
      return { ...state, position: effect.at };
  }
}

/**
 * A quest's status from its rows: complete once every row is, partial once
 * any counts. It keeps each row object, so `!==` finds the changed rows.
 */
export function withStatus(objectives: readonly ObjectiveProgress[]): QuestProgress {
  const status = objectives.every((r) => r.complete)
    ? "complete"
    : objectives.some((r) => r.complete || r.count > 0)
      ? "partial"
      : "incomplete";
  return { status, objectives };
}

/** The objective `.complete id,obj` names, as `completeRow` numbers the quest's rows. */
export function objectiveRef(quest: SimQuest | undefined, questId: number, obj: number): ObjectiveRef | undefined {
  // RXP names objectives by whole numbers; any other index is unknown.
  if (!quest || !Number.isInteger(obj)) return undefined;
  const row = completeRow(quest.objectives, obj);
  return row === undefined ? undefined : { questId, row };
}
