import type { InstanceId } from "../data/index.ts";
import { TILE_PIXELS, TILE_WORLD_UNITS } from "./artifact.ts";
import { classifyStop } from "./indoor.ts";
import { nativePlan, noArtifact, resolvedOn, type MapPoint, type NativeFrame, type NativePlan, type Point } from "./frame.ts";
import type { Leg, MovementMode, RoutePlan } from "./plan.ts";
import { GROUND_SETTINGS, noPathKey, searchKey } from "./reuse.ts";
import { routeOf } from "./result.ts";
import {
  SNAP,
  coarseBound,
  keptReach,
  retime,
  routeLeg,
  snapNode,
  swimStart,
  type LegRequest,
  type LegResult,
  type LegStop,
  type TerrainRoute,
} from "./search.ts";
import { nativeToCell, type Terrain } from "./terrain.ts";
import {
  groundSeconds,
  RIDE_SETTINGS,
  legRides,
  routeTransport,
  type ClosedSide,
  type GroundBound,
  type GroundLeg,
  type Rides,
  type TransportLeg,
  type TransportPart,
} from "./transport.ts";

export interface JourneyOptions extends Pick<LegRequest, "maxSlope" | "cellBudget"> {
  /** The names of the modes to route, such as the one mode that the route workspace shows; every mode of the plan without it. */
  modes?: readonly string[];
  /**
   * Names the terrain: two grounds with one name route every leg the same. Without it, legs
   * have no key, and no leg uses `known`.
   */
  groundKey?: string;
  /** Earlier leg results by key. A leg whose key is here takes that result, and is not searched. */
  known?: ReadonlyMap<string, LegResult>;
  /**
   * Gets each ground result that the search finds, by key. These include the
   * results that no leg update reports: the ground parts of rides that the trip
   * does not take, and the results of the reference mode
   * (`sharedGround`). A later search can take them in `known`.
   */
  found?: (key: string, result: LegResult) => void;
  /**
   * Gets leg results as soon as they are known. The first call has every leg
   * that needs no long search, perhaps none; each later call has one leg
   * that a search found. With rides, each leg first comes `searching`, then
   * `searching` with `trying` each time the search of its rides moves to
   * another mode of ride, and again when the search of its rides ends.
   */
  onLegs?: (updates: LegUpdate[]) => void;
  /** The rides that `routeTrip` may take (`routeTransport`); none by default. Each leg takes those of `legRides`. */
  rides?: Rides;
}

/**
 * One leg's result in one mode, by its index in the plan. A ground leg has
 * its key when the ground has a name. `searching`: the rides of the leg are
 * not searched yet, so a later update for the leg and mode gives its result.
 * Until then, a ground result is only the leg's way without rides, and a
 * crossing means only that no ride is known yet. `trying`: the search of the
 * leg's rides now walks to or from a ride of this mode.
 */
export type LegUpdate = { mode: string; leg: number; searching?: true; trying?: string } & (
  | { result: LegResult; key?: string }
  | { result: Crossing | TransportLeg }
);

/**
 * A leg between stops on two maps without a way through the rides that the
 * trip may take. It has no route and adds no time.
 */
interface Crossing {
  kind: "crossing";
}

export type JourneyLeg = LegResult | TransportLeg | Crossing;

export interface Journey<Leg = JourneyLeg> {
  mode: MovementMode;
  /** One result for each leg of the plan, in order. Failed legs keep any provisional route. */
  legs: Leg[];
  /**
   * The sum of the legs, including straight estimates and rides at their
   * average wait; a crossing adds nothing. Undefined when any other leg is not a
   * `route`, `straight`, or `transport` result: the journey has no complete total.
   */
  seconds?: number;
}

export interface Journeys {
  /** One journey for each routed mode, in the plan's display order. */
  journeys: Journey[];
  /** The routed mode's journey with the least complete total; the earlier mode on a tie. */
  fastest?: Journey;
}

const routedModes = (plan: NativePlan, { modes }: JourneyOptions) =>
  plan.settings.modes.filter((mode) => !modes || modes.includes(mode.name));

