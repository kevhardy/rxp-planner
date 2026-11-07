import type { Point } from "./frame.ts";
import { TILE_PIXELS, TILE_WORLD_UNITS } from "./artifact.ts";
import { routeOf, type Journey, type JourneyLeg } from "./journey.ts";
import { DAMAGE_FALL, FATAL_FALL, type LegResult, type LegStop, type TerrainRoute } from "./search.ts";
import { rideCost, transportSteps, type TransportLeg, type TransportLink } from "./transport.ts";

/**
 * A leg's time and horizontal distance. `complete`: terrain routes, and for
 * a transport leg its rides. `estimate`: some ground is a straight line.
 * `provisional`: a failed search's best route so far, which is possibly not
 * the cheapest.
 */
export interface Measure {
  seconds: number;
  /** Horizontal world units (yards) along the drawn path. */
  distance: number;
  basis: "complete" | "estimate" | "provisional";
}

export interface LegSummary {
  kind: JourneyLeg["kind"];
  label: string;
  measure?: Measure;
  /**
   * `terrain`: ground cells. `straight`: unchecked against terrain.
   * `transport`: ground and rides. `crossing`: between two maps, not
   * routed. `none`: no route.
   */
  source: "terrain" | "straight" | "transport" | "crossing" | "none";
  provenance: string;
}

/**
 * `complete`: no leg failed or holds a straight line; a crossing adds no time.
 * `estimate`: the listed legs hold straight lines. `none`: the listed legs
 * failed, so the journey has no total.
 */
export type JourneyTotal =
  | { kind: "complete"; seconds: number; distance: number }
  | { kind: "estimate"; seconds: number; distance: number; straight: number[] }
  | { kind: "none"; failed: { leg: number; kind: JourneyLeg["kind"] }[] };

export interface JourneySummary {
  mode: string;
  legs: LegSummary[];
  total: JourneyTotal;
  /** The legs between two maps, by index. The total does not count them. */
  crossings: number[];
}

const WORLD_PER_PIXEL = TILE_WORLD_UNITS / TILE_PIXELS;
const length = (points: readonly Point[]) =>
  points.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - points[i - 1]![0], p[1] - points[i - 1]![1]) : 0), 0) * WORLD_PER_PIXEL;

const CROSSING: LegSummary = {
  kind: "crossing",
  label: "No ground route between continents",
  source: "crossing",
  provenance: "Between continents; no ride that this character can take joins them",
};

const RIDE_WORDS: Record<string, { label: string; stop: string; noun: string; doing?: string }> = {
  ship: { label: "Ship", stop: "the ship", noun: "ship", doing: "Taking ship to" },
  zeppelin: { label: "Zeppelin", stop: "the zeppelin", noun: "zeppelin", doing: "Taking the zeppelin to" },
  tram: { label: "Deeprun Tram", stop: "the Deeprun Tram", noun: "Deeprun Tram", doing: "Taking the tram to" },
  portal: { label: "Portal", stop: "the portal", noun: "portal", doing: "Taking the portal to" },
  transition: { label: "Portal", stop: "the portal", noun: "portal" },
  access: { label: "Entrance", stop: "the entrance", noun: "entrance" },
  "druid-flight": { label: "Druid flight", stop: "the druid flight", noun: "druid flight" },
  elevator: { label: "Elevator", stop: "the elevator", noun: "elevator", doing: "Taking the elevator to" },
  flight: { label: "Fly", stop: "the flight master", noun: "flight", doing: "On flight path to" },
};

const wordsOf = (mode: string) => (Object.hasOwn(RIDE_WORDS, mode) ? RIDE_WORDS[mode] : undefined);

/** The rides of one step in words, by where the last ends, such as "Ship to Auberdine" or "Fly to Ironforge". */
export const rideLabel = (links: readonly TransportLink[]) => {
  const { mode, to } = links.at(-1)!;
  return `${wordsOf(mode)?.label ?? mode} to ${to.name}`;
};

/** What the character does on a ride in Playback, such as "Taking ship to Auberdine". */
export const rideText = ({ mode, to }: Pick<TransportLink, "mode" | "to">) => `${wordsOf(mode)?.doing ?? "Riding to"} ${to.name}`;

/** The kinds of a leg's rides in travel order, each once, such as "Ship, flight, portal". */
export function rideKinds(leg: TransportLeg): string {
  const nouns = [
    ...new Set(
      transportSteps(leg.parts).flatMap((step) => {
        if (step.kind !== "ride") return [];
        const { mode } = step.links[0]!;
        return [wordsOf(mode)?.noun ?? mode];
      }),
    ),
  ];
  const words = nouns.join(", ");
  return words[0]!.toUpperCase() + words.slice(1);
}

/**
 * A ground step in words: the mode, then where it goes, such as "Run to the
 * ship". A step to no ride goes to `end`, such as "the destination".
 */
