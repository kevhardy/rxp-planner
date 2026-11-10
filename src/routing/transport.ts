import type { RideRequirements, TransportLinkRecord, TransportsFile } from "../../packages/data-contract/transports.ts";
import type { Faction } from "../../packages/data-contract/shared.ts";
import type { ClassName } from "../data/races.ts";
import type { InstanceId } from "../data/index.ts";
import { TILE_PIXELS, TILE_WORLD_UNITS } from "./artifact.ts";
import { frameOf, worldToNative, type NativeFrame, type MapPoint, type Point } from "./frame.ts";
import type { Leg } from "./plan.ts";
import { SNAP, type LegResult } from "./search.ts";

/** The seconds that a route counts for a ride: its `average`, the expected wait and ride. */
export const rideCost = ({ seconds }: Pick<TransportLinkRecord, "seconds">) => seconds.average;

/** A place where a ground leg of a ride can start or end. `height` is set for a stop that has one. */
interface RideStop extends MapPoint {
  height?: number;
  /** A place in a flight: no ground leg starts or ends here. */
  air?: true;
}

/** A stop of a ride, at a native pixel of its map. */
export interface TransportStop extends RideStop {
  id: string;
  name: string;
}

export interface TransportLink extends Omit<TransportLinkRecord, "from" | "to" | "path"> {
  from: TransportStop;
  to: TransportStop;
  /** The points between the stops, at native pixels of the stops' map. */
  path?: Point[];
}

/** Drops each link that has a stop outside `frames`. */
export function placeTransports(file: TransportsFile, frames: readonly NativeFrame[]): TransportLink[] {
  const stops = new Map<string, TransportStop>();
  for (const { id, world, name, height, air } of file.nodes) {
    const map = world.instance;
    const frame = frameOf(frames, map);
    const at = frame && worldToNative(frame, world);
    if (at)
      stops.set(id, { id, name, map, point: at.map(Math.round) as Point, ...(height !== undefined && { height }), ...(air && { air }) });
  }
  return file.links.flatMap(({ from, to, path, ...link }) => {
    const [a, b] = [stops.get(from), stops.get(to)];
    if (!a || !b) return [];
    const frame = frameOf(frames, a.map)!;
    const points = path?.flatMap(([x, y]) => {
      const at = worldToNative(frame, { instance: a.map, x, y });
      return at ? [at.map(Math.round) as Point] : [];
    });
    return [{ ...link, from: a, to: b, ...(points && { path: points }) }];
  });
}

/** The character that rides. `otherFaction` also allows the other faction's rides. */
export interface TransportAccess {
  faction: Faction;
  otherFaction: boolean;
  class: ClassName;
  race: string;
}

const factionOpen = (r: RideRequirements, faction: Faction, otherFaction: boolean) => !r.faction || otherFaction || r.faction === faction;

/**
 * The links that `access` may ride by faction, class, and race. Every flight point counts as learned. Playback keeps
 * the learned ones with `ridesFor`.
 */
export const usableLinks = (links: readonly TransportLink[], access: TransportAccess): TransportLink[] =>
  links.filter(
    ({ requires: r }) =>
      factionOpen(r, access.faction, access.otherFaction) && (!r.class || r.class === access.class) && (!r.race || r.race === access.race),
  );

/** `links` holds the rides of both factions. `legRides` applies each leg's `otherFaction`. */
export interface Rides {
  links: readonly TransportLink[];
  faction?: Faction;
}

/** The rides of a trip for the character of `access`, of both factions. */
export const tripRides = (links: readonly TransportLink[], access: Omit<TransportAccess, "otherFaction">): Rides => ({
  links: usableLinks(links, { ...access, otherFaction: true }),
  faction: access.faction,
});

export const RIDE_SETTINGS = ["otherFaction", "flightPaths", "shipPaths"] as const satisfies readonly (keyof Leg)[];
type LegRideSettings = Pick<Leg, (typeof RIDE_SETTINGS)[number]>;

const MODE_SETTING: Readonly<Partial<Record<string, Exclude<keyof LegRideSettings, "otherFaction">>>> = {
  flight: "flightPaths",
  ship: "shipPaths",
  zeppelin: "shipPaths",
};

export const legRides = ({ links, faction }: Rides, leg: LegRideSettings): readonly TransportLink[] =>
  links.filter(({ requires, mode }) => {
    const setting = Object.hasOwn(MODE_SETTING, mode) ? MODE_SETTING[mode] : undefined;
    return (!faction || factionOpen(requires, faction, leg.otherFaction)) && (!setting || leg[setting]);
  });

/** A part of a leg that takes rides: a ground leg on one map, or a ride. */
export type TransportPart =
  | { kind: "ground"; map: InstanceId; from: Point; to: Point; result: LegResult; key?: string }
  | { kind: "ride"; link: TransportLink };

/** One ride step holds the rides of one ticket, such as a flight through several flight points. */
export type TransportStep = Extract<TransportPart, { kind: "ground" }> | { kind: "ride"; links: TransportLink[] };