async function startJourneys(
  terrain: Terrain,
  plan: NativePlan,
  options: JourneyOptions,
  report: (update: LegUpdate) => void,
  share: SharedGround,
): Promise<{ requests: { request: LegRequest; moves: boolean }[][]; search: () => Promise<Journey<LegResult>[]> }> {
  const started: Awaited<ReturnType<typeof startJourney>>[] = [];
  for (const mode of routedModes(plan, options)) started.push(await startJourney(terrain, plan, mode, options, report, share));
  return {
    requests: started.map(({ requests }) => requests),
    search: async () => {
      const journeys: Journey<LegResult>[] = [];
      for (const { search } of started) journeys.push(await search());
      return journeys;
    },
  };
}

function reporter(onLegs: JourneyOptions["onLegs"]) {
  let held: LegUpdate[] | undefined = [];
  return {
    add(update: LegUpdate) {
      if (held) held.push(update);
      else onLegs?.([update]);
    },
    flush() {
      if (held) onLegs?.(held);
      held = undefined;
    },
  };
}

const withFastest = (journeys: Journey[]): Journeys => {
  const fastest = journeys.reduce<Journey | undefined>(
    (best, j) => (j.seconds !== undefined && (best?.seconds === undefined || j.seconds < best.seconds) ? j : best),
    undefined,
  );
  return { journeys, ...(fastest && { fastest }) };
};

export interface MapGround extends Pick<JourneyOptions, "groundKey"> {
  terrain: Terrain;
}

/**
 * Routes a plan whose stops can be on several maps, such as Eastern
 * Kingdoms and Kalimdor. Each run of legs on one map routes as one journey
 * for each mode of `options.modes` on the ground that `ground` gives for that
 * map, with `options`. `ground` gives undefined for a map without terrain.
 *
 * Then each leg can take the rides of `options.rides` that its setting
 * allows (`legRides`, `routeTransport`): a leg on one map when a way through rides beats its
 * ground route, and a leg between two maps when it has such a way. A leg
 * between two maps without one is a `Crossing`. The mode is inactive after a
 * crossing, as at the start. In a leg with rides, a ride leaves the mode
 * inactive. The next leg starts in the mode state at the end of the leg that
 * the trip takes.
 */
