import type { WorldLocation, WorldPoint } from "../../packages/data-contract/geometry.ts";

/**
 * A HereBeDragons world position in yards on map `instance`, as `.goto` and
 * `packages/data-contract/geometry.ts` give it, and the height in yards of
 * the interior surface that the stop is on. A null height snaps to the
 * ground, which is a buried floor under solid terrain (`groundHeight` in
 * `terrain.ts`). A stop names no artifact or pixel, so a new release does
 * not move it.
 */
export interface WorldStop extends WorldLocation {
  height: number | null;
}

/** `at` on the ground, or on the surface at `height`. */
export const withHeight = ({ instance, x, y }: WorldLocation, height: number | null): WorldStop => ({ instance, x, y, height });

/**
 * A leg that does not follow terrain is a labeled straight-line estimate. It
 * keeps its other settings for later. `downhill` allows steep descents in the
 * leg's direction. With it, `damagingFalls` allows falls that deal damage.
 * With those, `fatalFalls` allows fatal falls. `hazards` allows lava and
 * slime. `otherFaction` allows the other faction's rides. A ride without a
 * faction is always open. `flightPaths` allows flights, and `shipPaths`
 * allows ships and zeppelins.
 */
export interface Leg {
  followTerrain: boolean;
  downhill: boolean;
  damagingFalls: boolean;
  fatalFalls: boolean;
  hazards: boolean;
  otherFaction: boolean;
  flightPaths: boolean;
  shipPaths: boolean;
}

export interface MovementMode {
  name: string;
  /** World units per second. */
  speed: number;
  /** Seconds to start the mode, such as a mount's cast. */
  activation: number;
}

export interface PlanSettings {
  swimming: { enabled: boolean; speed: number };
  /** Every movement mode, in display order. */
  modes: MovementMode[];
}

/**
 * Leg i runs from stop i to stop i + 1, so there is one leg fewer than
 * stops, and at least two stops. A leg between two maps has no ground
 * route. The saved record and the route text hold these fields and no
 * other.
 */
export interface RoutePlan {
  id: string;
  stops: WorldStop[];
  legs: Leg[];
  settings: PlanSettings;
}

export const DEFAULT_LEG: Readonly<Leg> = {
  followTerrain: true,
  downhill: true,
  damagingFalls: true,
  fatalFalls: false,
  hazards: false,
  otherFaction: false,
  flightPaths: true,
  shipPaths: true,
};

export const LEG_KEYS = Object.keys(DEFAULT_LEG) as (keyof Leg)[];

/** The prototype's modes. The first mode is Run. */
export const DEFAULT_MODES: readonly MovementMode[] = [
  { name: "Run", speed: 7, activation: 0 },
  { name: "Mount", speed: 11.2, activation: 3 },
  { name: "Epic mount", speed: 14, activation: 3 },
  { name: "Ghost Wolf", speed: 9.8, activation: 3 },
  { name: "Travel Form", speed: 9.8, activation: 0 },
];

/** In degrees. The calibration corridors use this slope. */
export const DEFAULT_MAX_SLOPE = 50;
export const DEFAULT_SWIM_SPEED = 4.7;