/** The steps of `parts`: a ride that ends at an `air` stop is one step with the rides after it. */
export function transportSteps(parts: readonly TransportPart[]): TransportStep[] {
  const steps: TransportStep[] = [];
  for (const part of parts) {
    const last = steps.at(-1);
    if (part.kind === "ride" && last?.kind === "ride" && last.links.at(-1)!.to.air) last.links.push(part.link);
    else steps.push(part.kind === "ride" ? { kind: "ride", links: [part.link] } : part);
  }
  return steps;
}

/** A leg that takes at least one ride. `seconds` costs each ride at its `rideCost`. */
export interface TransportLeg {
  kind: "transport";
  /** Starts and ends with a ground part, with a ride before the last one. */
  parts: TransportPart[];
  seconds: number;
}

/** A ground leg's time, or undefined when it has no route to take: a route, a straight estimate, or a route that skipped tiles without terrain. */
export function groundSeconds(result: LegResult): number | undefined {
  if (result.kind === "route" || result.kind === "straight") return result.seconds;
  return result.kind === "missing-coverage" ? result.route?.seconds : undefined;
}

/**
 * A ground leg: `first` starts at the leg's start, `last` ends at its end.
 * `ride` is the mode of the ride that the ground leg walks to or from.
 */
export type GroundLeg = (
  from: RideStop,
  to: RideStop,
  ends: { first: boolean; last: boolean; ride?: string },
) => Promise<{ result: LegResult; key?: string }>;

/** True only when a proof, such as a kept reach set or an end with no terrain, shows that no ground route joins the end of `side` and any of `stops`. */
export type ClosedSide = (side: "from" | "to", stops: readonly RideStop[]) => Promise<boolean>;

/** Seconds. Infinity: the leg has no route. Undefined: no bound is known. */
export type GroundBound = (from: RideStop, to: RideStop) => Promise<number | undefined>;

const SLACK = 4 * SNAP;
const YARDS_PER_PIXEL = TILE_WORLD_UNITS / TILE_PIXELS;

interface Node extends RideStop {
  arrive: boolean;
  leave: boolean;
}

class Queue<T extends { f: number }> {
  private items: { entry: T; order: number }[] = [];
  private count = 0;
  private less(i: number, j: number) {
    const [a, b] = [this.items[i]!, this.items[j]!];
    return a.entry.f < b.entry.f || (a.entry.f === b.entry.f && a.order < b.order);
  }
  private swap(i: number, j: number) {
    [this.items[i], this.items[j]] = [this.items[j]!, this.items[i]!];
  }
  push(entry: T) {
    let i = this.items.push({ entry, order: this.count++ }) - 1;
    while (i > 0 && this.less(i, (i - 1) >> 1)) {
      this.swap(i, (i - 1) >> 1);
      i = (i - 1) >> 1;
    }
  }
  pop(): T | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (top && last && this.items.length > 0) {
      this.items[0] = last;
      for (let i = 0; ;) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let k = i;
        if (l < this.items.length && this.less(l, k)) k = l;
        if (r < this.items.length && this.less(r, k)) k = r;
        if (k === i) break;
        this.swap(i, k);
        i = k;
      }
    }
    return top?.entry;
  }
}

/**
 * Rides form a small graph above the exact ground search. A new service adds
 * edges and a cost. It never changes `routeLeg` or its A*.
 *
 * The fastest way that takes at least one ride, or undefined when it does not
 * beat `direct`, the seconds of the ground leg. `speed` is the fastest speed
 * of the mode. `closed` is asked again after each failed first or last ground
 * leg, because that search can keep a proof.
 */