export async function routeTrip(
  world: RoutePlan,
  ground: (map: InstanceId) => MapGround | undefined,
  options: JourneyOptions,
): Promise<Journeys> {
  const mapGround = (map: number) => {
    const found = ground(map);
    if (!found) throw noArtifact(map);
    return found;
  };
  const plan = nativePlan(world, (map) => ground(map)?.terrain.frame);
  const { stops, legs } = plan;
  const runs = mapRuns(plan);
  const transports = options.rides?.links ?? [];
  const report = reporter(options.onLegs);
  const modes = routedModes(plan, options);
  const share = sharedGround(plan.settings.modes, modes, options);
  const started: { run: { from: number; to: number }; started: Awaited<ReturnType<typeof startJourneys>> }[] = [];
  for (const run of runs) {
    const { terrain, ...named } = mapGround(plan.maps[run.from]!);
    const part = runPlan(plan, run);
    const add = (update: LegUpdate) =>
      report.add({ ...update, leg: update.leg + run.from, ...(transports.length > 0 && { searching: true }) });
    started.push({ run, started: await startJourneys(terrain, part, { ...options, ...named }, add, share) });
  }
  const runOf = (i: number) => started.findIndex(({ run }) => run.from <= i && i < run.to);
  for (const i of legs.keys())
    if (runOf(i) < 0)
      for (const mode of modes)
        report.add({ mode: mode.name, leg: i, result: { kind: "crossing" }, ...(transports.length > 0 && { searching: true }) });
  report.flush();
  const routed: Journey<LegResult>[][] = [];
  for (const { started: s } of started) routed.push(await s.search());
  if (!transports.length && runs.length === 1 && runs[0]!.from === 0 && runs[0]!.to === stops.length - 1) return withFastest(routed[0]!);
  const noPath = new Map<string, LegResult>();
  const closedSides = new Map<string, boolean>();
  const unprovenSides = new Set<string>();
  const journeys: Journey[] = [];
  for (const [m, mode] of modes.entries()) {
    const trip: JourneyLeg[] = [];
    const asked: (LegRequest | undefined)[] = [];
    let active = false;
    for (const i of legs.keys()) {
      const k = runOf(i);
      const from = k < 0 ? 0 : started[k]!.run.from;
      let own = k < 0 ? undefined : routed[k]![m]!.legs[i - from];
      const crossing: Crossing = { kind: "crossing" };
      let rides: TransportLeg | undefined;
      if (transports.length) {
        const requests = k < 0 ? undefined : started[k]!.started.requests[m]!;
        const [start, end] = [stopAt(plan, i)!, stopAt(plan, i + 1)!];
        let request = requests?.[i - from]!.request;
        if (request && i > 0) {
          const terrain = mapGround(plan.maps[i]!).terrain;
          active = await activeAfter(plan, terrain, options.maxSlope, (j) => rideWalks(trip[j]), i, from, requests!, active);
          if (active !== request.active) {
            request = { ...request, active };
            own = (await rideGround(i, mode, request)(start, end, { first: true, last: true })).result;
          }
        } else active = false;
        asked[i] = request;
        const direct = own && (groundSeconds(own) ?? routeOf(own)?.seconds);
        const speed = Math.max(mode.speed, plan.settings.swimming.enabled ? plan.settings.swimming.speed : 0);
        const links = legRides(options.rides!, legs[i]!);
        const walk = rideGround(i, mode, request);
        let trying: string | undefined;
        const before = { mode: mode.name, leg: i, searching: true as const, ...(own ? { result: own } : { result: crossing }) };
        rides = await routeTransport(
          start,
          end,
          links,
          speed,
          (from, to, ends) => {
            if (ends.ride !== undefined && ends.ride !== trying) report.add({ ...before, trying: (trying = ends.ride) });
            return walk(from, to, ends);
          },
          direct,
          closedSide(i, mode),
          rideBound(i, mode),
        );
        report.add({ mode: mode.name, leg: i, ...(rides ? { result: rides } : own ? { result: own } : { result: crossing }) });
      }
      trip.push(rides ?? own ?? crossing);
    }
    if (transports.length) await settleContinues(trip, asked, m, mode);
    const timed = trip.every((leg) => leg.kind === "crossing" || leg.kind === "transport" || timedLeg(leg));
    const seconds = trip.reduce((sum, leg) => sum + ("seconds" in leg ? leg.seconds : 0), 0);
    journeys.push({ mode, legs: trip, ...(timed && { seconds }) });
  }
  return withFastest(journeys);

  async function settleContinues(trip: JourneyLeg[], asked: readonly (LegRequest | undefined)[], m: number, mode: MovementMode) {
    const moves = (k: number) => {
      const { run, started: s } = started[runOf(k)]!;
      return s.requests[m]![k - run.from]!.moves;
    };
    for (const [i, leg] of trip.entries()) {
      const { active = false, continues: was = false } = asked[i] ?? {};
      const continues = continuesAfter(plan, (j) => rideWalks(trip[j]), moves, i);
      if (leg.kind === "crossing" || continues === was) continue;
      const walk = rideGround(i, mode, { active, continues });
      const end = stopAt(plan, i + 1)!;
      if (leg.kind === "transport") {
        const last = leg.parts.at(-1) as Extract<TransportPart, { kind: "ground" }>;
        const ride = leg.parts.at(-2) as Extract<TransportPart, { kind: "ride" }>;
        const { result, key } = await walk(ride.link.to, end, { first: false, last: true });
        const part: TransportPart = {
          kind: "ground",
          map: last.map,
          from: last.from,
          to: last.to,
          result,
          ...(key !== undefined && { key }),
        };
        trip[i] = {
          ...leg,
          parts: [...leg.parts.slice(0, -1), part],
          seconds: leg.seconds + groundSeconds(result)! - groundSeconds(last.result)!,
        };
        report.add({ mode: mode.name, leg: i, result: trip[i] });
      } else {
        const { result } = await walk(stopAt(plan, i)!, end, { first: true, last: true });
        report.add({ mode: mode.name, leg: i, result: (trip[i] = result) });
      }
    }
  }

  function closedSide(i: number, mode: MovementMode): ClosedSide {
    return async (side, stops) => {
      const key = `${i} ${side}`;
      const known = closedSides.get(key);
      if (known !== undefined) return known;
      if (unprovenSides.has(key)) return false;
      if (!stops.length) return true;
      const setting = plan.legs[i]!;
      const stop = stopAt(plan, side === "from" ? i : i + 1)!;
      const terrain = mapGround(stop.map).terrain;
      if (setting.followTerrain && (await offTerrain(terrain, stop.point))) {
        closedSides.set(key, true);
        return true;
      }
      const r = legRequest(setting, mode, plan, options, false, false, planHeights(plan, i));
      const test = await keptReach(terrain, stop.point, side, setting, r);
      if (!test) {
        unprovenSides.add(key);
        return false;
      }
      let closed = true;
      for (const s of stops)
        if (await test(s.point, s.height)) {
          closed = false;
          break;
        }
      closedSides.set(key, closed);
      return closed;
    };
  }

  function rideBound(i: number, mode: MovementMode): GroundBound | undefined {
    const setting = plan.legs[i]!;
    if (!setting.followTerrain) return undefined;
    const r = legRequest(setting, mode, plan, options, false, false, planHeights(plan, i));
    return async (from, to) => {
      const terrain = ground(from.map)?.terrain;
      return terrain && coarseBound(terrain, from, to, setting, r);
    };
  }

  function rideGround(i: number, mode: MovementMode, request: Pick<LegRequest, "active" | "continues"> | undefined): GroundLeg {
    const setting = plan.legs[i]!;
    return async (from, to, { first, last }) => {
      const { terrain, groundKey } = mapGround(from.map);
      const r = legRequest(setting, mode, plan, options, first && !!request?.active, last && !!request?.continues, {
        from: from.height,
        to: to.height,
      });
      const search = async (asked: LegRequest) => {
        const result = await routeLeg(terrain, from.point, to.point, setting, asked);
        // A no-path search keeps the reach set that `keptReach` needs for a proof.
        if (result.kind === "no-path") unprovenSides.clear();
        return result;
      };
      if (groundKey === undefined) return { result: await search(r) };
      const key = searchKey(from.point, to.point, setting, r, groundKey);
      const reach = noPathKey(from.point, to.point, setting, r, groundKey);
      let result = noPath.get(reach);
      if (!result) {
        result = await share(terrain, from.point, to.point, setting, r, groundKey, search);
        if (result.kind === "no-path") noPath.set(reach, result);
      }
      return { result, key };
    };
  }
}

