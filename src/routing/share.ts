import type { Tile } from "./artifact.ts";
import type { JourneyLeg } from "./journey.ts";
import { DEFAULT_LEG, LEG_KEYS, type Leg, type RoutePlan } from "./plan.ts";
import { fail, fields, parse, readPlanParts } from "./records.ts";
import { summarizeLeg } from "./result.ts";
import type { RideSeconds } from "../../packages/data-contract/transports.ts";

const ROUTE_FORMAT = "restedxp-route";
const ROUTE_VERSION = 3;
const MAX_STOPS = 100;

/** One leg's result in the shown mode, or why it has none. Distances are yards and times are seconds. */
export interface LegReport {
  status: JourneyLeg["kind"] | "calculating" | "failed";
  distance?: number;
  seconds?: number;
  /** The search region of a `limit` result, in cells. */
  cells?: number;
  /** The stop of a `no-terrain` result, or of a `no-path` result that names one. */
  endpoint?: "start" | "end";
  /** The tiles without terrain data of a `missing-coverage` result. */
  tiles?: Tile[];
  reason?: string;
  parts?: PartReport[];
}

/** `from` and `to` are stop IDs of the transport file. */
type PartReport =
  | ({ kind: "ground" } & Omit<LegReport, "parts">)
  | { kind: "ride"; service: string; from: string; to: string; seconds: RideSeconds; placeholder?: true };

/** What the workspace showed when the route was copied. The planner does not know its build commit, so the context has none. */
export interface RouteContext {
  artifacts: Record<number, string>;
  maxSlope: number;
  /** The mode of `results`. */
  mode?: string;
  results: LegReport[];
}

const tenths = (n: number) => Math.round(n * 10) / 10;

export function legReport(result: JourneyLeg): LegReport {
  const { measure } = summarizeLeg(result);
  return {
    status: result.kind,
    ...(measure && { distance: tenths(measure.distance), seconds: tenths(measure.seconds) }),
    ...(result.kind === "limit" && { cells: result.cells }),
    ...((result.kind === "no-terrain" || result.kind === "no-path") && result.endpoint && { endpoint: result.endpoint }),
    ...(result.kind === "missing-coverage" && { tiles: result.tiles.map(({ tile }) => tile) }),
    ...(result.kind === "transport" && {
      parts: result.parts.map((part): PartReport =>
        part.kind === "ground"
          ? { kind: "ground", ...legReport(part.result) }
          : {
              kind: "ride",
              service: part.link.service,
              from: part.link.from.id,
              to: part.link.to.id,
              seconds: part.link.seconds,
              ...(part.link.placeholder && { placeholder: true }),
            },
      ),
    }),
  };
}

const legOf = (leg: Leg): Leg => {
  const out = { ...DEFAULT_LEG };
  for (const key of LEG_KEYS) out[key] = leg[key];
  return out;
};

export function writeRoute(plan: RoutePlan, context: RouteContext): string {
  const { swimming, modes } = plan.settings;
  return layout({
    format: ROUTE_FORMAT,
    version: ROUTE_VERSION,
    stops: plan.stops,
    legs: plan.legs.map(legOf),
    settings: { swimming, modes },
    context,
  });
}

const isObject = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value);

function layout(value: unknown, indent = ""): string {
  const inner = `${indent}  `;
  if (Array.isArray(value) && value.some(isObject))
    return `[\n${value.map((entry) => inner + JSON.stringify(entry)).join(",\n")}\n${indent}]`;
  if (isObject(value) && indent.length < 4)
    return `{\n${Object.entries(value as object)
      .map(([key, entry]) => `${inner}${JSON.stringify(key)}: ${layout(entry, inner)}`)
      .join(",\n")}\n${indent}}`;
  return JSON.stringify(value);
}

/**
 * Reads route text as a new plan with ID `id`. It needs no routing data: a
 * stop off the loaded data reads, and the route search reports it. Throws
 * `path: problem` at the first fault.
 */
export function readRoute(text: string, id: string): RoutePlan {
  if (!text.trim()) throw new Error("Paste the text of a copied route.");
  const value = parse(text) as { format?: unknown; version?: unknown } | null;
  if (value?.format !== ROUTE_FORMAT) fail("route.format", `expected "${ROUTE_FORMAT}"`);
  const { version } = value;
  if (typeof version === "number" && version < ROUTE_VERSION)
    fail("route.version", `this planner no longer reads version ${version} route text. It reads version ${ROUTE_VERSION}`);
  if (version !== ROUTE_VERSION) fail("route.version", `expected ${ROUTE_VERSION}, the version that this planner reads`);
  const root = fields(value, "route", ["format", "version", "stops", "legs", "settings"], ["context"]);
  return { id, ...readPlanParts(root, "route", MAX_STOPS) };
}