export async function routeTransport(
  from: MapPoint,
  to: MapPoint,
  links: readonly TransportLink[],
  speed: number,
  ground: GroundLeg,
  direct = Infinity,
  closed?: ClosedSide,
  groundBound?: GroundBound,
): Promise<TransportLeg | undefined> {
  const nodes: Node[] = [
    { ...from, arrive: false, leave: true },
    { ...to, arrive: true, leave: false },
  ];
  const index = new Map<string, number>();
  const node = (stop: TransportStop, side: "arrive" | "leave") => {
    let i = index.get(stop.id);
    if (i === undefined) {
      const { map, point, height, air } = stop;
      i = nodes.push({ map, point, ...(height !== undefined && { height }), ...(air && { air }), arrive: false, leave: false }) - 1;
      index.set(stop.id, i);
    }
    if (!stop.air) nodes[i]![side] = true;
    return i;
  };
  const rides = links.map((link) => ({ link, from: node(link.from, "arrive"), to: node(link.to, "leave") }));
  const n = nodes.length;
  const ridesFrom = nodes.map(() => [] as typeof rides);
  const ridesTo = nodes.map(() => [] as typeof rides);
  for (const r of rides) {
    ridesFrom[r.from]!.push(r);
    ridesTo[r.to]!.push(r);
  }
  const shut = (side: "from" | "to") => {
    const end = nodes[side === "from" ? 0 : 1]!;
    const stops = nodes.slice(2).filter((s) => s.map === end.map && (side === "from" ? s.arrive : s.leave));
    return closed?.(side, stops) ?? false;
  };
  const straightLineBound = (a: number, b: number) => {
    const [p, q] = [nodes[a]!, nodes[b]!];
    if (a === b || p.map !== q.map || !p.leave || !q.arrive || (a === 0 && b === 1)) return Infinity;
    const yards = Math.hypot(p.point[0] - q.point[0], p.point[1] - q.point[1]) * YARDS_PER_PIXEL;
    return Math.max(0, yards - SLACK) / speed;
  };
  const bounds = new Float64Array(n * n);
  for (let ab = 0; ab < bounds.length; ab++) bounds[ab] = straightLineBound(Math.floor(ab / n), ab % n);
  const refined = new Set<number>();
  const bound = (a: number, b: number) => bounds[a * n + b]!;
  const out = (a: number) => [
    ...nodes.flatMap((_, b) => (Number.isFinite(bound(a, b)) ? [{ to: b, cost: bound(a, b), ride: undefined }] : [])),
    ...ridesFrom[a]!.map((r) => ({ to: r.to, cost: rideCost(r.link), ride: r.link })),
  ];

  const rest = new Array<number>(n).fill(Infinity);
  rest[1] = 0;
  for (const done = new Set<number>(); done.size < n;) {
    let b = -1;
    for (let k = 0; k < n; k++) if (!done.has(k) && (b < 0 || rest[k]! < rest[b]!)) b = k;
    if (!Number.isFinite(rest[b]!)) break;
    done.add(b);
    for (let a = 0; a < n; a++) rest[a] = Math.min(rest[a]!, bound(a, b) + rest[b]!);
    for (const r of ridesTo[b]!) rest[r.from] = Math.min(rest[r.from]!, rideCost(r.link) + rest[b]!);
  }
  if (!(rest[0]! < direct) || (await shut("from")) || (await shut("to"))) return undefined;

  type Step = { from: number; to: number; cost: number; part: TransportPart };
  const best = new Array<number>(n).fill(Infinity);
  const via: (Step | undefined)[] = [];
  best[0] = 0;
  best[1] = direct;
  const searched = new Map<string, ReturnType<GroundLeg>>();
  const queue = new Queue<{ f: number; at: number; from: number; to: number; cost: number; part?: TransportPart }>();
  // Two walks in a row only split one ground route, and rounding can make the split look faster.
  const push = (a: number, afterWalk: boolean) => {
    for (const edge of out(a)) {
      if (afterWalk && !edge.ride) continue;
      const f = best[a]! + edge.cost + rest[edge.to]!;
      if (Number.isFinite(f))
        queue.push({
          f,
          at: best[a]!,
          from: a,
          to: edge.to,
          cost: edge.cost,
          ...(edge.ride && { part: { kind: "ride", link: edge.ride } }),
        });
    }
  };
  push(0, false);
  for (;;) {
    const entry = queue.pop();
    if (!entry || entry.f >= best[1]) break;
    if (entry.at > best[entry.from]!) continue;
    const { from: a, to: b } = entry;
    if (!entry.part) {
      const [p, q] = [nodes[a]!, nodes[b]!];
      const ab = a * n + b;
      if (!refined.has(ab)) {
        bounds[ab] = Math.max(bounds[ab]!, (await groundBound?.(p, q)) ?? 0);
        refined.add(ab);
      }
      const lower = bounds[ab]!;
      if (!Number.isFinite(lower)) continue;
      if (lower > entry.cost) {
        queue.push({ ...entry, f: entry.at + lower + rest[b]!, cost: lower });
        continue;
      }
      const key = `${a}>${b}`;
      if (!searched.has(key)) {
        const ride = (b === 1 ? ridesTo[a]! : ridesFrom[b]!)[0]!.link.mode;
        searched.set(key, ground(p, q, { first: a === 0, last: b === 1, ride }));
      }
      const { result, key: legKey } = await searched.get(key)!;
      const cost = groundSeconds(result);
      if (result.kind === "no-path" && ((a === 0 && (await shut("from"))) || (b === 1 && (await shut("to"))))) return undefined;
      if (cost === undefined) continue;
      const part: TransportPart = {
        kind: "ground",
        map: p.map,
        from: p.point,
        to: q.point,
        result,
        ...(legKey !== undefined && { key: legKey }),
      };
      queue.push({ ...entry, f: entry.at + cost + rest[b]!, cost, part });
      continue;
    }
    if (entry.at + entry.cost >= best[b]!) continue;
    best[b] = entry.at + entry.cost;
    via[b] = { from: a, to: b, cost: entry.cost, part: entry.part };
    if (b !== 1) push(b, entry.part.kind === "ground");
  }
  if (!via[1]) return undefined;
  const parts: TransportPart[] = [];
  for (let b = 1; b !== 0; b = via[b]!.from) parts.unshift(via[b]!.part);
  return { kind: "transport", parts, seconds: best[1] };
}