function mapRuns({ stops, maps, legs }: NativePlan): { from: number; to: number }[] {
  if (maps.length !== stops.length) throw new RangeError("A trip needs one map per stop");
  const runs: { from: number; to: number }[] = [];
  let from = 0;
  for (let i = 0; i <= legs.length; i++) {
    if (i < legs.length && maps[i] === maps[i + 1]) continue;
    if (i > from) runs.push({ from, to: i });
    from = i + 1;
  }
  return runs;
}

const runPlan = (plan: NativePlan, { from, to }: { from: number; to: number }): NativePlan => ({
  ...plan,
  stops: plan.stops.slice(from, to + 1),
  maps: plan.maps.slice(from, to + 1),
  heights: plan.heights.slice(from, to + 1),
  legs: plan.legs.slice(from, to),
});

/**
 * The request with which `routeTrip` searches leg `leg` of `plan` in
 * `mode`, on the terrain that `ground` gives for its map; undefined for a
 * leg between two maps. As in the journey, it can search the legs of its map
 * that have a stop in a building or two near stops. `walks` gives the
 * `rideWalks` of each leg of the trip; without it, the trip takes no rides.
 */
export async function tripLegRequest(
  world: RoutePlan,
  ground: (map: InstanceId) => Terrain,
  mode: MovementMode,
  options: Pick<JourneyOptions, "maxSlope" | "cellBudget">,
  leg: number,
  walks: readonly RideWalks[] = [],
): Promise<TripLeg | undefined> {
  const plan = nativePlan(world, (map) => ground(map).frame);
  const run = mapRuns(plan).find(({ from, to }) => from <= leg && leg < to);
  if (!run) return undefined;
  const terrain = ground(plan.maps[run.from]!);
  const { requests } = await startJourney(terrain, runPlan(plan, run), mode, options, () => {});
  const walk = (k: number) => walks[k];
  let active = false;
  for (let i = Math.max(run.from, 1); i <= leg; i++)
    active = await activeAfter(plan, terrain, options.maxSlope, walk, i, run.from, requests, active);
  const continues = continuesAfter(plan, walk, (k) => requests[k - run.from]!.moves, leg);
  return {
    terrain,
    request: { ...requests[leg - run.from]!.request, active, continues },
    from: plan.stops[leg]!,
    to: plan.stops[leg + 1]!,
  };
}

