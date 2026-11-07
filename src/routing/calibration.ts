import type { Point } from "./frame.ts";
import { json, parseScope, scopeName, type ArtifactScope, type RoutingArtifact } from "./artifact.ts";
import type { LegResult } from "./search.ts";
import { fail, fields, list } from "./shape.ts";

/** The producer's travel modes, as observations and corridor cases name them. */
export const MODES = ["run", "mount", "epic-mount", "ghost-wolf", "travel-form"] as const;
export type Mode = (typeof MODES)[number];
/** The planner mode name (`DEFAULT_MODES`) of each producer mode. */
export const MODE_NAMES: Record<Mode, string> = {
  run: "Run",
  mount: "Mount",
  "epic-mount": "Epic mount",
  "ghost-wolf": "Ghost Wolf",
  "travel-form": "Travel Form",
};

/** Native pixels from a corridor endpoint to the matching observation endpoint: two routing cells, about 8 yards. */
export const TOLERANCE = 8;

/** A timed journey in the game, in the producer's format. */
export interface Observation {
  id: string;
  scope: ArtifactScope;
  from: Point;
  to: Point;
  mode: Mode;
  /** Character level, speed effects, and other conditions. */
  conditions: string;
  seconds: number;
  /** Who recorded it and how. */
  source: string;
}

/** A corridor run's routed result, as the corridor check gives it. */
interface Estimate {
  kind: LegResult["kind"];
  /** The best route found so far of a `missing-coverage` or `limit` result. */
  provisional?: true;
  seconds?: number;
  distance?: number;
}

/** A corridor of a cases file, routed in each of its modes. */
export interface RoutedCorridor {
  name: string;
  from: Point;
  to: Point;
  runs: { mode: Mode; estimate: Estimate }[];
}

/**
 * `calibrated`: a terrain route with at least one matching observation.
 * `uncalibrated`: no matching observation. `not-comparable`: matching
 * observations, but the estimate is not a terrain route.
 */
type CalibrationStatus = "calibrated" | "uncalibrated" | "not-comparable";

interface ComparedObservation extends Observation {
  /** Estimate minus observed, in seconds and in percent of observed. Only for a terrain route. */
  error?: { seconds: number; percent: number };
}

interface CalibrationEntry {
  corridor: string;
  from: Point;
  to: Point;
  mode: Mode;
  estimate: Estimate;
  status: CalibrationStatus;
  /** The corridor is at most 2 × TOLERANCE long, so its direction is unclear, and no observation matches it. */
  short?: true;
  /** The matching observations, in ID order. */
  observations: ComparedObservation[];
}

export interface CalibrationReport {
  schema: "restedxp-routing-calibration";
  version: 1;
  artifact: string;
  scope: ArtifactScope;
  settings: object;
  tolerance: number;
  counts: Record<CalibrationStatus, number> & { observations: number; unmatched: number; outOfScope: number };
  entries: CalibrationEntry[];
  unmatched: string[];
  outOfScope: Observation[];
}

/**
 * Matches the producer's observation parser, but keeps an observation of
 * another scope so that the report can name it.
 */
export function parseObservations(value: unknown, scope: ArtifactScope): Observation[] {
  const root = fields(value, "observations", ["schema", "version", "scope", "observations"]);
  if (root.schema !== "restedxp-routing-observations") fail("observations.schema", "expected restedxp-routing-observations");
  if (root.version !== 1) fail("observations.version", "expected 1");
  const fileScope = parseScope(root.scope, "observations.scope");
  if (scopeName(fileScope) !== scopeName(scope)) fail("observations.scope", `expected ${scopeName(scope)}, found ${scopeName(fileScope)}`);
  let last = "";
  for (const [i, value] of list(root.observations, "observations.observations").entries()) {
    const path = `observations.observations[${i}]`;
    const o = fields(value, path, ["id", "scope", "from", "to", "mode", "conditions", "seconds", "source"]);
    if (typeof o.id !== "string" || o.id.length > 100 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(o.id))
      fail(`${path}.id`, "expected lowercase letters, digits, and single hyphens");
    if (o.id <= last) fail(`${path}.id`, "expected ascending, distinct IDs");
    last = o.id;
    parseScope(o.scope, `${path}.scope`);
    const from = point(o.from, `${path}.from`),
      to = point(o.to, `${path}.to`);
    if (from.join() === to.join()) fail(`${path}.to`, "expected a different point from the start");
    if (!MODES.includes(o.mode as Mode)) fail(`${path}.mode`, `expected one of ${MODES.join(", ")}`);
    text(o.conditions, `${path}.conditions`);
    if (typeof o.seconds !== "number" || !(o.seconds > 0 && o.seconds <= 86_400))
      fail(`${path}.seconds`, "expected a number above 0 and at most 86400");
    text(o.source, `${path}.source`);
  }
  return root.observations as Observation[];
}

/** The artifact's observations; none when it has no `observations.json`. */
export async function loadObservations(artifact: Pick<RoutingArtifact, "manifest" | "read">): Promise<Observation[]> {
  const { manifest } = artifact;
  if (!manifest.assets.some((a) => a.path === "observations.json")) return [];
  return parseObservations(json(await artifact.read("observations.json"), "observations.json"), manifest.scope);
}

