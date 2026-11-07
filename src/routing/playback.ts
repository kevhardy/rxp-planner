import type { InstanceId, Spawn, WorldLocation } from "../data/index.ts";
import type { GuideDocument } from "../guide/index.ts";
import {
  flightLeg,
  momentAt,
  priceRoute,
  straightTravel,
  TIMELINE_MODEL,
  type Activity,
  type FlightLeg,
  type Fly,
  type KillWalk,
  type Moment,
  type PriceOptions,
  type Profile,
  type RouteSimulation,
  type SimData,
  type Standing,
  type TimelineGuide,
  type TimelineResult,
  type Travel,
  type TravelLeg,
  type Walk,
} from "../rules/index.ts";
import { frameOf, nativeStop, nativeToWorld, type NativeFrame } from "./frame.ts";
import type { Journey, JourneyLeg, Journeys } from "./journey.ts";
import { createPlan, DEFAULT_LEG, withHeight, type MovementMode, type RoutePlan } from "./plan.ts";
import { rideText, routeOf } from "./result.ts";
import type { LegStop, TerrainRoute } from "./search.ts";
import { STOREY } from "./terrain.ts";
import type { Rides, TransportLink } from "./transport.ts";

/** The host's routing, which the playback calls for each leg. */
export interface WayRouter {
  /** The frames of the loaded maps. A leg with an end off every frame keeps a straight way. */
  frames: readonly NativeFrame[];
  /** The rides of the character, of every mode. Playback picks the ones each leg may take. */
  rides?: Rides;
  /** Routes the plan in mode `mode` only. Rejects with an `AbortError` when `signal` aborts. */
  route(plan: RoutePlan, mode: string, signal: AbortSignal, rides: Rides | undefined): Promise<Journeys>;
}

/** What to play: a simulated route and what its timeline reads. */
export interface PlaybackInput {
  simulation: RouteSimulation;
  /** The documents that `simulation` was built from. */
  guides: readonly GuideDocument[];
  profile: Profile;
  data: SimData;
  npcs: Pick<PriceOptions, "spawns" | "npcName" | "placeName">;
}

export interface PlaybackMoment extends Moment {
  /** Undefined before the route's first place. Its height is absent where the way has none, such as a straight way. */
  place: Standing | undefined;
}

/** One travel or flight activity of a step, for the map to draw as Routes draws a leg. */
export interface WayView {
  /** A plan of one leg and its journey; undefined for a way off the loaded maps. */
  plan: RoutePlan | undefined;
  journey: Journey | undefined;
  from: WorldLocation;
  to: WorldLocation;
  start: number;
  seconds: number;
  /** The activity's travel source, such as `routing` or `straight (pending)`. */
  source: string | undefined;
  /**
   * Why a way's seconds are a straight-line or model estimate, in whole or in part, as a
   * `RoutingProgress.straight` reason or `pending`; `flight-unknown` for a `.fly` that walks
   * because the character knows no flight there; undefined for a way routed from end to end.
   */
  estimate: EstimateReason | undefined;
}

export type EstimateReason = "pending" | "unavailable" | LineReason | StraightReason | "flight-unknown";

type StraightReason = "off-map" | "failed" | "interior-path-missing" | Exclude<JourneyLeg["kind"], "route" | "transport" | "straight">;

type LineReason = "door-line" | "steep-line";

/** How many of the legs that the timeline asks for have a routed way. */
export interface RoutingProgress {
  asked: number;
  routed: number;
  /** Legs that wait to route. */
  pending: number;
  /** Legs that keep a straight way, by reason: `unavailable`, `off-map`, `crossing`, `no-path`, `failed`, ... */
  straight: Readonly<Partial<Record<EstimateReason, number>>>;
}

export interface ChainGuide extends Omit<TimelineGuide, "priced"> {
  /** Undefined past the reach. */
  priced?: NonNullable<TimelineGuide["priced"]> & {
    /**
     * The legs that the guide's activities take. A leg that no activity takes, such as a walk that a Hearthstone
     * choice only compares, counts for the guide of the leg asked before it. A leg of two guides counts in both, so
     * the guides do not add up to `Playback.routing`.
     */
    routing: RoutingProgress;
    /** No leg of the guide waits to route. */
    done: boolean;
  };
}