/** `from` and `to` are the leg's ends resolved on `terrain`. */
export interface TripLeg {
  terrain: Terrain;
  request: LegRequest;
  from: Point;
  to: Point;
}

/**
 * Whether a leg that the trip takes with rides moves on the ground before its
 * first ride and after its last ride. Undefined for any other leg.
 */
export type RideWalks = { before: boolean; after: boolean } | undefined;

export const rideWalks = (leg: JourneyLeg | undefined): RideWalks =>
  leg?.kind === "transport" ? { before: partMoves(leg.parts[0]!), after: partMoves(leg.parts.at(-1)!) } : undefined;

async function activeAfter(
  plan: NativePlan,
  terrain: Terrain,
  maxSlope: number,
  walks: (k: number) => RideWalks,
  i: number,
  from: number,
  requests: readonly { request: LegRequest; moves: boolean }[],
  active: boolean,
): Promise<boolean> {
  const before = walks(i - 1);
  const moved = before ? before.after : i > from && requests[i - 1 - from]!.moves;
  if (!moved) return !before && i > from && active;
  if (i > from) return requests[i - from]!.request.active!;
  const leg = plan.legs[i - 1]!;
  return !leg.followTerrain || !(await inWater(terrain, plan.stops[i]!, maxSlope, leg.hazards));
}

function continuesAfter(plan: NativePlan, walks: (k: number) => RideWalks, moves: (k: number) => boolean, i: number): boolean {
  for (let k = i + 1; k < plan.legs.length && plan.maps[k] === plan.maps[k + 1]; k++) {
    const rides = walks(k);
    if (rides) return rides.before;
    if (moves(k)) return true;
  }
  return false;
}

/**
 * Routes every leg of `plan` in `mode`, charged as one journey:
 *
 * - The mode activates once, on the first leg that moves. A terrain route
 *   of one point does not move: between two stops in one cell, between two
 *   ground stops that snap to one node, or between two stops that it meets
 *   at one door or one target.
 * - Leaving water at the end of a leg remounts only when a later leg moves: a terrain leg to another cell, or a straight leg
 *   to another pixel.
 * - A leg that ends in water leaves the mode inactive, so the next leg pays
 *   activation when it moves on land.
 * - A failed leg still counts as movement, so later legs do not activate again.
 * - A straight leg activates the mode, even when it ends in water.
 */
export async function routeJourney(
  terrain: Terrain,
  world: RoutePlan,
  mode: MovementMode,
  options: JourneyOptions,
): Promise<Journey<LegResult>> {
  const plan = onTerrain(terrain, world);
  const report = reporter(options.onLegs);
  const { search } = await startJourney(terrain, plan, mode, options, report.add);
  report.flush();
  return search();
}

async function startJourney(
  terrain: Terrain,
  plan: NativePlan,
  mode: MovementMode,
  options: JourneyOptions,
  report: (update: LegUpdate) => void,
  share: SharedGround = sharedGround([mode], [mode], options),
): Promise<{ requests: { request: LegRequest; key?: string; moves: boolean }[]; search: () => Promise<Journey<LegResult>> }> {
  const { stops, legs: settings } = plan;
  if (stops.length < 2 || settings.length !== stops.length - 1) throw new RangeError("A journey needs one setting per leg");
  const { maxSlope, groundKey, known } = options;
  const requestOf = (i: number, active: boolean, continues: boolean): { request: LegRequest; key?: string } => {
    const leg = settings[i]!;
    const request = legRequest(leg, mode, plan, options, active, continues, planHeights(plan, i));
    const key = groundKey === undefined ? undefined : searchKey(stops[i]!, stops[i + 1]!, leg, request, groundKey);
    return { request, ...(key !== undefined && { key }) };
  };
  const find = ({ request }: { request: LegRequest }, i: number) => {
    const search = (r: LegRequest) => routeLeg(terrain, stops[i]!, stops[i + 1]!, settings[i]!, r);
    return groundKey === undefined ? search(request) : share(terrain, stops[i]!, stops[i + 1]!, settings[i]!, request, groundKey, search);
  };

  const actives: boolean[] = [];
  const moving: boolean[] = [];
  const early: { request: LegRequest; result: LegResult }[] = [];
  let active = false;
  for (const [i, leg] of settings.entries()) {
    const from = stops[i],
      to = stops[i + 1];
    if (!from || !to) throw new RangeError(`No stops for leg ${i}`);
    actives.push(active);
    moving[i] = !still(plan, i);
    if (!moving[i]) continue;
    if (leg.followTerrain && (!apart(from, to) || (await inBuilding(terrain, from)) || (await inBuilding(terrain, to)))) {
      const entry = requestOf(
        i,
        active,
        continues(plan, i, (k) => moving[k] ?? moves(plan, k)),
      );
      const result = await find(entry, i);
      early[i] = { request: entry.request, result };
      moving[i] = !(result.kind === "route" && result.points.length === 1);
      if (!moving[i]) continue;
    }
    active = !leg.followTerrain || !(await inWater(terrain, to, maxSlope, leg.hazards));
  }

  const requests = settings.map((_, i) => ({
    ...requestOf(
      i,
      actives[i]!,
      continues(plan, i, (k) => moving[k]!),
    ),
    moves: moving[i]!,
  }));
  const legs: LegResult[] = [];
  for (const [i, { request, key }] of requests.entries()) {
    const found = early[i];
    const result =
      found && (!moving[i] || found.request.continues === request.continues)
        ? found.result
        : key !== undefined
          ? known?.get(key)
          : undefined;
    if (!result) continue;
    legs[i] = result;
    report({ mode: mode.name, leg: i, result, ...(key !== undefined && { key }) });
  }
  const search = async () => {
    for (const [i, entry] of requests.entries())
      if (!legs[i])
        report({ mode: mode.name, leg: i, result: (legs[i] = await find(entry, i)), ...(entry.key !== undefined && { key: entry.key }) });
    return { mode, legs, ...(legs.every(timedLeg) && { seconds: legs.reduce((sum, leg) => sum + leg.seconds, 0) }) };
  };
  return { requests, search };
}