export const groundLabel = (mode: string, next: TransportLink | undefined, end: string) =>
  `${mode} to ${next ? (wordsOf(next.mode)?.stop ?? next.mode) : end}`;

const ESTIMATE_NOTE = "Estimate from the flight length";
const REFERENCE_NOTE = "Estimate from the straight line and a nearby flight";

function estimateNote(links: readonly TransportLink[]) {
  const hops = links.filter((link) => link.from.air && link.to.air);
  const reference = hops.filter((link) => link.estimate === "reference").length;
  if (!reference) return ESTIMATE_NOTE;
  if (reference === hops.length) return REFERENCE_NOTE;
  return `${ESTIMATE_NOTE}, and for ${reference === 1 ? "one hop" : `${reference} hops`} from the straight line and a nearby flight`;
}

/**
 * The time of one step's rides in words: the time that routes count
 * (`rideCost`), and the spread as "min to max" when the wait varies. A ride
 * that the source times with a placeholder makes the step read "TBD". A
 * ride whose time is a model estimate gives the step a note (`estimateNote`).
 */
export function rideTime(links: readonly TransportLink[]): { cost: string; spread?: string; note?: string } {
  if (links.some((link) => link.placeholder)) return { cost: "TBD" };
  const sum = (pick: (link: TransportLink) => number) => links.reduce((total, link) => total + pick(link), 0);
  const [min, max] = [sum((link) => link.seconds.min), sum((link) => link.seconds.max)];
  const cost = formatSeconds(sum(rideCost));
  return {
    cost,
    ...(min !== max && { spread: `${formatSeconds(min)} to ${formatSeconds(max)}` }),
    ...(links.some((link) => link.estimate) && { note: estimateNote(links) }),
  };
}

function summarizeTransport(leg: TransportLeg): LegSummary {
  const grounds = leg.parts.flatMap((part) => (part.kind === "ground" ? [part.result] : []));
  const rides = leg.parts.flatMap((part) => (part.kind === "ride" ? [part.link] : []));
  const steps = transportSteps(leg.parts).flatMap((step) => (step.kind === "ride" ? [step.links] : []));
  const distance = grounds.reduce((sum, result) => {
    const route = routeOf(result);
    return sum + (result.kind === "straight" ? result.distance : route ? length(route.points) : 0);
  }, 0);
  const basis = grounds.some((r) => r.kind === "straight")
    ? "estimate"
    : grounds.every((r) => r.kind === "route")
      ? "complete"
      : "provisional";
  const tbd = rides.some((ride) => ride.placeholder);
  const estimate = rides.some((ride) => ride.estimate);
  const reference = rides.some((ride) => ride.estimate === "reference");
  return {
    kind: "transport",
    label: steps.map(rideLabel).join(", then "),
    measure: { seconds: leg.seconds, distance, basis },
    source: "transport",
    provenance: `Terrain and rides, each ride at its average wait${tbd ? "; a ride time is TBD, so the leg counts its placeholder" : ""}${estimate ? `; flight times are estimates from the flight length${reference ? ", or from the straight line and a nearby flight" : ""}` : ""}`,
  };
}

export function summarizeLeg(result: JourneyLeg): LegSummary {
  if (result.kind === "crossing") return CROSSING;
  if (result.kind === "transport") return summarizeTransport(result);
  const route = routeOf(result);
  const source = result.kind === "straight" ? "straight" : route ? "terrain" : "none";
  const measure: Measure | undefined =
    result.kind === "straight"
      ? { seconds: result.seconds, distance: result.distance, basis: "estimate" }
      : route && { seconds: route.seconds, distance: length(route.points), basis: result.kind === "route" ? "complete" : "provisional" };
  return {
    kind: result.kind,
    label: legLabel(result),
    ...(measure && { measure }),
    source,
    provenance: source === "straight" ? "Straight line, not checked against terrain" : source === "none" ? "No route" : "Terrain only",
  };
}

export function summarizeJourney(journey: Journey): JourneySummary {
  const legs = journey.legs.map(summarizeLeg);
  const failed = legs.flatMap((leg, i) =>
    leg.kind === "route" || leg.kind === "straight" || leg.kind === "transport" || leg.kind === "crossing"
      ? []
      : [{ leg: i, kind: leg.kind }],
  );
  const straight = legs.flatMap((leg, i) => (leg.measure?.basis === "estimate" ? [i] : []));
  const sum = (key: "seconds" | "distance") => legs.reduce((s, leg) => s + (leg.measure?.[key] ?? 0), 0);
  const total: JourneyTotal = failed.length
    ? { kind: "none", failed }
    : straight.length
      ? { kind: "estimate", seconds: sum("seconds"), distance: sum("distance"), straight }
      : { kind: "complete", seconds: sum("seconds"), distance: sum("distance") };
  return {
    mode: journey.mode.name,
    legs,
    total,
    crossings: legs.flatMap((leg, i) => (leg.kind === "crossing" ? [i] : [])),
  };
}