/** A priced timeline and the character's place at each second. Immutable. */
export interface Playback {
  timeline: TimelineResult;
  /** The legs of the priced guides. */
  routing: RoutingProgress;
  /** Each guide that RXP runs on the route, in route order. Read it instead of `timeline.guides`. */
  chain: readonly ChainGuide[];
  /** Undefined for a timeline of no steps. A reader may call it on every frame. */
  at(t: number): PlaybackMoment | undefined;
  /** The index of the step at second `t`; -1 for no steps. */
  stepAt(t: number): number;
  /** The travel and flight activities of step `step`, in order. */
  ways(step: number): readonly WayView[];
  /** The index of the step of guide `source` at index `step` of its document; -1 when the timeline does not show it. */
  indexOf(source: number, step: number): number;
}

export interface PlaybackRoutingOptions {
  /** Milliseconds between two new playbacks while legs route. 1000 by default; 0 gives only the first and the last. */
  every?: number;
  /** A routing whose routed ways this one keeps when both routers route the same frames with the same rides. */
  from?: PlaybackRouting;
  /** The most routed ways that it keeps, apart from the ways that the latest play needs. 8192 by default. */
  kept?: number;
}

const ABORT = () => new DOMException("The playback was replaced.", "AbortError");
const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/**
 * Builds playbacks for one router. It keeps the ways that it routed across
 * `play` calls, so after an edit only the new legs route. One leg routes at
 * a time. A leg that the new `play` also asks for keeps running; the others
 * abort. `play` again with the same input routes nothing new.
 */
export class PlaybackRouting {
  readonly #router: WayRouter | null;
  readonly #every: number;
  readonly #kept: number;
  readonly #ways = new Map<string, Way>();
  #writes = 0;
  #needed: ReadonlyMap<string, Ask> = new Map();
  readonly #floors = new Map<string, number | undefined>();
  #run = 0;
  #running: { key: string; abort: AbortController; done: Promise<void> } | undefined;