function legRequest(
  leg: Leg,
  mode: MovementMode,
  plan: NativePlan,
  { maxSlope, cellBudget }: Pick<JourneyOptions, "maxSlope" | "cellBudget">,
  active: boolean,
  continues: boolean,
  heights: { from?: number | undefined; to?: number | undefined },
): LegRequest {
  const { damagingFalls, fatalFalls, hazards } = leg;
  return {
    maxSlope,
    swimming: plan.settings.swimming,
    mode,
    active,
    continues,
    damagingFalls,
    fatalFalls,
    hazards,
    ...(cellBudget !== undefined && { cellBudget }),
    ...((heights.from !== undefined || heights.to !== undefined) && { heights }),
  };
}

const onTerrain = (terrain: Terrain, plan: RoutePlan) =>
  nativePlan(plan, (map) => (map === terrain.frame.scope.map ? terrain.frame : undefined));

const stopAt = (plan: NativePlan, i: number): MapPoint | undefined => {
  const point = plan.stops[i];
  const height = plan.heights[i];
  return point && { map: plan.maps[i]!, point, ...(height != null && { height }) };
};

const planHeights = (plan: NativePlan, i: number) => ({ from: stopAt(plan, i)?.height, to: stopAt(plan, i + 1)?.height });

const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const changesFloor = (plan: NativePlan, i: number) => plan.legs[i]!.followTerrain && plan.heights[i] !== plan.heights[i + 1];
const still = (plan: NativePlan, i: number) => same(plan.stops[i]!, plan.stops[i + 1]!) && !changesFloor(plan, i);
const partMoves = (part: TransportPart) =>
  part.kind === "ground" && !same(part.from, part.to) && !(part.result.kind === "route" && part.result.points.length === 1);
const cell = (p: Point) => nativeToCell({ tile: [0, 0] }, p).join();
const apart = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) * (TILE_WORLD_UNITS / TILE_PIXELS) > 2 * SNAP;

function moves(plan: NativePlan, k: number): boolean {
  const a = plan.stops[k],
    b = plan.stops[k + 1];
  return !!a && !!b && (plan.legs[k]?.followTerrain ? cell(a) !== cell(b) || changesFloor(plan, k) : !same(a, b));
}

function continues(plan: NativePlan, i: number, moves: (k: number) => boolean): boolean {
  for (let k = i + 1; k < plan.legs.length && plan.maps[k] === plan.maps[k + 1]; k++) if (moves(k)) return true;
  return false;
}

/**
 * Whether a leg moves, as `keptLegs` can tell without a search. `same-in-both`: only a search can tell, and it gives both
 * plans one answer.
 */