function checkStop({ instance, x, y, height }: WorldStop): WorldStop {
  if (!Number.isInteger(instance) || instance < 0) throw new RangeError(`Expected a map ID from 0, found ${instance}`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError(`Expected finite world yards, found ${x}, ${y}`);
  if (height !== null && !Number.isFinite(height)) throw new RangeError(`Expected a finite height or null, found ${height}`);
  return { instance, x, y, height };
}

export const formatWorldPoint = ({ x, y }: WorldPoint) => `${x.toFixed(2)}, ${y.toFixed(2)}`;

/** Reads `x, y` world yards, as typed in Edit coordinates. */
export function parseWorldPoint(text: string): WorldPoint {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  const point = match && { x: Number(match[1]), y: Number(match[2]) };
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new RangeError("Enter one point as x, y in yards.");
  return point;
}

/** A new plan from `start` to `destination` with default settings. Its leg takes the settings of `leg`. Fresh plans allow swimming. */
export function createPlan(start: WorldStop, destination: WorldStop, id: string = crypto.randomUUID(), leg: Leg = DEFAULT_LEG): RoutePlan {
  return {
    id,
    stops: [checkStop(start), checkStop(destination)],
    legs: [{ ...leg }],
    settings: {
      swimming: { enabled: true, speed: DEFAULT_SWIM_SPEED },
      modes: DEFAULT_MODES.map((mode) => ({ ...mode })),
    },
  };
}

/** Inserts a waypoint at `at` into leg `leg`. Both halves keep that leg's settings. */
export function insertWaypoint(plan: RoutePlan, leg: number, at: WorldStop): RoutePlan {
  const settings = plan.legs[leg];
  if (!settings) throw new RangeError(`No leg ${leg}`);
  return {
    ...plan,
    stops: plan.stops.toSpliced(leg + 1, 0, checkStop(at)),
    legs: plan.legs.toSpliced(leg, 0, { ...settings }),
  };
}

/**
 * The joined leg keeps a relaxation, including a straight line, only when
 * both legs had it. So removal never extends a relaxation over a leg that
 * lacked it.
 */
export function removeWaypoint(plan: RoutePlan, stop: number): RoutePlan {
  const before = plan.legs[stop - 1];
  const after = plan.legs[stop];
  if (!before || !after || stop >= plan.stops.length - 1) throw new RangeError("Only waypoints can be removed");
  return {
    ...plan,
    stops: plan.stops.toSpliced(stop, 1),
    legs: plan.legs.toSpliced(stop - 1, 2, {
      followTerrain: before.followTerrain || after.followTerrain,
      downhill: before.downhill && after.downhill,
      damagingFalls: before.damagingFalls && after.damagingFalls,
      fatalFalls: before.fatalFalls && after.fatalFalls,
      hazards: before.hazards && after.hazards,
      otherFaction: before.otherFaction && after.otherFaction,
      flightPaths: before.flightPaths && after.flightPaths,
      shipPaths: before.shipPaths && after.shipPaths,
    }),
  };
}

/** Moves any stop, as a drag or Edit coordinates does, possibly to another map. Its legs keep their settings. */
export function moveStop(plan: RoutePlan, stop: number, at: WorldStop): RoutePlan {
  if (!plan.stops[stop]) throw new RangeError(`No stop ${stop}`);
  return { ...plan, stops: plan.stops.with(stop, checkStop(at)) };
}

export function setLeg(plan: RoutePlan, leg: number, change: Partial<Leg>): RoutePlan {
  const settings = plan.legs[leg];
  if (!settings) throw new RangeError(`No leg ${leg}`);
  return { ...plan, legs: plan.legs.with(leg, { ...settings, ...change }) };
}

/** Each leg keeps its settings, which now apply in the other direction. */
export function reverse(plan: RoutePlan): RoutePlan {
  return {
    ...plan,
    stops: plan.stops.toReversed(),
    legs: plan.legs.toReversed(),
  };
}

/** Add point and start here: `at` is the new start, and the old start becomes the next stop. The new leg takes `leg`. */
export function addStart(plan: RoutePlan, at: WorldStop, leg: Leg = DEFAULT_LEG): RoutePlan {
  return {
    ...plan,
    stops: [checkStop(at), ...plan.stops],
    legs: [{ ...leg }, ...plan.legs],
  };
}

/** Adds a new destination at `at`; the old destination becomes a waypoint. The new leg takes `leg`. */
export function addDestination(plan: RoutePlan, at: WorldStop, leg: Leg = DEFAULT_LEG): RoutePlan {
  return {
    ...plan,
    stops: [...plan.stops, checkStop(at)],
    legs: [...plan.legs, { ...leg }],
  };
}

/**
 * Plan edits for one session, for undo. There is no redo. A drag adds one
 * entry however many moves it makes. After a clear there is no plan, and
 * undo brings it back.
 */
export type PlanHistory = EditHistory | { plan: null; past: PastEdits; dragging: false };

export interface EditHistory {
  plan: RoutePlan;
  past: PastEdits;
  /** True while a drag is open; its moves replace `plan` without new entries. */
  dragging: boolean;
}

type PastEdits = readonly { plan: RoutePlan; label: string }[];

const HISTORY_LIMIT = 100;

export function startHistory(plan: RoutePlan): EditHistory {
  return { plan, past: [], dragging: false };
}

const pastWith = (history: EditHistory, label: string): PastEdits => [...history.past, { plan: history.plan, label }].slice(-HISTORY_LIMIT);

/** Adopts `next` as one undoable edit described by `label`, such as "remove waypoint 2". It ends an open drag. */
export function record(history: EditHistory, next: RoutePlan, label: string): EditHistory {
  return { plan: next, past: pastWith(history, label), dragging: false };
}

/** Leaves no plan, as one undoable edit. It ends an open drag. */
export function clear(history: EditHistory): PlanHistory {
  return { plan: null, past: pastWith(history, "clear route"), dragging: false };
}

/** Moves `stop` during a drag. The first move of a drag records one edit; later moves join it. */
export function dragStop(history: EditHistory, stop: number, at: WorldStop, label: string): EditHistory {
  const next = moveStop(history.plan, stop, at);
  if (history.dragging) return { ...history, plan: next };
  return { ...record(history, next, label), dragging: true };
}

/** Ends a drag. A drag that put the stop back where it was leaves nothing to undo. */
export function endDrag(history: EditHistory): EditHistory {
  if (!history.dragging) return history;
  const before = history.past.at(-1)?.plan;
  const placed = (plan: RoutePlan) => JSON.stringify(plan.stops);
  const unchanged = before && placed(before) === placed(history.plan);
  return { plan: unchanged ? before : history.plan, past: unchanged ? history.past.slice(0, -1) : history.past, dragging: false };
}

/** Cancels an open drag: the plan returns to where it was before the drag, with nothing to undo. */
export function cancelDrag(history: EditHistory): EditHistory {
  const before = history.dragging && history.past.at(-1);
  return before ? { plan: before.plan, past: history.past.slice(0, -1), dragging: false } : history;
}

/** Restores the plan before the last edit, ending an open drag first. */
export function undo(history: PlanHistory): PlanHistory {
  const ended = history.plan ? endDrag(history) : history;
  const last = ended.past.at(-1);
  return last ? { plan: last.plan, past: ended.past.slice(0, -1), dragging: false } : ended;
}