function legLabel(result: LegResult): string {
  const provisional = "route" in result && result.route ? "; provisional route shown" : "";
  switch (result.kind) {
    case "route":
      return "Terrain route";
    case "straight":
      return "Straight-line estimate";
    case "no-path":
      return result.endpoint ? `No path: the ${result.endpoint} is blocked, too steep, or in water` : "No path";
    case "missing-coverage":
      return `Missing coverage: terrain data unavailable for ${count(result.tiles.length, "nearby tile")}${
        result.route ? "; the route is provisional because a faster one may pass through them" : ""
      }`;
    case "limit":
      return `Search limit: needs ${result.cells.toLocaleString("en-US")} cells${provisional}`;
    case "no-terrain":
      return `No terrain at the ${result.endpoint}`;
  }
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
/**
 * A floor index counts height peaks inside a building, not storeys, so only
 * its side of the ground floor is safe to name.
 */
export function floorName(index: number, ground: number): string {
  if (index === ground) return "ground floor";
  return index > ground ? "upper level" : "lower level";
}

export interface FloorLine {
  text: string;
  /** The stop of the line: 0 for the start of the route, 1 for its end. */
  side: 0 | 1;
  /** The route starts or stops at a door, or the floor of the stop is not confirmed. */
  warn: boolean;
}

type Floor = Exclude<LegStop["floor"], "door" | undefined>;
const floorLine = (label: string, { index, ground, confirmed }: Floor, side: 0 | 1): FloorLine => ({
  text: `${label}: ${floorName(index, ground)}${confirmed ? "" : ". The floor is not confirmed."}`,
  side,
  warn: !confirmed,
});

/**
 * Where a route meets its stops in buildings, in words: the floor of its end,
 * the floor of its start when that floor is not confirmed, and the door where
 * it starts or ends when the floor of that stop is not known. A start on a
 * confirmed floor has no line, because the leg that arrives names it. The route
 * workspace shows a `warn` line as a warning. A route without `stops`, such as
 * one on tiles without floors, has no lines.
 */
export function floorLines(route: TerrainRoute): FloorLine[] {
  const [start, end] = route.stops ?? [];
  const lines: FloorLine[] = [];
  if (start?.floor === "door") lines.push({ text: "Start inside: floor not known. The route starts at the door.", side: 0, warn: true });
  else if (start?.floor && !start.floor.confirmed) lines.push(floorLine("Start inside", start.floor, 0));
  if (end?.floor === "door") lines.push({ text: "Inside: floor not known. The route stops at the door.", side: 1, warn: true });
  else if (end?.floor) lines.push(floorLine("Inside", end.floor, 1));
  return lines;
}

/** A line of `fallLines`: the height, such as "32.8 yd", and the damage, such as "~35% HP" or "Fatal". */
export interface FallLine {
  height: string;
  damage: string;
  fatal: boolean;
}

/** The damage share of health is 0.018 × height − 0.2426, as AzerothCore computes it. */
export function fallLines(route: TerrainRoute): FallLine[] {
  return route.falls.flatMap(({ height }) => {
    if (height < DAMAGE_FALL) return [];
    const fatal = height >= FATAL_FALL;
    const damage = fatal ? "Fatal" : `~${Math.round((0.018 * height - 0.2426) * 100)}% HP`;
    return [{ height: `${height.toFixed(1)} yd`, damage, fatal }];
  });
}

/** Seconds as "7 min 7 s", or "45 s" under a minute. */
export function formatSeconds(seconds: number): string {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export const formatDistance = (distance: number) => `${Math.round(distance).toLocaleString("en-US")} yd`;

/** A route that only skipped tiles without terrain data reads as complete. The leg panel notes the tiles. */
export function measureLabel(measure: Measure, kind: JourneyLeg["kind"]): string {
  const text = `${formatSeconds(measure.seconds)}, ${formatDistance(measure.distance)}`;
  return measure.basis === "complete" || kind === "missing-coverage" ? text : `${text} (${measure.basis})`;
}

/**
 * The UI sums a journey whose only failed legs skipped tiles without terrain
 * data. `summary.total` still marks that journey failed.
 */
export function shownTotal(summary: JourneySummary): JourneyTotal {
  const { total, legs } = summary;
  const known = legs.every((leg) => leg.measure || leg.kind === "crossing");
  if (total.kind !== "none" || !total.failed.every((f) => f.kind === "missing-coverage") || !known) return total;
  const sum = (key: "seconds" | "distance") => legs.reduce((s, leg) => s + (leg.measure?.[key] ?? 0), 0);
  const straight = legs.flatMap((leg, i) => (leg.measure?.basis === "estimate" ? [i] : []));
  return straight.length
    ? { kind: "estimate", seconds: sum("seconds"), distance: sum("distance"), straight }
    : { kind: "complete", seconds: sum("seconds"), distance: sum("distance") };
}