type Movement = "still" | "moves" | "same-in-both" | "needs-search";

function meets(leg: JourneyLeg | undefined, side: 0 | 1): LegStop | undefined {
  const route = leg && routeOf(leg);
  return route && (route.stops?.[side] ?? { class: "ground" });
}

/**
 * The legs of `journey`, a journey of `before` that may lack legs not yet
 * found, whose results the same mode gives for `plan` too. A view keeps them
 * while `plan` routes. A kept leg has the same stop pixels on `frames`, maps,
 * heights, and setting, the same plan settings, and the same `active` as in
 * `before`, and, unless it is a route that does not end swimming, the same
 * `continues`. Pixels decide, because the search sees only pixels. A plan
 * with a stop off `frames` keeps no leg.
 */
export function keptLegs(
  beforeWorld: RoutePlan,
  journey: readonly (JourneyLeg | undefined)[],
  world: RoutePlan,
  frames: readonly NativeFrame[],
): JourneyLeg[] {
  const kept: JourneyLeg[] = [];
  const before = resolvedOn(frames, beforeWorld);
  const plan = resolvedOn(frames, world);
  if (!before || !plan) return kept;
  const keeps: boolean[] = [];
  if (JSON.stringify(before.settings) !== JSON.stringify(plan.settings)) return kept;
  const stop = (k: number) =>
    before.maps[k] === plan.maps[k] &&
    before.heights[k] === plan.heights[k] &&
    !!before.stops[k] &&
    !!plan.stops[k] &&
    same(before.stops[k], plan.stops[k]);
  const unchanged = (k: number) => {
    const a = before.legs[k],
      b = plan.legs[k];
    return !!a && !!b && GROUND_SETTINGS.every((name) => a[name] === b[name]) && stop(k) && stop(k + 1);
  };
  const outside = (k: number) =>
    [meets(journey[k - 1], 1), meets(journey[k], 0)].some((s) => !!s && s.class !== "target" && s.class !== "building");
  const movement = (p: NativePlan, k: number): Movement => {
    const from = p.stops[k]!,
      to = p.stops[k + 1]!;
    if (still(p, k)) return "still";
    if (!p.legs[k]!.followTerrain) return "moves";
    const result = p === before || unchanged(k) ? journey[k] : undefined;
    if (result) return result.kind === "route" && result.points.length === 1 ? "still" : "moves";
    const known = (j: number) => (p === before || stop(j)) && outside(j);
    if (apart(from, to) && known(k) && known(k + 1)) return "moves";
    return unchanged(k) ? "same-in-both" : "needs-search";
  };
  const sameRides = (i: number) => RIDE_SETTINGS.every((name) => before.legs[i]![name] === plan.legs[i]![name]);
  const sameActive = (i: number) => {
    for (let k = i - 1; k >= 0; k--) {
      const crossing = (p: NativePlan) => p.maps[k] !== p.maps[k + 1];
      if (crossing(before) || crossing(plan)) return crossing(before) && crossing(plan) && unchanged(k) && sameRides(k);
      const was = movement(before, k);
      if (was === "needs-search" || was !== movement(plan, k)) return false;
      if (was !== "still") return keeps[k]!;
    }
    return true;
  };
  const runEnds = (p: NativePlan, k: number) => k >= p.legs.length || p.maps[k] !== p.maps[k + 1];
  const sameRun = (k: number) => {
    for (; !runEnds(before, k) && !runEnds(plan, k); k++) if (!unchanged(k) || !sameRides(k)) return false;
    return runEnds(before, k) && runEnds(plan, k);
  };
  const sameContinues = (i: number) => {
    for (let k = i + 1; ; k++) {
      const end = (p: NativePlan) => runEnds(p, k);
      if (end(before) || end(plan)) return [before, plan].every((p) => end(p) || !continues(p, k - 1, (j) => movement(p, j) !== "still"));
      if (rideWalks(journey[k]) || movement(before, k) !== "still" || movement(plan, k) !== "still") return sameRun(k);
      if (!sameRides(k)) return false;
    }
  };
  for (const [i, result] of journey.entries()) {
    keeps[i] = unchanged(i) && sameRides(i) && ((!!result && !endsSwimming(result)) || sameContinues(i)) && sameActive(i);
    if (result && keeps[i]) kept[i] = result;
  }
  return kept;
}