export function calibrate(input: {
  artifact: string;
  scope: ArtifactScope;
  settings: object;
  corridors: readonly RoutedCorridor[];
  observations: readonly Observation[];
}): CalibrationReport {
  const inScope = input.observations.filter((o) => scopeName(o.scope) === scopeName(input.scope));
  const outOfScope = input.observations.filter((o) => !inScope.includes(o));
  const gap = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const matched = new Set<string>();
  const entries: CalibrationEntry[] = [];
  for (const corridor of input.corridors) {
    const short = gap(corridor.from, corridor.to) <= 2 * TOLERANCE;
    const near = (o: Observation) => !short && gap(o.from, corridor.from) <= TOLERANCE && gap(o.to, corridor.to) <= TOLERANCE;
    for (const { mode, estimate } of corridor.runs) {
      const matches = inScope.filter((o) => o.mode === mode && near(o));
      for (const o of matches) matched.add(o.id);
      const complete = estimate.kind === "route" && estimate.seconds !== undefined;
      entries.push({
        corridor: corridor.name,
        from: corridor.from,
        to: corridor.to,
        mode,
        estimate,
        status: !matches.length ? "uncalibrated" : complete ? "calibrated" : "not-comparable",
        ...(short && { short }),
        observations: matches.map((o) => {
          if (!complete) return o;
          const difference = estimate.seconds! - o.seconds;
          return { ...o, error: { seconds: round(difference, 100), percent: round((100 * difference) / o.seconds, 10) } };
        }),
      });
    }
  }
  const unmatched = inScope.filter((o) => !matched.has(o.id)).map((o) => o.id);
  const count = (status: CalibrationStatus) => entries.filter((e) => e.status === status).length;
  return {
    schema: "restedxp-routing-calibration",
    version: 1,
    artifact: input.artifact,
    scope: input.scope,
    settings: input.settings,
    tolerance: TOLERANCE,
    counts: {
      calibrated: count("calibrated"),
      uncalibrated: count("uncalibrated"),
      "not-comparable": count("not-comparable"),
      observations: input.observations.length,
      unmatched: unmatched.length,
      outOfScope: outOfScope.length,
    },
    entries,
    unmatched,
    outOfScope,
  };
}

/** Report bytes: two-space JSON with a final newline. */
export const calibrationBytes = (report: CalibrationReport) => `${JSON.stringify(report, null, 2)}\n`;

/** A short Markdown summary: one table row for each corridor run, then the observations that match nothing. */
export function calibrationMarkdown(report: CalibrationReport): string {
  const { counts } = report;
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");
  const seconds = (n: number) => `${n.toFixed(2)} s`;
  const signed = (n: number, unit: string) => `${n > 0 ? "+" : ""}${n}${unit}`;
  const estimate = (e: Estimate) =>
    e.kind === "route" && e.seconds !== undefined
      ? seconds(e.seconds)
      : `${e.kind}${e.seconds !== undefined ? ` (${e.provisional ? "provisional " : ""}${seconds(e.seconds)})` : ""}`;
  const lines = [
    "# Routing calibration",
    "",
    `Artifact \`${report.artifact}\`, ${scopeName(report.scope)}. Endpoint tolerance: ${report.tolerance} native pixels.`,
    "",
    `Runs: ${counts.calibrated} calibrated, ${counts.uncalibrated} uncalibrated, ${counts["not-comparable"]} not comparable. ` +
      `Observations: ${counts.observations}, ${counts.unmatched} unmatched, ${counts.outOfScope} out of scope.`,
    "",
    "| Corridor | Mode | Estimate | Observed | Error | Status |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.entries.map((e) =>
      [
        "",
        cell(e.corridor),
        e.mode,
        estimate(e.estimate),
        e.observations.map((o) => `${o.id}: ${seconds(o.seconds)}`).join("; "),
        e.observations.flatMap((o) => (o.error ? [`${signed(o.error.seconds, " s")} (${signed(o.error.percent, "%")})`] : [])).join("; "),
        e.short ? `${e.status} (corridor too short)` : e.status,
        "",
      ]
        .join(" | ")
        .trim(),
    ),
  ];
  if (report.unmatched.length) lines.push("", "## Unmatched observations", "", ...report.unmatched.map((id) => `- ${id}`));
  if (report.outOfScope.length)
    lines.push(
      "",
      "## Out of scope",
      "",
      ...report.outOfScope.map((o) => `- ${o.id}: ${scopeName(o.scope)}, ${o.mode}, ${seconds(o.seconds)}`),
    );
  return `${lines.join("\n")}\n`;
}

const round = (n: number, scale: number) => Math.round(n * scale) / scale;

function point(value: unknown, path: string): Point {
  const p = list(value, path, 2);
  if (p.length !== 2 || !p.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 32_768))
    fail(path, "expected [x, y] integer native pixels from 0 to 32767");
  return value as Point;
}

function text(value: unknown, path: string): void {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) fail(path, "expected text of 1 to 2000 characters");
}