  /** `router` null: every leg keeps a straight way, with the reason `unavailable`. */
  constructor(router: WayRouter | null, options: PlaybackRoutingOptions = {}) {
    this.#router = router;
    this.#every = options.every ?? 1000;
    this.#kept = options.kept ?? KEPT_WAYS;
    const from = options.from;
    if (from && router && from.#router && routingKey(from.#router) === routingKey(router))
      for (const [key, way] of from.#ways) this.#ways.set(key, way);
  }

  /**
   * Prices the first `reach` guides of `input` (Infinity for all) with the
   * ways routed so far and gives that playback to `onPlayback` at once. Then
   * routes the missing legs of those guides, the first at or after `focus()`
   * first, gives a better playback after each `every` ms of routed legs, and
   * the last one when no leg is missing. Resolves with the last playback.
   * Rejects with an `AbortError` when a later `play` or `stop` replaces it.
   * A price gives the event loop a turn about every `SLICE_MS`.
   */
  async play(input: PlaybackInput, reach: number, focus: () => number, onPlayback?: (playback: Playback) => void): Promise<Playback> {
    const run = ++this.#run;
    const asks = new Map<string, Ask>();
    this.#needed = asks;
    const frames = this.#router?.frames ?? [];
    const price = async () => {
      for (;;) {
        const version = this.#writes;
        asks.clear();
        const last: Last = {};
        const timeline = await priceRoute(input.simulation, input.guides, input.profile, input.data, {
          ...input.npcs,
          maxGuides: reach,
          pause: this.#pause(run),
          travel: this.#travel(asks, last),
          fly: this.#fly(asks),
          walk: this.#walk(asks, last),
        });
        if (run !== this.#run) throw ABORT();
        if (version !== this.#writes) continue;
        const priced = makePlayback(timeline, asks, this.#ways, this.#router !== null);
        onPlayback?.(priced.playback);
        return priced;
      }
    };
    let priced = await price();
    if (this.#running && !asks.has(this.#running.key)) this.#running.abort.abort();
    if (!this.#router) return priced.playback;
    let shown = performance.now();
    for (;;) {
      let fresh = false;
      for (let ask = next(asks, this.#ways, priced.starts, focus()); ask; ask = next(asks, this.#ways, priced.starts, focus())) {
        await this.#route(ask, frames, run);
        if (run !== this.#run) throw ABORT();
        fresh = true;
        if (this.#every > 0 && performance.now() - shown >= this.#every) {
          priced = await price();
          shown = performance.now();
          fresh = false;
        }
      }
      if (!fresh) return priced.playback;
      priced = await price();
    }
  }

  /** Stops routing. Keeps the routed ways. */
  stop(): void {
    this.#run++;
    this.#running?.abort.abort();
  }

  #pause(run: number): () => Promise<void> | undefined {
    let since = performance.now();
    return () => {
      if (run !== this.#run) throw ABORT();
      if (performance.now() - since < SLICE_MS) return undefined;
      return (async () => {
        await nextTask();
        if (run !== this.#run) throw ABORT();
        since = performance.now();
      })();
    };
  }

  #travel(asks: Map<string, Ask>, last: Last): Travel {
    return (leg) => {
      const estimate = straightTravel(leg);
      const { key, way } = this.#ground(asks, last, leg);
      const status = statusOf(way, this.#router !== null);
      if (status.seconds !== undefined) return { seconds: status.seconds, source: "routing", way: key };
      const reason = status.estimate;
      return { seconds: estimate.seconds, source: reason === "crossing" ? "crossing" : `${estimate.source} (${reason})`, way: key };
    };
  }

  #fly(asks: Map<string, Ask>): Fly {
    return (leg) => {
      const ask = flightAsk(leg);
      if (!asks.has(ask.key)) asks.set(ask.key, ask);
      const way = this.#ways.get(ask.key);
      if (way?.journey && !way.journey.legs.some(flies)) return undefined;
      const status = statusOf(way, this.#router !== null);
      if (status.seconds !== undefined) return { seconds: status.seconds, source: "routing", way: ask.key };
      return { seconds: flightLeg(leg).seconds, source: `flight (${status.estimate})`, way: ask.key };
    };
  }

  #walk(asks: Map<string, Ask>, last: Last): Walk {
    return (leg) => {
      const { from, to, toward } = leg;
      const stand = () => {
        if (toward.z !== undefined) last.end = { cell: cell(to), height: toward.z };
      };
      if (cell(from) === cell(to)) {
        stand();
        return {};
      }
      const { key, way } = this.#ground(asks, last, leg);
      if (!runsOn(way)) {
        last.end = undefined;
        stand();
      }
      return { ...(way?.seconds !== undefined && { seconds: way.seconds }), way: key };
    };
  }

  #ground(asks: Map<string, Ask>, last: Last, leg: TravelLeg): { key: string; way: Way | undefined } {
    const ask = groundAsk(leg);
    if (!asks.has(ask.key)) asks.set(ask.key, ask);
    const { key, way } = this.#fromLastFloor(asks, last, leg, ask) ?? { key: ask.key, way: this.#ways.get(ask.key) };
    const height = way?.seconds === undefined ? undefined : endOf(way.motion).height;
    last.end = height === undefined ? undefined : { cell: cell(leg.to), height };
    return { key, way };
  }

  #fromLastFloor(asks: Map<string, Ask>, last: Last, leg: TravelLeg, ask: Ask): { key: string; way: Way } | undefined {
    const way = this.#ways.get(ask.key);
    const heights = last.end?.cell === cell(leg.from) && way ? pinOf(way, last.end.height) : undefined;
    if (!heights) return undefined;
    const pinned: Ask = { ...ask, key: `${ask.key} @${heights.from},${heights.to ?? ""}`, heights, plain: ask.key };
    if (!asks.has(pinned.key)) asks.set(pinned.key, pinned);
    const better = this.#ways.get(pinned.key);
    return better?.seconds === undefined ? undefined : { key: pinned.key, way: better };
  }

  async #route(ask: Ask, frames: readonly NativeFrame[], run: number): Promise<void> {
    while (this.#running) {
      const { key, done } = this.#running;
      await done;
      if (run !== this.#run) throw ABORT();
      if (key === ask.key || this.#ways.has(ask.key)) return;
    }
    const plan = planOf(ask, frames);
    if (!plan) {
      this.#keep(ask.key, straightWay(ask, "off-map"));
      return;
    }
    const abort = new AbortController();
    const router = this.#router!;
    const done = this.#floor(ask, frames, abort.signal)
      .then(async (floor) => {
        const asked = floor === undefined ? plan : planOf(ask, frames, floor)!;
        return [asked, await router.route(asked, ask.mode, abort.signal, ridesFor(ask, router.rides))] as const;
      })
      .then(
        ([asked, journeys]) => this.#keep(ask.key, wayOf(ask, asked, journeys.journeys[0], frames)),
        (error: unknown) => {
          if (!isAbort(error)) this.#keep(ask.key, { ...straightWay(ask, "failed"), plan });
        },
      );
    this.#running = { key: ask.key, abort, done };
    await done;
    this.#running = undefined;
  }

  async #floor(ask: Ask, frames: readonly NativeFrame[], signal: AbortSignal): Promise<number | undefined> {
    const { toward } = ask;
    if (toward?.z !== undefined) return toward.z;
    const frame = toward && frameOf(frames, toward.instance);
    if (!frame) return undefined;
    const { point } = nativeStop(frame, withHeight(toward, null));
    const key = `${toward.instance}:${point.join()}`;
    if (!this.#floors.has(key)) {
      const leg = { ...DEFAULT_LEG, flightPaths: false, shipPaths: false };
      const at = (x: number) => withHeight(nativeToWorld(frame, [x, point[1]]), null);
      const plan = createPlan(at(point[0]), at(point[0] + 1), key, leg);
      const journeys = await this.#router!.route(
        { ...plan, settings: { ...plan.settings, modes: playbackModes() } },
        "Run",
        signal,
        undefined,
      );
      const first = journeys.journeys[0]?.legs[0];
      const route = first?.kind === "route" ? first : undefined;
      const start = route?.stops?.[0];
      this.#floors.set(key, start?.class === "hint" && !start.ambiguous ? route?.heights?.[0] : undefined);
    }
    return this.#floors.get(key);
  }

  #keep(key: string, way: Way) {
    this.#writes++;
    this.#ways.set(key, way);
    for (const old of this.#ways.keys()) {
      if (this.#ways.size <= this.#kept) break;
      if (!this.#needed.has(old)) this.#ways.delete(old);
    }
  }
}

const SLICE_MS = 10;

/** One macrotask. A nested `setTimeout(0)` waits at least 4 ms in a browser. */
function nextTask(): Promise<void> {
  const { scheduler } = globalThis as { scheduler?: { yield?: () => Promise<void> } };
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(undefined);
  });
}

const routingKey = (router: WayRouter) => JSON.stringify([router.frames.map((f) => [f.scope, f.frame]), router.rides ?? null]);

const KEPT_WAYS = 8192;

interface Ask {
  key: string;
  kind: "ground" | "flight";
  from: WorldLocation;
  to: WorldLocation;
  mode: "Run" | "Mount";
  learned?: readonly number[];
  heights?: Pin;
  plain?: string;
  toward?: Spawn;
}

interface Last {
  end?: { cell: string; height: number } | undefined;
}

interface Pin {
  from: number;
  to?: number;
}

function pinOf(way: Way, height: number): Pin | undefined {
  const h = Math.round(height);
  if (way.estimate === "no-path") return { from: h, to: h };
  const leg = way.journey?.legs[0];
  const first = leg?.kind === "transport" ? leg.parts[0] : undefined;
  const route = leg?.kind === "route" ? leg : first?.kind === "ground" && first.result.kind === "route" ? first.result : undefined;
  if (!route || (route.stops?.[0].class ?? "ground") !== "ground") return undefined;
  const start = route.heights?.[0];
  if (start === undefined || Math.abs(start - height) < STOREY) return undefined;
  return leg === route && (route.stops?.[1].class ?? "ground") === "ground" ? { from: h, to: h } : { from: h };
}

const placeKey = (at: WorldLocation) => `${at.instance}:${at.x},${at.y}`;

const cell = (at: WorldLocation) => `${at.instance}:${Math.round(at.x / 5)},${Math.round(at.y / 5)}`;

function groundAsk({ from, to, mode, toward }: TravelLeg): Ask {
  const ask: Ask = { key: `ground ${mode} ${placeKey(from)}>${placeKey(to)}`, kind: "ground", from, to, mode };
  if (!toward) return ask;
  const z = toward.z === undefined ? "" : `@${Math.round(toward.z)}`;
  return { ...ask, key: `${ask.key} ~${placeKey(toward)}${z}`, toward };
}

function flightAsk({ from, to, learned: known }: FlightLeg): Ask {
  const learned = [...known].sort((a, b) => a - b);
  return { key: `flight ${placeKey(from)}>${placeKey(to)} ${learned.join("|")}`, kind: "flight", from, to, mode: "Run", learned };
}

const flies = (leg: JourneyLeg) =>
  leg.kind === "transport" && leg.parts.some((part) => part.kind === "ride" && part.link.mode === "flight");

const M = TIMELINE_MODEL;

function playbackModes(): MovementMode[] {
  const run = M.runSpeed.value;
  const mount = M.mount.value;
  return [
    { name: "Run", speed: run, activation: 0 },
    ...(mount ? [{ name: "Mount", speed: run * mount.speed, activation: mount.cast }] : []),
  ];
}

function planOf(ask: Ask, frames: readonly NativeFrame[], floor = ask.heights?.to): RoutePlan | undefined {
  if (!frameOf(frames, ask.from.instance) || !frameOf(frames, ask.to.instance)) return undefined;
  const leg = ask.kind === "flight" ? { ...DEFAULT_LEG, shipPaths: false } : { ...DEFAULT_LEG, flightPaths: false };
  const plan = createPlan(withHeight(ask.from, ask.heights?.from ?? null), withHeight(ask.to, floor ?? null), ask.key, leg);
  return { ...plan, settings: { ...plan.settings, modes: playbackModes() } };
}

/** A flight lands and takes off only at the flight master (`FLIGHT_<taxi node>`) of a node the character learned. */
export function ridesFor(ask: Pick<Ask, "kind" | "learned">, rides: Rides | undefined): Rides | undefined {
  if (!rides || ask.kind === "ground") return rides;
  const known = new Set((ask.learned ?? []).map((node) => `FLIGHT_${node}`));
  const knows = (link: TransportLink, side: "from" | "to") => link[side].air || known.has(link[side].id);
  return { ...rides, links: rides.links.filter((link) => link.mode === "flight" && knows(link, "from") && knows(link, "to")) };
}

type Routed = { seconds: number; estimate?: LineReason };

type Straight = { seconds?: undefined; estimate: StraightReason };

type Way = { plan?: RoutePlan; journey?: Journey; motion: Motion } & (Routed | Straight);

type WayStatus = Routed | Straight | { seconds?: undefined; estimate: "pending" | "unavailable" };

const statusOf = (way: Way | undefined, routable: boolean): WayStatus => way ?? { estimate: routable ? "pending" : "unavailable" };

interface Motion {
  runs: MotionRun[];
  seconds: number;
}

interface MotionRun {
  map: InstanceId;
  x: number[];
  y: number[];
  h: (number | null)[];
  t: number[];
  ride?: string;
}

function straightWay(ask: Ask, reason: StraightReason): Way & Straight {
  return { estimate: reason, motion: straightMotion(ask.from, ask.to) };
}

function straightMotion(from: WorldLocation, to: WorldLocation, start = 0, seconds = 1): Motion {
  const end = start + seconds;
  const runs: MotionRun[] =
    from.instance === to.instance
      ? [{ map: from.instance, x: [from.x, to.x], y: [from.y, to.y], h: [null, null], t: [start, end] }]
      : [
          { map: from.instance, x: [from.x, from.x], y: [from.y, from.y], h: [null, null], t: [start, end] },
          { map: to.instance, x: [to.x], y: [to.y], h: [null], t: [end] },
        ];
  return { runs, seconds: end };
}

function wayOf(ask: Ask, plan: RoutePlan, journey: Journey | undefined, frames: readonly NativeFrame[]): Way {
  const leg = journey?.legs[0];
  const ground = leg?.kind === "transport" ? leg.parts.flatMap((part) => (part.kind === "ground" ? [part.result] : [])) : leg ? [leg] : [];
  if (ground.some((part) => routeOf(part)?.stops?.some((stop) => stop.floor === "door")))
    return (
      (leg && (leg.kind === "route" || leg.kind === "transport") && lineWay(ask, plan, journey, leg, frames)) || {
        ...straightWay(ask, "interior-path-missing"),
        plan,
      }
    );
  const steep = leg?.kind === "route" && leg.stops?.some((stop) => stop.steep) && lineWay(ask, plan, journey!, leg, frames);
  if (steep) return steep;
  const motion = leg && motionOf(leg, ask, frames);
  if ((leg?.kind === "route" || leg?.kind === "transport") && motion) return { plan, journey, seconds: leg.seconds, motion };
  const reason = !leg || leg.kind === "route" || leg.kind === "transport" || leg.kind === "straight" ? "failed" : leg.kind;
  return { ...straightWay(ask, reason), plan, ...(journey && { journey }), ...(motion && { motion }) };
}

/**
 * The longest line in yards between a guide point and its route's stop. Measured on the built-in guides' legs that leave
 * a building: the lines in houses, inns, Anvilmar, and the Abbey are 50 yd or shorter, and those in mines and tunnels
 * are 106 yd or longer and cross walls.
 */
const DOOR_TAIL = 75;

/**
 * The stops where `leg` meets its guide points. Undefined when its doors say nothing of the way: inside a building that
 * the leg leaves and enters, or between two rides.
 */
function lineEnds(ask: Ask, leg: Extract<JourneyLeg, { kind: "route" | "transport" }>): { start?: LegStop; end?: LegStop } | undefined {
  const ground =
    leg.kind === "route"
      ? [{ route: leg, first: true, last: true }]
      : leg.parts.flatMap((part, i) =>
          part.kind === "ground" ? [{ route: routeOf(part.result), first: i === 0, last: i === leg.parts.length - 1 }] : [],
        );
  for (const { route, first, last } of ground) {
    const stops = route?.stops;
    if (!stops) continue;
    if (stops[0].building !== undefined && stops[0].building === stops[1].building) return undefined;
    if ((stops[0].floor === "door" && !first) || (stops[1].floor === "door" && !last)) return undefined;
  }
  const start = ground.find((part) => part.first)?.route?.stops?.[0];
  const end = ground.find((part) => part.last)?.route?.stops?.[1];
  if (ask.from.instance === ask.to.instance && start?.building !== undefined && start.building === end?.building) return undefined;
  return { ...(start && { start }), ...(end && { end }) };
}

const drawsLine = (stop: LegStop | undefined) => stop?.floor === "door" || !!stop?.steep;

function lineWay(
  ask: Ask,
  plan: RoutePlan,
  journey: Journey,
  leg: Extract<JourneyLeg, { kind: "route" | "transport" }>,
  frames: readonly NativeFrame[],
): Way | undefined {
  const ends = lineEnds(ask, leg);
  if (!ends) return undefined;
  const { start, end } = ends;
  const motion = motionOf(leg, ask, frames);
  if (!motion) return undefined;
  const first = motion.runs[0]!;
  const last = motion.runs.at(-1)!;
  const endIndex = last.x.length - 1;
  const head = drawsLine(start) ? Math.hypot(first.x[0]! - ask.from.x, first.y[0]! - ask.from.y) : 0;
  const tail = drawsLine(end) ? Math.hypot(ask.to.x - last.x[endIndex]!, ask.to.y - last.y[endIndex]!) : 0;
  if (Math.max(head, tail) > DOOR_TAIL) return undefined;
  const before = head / journey.mode.speed;
  const seconds = before + leg.seconds + tail / journey.mode.speed;
  const [h0, h1] = [first.h[0]!, last.h[endIndex]!];
  for (const run of motion.runs) run.t = run.t.map((t) => t + before);
  if (head > 0) {
    first.x.unshift(ask.from.x);
    first.y.unshift(ask.from.y);
    first.h.unshift(h0);
    first.t.unshift(0);
  }
  if (tail > 0) {
    last.x.push(ask.to.x);
    last.y.push(ask.to.y);
    last.h.push(h1);
    last.t.push(seconds);
  }
  const estimate = start?.floor === "door" || end?.floor === "door" ? "door-line" : "steep-line";
  return { plan, journey, seconds, estimate, motion: { runs: motion.runs, seconds } };
}

function motionOf(leg: JourneyLeg, ask: Ask, frames: readonly NativeFrame[]): Motion | undefined {
  const route = routeOf(leg);
  if (route) return routeMotion(route, ask.from.instance, frames, 0);
  if (leg.kind !== "transport") return undefined;
  const runs: MotionRun[] = [];
  let at = 0;
  for (const part of leg.parts) {
    if (part.kind === "ground") {
      const ground = routeOf(part.result);
      const motion = ground && routeMotion(ground, part.map, frames, at);
      if (motion) {
        runs.push(...motion.runs);
        at = motion.seconds;
      }
      continue;
    }
    const { link } = part;
    const frame = frameOf(frames, link.from.map);
    if (!frame) continue;
    const native = [link.from.point, ...(link.path ?? []), ...(link.to.map === link.from.map ? [link.to.point] : [])];
    const world = native.map((p) => nativeToWorld(frame, p));
    const wait = link.seconds.average - link.seconds.min;
    const moving = timesAlong(world, at + wait, link.seconds.min);
    runs.push({
      map: link.from.map,
      x: [world[0]!.x, ...world.map((p) => p.x)],
      y: [world[0]!.y, ...world.map((p) => p.y)],
      h: [link.from.height ?? null, ...world.map(() => null)],
      t: [at, ...moving],
      ride: rideText(link),
    });
    at += link.seconds.average;
  }
  return runs.length ? { runs, seconds: at } : undefined;
}

function routeMotion(route: TerrainRoute, map: InstanceId, frames: readonly NativeFrame[], start: number): Motion | undefined {
  const frame = frameOf(frames, map);
  if (!frame || !route.points.length) return undefined;
  const world = route.points.map((p) => nativeToWorld(frame, p));
  const t = timesAlong(world, start + route.activation, route.seconds - route.activation);
  const h = route.points.map((_, i) => route.heights?.[i] ?? null);
  return { runs: [{ map, x: world.map((p) => p.x), y: world.map((p) => p.y), h, t }], seconds: start + route.seconds };
}

function timesAlong(points: readonly WorldLocation[], start: number, seconds: number): number[] {
  const along = [0];
  for (let i = 1; i < points.length; i++)
    along.push(along[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  const length = along.at(-1)!;
  return along.map((d) => start + (length > 0 ? (d / length) * seconds : 0));
}

function placeOn(motion: Motion, seconds: number): { place: Standing; ride?: string } {
  let run = motion.runs[0]!;
  for (const r of motion.runs) if (r.t[0]! <= seconds) run = r;
  const { t, x, y, h } = run;
  let lo = 0;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid]! <= seconds) lo = mid;
    else hi = mid - 1;
  }
  const next = Math.min(lo + 1, t.length - 1);
  const span = t[next]! - t[lo]!;
  const f = span > 0 ? Math.min(1, Math.max(0, (seconds - t[lo]!) / span)) : 0;
  const [ha, hb] = [h[lo]!, h[next]!];
  const height = ha !== null && hb !== null ? ha + (hb - ha) * f : f < 0.5 ? ha : hb;
  const place = { instance: run.map, x: x[lo]! + (x[next]! - x[lo]!) * f, y: y[lo]! + (y[next]! - y[lo]!) * f };
  return { place: height === null ? place : { ...place, height }, ...(run.ride && { ride: run.ride }) };
}

const endOf = (motion: Motion) => placeOn(motion, motion.seconds).place;

const runsOn = (way: Way | undefined): way is Way => way?.seconds !== undefined && way.motion.runs.length === 1;

function walkMotion(walk: KillWalk, ways: ReadonlyMap<string, Way>, height: number | null): Motion {
  const run: MotionRun = { map: walk.from.instance, x: [walk.from.x], y: [walk.from.y], h: [height], t: [0] };
  const add = (x: number, y: number, h: number | null, t: number) => {
    run.x.push(x);
    run.y.push(y);
    run.h.push(h);
    run.t.push(t);
  };
  let left = 0;
  for (const kill of walk.kills) {
    const way = kill.way === undefined ? undefined : ways.get(kill.way);
    const routed = runsOn(way) ? way.motion : undefined;
    if (routed) {
      const r = routed.runs[0]!;
      const scale = routed.seconds > 0 ? (kill.arrive - left) / routed.seconds : 0;
      for (const [i, t] of r.t.entries()) add(r.x[i]!, r.y[i]!, r.h[i]!, left + t * scale);
    }
    const h = routed ? run.h.at(-1)! : (kill.at.height ?? run.h.at(-1)!);
    add(kill.at.x, kill.at.y, h, kill.arrive);
    add(kill.at.x, kill.at.y, h, kill.end);
    left = kill.end;
  }
  return { runs: [run], seconds: left };
}

function next(
  asks: ReadonlyMap<string, Ask>,
  ways: ReadonlyMap<string, Way>,
  starts: ReadonlyMap<string, number>,
  focus: number,
): Ask | undefined {
  let best: Ask | undefined;
  let bestStart = Infinity;
  let first: Ask | undefined;
  let firstStart = Infinity;
  let untimed: Ask | undefined;
  for (const [key, ask] of asks) {
    if (ways.has(key)) continue;
    const start = starts.get(key) ?? (ask.plain === undefined ? undefined : starts.get(ask.plain));
    if (start === undefined) untimed ??= ask;
    else if (start >= focus && start < bestStart) [best, bestStart] = [ask, start];
    else if (start < firstStart) [first, firstStart] = [ask, start];
  }
  return best ?? first ?? untimed;
}

function makePlayback(
  timeline: TimelineResult,
  asks: Map<string, Ask>,
  ways: ReadonlyMap<string, Way>,
  routable: boolean,
): { playback: Playback; starts: ReadonlyMap<string, number> } {
  const { steps } = timeline;
  const starts = new Map<string, number>();
  const motions = new Map<Activity, { way: Way | undefined; motion: Motion }>();
  const places = new Map<Activity, Standing | undefined>();
  const ends: (Standing | undefined)[] = [];
  const index = new Map<string, number>();
  const legsByGuide = new Map<number, Set<string>>();
  const firstGuide = new Map<string, number>();
  const add = (source: number, leg: string) => {
    const set = legsByGuide.get(source);
    if (set) set.add(leg);
    else legsByGuide.set(source, new Set([leg]));
  };
  const takes = (source: number, key: string | undefined) => {
    const ask = key === undefined ? undefined : asks.get(key);
    if (!ask) return;
    const leg = ask.plain ?? ask.key;
    if (!firstGuide.has(leg)) firstGuide.set(leg, source);
    add(source, leg);
  };
  let at: Standing | undefined;
  for (const [i, step] of steps.entries()) {
    index.set(`${step.source} ${step.step}`, i);
    if (step.arrive) at = step.arrive;
    for (const activity of step.activities) {
      if (activity.kind === "travel" || activity.kind === "flight") {
        const key = activity.way;
        takes(step.source, key);
        const way = key === undefined ? undefined : ways.get(key);
        const motion = way?.motion ?? straightMotion(activity.from, activity.to);
        if (key !== undefined && !starts.has(key) && activity.seconds > 0) starts.set(key, activity.start);
        motions.set(activity, { way, motion });
        places.set(activity, at ?? activity.from);
        at = way ? endOf(motion) : activity.to;
      } else if ((activity.kind === "kill" || activity.kind === "grind") && activity.walk) {
        let left = 0;
        for (const kill of activity.walk.kills) {
          takes(step.source, kill.way);
          if (kill.way !== undefined && !starts.has(kill.way) && kill.arrive > left) starts.set(kill.way, activity.start + left);
          left = kill.end;
        }
        const motion = walkMotion(activity.walk, ways, at?.height ?? null);
        motions.set(activity, { way: undefined, motion });
        at = endOf(motion);
      } else {
        places.set(activity, at);
        if ((activity.kind === "hearth" || activity.kind === "deathskip") && activity.to) at = activity.to;
      }
    }
    ends.push(at);
  }

  const again = new Map<string, WayStatus>();
  for (const ask of asks.values()) {
    if (ask.plain === undefined || again.get(ask.plain)?.seconds !== undefined) continue;
    const status = statusOf(ways.get(ask.key), routable);
    if (status.seconds !== undefined || status.estimate === "pending") again.set(ask.plain, status);
  }
  const tally = (keys: Iterable<string>): RoutingProgress => {
    const progress = { asked: 0, routed: 0, pending: 0, straight: {} as Partial<Record<EstimateReason, number>> };
    for (const key of keys) {
      progress.asked++;
      const status = again.get(key) ?? statusOf(ways.get(key), routable);
      if (status.seconds !== undefined) progress.routed++;
      else if (status.estimate === "pending") progress.pending++;
      else progress.straight[status.estimate] = (progress.straight[status.estimate] ?? 0) + 1;
    }
    return progress;
  };
  const asked = [...asks.values()].flatMap((ask) => (ask.plain === undefined ? [ask.key] : []));
  let guide = timeline.guides.find((g) => g.priced)?.source;
  for (const key of asked) {
    const first = firstGuide.get(key);
    if (first !== undefined) guide = first;
    else if (guide !== undefined) add(guide, key);
  }
  const chain = timeline.guides.map(({ priced, ...g }): ChainGuide => {
    if (!priced) return g;
    const routing = tally(legsByGuide.get(g.source) ?? []);
    return { ...g, priced: { ...priced, routing, done: routing.pending === 0 } };
  });

  const stepAt = (t: number) => {
    if (!steps.length) return -1;
    let lo = 0;
    let hi = steps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (steps[mid]!.start <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const playback: Playback = {
    timeline,
    routing: tally(asked),
    chain,
    stepAt,
    at(t) {
      const moment = momentAt(timeline, t);
      if (!moment) return undefined;
      const { activity } = moment;
      const moving = activity && motions.get(activity);
      if (!activity || !moving) return { ...moment, place: activity ? places.get(activity) : ends[moment.step] };
      const scale = activity.seconds > 0 ? moving.motion.seconds / activity.seconds : 0;
      const { place, ride } = placeOn(moving.motion, (t - activity.start) * scale);
      return { ...moment, place, ...(ride && { doing: ride }) };
    },
    ways(i) {
      return (steps[i]?.activities ?? []).flatMap((a) => {
        if (a.kind !== "travel" && a.kind !== "flight") return [];
        const way = motions.get(a)?.way;
        const view: WayView = {
          plan: way?.plan,
          journey: way?.journey,
          from: a.from,
          to: a.to,
          start: a.start,
          seconds: a.seconds,
          source: a.source,
          estimate: a.kind === "travel" && a.target.kind === "flight" ? "flight-unknown" : statusOf(way, routable).estimate,
        };
        return a.seconds > 0 ? [view] : [];
      });
    },
    indexOf: (source, step) => index.get(`${source} ${step}`) ?? -1,
  };
  return { playback, starts };
}