function endsSwimming(leg: JourneyLeg): boolean {
  return leg.kind !== "route" || leg.swims.at(-1) === leg.points.length - 2;
}

type SharedGround = (
  terrain: Terrain,
  from: Point,
  to: Point,
  leg: Leg,
  request: LegRequest,
  groundKey: string,
  search: (request: LegRequest) => Promise<LegResult>,
) => Promise<LegResult>;

const slowestMode = (modes: readonly MovementMode[]) =>
  modes.reduce<MovementMode | undefined>(
    (slow, mode) => (!slow || mode.speed < slow.speed || (mode.speed === slow.speed && mode.activation < slow.activation) ? mode : slow),
    undefined,
  );

function sharedGround(
  planModes: readonly MovementMode[],
  routed: readonly MovementMode[],
  { known, found: onFound }: Pick<JourneyOptions, "known" | "found">,
): SharedGround {
  const results = new Map(known);
  const keep = (key: string, result: LegResult) => {
    results.set(key, result);
    onFound?.(key, result);
  };
  const reference = slowestMode(planModes);
  const referenceIsRouted = routed.some((mode) => mode.name === reference?.name);
  const swimStarts = new Map<string, Promise<boolean>>();
  return async (terrain, from, to, leg, request, groundKey, search) => {
    const key = searchKey(from, to, leg, request, groundKey);
    let result = results.get(key);
    if (result) return result;
    result = (await reused()) ?? (await search(request));
    keep(key, result);
    return result;

    async function reused(): Promise<LegResult | undefined> {
      const { mode } = request;
      if (!leg.followTerrain || !reference || mode.name === reference.name || mode.speed < reference.speed) return undefined;
      const base = { ...request, mode: reference };
      const baseKey = searchKey(from, to, leg, base, groundKey);
      let found = results.get(baseKey);
      if (!found) {
        if (!referenceIsRouted) return undefined;
        keep(baseKey, (found = await search(base)));
      }
      if (found.kind === "no-path") return found;
      if (found.kind !== "route" || found.swims.length) return undefined;
      return (await staysFastest(found, reference)) ? retime(found, request) : undefined;
    }

    /**
     * Any other dry route B costs at least `(activations of B - activations of A) * delta / speed` more than `route` A in
     * the faster mode. So A stays fastest when it has one point, when `delta` is 0, or when `delta` is above 0 and A
     * has the fewest activations.
     */
    async function staysFastest(route: TerrainRoute, reference: MovementMode): Promise<boolean> {
      if (route.points.length < 2) return true;
      const { mode } = request;
      const delta = mode.speed * mode.activation - reference.speed * reference.activation;
      if (delta === 0) return true;
      if (delta < 0) return false;
      const fewestActivations = request.active || (route.distance > 0 && !(await startsSwimming()));
      return fewestActivations;
    }

    function startsSwimming(): Promise<boolean> {
      const only = { ...request, mode: undefined, active: undefined, continues: undefined, heights: request.heights?.from };
      const at = JSON.stringify([from, groundKey, leg.downhill, only]);
      let swims = swimStarts.get(at);
      if (!swims) swimStarts.set(at, (swims = swimStart(terrain, from, leg, request)));
      return swims;
    }
  };
}

const timedLeg = (leg: JourneyLeg): leg is Extract<LegResult, { kind: "route" | "straight" }> =>
  leg.kind === "route" || leg.kind === "straight";

async function inBuilding(terrain: Terrain, point: Point): Promise<boolean> {
  const { class: kind } = classifyStop(await terrain.region([point], TILE_PIXELS), point);
  return kind === "target" || kind === "building";
}

async function offTerrain(terrain: Terrain, point: Point): Promise<boolean> {
  const tile = await terrain.region([point], 0);
  const coverage = tile.coverage(nativeToCell(tile, point));
  return coverage !== "present" && coverage !== "missing-coverage";
}

async function inWater(terrain: Terrain, point: Point, maxSlope: number, hazards: boolean): Promise<boolean> {
  const tile = await terrain.region([point], 0);
  const [x, y] = nativeToCell(tile, point);
  if (!(x >= 0 && y >= 0 && x < tile.width && y < tile.height && Number.isFinite(tile.water[y * tile.width + x]))) return false;
  const region = await terrain.region([point], TILE_PIXELS);
  return classifyStop(region, point).class === "ground" && snapNode(region, point, maxSlope, hazards) < 0;
}
