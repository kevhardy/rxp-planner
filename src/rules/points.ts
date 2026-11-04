import type { GameData, GotoError, MapLocation } from "../data/index.ts";
import { luaNumber, type BodyLine, type Step } from "../guide/index.ts";
import { commandRule, type PointRun } from "./commands.ts";

/** An argument of `.questgoto` and `.questwaypoint` that RXP needs as a number, by its catalog name. */
export type QuestPointNumber = "radius" | "questId" | "objective";

// `addon.functions.questgoto` and `addon.functions.questwaypoint` read these arguments with `tonumber`, and make no
// element unless all three are numbers.
const QUEST_POINT_NUMBERS: readonly (readonly [QuestPointNumber, number])[] = [
  ["radius", 3],
  ["questId", 4],
  ["objective", 5],
];

/** The first argument that makes RXP drop a `.questgoto` or `.questwaypoint` line, or `undefined` when RXP keeps the line. */
export function droppedPointArg(line: BodyLine): QuestPointNumber | undefined {
  if (line.kind !== "command" || !commandRule(line.name)?.point?.quest) return undefined;
  return QUEST_POINT_NUMBERS.find(([, i]) => luaNumber(line.args[i] ?? "") === undefined)?.[0];
}

/** How RXP runs the line, or `undefined` when it is not a point line or RXP drops it. */
export const pointRun = (line: BodyLine): PointRun | undefined =>
  line.kind === "command" && droppedPointArg(line) === undefined ? commandRule(line.name)?.point?.run : undefined;

const isPointLine = (line: BodyLine): boolean => pointRun(line) !== undefined;

// The fifth `.waypoint` argument sets arrow priority or a callback, so it does not make a point optional.
// Every `.questgoto` is optional: `addon.functions.questgoto` passes `addon.functions["goto"]` an optional
// flag of "0", and keeps the line only with a fifth argument, the quest ID.
export const isOptionalPoint = (line: BodyLine): boolean =>
  line.kind === "command" && pointRun(line) === "goto" && line.args[4] !== undefined;

/** Whether the step's route stops at the point: something leads the player there, and it is not optional. */
export const isRouteStop = (line: BodyLine): boolean => {
  const run = pointRun(line);
  return run !== undefined && run !== "pin" && !isOptionalPoint(line);
};

/** Whether a line's arguments put the step on the map, as a point or a path: what the map draws, and what a coordinate edit changes. */
export const isCoordinateLine = (line: BodyLine): boolean =>
  isPointLine(line) || (line.kind === "command" && commandRule(line.name)?.path === true);

export interface StepPath<P = MapLocation> {
  line: number;
  command: "line" | "loop";
  points: P[];
}

export interface PointProblem {
  line: number;
  command: string;
  message: string;
}

export interface StepPoints<P = MapLocation> {
  points: (P & { line: number; command: string })[];
  paths: StepPath<P>[];
  problems: PointProblem[];
  /** `#loop`: the step's points form a closed loop. */
  loop: boolean;
}

/** Locates a step's point commands and paths. Problems are coordinates Forever cannot place. */
export function stepLocations(data: GameData, step: Pick<Step, "body">): StepPoints {
  return walkStep(data, step, (args) => {
    const located = data.locateGoto(args);
    return located.ok ? { uiMapId: located.uiMapId, x: located.x, y: located.y, world: located.world } : located;
  });
}

function walkStep<P>(data: GameData, step: Pick<Step, "body">, place: (args: readonly string[]) => P | GotoError): StepPoints<P> {
  const result: StepPoints<P> = { points: [], paths: [], problems: [], loop: false };
  const failed = (p: P | GotoError): p is GotoError => (p as GotoError).ok === false;
  step.body.forEach((line, index) => {
    if (line.kind === "tag" && line.name === "loop") result.loop = true;
    if (line.kind !== "command") return;
    if (isPointLine(line)) {
      const placed = place(line.args);
      if (failed(placed)) result.problems.push({ line: index, command: line.name, message: placed.message });
      else result.points.push({ ...placed, line: index, command: line.name });
    } else if (commandRule(line.name)?.path) {
      const command = line.name as "line" | "loop";
      // `.loop` puts an arrival range before the zone and has no world form.
      const path = command === "loop" ? pathArgs(line.args.slice(1), false, data) : pathArgs(line.args, true, data);
      const points = typeof path === "string" ? path : path.map(place);
      const problem = typeof points === "string" ? points : points.find(failed)?.message;
      if (problem !== undefined) result.problems.push({ line: index, command, message: problem });
      else result.paths.push({ line: index, command, points: points as P[] });
    }
  });
  return result;
}

/**
 * Splits `zone,x1,y1,x2,y2,...` into `.goto` arguments for each point as
 * RXP's `.line` and `.loop` handlers read them, or says why it cannot.
 * Unlike `.goto`, zone aliases such as `StormwindNew` keep their
 * percentages. With `worldForm`, `mapId/instance` gives world coordinates,
 * as in `.line`, where `+` before a map ID only adds a center point.
 */
function pathArgs(args: readonly string[], worldForm: boolean, data: GameData): string[][] | string {
  const [zone = "", ...coords] = args;
  // RXP matches `(%d+)/(%d+)` anywhere in the zone argument.
  const world = worldForm && /(\d+)\/(\d+)/.exec(zone);
  let mapId = world && `${world[1]}/${world[2]}`;
  if (!mapId) {
    // Like Lua's tonumber, Number reads "+1429" as 1429.
    const id = data.uiMapNamed(zone) ?? (zone.trim() === "" ? NaN : Number(zone));
    if (!Number.isFinite(id)) return `RXP has no zone named "${zone}".`;
    mapId = String(id);
  }
  const points: string[][] = [];
  for (let i = 0; i + 1 < coords.length; i += 2) points.push([mapId, coords[i]!, coords[i + 1]!]);
  return points;
}

/**
 * Where a new point goes: after the selected point line, else after the
 * step's last point line, else after its leading tags, as guides put `.goto`
 * first.
 */
export function insertIndex(body: Step["body"], selected: number | null): number {
  if (selected !== null && body[selected] && isPointLine(body[selected])) return selected + 1;
  const last = body.findLastIndex(isPointLine);
  if (last >= 0) return last + 1;
  const firstOther = body.findIndex((l) => l.kind !== "tag");
  return firstOther < 0 ? body.length : firstOther;
}
