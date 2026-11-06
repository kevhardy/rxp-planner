import type { Point } from "./frame.ts";
import { CELLS, TILE_PIXELS, TILE_WORLD_UNITS, type Tile } from "./artifact.ts";
import type { CoarseLayer } from "./coarse.ts";
import { SIDES, SWIM, type FloorPoint } from "./floor.ts";
import { Heap } from "./heap.ts";
import {
  attachCell,
  classifyStop,
  doorsPath,
  pairPath,
  pathLength,
  pathLine,
  regionBuildings,
  sameBuilding,
  stopDoors,
  type PlacedBuilding,
  type Stop,
  type StopClass,
} from "./indoor.ts";
import { keepNewest } from "./kept.ts";
import { encodeNodeKey } from "./node-key.ts";
import type { Leg, MovementMode, PlanSettings } from "./plan.ts";
import { smoothRoute, type SmoothGrid } from "./smooth.ts";
import {
  CELL_PIXELS,
  HEAD_BUILDING,
  HEAD_LAYERS,
  HEAD_SWIM,
  HOLE,
  NODE_BURIED,
  NODE_DESCENT,
  NODE_FALL,
  NODE_HAZARD,
  NODE_SWIM,
  NODE_WATER,
  cellToNative,
  floorNode,
  groundHeight,
  groundIssue,
  nativeToCell,
  type CellPoint,
  type RegionFloor,
  type Terrain,
  type TerrainRegion,
  type TileBounds,
} from "./terrain.ts";

const CELL_BUDGET = 10_000_000;
/** A fall of this height or more, in yards, deals damage. */
export const DAMAGE_FALL = 13.48;
/** A fall of this height or more, in yards, is fatal. */
export const FATAL_FALL = 69.03;
/** A ground stop in a floor cell snaps to a node of a cell whose centre is within this many yards (2D). */
export const SNAP = 5;
const STEEP_RISE = 3;
const MARGIN = TILE_PIXELS;
const FLOOD_MARGIN = 2 * TILE_PIXELS;

/** The cells that a search expanded, by tile key `"x,y"`: 128 × 128 cells, row by row, 1 for each expanded cell. */
export type ExpandedCells = Map<string, Uint8Array>;

export interface LegRequest extends Pick<PlanSettings, "swimming"> {
  /** Steepest walkable slope, in degrees. */
  maxSlope: number;
  mode: MovementMode;
  /** The mode is already active at the start, so no activation is charged. */
  active?: boolean;
  /** The journey goes on past the leg's end, so leaving water there remounts. */
  continues?: boolean;
  /** The most nodes to load; `CELL_BUDGET` by default. */
  cellBudget?: number;
  /**
   * With the leg's downhill shortcuts, falls of `DAMAGE_FALL` or more are
   * allowed: runs of floor drops and descent steps. True by default.
   * Without downhill shortcuts, no fall is.
   */
  damagingFalls?: boolean;
  /** With damaging falls, falls of `FATAL_FALL` or more are allowed. False by default. */
  fatalFalls?: boolean;
  /** The height of a ground or hint stop that has one. The stop uses the node nearest that height. */
  heights?: { from?: number | undefined; to?: number | undefined };
  /**
   * "Allow lava and slime": the route can use the floor layers and swim nodes
   * in magma or slime. False by default. Terrain magma and slime stay blocked.
   */
  hazards?: boolean;
}

/**
 * How a route meets one of its stops. `floor`, for a target or a building
 * stop: the floor where the route meets it, with the index of the ground
 * floor of its building, or `door` when the route stops at a door. For a
 * target of kind 1, it is the floor that the stored path reaches, and it is
 * not `confirmed`. `building` is the WMO placement of the building.
 * `steep`, for a ground stop on steep terrain: the route meets it at the
 * snap node, not in its cell. `ambiguous`, for a hint stop: hints a storey
 * apart match it.
 */
export interface LegStop {
  class: StopClass;
  floor?: { index: number; ground: number; confirmed: boolean } | "door";
  building?: number;
  steep?: true;
  ambiguous?: true;
}

/** A stored building path that the route uses: route points `start` to `end`. */
export interface IndoorPath {
  /** `door`: door to target. `pair`: target to target. `doors`: door to door. */
  kind: "door" | "pair" | "doors";
  start: number;
  end: number;
}

/**
 * A path over terrain. Its points are native pixels: the cell centres of
 * its nodes, with the points of each stored building path between them.
 */
export interface TerrainRoute {
  kind: "route";
  points: Point[];
  /**
   * The height of each point in world yards, parallel to `points`: the
   * node's floor layer or surface, or a stored building path point's z. It
   * places a point on its floor between the stops too, such as on stairs.
   */
  heights?: number[];
  /** The start and the end stop, when either is not a ground stop or is steep. */
  stops?: [LegStop, LegStop];
  /** The stored building paths of the route, in route order; absent when it uses none. */
  paths?: IndoorPath[];
  /** Segment indices that need the downhill exception to the slope limit. */
  descents: number[];
  descentDrop: number;
  /**
   * Falls: each run of floor drops and descent steps.
   * The route falls `height` yards from point `point`. A drop in one cell
   * repeats its point.
   */
  falls: { point: number; height: number }[];
  /** Surface-water and shore segment indices, separate from land distance. */
  swims: number[];
  swimDistance: number;
  swimSeconds: number;
  /** Activations after leaving water, before point `point`. */
  swimRemounts: { point: number; seconds: number }[];
  /** Terrain surface distance on land, in world units; excludes swimming. */
  distance: number;
  /** Land `distance` at the mode speed; excludes swimming and activation. */
  terrainSeconds: number;
  /** The mode's activation at the start; 0 when the route opens in water or the mode is active. */
  activation: number;
  /** Land, swimming, remounts, and the initial activation. */
  seconds: number;
}

/**
 * A leg that does not follow terrain: horizontal distance at the mode speed.
 * It makes no claim that the ground between the stops is passable.
 */
interface StraightEstimate {
  kind: "straight";
  points: [Point, Point];
  /** Horizontal world units. */
  distance: number;
  activation: number;
  seconds: number;
}

export type LegResult =
  | TerrainRoute
  | StraightEstimate
  /** No route on loaded terrain; `endpoint` names a stop that is blocked, steep, or in water without swimming. */
  | { kind: "no-path"; endpoint?: "start" | "end" }
  /**
   * The search reached tiles without coverage where a route cheaper than the
   * best one could pass; one cell of each tile. `route`, when present, is the
   * best route without those tiles: provisional, and possibly not the cheapest.
   */
  | { kind: "missing-coverage"; tiles: { tile: Tile; at: Point }[]; route?: TerrainRoute }
  /** A stop is on a tile without terrain, or outside the frame. */
  | { kind: "no-terrain"; endpoint: "start" | "end" }
  /**
   * The search needed a region of `cells` nodes, more than the budget. `route`, when
   * present, is the best route in the last region: provisional, and possibly
   * not the cheapest.
   */
  | { kind: "limit"; cells: number; route?: TerrainRoute };

const WEST = 1,
  EAST = 2,
  NORTH = 4,
  SOUTH = 8;

/**
 * Routes one leg from `from` to `to`, in native pixels. A leg that follows
 * terrain uses the eight-neighbour search of the data producer's routing
 * prototype, so the same cells and settings give the same route. Diagonals
 * cannot pass between blocked cells. Throws for invalid settings.
 *
 * In floor cells, the search uses floor nodes: walk links, drop links that
 * the leg's fall settings allow, and swim nodes. A ground stop in a floor
 * cell starts or ends on the node nearest it within `SNAP` yd, using the
 * requested height or `groundHeight`; without one, on any usable node of
 * its cell. A ground stop on steep terrain does the same, within
 * `STEEP_RISE` yd of its height. A stop at a building
 * target, in a building, or at a hint follows `classifyStop` in indoor.ts.
 *
 * Unless `active`, the mode's activation is charged once, on the first step
 * or stored path from the start, unless that step is into water. A remount always follows
 * leaving water, unless the leg ends there and does not `continue`.
 *
 * The search enlarges its region while a cheaper route could leave it, up to
 * the node budget. A route that is not known to be the cheapest is only a
 * provisional `route` of a `missing-coverage` or `limit` result.
 * `expanded`, when given, gets the cells whose nodes the search of each
 * region expanded, and the cells under each stored path that it followed.
 */
export async function routeLeg(
  terrain: Terrain,
  from: Point,
  to: Point,
  leg: Pick<Leg, "followTerrain" | "downhill">,
  request: LegRequest,
  expanded?: ExpandedCells,
): Promise<LegResult> {
  const { maxSlope, mode, swimming } = request;
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  if (
    !(maxSlope >= 0 && maxSlope < 90) ||
    !positive(mode.speed) ||
    !(Number.isFinite(mode.activation) && mode.activation >= 0) ||
    !positive(swimming.speed)
  )
    throw new RangeError("Invalid slope or movement settings");
  if (!leg.followTerrain) {
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1]) * (TILE_WORLD_UNITS / TILE_PIXELS);
    const activation = distance > 0 && !request.active ? mode.activation : 0;
    return { kind: "straight", points: [from, to], distance, activation, seconds: distance / mode.speed + activation };
  }
  const budget = request.cellBudget ?? CELL_BUDGET;
  let points: Point[] = [from, to],
    margin = MARGIN,
    grow = MARGIN;
  let last: Pick<Search, "route"> = {};
  const reach = reachMemo(terrain, request, leg.downhill);
  const coarse = await terrain.coarse?.();
  expanded?.clear();
  for (;;) {
    const bounds = terrain.bounds(points, margin);
    const cells = bounds.cols * bounds.rows * CELLS * CELLS;
    if (cells > budget) return { kind: "limit", cells, ...(last.route && { route: last.route }) };
    const region = await withHomes(terrain, await terrain.region(points, margin));
    const nodes = nodeCount(region);
    if (nodes > budget) return { kind: "limit", cells: nodes, ...(last.route && { route: last.route }) };
    const marks = expanded && new Uint8Array(region.width * region.height);
    const search = searchRegion(region, from, to, leg.downhill, { kind: "route", request, marks, reach, coarse });
    if (expanded && marks) tileMarks(region, marks, expanded);
    const { result, sides } = search;
    if (!sides) return result;
    last = search;
    const x0 = bounds.tile[0] * TILE_PIXELS,
      y0 = bounds.tile[1] * TILE_PIXELS;
    const x1 = x0 + bounds.cols * TILE_PIXELS - 1,
      y1 = y0 + bounds.rows * TILE_PIXELS - 1;
    const next: Point[] = [
      [sides & WEST ? x0 - grow : x0, sides & NORTH ? y0 - grow : y0],
      [sides & EAST ? x1 + grow : x1, sides & SOUTH ? y1 + grow : y1],
    ];
    if (sameBounds(terrain.bounds(next, 0), bounds)) return result;
    points = next;
    margin = 0;
    grow *= 2;
  }
}

const REACH = new WeakMap<Terrain, Map<string, Float64Array>>();
const REACH_NODES = 4_000_000;
const REACH_SETS = 4096;
// A building door can use a node that is unusable as a ground stop, so an unusable stop keys its proof by its point.
const unusableStopKey = (side: "from" | "to", point: Point, height: number | undefined) => `${side}@${JSON.stringify([point, height])}`;

interface Reach {
  get(key: string): Float64Array | undefined;
  set(key: string, nodes: Float64Array): void;
}

/** The settings of a request that decide whether a route exists. The mode and the swim speed change only the time. */
export type ReachRequest = Pick<LegRequest, "maxSlope" | "damagingFalls" | "fatalFalls" | "hazards"> & {
  swimming: Pick<LegRequest["swimming"], "enabled">;
};

const reachSettings = (
  { maxSlope, swimming, damagingFalls = true, fatalFalls = false, hazards = false }: ReachRequest,
  downhill: boolean,
) => [maxSlope, swimming.enabled, downhill, damagingFalls, fatalFalls, hazards];

function reachMemo(terrain: Terrain, request: ReachRequest, downhill: boolean): Reach {
  let sets = REACH.get(terrain);
  if (!sets) REACH.set(terrain, (sets = new Map<string, Float64Array>()));
  const prefix = `${JSON.stringify(reachSettings(request, downhill))} `;
  const all = sets;
  return {
    get: (key) => all.get(prefix + key),
    set(key, nodes) {
      if (nodes.length > REACH_NODES) return;
      keepNewest(all, prefix + key, nodes, REACH_SETS);
      let total = 0;
      for (const set of all.values()) total += set.length;
      for (const [old, set] of all) {
        if (total <= REACH_NODES) break;
        all.delete(old);
        total -= set.length;
      }
    },
  };
}

/**
 * The test that a reach set kept for `terrain` gives for the stop at `at`
 * (`side` "from": as the start of a leg; "to": as its end) with `leg` and
 * `request`; undefined when no set is kept for it. `request.heights` gives
 * the height of the stop at `at`. The test takes another stop and its
 * height. It gives false when the set proves that a leg between the two
 * stops has no route, as `routeLeg` would find; else true, also for a stop
 * that reach sets do not serve. Neither the mode nor `active` nor
 * `continues` changes the answer.
 */
export async function keptReach(
  terrain: Terrain,
  at: Point,
  side: "from" | "to",
  leg: Pick<Leg, "downhill">,
  request: LegRequest,
): Promise<((other: Point, height?: number) => Promise<boolean>) | undefined> {
  const nodes = (point: Point, height: number | undefined) => stopKeys(terrain, point, height, leg, request);
  const height = side === "from" ? request.heights?.from : request.heights?.to;
  const own = await nodes(at, height);
  const keys = side === "from" ? own?.from : own?.to;
  const memo = reachMemo(terrain, request, leg.downhill);
  const set = keys && (memo.get(unusableStopKey(side, at, height)) ?? memo.get(`${side === "from" ? "f" : "b"}${keys.join(",")}`));
  if (!set) return undefined;
  return async (other, height) => {
    const theirs = await nodes(other, height);
    const ends = side === "from" ? theirs?.to : theirs?.from;
    return !ends || (!!own?.target && own.target === theirs?.target) || ends.some((key) => holds(set, key));
  };
}

const STOP_REGION_MARGIN = 2 * TILE_PIXELS;
const stopRegion = (terrain: Terrain, at: Point) => terrain.region([at], STOP_REGION_MARGIN);

/**
 * Whether a route of `leg` and `request` from `from` can make its first move
 * by swimming. Such a route pays no activation at the start. The answer does
 * not depend on the mode, `active`, or `continues`. True also when the search
 * cannot tell, such as when an edge from the start goes to a cell that is not
 * loaded.
 */
export async function swimStart(terrain: Terrain, from: Point, leg: Pick<Leg, "downhill">, request: LegRequest): Promise<boolean> {
  const height = request.heights?.from;
  const region = await stopRegion(terrain, from);
  const search = searchRegion(region, from, from, leg.downhill, {
    kind: "swim",
    request: { ...request, heights: { from: height, to: height } },
  });
  return search.swimStart ?? true;
}

/**
 * `route`, a route without swims that `routeLeg` found, timed in the mode of
 * `request`. Such a route costs its land distance at the mode speed, and the
 * activation once when it moves and the mode is not `active`. A route moves
 * when it has more than one point. The points and the distances stay the same.
 */
export function retime(route: TerrainRoute, request: LegRequest): TerrainRoute {
  if (route.swims.length) throw new RangeError("Only a route without swims can be timed in another mode");
  const { speed, activation } = request.mode;
  const terrainSeconds = route.distance / speed;
  const charged = !request.active && route.points.length > 1 ? activation : 0;
  return { ...route, terrainSeconds, activation: charged, seconds: terrainSeconds + charged };
}

const STOP_KEYS = new WeakMap<Terrain, Map<string, Promise<Search["stops"]>>>();
const KEPT_STOPS = 4096;

/**
 * The node keys of the stop at `point` with `height` (searchRegion
 * `stops`): where a route leaves it, where a route comes to it, and the
 * building of a target stop. Undefined for a stop without terrain, and
 * when a tile of the stop's region failed to load, because a failed tile can
 * change the node that the stop snaps to. The keys depend on the
 * settings that decide whether a route exists, not on the other stop, so
 * they are kept.
 */
export function stopKeys(
  terrain: Terrain,
  point: Point,
  height: number | undefined,
  leg: Pick<Leg, "downhill">,
  request: ReachRequest,
): Promise<Search["stops"]> {
  const kept = keptStops(terrain);
  const key = stopKey(point, height, leg, request);
  let keys = kept.get(key);
  if (!keys) {
    keys = stopRegion(terrain, point).then(
      (region) => {
        if (!region.failed.length)
          return searchRegion(region, point, point, leg.downhill, {
            kind: "stops",
            request: { ...request, heights: { from: height, to: height } },
          }).stops;
        kept.delete(key);
        return undefined;
      },
      (error: unknown) => {
        kept.delete(key);
        throw error;
      },
    );
    keepNewest(kept, key, keys, KEPT_STOPS);
  }
  return keys;
}

/**
 * Keeps `keys` as the stop keys of the stop at `point` with `height`, with
 * `leg` and `request`, so `stopKeys` gives them without reading the stop's
 * region. The keys must be those that `stopKeys` finds (stop-table.ts).
 */
export function keepStopKeys(
  terrain: Terrain,
  point: Point,
  height: number | undefined,
  leg: Pick<Leg, "downhill">,
  request: ReachRequest,
  keys: StopKeys,
): void {
  keepNewest(keptStops(terrain), stopKey(point, height, leg, request), Promise.resolve(keys), KEPT_STOPS);
}

export type StopKeys = NonNullable<Search["stops"]>;

/**
 * A lower bound in seconds on a ground leg from `from` to `to`, from the
 * coarse layer of `terrain`: Infinity when no leg exists. Undefined when the
 * layer cannot tell, and when both stops are targets of one building, since
 * a route between them can stay in it.
 */
export async function coarseBound(
  terrain: Terrain,
  from: { point: Point; height?: number | undefined },
  to: { point: Point; height?: number | undefined },
  leg: Pick<Leg, "downhill">,
  request: LegRequest,
): Promise<number | undefined> {
  const layer = await terrain.coarse?.();
  const band = layer?.band(request.maxSlope);
  if (!layer || !band) return undefined;
  const [a, b] = await Promise.all([
    stopKeys(terrain, from.point, from.height, leg, request),
    stopKeys(terrain, to.point, to.height, leg, request),
  ]);
  if (!a?.from?.length || !b?.to?.length || (a.target && a.target === b.target)) return undefined;
  return layer.seconds(layer.toward(band, b.to), a.from, request);
}

function keptStops(terrain: Terrain) {
  let kept = STOP_KEYS.get(terrain);
  if (!kept) STOP_KEYS.set(terrain, (kept = new Map<string, Promise<Search["stops"]>>()));
  return kept;
}

function stopKey(point: Point, height: number | undefined, leg: Pick<Leg, "downhill">, request: ReachRequest) {
  return JSON.stringify([...reachSettings(request, leg.downhill), point, height]);
}

function holds(nodes: Float64Array, node: number) {
  let [lo, hi] = [0, nodes.length - 1];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1,
      at = nodes[mid] ?? 0;
    if (at === node) return true;
    if (at < node) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/**
 * The cells that a route from `from` with `leg` and `request` can reach,
 * within `FLOOD_MARGIN` of it: the search of `routeLeg` without an end, so
 * it expands each node that it reaches, and the cells under each stored path
 * that it follows. Empty when the start has no node.
 */
export async function floodLeg(terrain: Terrain, from: Point, leg: Pick<Leg, "downhill">, request: LegRequest): Promise<ExpandedCells> {
  const region = await withHomes(terrain, await terrain.region([from], FLOOD_MARGIN));
  const marks = new Uint8Array(region.width * region.height);
  searchRegion(region, from, from, leg.downhill, { kind: "flood", request, marks });
  return tileMarks(region, marks, new Map());
}

function tileMarks(region: TerrainRegion, marks: Uint8Array, into: ExpandedCells): ExpandedCells {
  const { width } = region;
  for (let i = 0; i < marks.length; i++) {
    if (!marks[i]) continue;
    const x = i % width,
      y = Math.floor(i / width);
    const key = `${region.tile[0] + Math.floor(x / CELLS)},${region.tile[1] + Math.floor(y / CELLS)}`;
    let cells = into.get(key);
    if (!cells) into.set(key, (cells = new Uint8Array(CELLS * CELLS)));
    cells[(y % CELLS) * CELLS + (x % CELLS)] = 1;
  }
  return into;
}

/**
 * Adds to the floor tiles of `region` the records of each home tile outside
 * it that a door reference in it names. A door can attach in a tile next to
 * the home tile of its building, so the search then has every door that
 * attaches in the region. It loads each such home tile; it is usually cached.
 */
export async function withHomes(terrain: Terrain, region: TerrainRegion): Promise<TerrainRegion> {
  const tiles = region.floor?.tiles;
  if (!region.floor || !tiles) return region;
  const homes = new Map<string, Tile>();
  for (const { tile, doorRefs } of tiles.values())
    for (const {
      home: [dx, dy],
    } of doorRefs) {
      const home: Tile = [tile[0] + dx, tile[1] + dy];
      if (!tiles.has(home.join())) homes.set(home.join(), home);
    }
  if (!homes.size) return region;
  const all = new Map(tiles);
  for (const [key, [x, y]] of homes) {
    const records = (await terrain.region([[(x + 0.5) * TILE_PIXELS, (y + 0.5) * TILE_PIXELS]], 0)).floor?.tiles.get(key);
    if (records) all.set(key, records);
  }
  return { ...region, floor: { ...region.floor, tiles: all } };
}

/**
 * The snap node of a ground stop at native point `at` of `region`, as the
 * producer's site check snaps an end without a height. The stop cell must be
 * a floor cell with a terrain height, or a terrain cell steeper than
 * `maxSlope`. Of the layers and walkable terrain nodes of the cells whose
 * centres are within `SNAP` yd (2D) of the stop, it is the node nearest in 3D
 * to the stop at that height; the lower on a tie. For a steep stop, a node
 * more than `STEEP_RISE` yd above or below the stop is not a candidate. A
 * swim node is not a candidate; the layers of a building cell are outdoor
 * ground. Without `hazards`, a layer in magma or slime is not a candidate. A
 * descent layer is never a candidate. -1 when the stop cell is not such a
 * cell, or for no candidate. A stop is at `stopHeight`, else at
 * `groundHeight`. Unlike the producer, it measures from cell centres, not
 * survey columns, and it does not prefer floor layers to terrain nodes.
 */
export function snapNode(region: TerrainRegion, at: Point, maxSlope: number, hazards: boolean, stopHeight?: number): number {
  const { width, height, spacing, elevation, floor } = region;
  const [x, y] = nativeToCell(region, at);
  const i = y * width + x;
  const z = elevation[i] ?? Number.NaN;
  const steep = !floor?.head[i] && groundIssue(region, i, maxSlope)?.kind === "steep";
  if ((!floor?.head[i] && !steep) || !Number.isFinite(z)) return -1;
  const yards = spacing / CELL_PIXELS,
    reach = Math.ceil(SNAP / spacing + 0.5);
  let best = -1,
    least = Infinity,
    lowest = Infinity;
  const stop = stopHeight ?? groundHeight(region, i);
  const offer = (n: number, level: number, flat: number) => {
    if (steep && Math.abs(level - stop) > STEEP_RISE) return;
    const d = Math.hypot(flat, level - stop);
    if (d < least || (d === least && level < lowest)) [best, least, lowest] = [n, d, level];
  };
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      const [cx, cy] = [x + dx, y + dy];
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      const [px, py] = cellToNative(region, [cx, cy]);
      const flat = Math.hypot(px - at[0], py - at[1]) * yards;
      if (flat > SNAP) continue;
      const j = cy * width + cx;
      if (!floor?.head[j]) {
        if (!groundIssue(region, j, maxSlope)) offer(j, elevation[j] ?? 0, flat);
        continue;
      }
      for (let k = 0; k < (floor.head[j] & HEAD_LAYERS); k++) {
        const r = (floor.layerStart[j] ?? 0) + k,
          f = floor.flags[r] ?? 0;
        if ((hazards || !(f & NODE_HAZARD)) && !(f & NODE_DESCENT)) offer(floorNode(region, floor, j, k), floor.height[r] ?? 0, flat);
      }
    }
  return best;
}

function nodeCount({ width, height, floor }: TerrainRegion): number {
  let nodes = width * height + (floor?.height.length ?? 0);
  if (floor) for (const h of floor.head) if (h) nodes--;
  return nodes;
}

const sameBounds = (a: TileBounds, b: TileBounds) => a.tile.join() === b.tile.join() && a.cols === b.cols && a.rows === b.rows;

interface Search {
  result: LegResult;
  route?: TerrainRoute;
  sides: number;
  stops?: { from?: number[]; to?: number[]; target?: string };
  swimStart?: boolean;
}

const WALK = 1,
  DESCENT = 2,
  SWIMMING = 3,
  FALL = 4,
  INDOOR = 5;

const NO_FLOOR: RegionFloor = {
  head: new Uint8Array(),
  layerStart: new Uint32Array(),
  height: new Float32Array(),
  sides: new Uint8Array(),
  flags: new Uint8Array(),
  cell: new Uint32Array(),
  links: new Uint32Array(),
  mask: new Uint16Array(),
  drop: new Uint8Array(),
  tiles: new Map(),
};

const bitCount = (n: number) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1);

interface Via {
  kind?: IndoorPath["kind"];
  home: Tile;
  path: readonly FloorPoint[];
}

interface Edge {
  to: number;
  cell: CellPoint;
  length: number;
  via: number;
}

function legStop(stop: Stop, via: Via | undefined, at: 0 | -1, steep: boolean): LegStop {
  if (stop.class !== "target" && stop.class !== "building")
    return { class: stop.class, ...(stop.class === "hint" && stop.ambiguous && { ambiguous: true }), ...(steep && { steep: true }) };
  const { record } = stop.building;
  const building = record.placement;
  if (stop.class === "building" || !via) return { class: stop.class, floor: "door", building };
  const target = record.targets[stop.target];
  if (target?.kind === 0) return { class: "target", floor: { index: target.floor, ground: record.ground, confirmed: true }, building };
  if (!via.kind) return { class: "target", building };
  const z = via.path.at(at)?.[2] ?? 0;
  const off = (i: number) => Math.abs((record.floors[i] ?? 0) - z);
  const index = record.floors.reduce((best, _, i) => (off(i) < off(best) ? i : best), 0);
  return { class: "target", floor: { index, ground: record.ground, confirmed: false }, building };
}

type SearchGoal =
  | { kind: "route"; request: LegRequest; marks: Uint8Array | undefined; reach: Reach; coarse: CoarseLayer | undefined }
  | { kind: "flood"; request: LegRequest; marks: Uint8Array }
  | { kind: "swim"; request: LegRequest }
  | { kind: "stops"; request: ReachRequest & Pick<LegRequest, "heights"> };

function searchRegion(region: TerrainRegion, from: Point, to: Point, downhill: boolean, goal: SearchGoal): Search {
  const { width, height, spacing, elevation, slope, blocked, water } = region;
  const floor = region.floor ?? NO_FLOOR;
  const { head, layerStart, sides: linkSides, flags, links, mask, drop: dropBytes } = floor;
  const { maxSlope, hazards = false, heights } = goal.request;
  const allowSwimming = goal.request.swimming.enabled;
  const flood = goal.kind === "flood";
  const index = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? y * width + x : -1);
  const point = (i: number): CellPoint => [i % width, Math.floor(i / width)];
  const wet = (i: number) => Number.isFinite(water[i]);
  const walkable = (i: number) => i >= 0 && !groundIssue(region, i, maxSlope);
  const passable = (i: number) => walkable(i) || (i >= 0 && allowSwimming && wet(i) && blocked[i] === 0 && Number.isFinite(elevation[i]));
  const tileOf = ([x, y]: CellPoint): Tile => [region.tile[0] + Math.floor(x / CELLS), region.tile[1] + Math.floor(y / CELLS)];
  const ends = [nativeToCell(region, from), nativeToCell(region, to)] as const;
  const [start, end] = ends;

  const done = (result: LegResult): Search => ({ result, sides: 0 });
  for (const [n, cell] of ends.entries()) {
    const coverage = region.coverage(cell);
    if (coverage === "missing-coverage")
      return done({ kind: "missing-coverage", tiles: [{ tile: tileOf(cell), at: cellToNative(region, cell) }] });
    if (coverage !== "present") return done({ kind: "no-terrain", endpoint: n ? "end" : "start" });
  }

  const cells = width * height;
  const START = cells + floor.height.length,
    GOAL = START + 1;
  const inRegion = (n: number) => n < START;
  const cellOf = (n: number) => (n < cells ? n : inRegion(n) ? (floor.cell[n - cells] ?? 0) : -1);
  const cellNode = (i: number) => i;
  const layers = (i: number) => (head[i] ?? 0) & HEAD_LAYERS;
  const recordOf = (n: number) => (!inRegion(n) ? -1 : n >= cells ? n - cells : layers(n) ? (layerStart[n] ?? 0) : -1);
  const swimNode = (n: number) => {
    const r = recordOf(n);
    return r < 0 ? wet(n) : ((flags[r] ?? 0) & NODE_SWIM) !== 0;
  };
  const surface = (i: number) => (wet(i) ? (water[i] ?? 0) : (elevation[i] ?? 0));
  const level = (n: number) => {
    const r = recordOf(n);
    return r < 0 ? surface(n) : (floor.height[r] ?? 0);
  };
  const usable = (n: number) => {
    const r = recordOf(n);
    if (r < 0) return passable(n);
    const f = flags[r] ?? 0;
    return (hazards || !(f & NODE_HAZARD)) && (allowSwimming || !(f & NODE_SWIM));
  };
  const swimOf = (i: number) => {
    const h = head[i] ?? 0;
    if (!h) return wet(i) ? i : -1;
    return h & HEAD_SWIM ? floorNode(region, floor, i, layers(i)) : -1;
  };
  const nodesOf = (i: number): number[] => {
    if (!head[i]) return [i];
    const nodes: number[] = [];
    for (let k = 0; k < layers(i); k++) nodes.push(floorNode(region, floor, i, k));
    const swim = swimOf(i);
    if (swim >= 0) nodes.push(swim);
    return nodes;
  };
  const descents = flags.includes(NODE_DESCENT);
  const isDescent = (n: number) => {
    const r = recordOf(n);
    return r >= 0 && ((flags[r] ?? 0) & NODE_DESCENT) !== 0;
  };
  const descentOf = (i: number) => (layers(i) === 1 && ((flags[layerStart[i] ?? 0] ?? 0) & NODE_DESCENT) !== 0 ? i : -1);
  const groundLayers = (i: number) => (descentOf(i) < 0 ? layers(i) : 0);
  const groundOf = (i: number) => {
    if (!head[i]) return i;
    const count = groundLayers(i);
    if (!count) return -1;
    const off = (k: number) => Math.abs((floor.height[(layerStart[i] ?? 0) + k] ?? 0) - (elevation[i] ?? 0));
    let best = 0;
    for (let k = 1; k < count; k++) if (off(k) < off(best)) best = k;
    return floorNode(region, floor, i, best);
  };
  const surfaceOf = (i: number) => {
    const node = groundOf(i);
    if (node < 0) return -1;
    const r = recordOf(node);
    return r < 0 || !((flags[r] ?? 0) & NODE_BURIED) ? node : -1;
  };
  const descentKind = (a: number, b: number, length: number): number => {
    const dry = (n: number) => n >= cells || !!head[n] || (blocked[n] === 0 && Number.isFinite(elevation[n]) && !wet(n));
    if (!downhill || !dry(a) || !dry(b)) return 0;
    const drop = level(a) - level(b);
    if (!(drop > 0)) return 0;
    const sa = slope[cellOf(a)] ?? 90,
      sb = slope[cellOf(b)] ?? 90;
    return sa <= maxSlope && sb <= maxSlope && drop <= maxRise * length ? 0 : DESCENT;
  };
  const stopNodes = (i: number) => nodesOf(i).filter((n) => usable(n) && !isDescent(n));
  const unloaded = (i: number) => i < 0 || (blocked[i] === HOLE && !Number.isFinite(elevation[i]));
  const open = (cell: CellPoint) => index(...cell) < 0 || region.coverage(cell) === "missing-coverage";

  const sourceCell = index(...start),
    targetCell = index(...end);
  const startStop = classifyStop(region, from, heights?.from),
    endStop = classifyStop(region, to, heights?.to);
  const inBuilding = (i: number) => ((head[i] ?? 0) & HEAD_BUILDING) !== 0;
  const floorWithoutNode = (i: number) => !!head[i] && !groundLayers(i) && swimOf(i) < 0 && !inBuilding(i);
  const throughSides = (stop: Stop, i: number) => (stop.class === "ground" || stop.class === "hint") && floorWithoutNode(i);
  const hintNode = (stop: Stop, i: number, height?: number) => {
    if (stop.class !== "hint" || !groundLayers(i)) return -1;
    const off = (k: number) => Math.abs((floor.height[(layerStart[i] ?? 0) + k] ?? 0) - (height ?? stop.height));
    let best = 0;
    for (let k = 1; k < layers(i); k++) if (off(k) < off(best)) best = k;
    return floorNode(region, floor, i, best);
  };
  const groundNode = (stop: Stop, at: Point, height?: number) =>
    stop.class === "ground" ? snapNode(region, at, maxSlope, hazards, height) : -1;
  const startGround = groundNode(startStop, from, heights?.from),
    endGround = groundNode(endStop, to, heights?.to);
  const startThroughSides = startGround < 0 && throughSides(startStop, sourceCell),
    endThroughSides = endGround < 0 && throughSides(endStop, targetCell);
  const startNode = startGround >= 0 ? startGround : startThroughSides ? -1 : hintNode(startStop, sourceCell, heights?.from),
    endNode = endGround >= 0 ? endGround : endThroughSides ? -1 : hintNode(endStop, targetCell, heights?.to);
  const startSteep = startGround >= 0 && !head[sourceCell],
    endSteep = endGround >= 0 && !head[targetCell];

  const vias: Via[] = [];
  const addVia = (via: Via) => vias.push(via) - 1;
  const attach = (building: PlacedBuilding, door: number): { cell: CellPoint; node: number } => {
    const cell = attachCell(region, building, door);
    const i = index(...cell);
    if (unloaded(i)) return { cell, node: -1 };
    const k = building.record.doors[door]?.layer ?? 0;
    const node = !head[i] ? i : k < layers(i) ? floorNode(region, floor, i, k) : -1;
    return { cell, node: node >= 0 && usable(node) ? node : -2 };
  };
  const doorEdges = (stop: Stop, toStop: boolean): Edge[] => {
    if (stop.class !== "target" && stop.class !== "building") return [];
    const { home } = stop.building;
    return stopDoors(stop).map(({ door, path }) => {
      const { cell, node } = attach(stop.building, door);
      const via = path.length ? addVia({ kind: "door", home, path: toStop ? path : path.toReversed() }) : -1;
      return { to: node, cell, length: pathLength(path), via };
    });
  };
  const starts = doorEdges(startStop, false),
    goals = flood ? [] : doorEdges(endStop, true);
  const startIndoor = startStop.class === "target" || startStop.class === "building",
    endIndoor = endStop.class === "target" || endStop.class === "building";
  let inside: { length: number; via: number } | undefined;
  if (!flood && startStop.class === "target" && endStop.class === "target" && sameBuilding(startStop.building, endStop.building)) {
    const { home, record } = startStop.building;
    const target = record.targets[startStop.target];
    const [x, y] = target?.point ?? [0, 0];
    const z = record.floors[target?.kind === 0 ? target.floor : record.ground] ?? 0;
    if (startStop.target === endStop.target) inside = { length: 0, via: addVia({ home, path: [[x, y, z]] }) };
    else {
      const path = pairPath(record, startStop.target, endStop.target);
      if (path.length) inside = { length: pathLength(path), via: addVia({ kind: "pair", home, path }) };
    }
  }

  const sources = startIndoor
    ? []
    : startThroughSides
      ? [cellNode(sourceCell)]
      : startNode >= 0
        ? [startNode].filter(usable)
        : stopNodes(sourceCell);
  const nodeKey = (node: number) => {
    const c = cellOf(node);
    const layer = node < cells ? 0 : node - cells - (layerStart[c] ?? 0);
    return encodeNodeKey(region.tile[0] * CELLS + (c % width), region.tile[1] * CELLS + Math.floor(c / width), layer);
  };
  const keys = (nodes: number[]) => nodes.map(nodeKey).sort((a, b) => a - b);
  const doorNodes = (edges: Edge[]) =>
    edges.some((e) => e.to === -1 && open(e.cell)) ? undefined : edges.flatMap((e) => (e.to >= 0 ? [e.to] : []));
  const withSides = (own: number[], i: number, nodes: (t: number) => number[]) => {
    const [x, y] = point(i);
    const out = [...own];
    for (const [dx, dy] of SIDES) {
      const t = index(x + dx, y + dy);
      if (!unloaded(t)) out.push(...(floorWithoutNode(t) ? [cellNode(t)] : nodes(t)));
      else if (open([x + dx, y + dy])) return undefined;
    }
    return out;
  };
  const endNodes = endIndoor ? [GOAL] : endThroughSides ? [cellNode(targetCell)] : endNode >= 0 ? [endNode] : nodesOf(targetCell);
  const leaves = startIndoor ? doorNodes(starts) : startThroughSides ? withSides(sources, sourceCell, stopNodes) : sources,
    comes = endIndoor ? doorNodes(goals) : endThroughSides ? withSides(endNodes, targetCell, nodesOf) : endNodes;
  if (goal.kind === "stops") {
    const target = startStop.class === "target" && `${startStop.building.home.join(",")}:${startStop.building.index}`;
    return {
      ...done({ kind: "no-path" }),
      stops: { ...(leaves && { from: keys(leaves) }), ...(comes && { to: keys(comes) }), ...(target && { target }) },
    };
  }
  const { request } = goal;
  const { mode, active = false, continues = false, damagingFalls = true, fatalFalls = false } = request;
  const swimSpeed = request.swimming.speed;
  const marks = goal.kind === "swim" ? undefined : goal.marks;
  const unusableEndpoint = (endpoint: "start" | "end") => {
    if (goal.kind === "route" && !region.failed.length) {
      const key = endpoint === "start" ? unusableStopKey("from", from, heights?.from) : unusableStopKey("to", to, heights?.to);
      goal.reach.set(key, new Float64Array());
    }
    return done({ kind: "no-path", endpoint });
  };
  if (!inside && (startIndoor ? starts.every((e) => e.to === -2) : !sources.length)) return unusableEndpoint("start");
  const endFound = endIndoor
    ? goals.some((e) => e.to !== -2)
    : endThroughSides || (endNode >= 0 ? usable(endNode) : stopNodes(targetCell).length > 0);
  if (!flood && !inside && !endFound) return unusableEndpoint("end");
  const reach = goal.kind === "route" && !inside && leaves && comes ? goal.reach : undefined;
  const startKey = `f${keys(leaves ?? []).join(",")}`,
    endKey = `b${keys(comes ?? []).join(",")}`;
  if (reach && leaves && comes) {
    const forward = reach.get(startKey),
      backward = reach.get(endKey);
    if (forward && !comes.some((e) => holds(forward, nodeKey(e)))) return done({ kind: "no-path" });
    if (backward && !leaves.some((s) => holds(backward, nodeKey(s)))) return done({ kind: "no-path", endpoint: "end" });
    const coarse = goal.kind === "route" ? goal.coarse : undefined;
    if (!region.failed.length && coarse?.unreachable(keys(leaves), keys(comes), request)) return done({ kind: "no-path" });
  }
  const remember = (key: string, values: Float64Array) => {
    const keys: number[] = [];
    for (let node = 0; inRegion(node); node++) if ((values[node] ?? Infinity) < Infinity) keys.push(nodeKey(node));
    reach?.set(key, Float64Array.from(keys).sort());
  };
  const isEnd = flood ? () => false : (n: number) => endNodes.includes(n);

  const beyond = [Infinity, Infinity, Infinity, Infinity];
  const missing = new Map<string, { tile: Tile; at: Point; bound: number }>();
  const unknown: Outside = (cell, seconds) => {
    const bound = cost + seconds + heuristic(...cell);
    const [x, y] = cell;
    if (x < 0) beyond[0] = Math.min(beyond[0] ?? Infinity, bound);
    if (x >= width) beyond[1] = Math.min(beyond[1] ?? Infinity, bound);
    if (y < 0) beyond[2] = Math.min(beyond[2] ?? Infinity, bound);
    if (y >= height) beyond[3] = Math.min(beyond[3] ?? Infinity, bound);
    if (region.coverage(cell) === "missing-coverage") {
      const tile = tileOf(cell);
      const seen = missing.get(tile.join());
      if (!seen) missing.set(tile.join(), { tile, at: cellToNative(region, cell), bound });
      else seen.bound = Math.min(seen.bound, bound);
    }
  };
  const finish = (route: TerrainRoute | undefined, cost = route?.seconds ?? Infinity): Search => {
    const sides = beyond.reduce((bits, bound, side) => (bound < cost ? bits | (1 << side) : bits), 0);
    const tiles = [...missing.values()].flatMap(({ tile, at, bound }) => (bound < cost ? [{ tile, at }] : []));
    const result: LegResult = tiles.length ? { kind: "missing-coverage", tiles, ...(route && { route }) } : (route ?? { kind: "no-path" });
    return { result, ...(route && { route }), sides };
  };

  const nodes: number[] = [],
    parents: number[] = [],
    kinds: number[] = [],
    lengths: number[] = [],
    viaOf: number[] = [],
    moved: boolean[] = [],
    spent: number[] = [],
    runs: number[] = [];
  const addState = (node: number, parent: number, kind: number, length: number, via: number, move: boolean, cost: number, run: number) => {
    nodes.push(node);
    parents.push(parent);
    kinds.push(kind);
    lengths.push(length);
    viaOf.push(via);
    moved.push(move);
    spent.push(cost);
    return runs.push(run) - 1;
  };
  const n = GOAL + 1;
  const costs = new Float64Array(n).fill(Infinity);
  const offered = new Float64Array(n).fill(Infinity);
  const expanded = new Float64Array(n).fill(Infinity);
  const maxRise = Math.tan((maxSlope * Math.PI) / 180) * spacing;
  const stepKind = (a: number, b: number, length: number): number => {
    if (blocked[a] !== 0 || blocked[b] !== 0 || !Number.isFinite(elevation[a]) || !Number.isFinite(elevation[b])) return 0;
    if (wet(a) || wet(b)) {
      if (!allowSwimming) return 0;
      const surfaceA = wet(a) ? water[a] : elevation[a];
      const surfaceB = wet(b) ? water[b] : elevation[b];
      return (!wet(a) && (slope[a] ?? 90) > maxSlope) ||
        (!wet(b) && (slope[b] ?? 90) > maxSlope) ||
        Math.abs((surfaceA ?? 0) - (surfaceB ?? 0)) > maxRise * length
        ? 0
        : SWIMMING;
    }
    const drop = (elevation[a] ?? 0) - (elevation[b] ?? 0);
    if ((slope[a] ?? 90) <= maxSlope && (slope[b] ?? 90) <= maxSlope && Math.abs(drop) <= maxRise * length) return WALK;
    return downhill && drop > 0 ? DESCENT : 0;
  };
  const fastest = Math.max(mode.speed, allowSwimming ? swimSpeed : 0);
  const aims = endIndoor ? goals.filter((e) => e.to !== -2).map((e) => e.cell) : endNode >= 0 ? [point(cellOf(endNode))] : [end];
  const [ax, ay] = aims[0] ?? end;
  let doorPathSavings = 0;
  const heuristic =
    aims.length < 2
      ? (x: number, y: number) => Math.max(0, (Math.hypot(x - ax, y - ay) * spacing) / fastest - doorPathSavings)
      : (x: number, y: number) => {
          let least = Infinity;
          for (const [gx, gy] of aims) least = Math.min(least, Math.hypot(x - gx, y - gy));
          return Math.max(0, (least * spacing) / fastest - doorPathSavings);
        };
  const estimate = (node: number) => {
    if (node === GOAL || flood) return 0;
    const c = cellOf(node);
    return heuristic(c % width, Math.floor(c / width));
  };
  const distance = (a: number, b: number) => {
    const p = cellOf(a),
      q = cellOf(b);
    return Math.hypot(
      ((p % width) - (q % width)) * spacing,
      (Math.floor(p / width) - Math.floor(q / width)) * spacing,
      level(a) - level(b),
    );
  };

  const edges = new Map<number, Edge[]>();
  const entrances: number[] = [];
  const addEdge = (node: number, edge: Edge) => {
    const list = edges.get(node);
    if (list) list.push(edge);
    else edges.set(node, [edge]);
  };
  for (const building of regionBuildings(region)) {
    const doors = building.record.doors.map((_, door) => attach(building, door));
    for (const [i, a] of doors.entries())
      for (const [j, b] of doors.entries()) {
        if (j <= i || a.node === -2 || b.node === -2) continue;
        const path = doorsPath(building.record, i, j);
        if (!path.length) continue;
        const length = pathLength(path);
        if (a.node >= 0 || b.node >= 0)
          doorPathSavings += Math.max(
            0,
            (Math.hypot(a.cell[0] - b.cell[0], a.cell[1] - b.cell[1]) * spacing) / fastest - length / mode.speed,
          );
        if (a.node >= 0) addEdge(a.node, { to: b.node, cell: b.cell, length, via: addVia({ kind: "doors", home: building.home, path }) });
        if (b.node >= 0)
          addEdge(b.node, {
            to: a.node,
            cell: a.cell,
            length,
            via: addVia({ kind: "doors", home: building.home, path: path.toReversed() }),
          });
        if (a.node === -1 && b.node >= 0 && open(a.cell)) entrances.push(b.node);
        if (b.node === -1 && a.node >= 0 && open(b.cell)) entrances.push(a.node);
      }
  }
  for (const goal of goals)
    if (goal.to >= 0) addEdge(goal.to, { ...goal, to: GOAL });
    else if (goal.to === -1 && open(goal.cell)) entrances.push(GOAL);
  const hasEdges = new Uint8Array(n);
  for (const node of edges.keys()) hasEdges[node] = 1;

  type Visit = (next: number, kind: number, length?: number, via?: number, fall?: number) => void;
  type Outside = (cell: CellPoint, seconds: number) => void;
  const ignore: Outside = () => {};
  const step = (from: number, s: number, visit: (next: number, kind: number) => void) => {
    const c = cellOf(from);
    const [dx, dy] = SIDES[s] ?? [0, 0];
    const t = index((c % width) + dx, Math.floor(c / width) + dy);
    if (t < 0) return;
    const r = recordOf(from);
    if (descents) {
      const down = descentOf(t);
      const off = isDescent(from);
      const next = down >= 0 ? (off || r < 0 || from === surfaceOf(c) ? down : -1) : off ? surfaceOf(t) : -1;
      const kind = next >= 0 && (recordOf(next) < 0 || usable(next)) ? descentKind(from, next, 1) : 0;
      if (kind) visit(next, kind);
      if (off) return;
    }
    const swimTo = (a: number) => {
      const swim = swimOf(t);
      if (swim >= 0 && usable(swim) && Math.abs(level(a) - level(swim)) <= maxRise) visit(swim, SWIMMING);
    };
    if (r < 0) {
      if (!head[t]) {
        const kind = stepKind(c, t, 1);
        if (kind) visit(t, kind);
        return;
      }
      if (!passable(c)) return;
      const back = 1 << ((s + 2) % 4);
      for (let k = 0; k < layers(t); k++) {
        const next = floorNode(region, floor, t, k);
        if ((linkSides[(layerStart[t] ?? 0) + k] ?? 0) & back && usable(next)) visit(next, wet(c) ? SWIMMING : WALK);
      }
      if (wet(c)) swimTo(c);
      return;
    }
    const f = flags[r] ?? 0;
    if (f & NODE_SWIM) return swimTo(from);
    const walk = (linkSides[r] ?? 0) & 0x0f;
    if (!(walk & (1 << s))) return;
    let m = (mask[(links[r] ?? 0) + bitCount(walk & ((1 << s) - 1))] ?? 0) & ~SWIM;
    for (let k = 0; m; k++, m >>= 1) {
      if (!(m & 1)) continue;
      const next = head[t] ? floorNode(region, floor, t, k) : k === 0 ? t : -1;
      if (next >= 0 && usable(next) && !isDescent(next)) visit(next, swimNode(next) ? SWIMMING : WALK);
    }
  };

  const maxDrop = !downhill ? -1 : !damagingFalls ? DAMAGE_FALL : !fatalFalls ? FATAL_FALL : Infinity;
  const limited = (run: number) => (maxDrop < Infinity ? run : 0);
  const drops = (from: number, r: number, fallen: number, visit: Visit, outside: Outside) => {
    const c = cellOf(from),
      bits = linkSides[r] ?? 0;
    const land = (t: number, j: number) => {
      const height = (dropBytes[j] ?? 255) / 2;
      if (!(fallen + height < maxDrop)) return;
      const m = mask[j] ?? 0;
      if (m & SWIM) {
        const swim = swimOf(t);
        if (swim >= 0 && usable(swim)) visit(swim, FALL, undefined, -1, height);
      }
      for (let k = 0, rest = m & ~SWIM; rest; k++, rest >>= 1) {
        if (!(rest & 1)) continue;
        const next = head[t] ? floorNode(region, floor, t, k) : k === 0 ? t : -1;
        if (next >= 0 && usable(next)) visit(next, FALL, undefined, -1, height);
      }
    };
    let j = (links[r] ?? 0) + bitCount(bits & 0x0f);
    for (let s = 0; s < 4; s++) {
      if (!(bits & (0x10 << s))) continue;
      const [dx, dy] = SIDES[s] ?? [0, 0];
      const x = (c % width) + dx,
        y = Math.floor(c / width) + dy;
      const t = index(x, y);
      if (!unloaded(t)) land(t, j);
      else if (fallen + (dropBytes[j] ?? 255) / 2 < maxDrop) outside([x, y], spacing / fastest);
      j++;
    }
    if ((flags[r] ?? 0) & NODE_FALL) land(c, j);
  };

  const markPath = (marks: Uint8Array, { home, path }: Via) => {
    const line = pathLine(home, path);
    for (const [i, b] of line.entries()) {
      const a = line[i - 1] ?? b;
      const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
      for (let k = 0; k <= steps; k++) {
        const t = steps ? k / steps : 0;
        const cell = index(...nativeToCell(region, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
        if (cell >= 0) marks[cell] = 1;
      }
    }
  };

  const consistent = doorPathSavings === 0;
  const heap = new Heap();
  let reached = -1;
  let state = -1,
    current = -1,
    cost = 0,
    fallen = 0;
  const relax = (next: number, kind: number, length = distance(current, next), via = -1) => {
    if (marks && via >= 0) markPath(marks, vias[via]!);
    // In game, a slide down a steep face deals fall damage, so descent steps and drops add to one fall.
    const run = kind === DESCENT || kind === FALL ? fallen + level(current) - level(next) : 0;
    if (kind === DESCENT && !(run < maxDrop)) return;
    const moving = length > 0 || (inRegion(current) && inRegion(next));
    const candidate =
      cost +
      (kind === SWIMMING
        ? length / swimSpeed + (swimNode(current) && !swimNode(next) && (continues || !isEnd(next)) ? mode.activation : 0)
        : length / mode.speed + (moving && !moved[state] && !active ? mode.activation : 0));
    const cheaper = candidate < (costs[next] ?? Infinity);
    if (!cheaper && !(limited(run) < (offered[next] ?? Infinity))) return;
    if (cheaper) {
      costs[next] = candidate;
      if (!consistent) expanded[next] = Infinity;
    }
    offered[next] = Math.min(offered[next] ?? Infinity, limited(run));
    const id = addState(next, state, kind, length, via, !!moved[state] || moving, candidate, run);
    heap.push(id, candidate + estimate(next));
  };
  const follow = (edge: Edge, visit: Visit, outside: Outside) => {
    if (edge.to >= 0) visit(edge.to, edge.length ? INDOOR : WALK, edge.length, edge.via);
    else outside(edge.cell, edge.length / mode.speed);
  };
  for (const source of sources) {
    costs[source] = offered[source] = 0;
    heap.push(addState(source, -1, 0, 0, -1, false, 0, 0), estimate(source));
  }
  if (startIndoor) {
    current = START;
    state = addState(START, -1, 0, 0, -1, false, 0, 0);
    for (const edge of starts) if (edge.to !== -2) follow(edge, relax, unknown);
    if (inside) relax(GOAL, inside.length ? INDOOR : WALK, inside.length, inside.via);
  }
  const floorStep = (node: number, dx: number, dy: number, visit: Visit) => {
    const sx = dx < 0 ? 0 : 2,
      sy = dy > 0 ? 1 : 3;
    if (!dx || !dy) return step(node, dx ? sx : sy, visit);
    const via = (first: number, second: number) => {
      const out = new Map<number, number[]>();
      step(node, first, (side, a) =>
        step(side, second, (d, b) => {
          if (!out.has(d)) out.set(d, [a, b]);
        }),
      );
      return out;
    };
    const across = via(sy, sx);
    for (const [d, a] of via(sx, sy)) {
      const b = across.get(d);
      if (!b) continue;
      let kind =
        descents && (isDescent(node) || isDescent(d))
          ? descentKind(node, d, Math.SQRT2)
          : recordOf(node) < 0 && recordOf(d) < 0
            ? stepKind(node, d, Math.SQRT2)
            : swimNode(node) || swimNode(d)
              ? SWIMMING
              : WALK;
      if (!kind) continue;
      const hops = [...a, ...b];
      if (kind !== SWIMMING && hops.includes(SWIMMING)) continue;
      if (hops.includes(DESCENT)) {
        if (kind === SWIMMING || level(node) <= level(d)) continue;
        kind = DESCENT;
      }
      if (kind === DESCENT && ((flags[recordOf(node)] ?? 0) | (flags[recordOf(d)] ?? 0)) & NODE_BURIED) continue;
      visit(d, kind);
    }
  };
  const exits = (node: number, s: number) => {
    const r = recordOf(node);
    if (r < 0 || ((flags[r] ?? 0) & NODE_SWIM) !== 0 || ((linkSides[r] ?? 0) & (1 << s)) !== 0) return true;
    return descents && (isDescent(node) || node === surfaceOf(cellOf(node)));
  };
  const turns = (node: number, a: number, b: number) => {
    let found = false;
    step(node, a, (t) => (found ||= exits(t, b)));
    return found;
  };
  const expand = (node: number, fallen: number, visit: Visit, outside: Outside) => {
    const c = cellOf(node);
    const [x, y] = point(c);
    if (hasEdges[node]) for (const edge of edges.get(node) ?? []) follow(edge, visit, outside);
    if (endThroughSides && Math.abs(x - end[0]) + Math.abs(y - end[1]) === 1)
      visit(cellNode(targetCell), swimNode(node) ? SWIMMING : WALK, spacing);
    if (startThroughSides && c === sourceCell) {
      for (const [dx, dy] of SIDES) {
        const t = index(x + dx, y + dy);
        if (unloaded(t)) outside([x + dx, y + dy], spacing / fastest);
        else for (const next of stopNodes(t)) visit(next, swimNode(next) ? SWIMMING : WALK, spacing);
      }
      return;
    }
    const terrain = !head[c];
    const r = terrain ? -1 : recordOf(node),
      f = flags[r] ?? 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const next = index(x + dx, y + dy);
        if (unloaded(next)) {
          if (!terrain) {
            const sx = dx < 0 ? 0 : 2,
              sy = dy > 0 ? 1 : 3;
            if (dx && dy ? !turns(node, sx, sy) || !turns(node, sy, sx) : !exits(node, dx ? sx : sy)) continue;
          }
          outside([x + dx, y + dy], (Math.hypot(dx, dy) * spacing) / fastest);
          continue;
        }
        const horizontal = y * width + x + dx;
        const vertical = (y + dy) * width + x;
        if (!terrain || head[next] || (dx && dy && (head[horizontal] || head[vertical]))) {
          floorStep(node, dx, dy, visit);
          continue;
        }
        let kind = stepKind(node, next, Math.hypot(dx, dy));
        if (!kind) continue;
        if (dx && dy) {
          const sides = [
            stepKind(node, horizontal, 1),
            stepKind(horizontal, next, 1),
            stepKind(node, vertical, 1),
            stepKind(vertical, next, 1),
          ];
          if (sides.includes(0)) continue;
          if (kind !== SWIMMING && sides.includes(SWIMMING)) continue;
          if (sides.includes(DESCENT)) {
            if (kind === SWIMMING) continue;
            if ((elevation[node] ?? 0) <= (elevation[next] ?? 0)) continue;
            kind = DESCENT;
          }
        }
        visit(next, kind);
      }
    if (terrain) return;
    if (f & NODE_WATER) {
      const swim = swimOf(c);
      if (swim >= 0 && usable(swim)) visit(swim, SWIMMING);
    }
    if (f & NODE_SWIM)
      for (let k = 0; k < layers(c); k++) {
        const layer = floorNode(region, floor, c, k);
        if ((flags[(layerStart[c] ?? 0) + k] ?? 0) & NODE_WATER && usable(layer)) visit(layer, SWIMMING);
      }
    drops(node, r, fallen, visit, outside);
  };
  const swimsFirst = () => {
    const firsts: number[] = [];
    if (startIndoor) {
      for (const e of starts)
        if (e.to !== -2 && !e.length) {
          if (e.to >= 0) firsts.push(e.to);
          else if (open(e.cell)) return true;
        }
    } else firsts.push(...sources);
    let swims = false,
      blind = false;
    const swim: Visit = (_next, kind) => {
      if (kind === SWIMMING) swims = true;
    };
    for (const node of firsts) {
      if (swimNode(node)) return true;
      expand(node, 0, swim, () => (blind = true));
      if (swims || blind) return true;
    }
    return false;
  };
  if (goal.kind === "swim") return { ...done({ kind: "no-path" }), swimStart: swimsFirst() };
  for (let entry = heap.pop(); entry; entry = heap.pop()) {
    state = entry.id;
    current = nodes[state] ?? -1;
    fallen = runs[state] ?? 0;
    if (!(limited(fallen) < (expanded[current] ?? Infinity))) continue;
    if (isEnd(current)) {
      reached = state;
      break;
    }
    expanded[current] = limited(fallen);
    cost = spent[state] ?? Infinity;
    if (marks && inRegion(current)) marks[cellOf(current)] = 1;
    expand(current, fallen, relax, unknown);
  }
  if (flood) return done({ kind: "no-path" });
  const sealed = (): Float64Array | undefined => {
    const back = new Map<number, number[]>();
    for (const [node, list] of edges)
      for (const { to } of list) {
        if (to < 0) continue;
        const from = back.get(to);
        if (from) from.push(node);
        else back.set(to, [node]);
      }
    const doors = new Set(entrances);
    const needs = new Float64Array(n).fill(Infinity);
    const queue = new Heap();
    const add = (node: number, need: number) => {
      if (!(need < (needs[node] ?? Infinity))) return;
      needs[node] = need;
      const [x, y] = point(cellOf(node));
      queue.push(node, inRegion(node) ? Math.min(x, y, width - 1 - x, height - 1 - y) : 0);
    };
    for (const node of endNodes) add(node, 0);
    for (let entry = queue.pop(); entry; entry = queue.pop()) {
      const target = entry.id;
      if (doors.has(target)) return undefined;
      for (const node of back.get(target) ?? []) add(node, 0);
      if (!inRegion(target)) continue;
      const [x, y] = point(cellOf(target));
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const t = index(x + dx, y + dy);
          if (unloaded(t)) {
            if (open([x + dx, y + dy])) return undefined;
            continue;
          }
          for (const node of nodesOf(t)) {
            if (needs[node] === 0) continue;
            let least = Infinity;
            const visit: Visit = (next, kind, _length, _via, fall = 0) => {
              if (next !== target) return;
              if (kind !== DESCENT && kind !== FALL) {
                least = 0;
                return;
              }
              const after = needs[target] ?? 0,
                drop = level(node) - level(next);
              const need = limited(kind === DESCENT ? drop + after : Math.max(fall, after > 0 ? drop + after : 0));
              if (need < maxDrop) least = Math.min(least, need);
            };
            expand(node, 0, visit, ignore);
            add(node, least);
          }
        }
    }
    return needs;
  };
  if (reached < 0) {
    const search = finish(undefined);
    if (!search.sides) {
      if (reach && search.result.kind === "no-path") remember(startKey, expanded);
      return search;
    }
    const needs = sealed();
    if (!needs) return search;
    if (reach) remember(endKey, needs);
    return done({ kind: "no-path", endpoint: "end" });
  }

  const searched = [reached];
  for (let i = reached; (parents[i] ?? -1) >= 0;) searched.push((i = parents[i] ?? -1));
  searched.reverse();
  const ground = (node: number) => node === groundOf(cellOf(node));
  const grid: SmoothGrid = {
    width,
    spacing,
    cellOf,
    level,
    walk(from, cell, visit) {
      const walk: Visit = (next, kind, _length, via = -1) => {
        if (kind === WALK && via < 0 && inRegion(next) && cellOf(next) === cell && ground(next) === ground(from)) visit(next);
      };
      expand(from, 0, walk, ignore);
    },
  };
  const smooth = smoothRoute(grid, {
    nodes: searched.map((s) => nodes[s] ?? -1),
    lengths: searched.map((s) => lengths[s] ?? 0),
    plain: searched.map((s, i) => {
      const from = nodes[searched[i - 1] ?? -1] ?? -1,
        to = nodes[s] ?? -1;
      return i > 0 && kinds[s] === WALK && (viaOf[s] ?? -1) < 0 && inRegion(from) && inRegion(to) && ground(from) === ground(to);
    }),
  });
  let saved = 0;
  for (const s of searched) saved += lengths[s] ?? 0;
  const chain = smooth.keep.map((p, i) => {
    const s = searched[p] ?? reached;
    lengths[s] = smooth.lengths[i] ?? 0;
    saved -= lengths[s];
    return s;
  });
  const native = (node: number) => cellToNative(region, point(cellOf(node)));
  const first = nodes[chain[0] ?? reached] ?? -1;
  const route: TerrainRoute = {
    kind: "route",
    points: inRegion(first) ? [native(first)] : [],
    heights: inRegion(first) ? [level(first)] : [],
    descents: [],
    descentDrop: 0,
    falls: [],
    swims: [],
    swimDistance: 0,
    swimSeconds: 0,
    swimRemounts: [],
    distance: 0,
    terrainSeconds: 0,
    activation: 0,
    seconds: (spent[reached] ?? 0) - saved / mode.speed,
  };
  const { points } = route;
  const levels = route.heights!;
  const paths: IndoorPath[] = [];
  // Sum in locals, not in `route` fields. Under some Node versions, V8's
  // concurrent OSR code sometimes doubled `route.distance +=` here.
  let land = 0,
    swim = 0,
    moving = false,
    falling = false;
  for (let i = 1; i < chain.length; i++) {
    const s = chain[i] ?? reached;
    const from = nodes[chain[i - 1] ?? reached] ?? -1,
      to = nodes[s] ?? -1;
    const kind = kinds[s],
      length = lengths[s] ?? 0;
    const via = vias[viaOf[s] ?? -1];
    if (via?.path.length) {
      const start = points.length;
      points.push(...pathLine(via.home, via.path));
      for (const [, , z] of via.path) levels.push(z / 8);
      if (via.kind) paths.push({ kind: via.kind, start, end: points.length - 1 });
    }
    if (!moving && (length > 0 || (inRegion(from) && inRegion(to)))) {
      moving = true;
      if (!active && kind !== SWIMMING) route.activation = mode.activation;
    }
    if (kind === DESCENT) {
      route.descents.push(points.length - 1);
      route.descentDrop += level(from) - level(to);
    }
    const fell = kind === DESCENT || kind === FALL;
    const fall = route.falls.at(-1);
    if (fell && falling && fall) fall.height = runs[s] ?? 0;
    else if (fell) route.falls.push({ point: points.length - 1, height: runs[s] ?? 0 });
    falling = fell;
    if (kind === SWIMMING) {
      route.swims.push(points.length - 1);
      swim += length;
      if (swimNode(from) && !swimNode(to) && (continues || !isEnd(to)))
        route.swimRemounts.push({ point: points.length, seconds: mode.activation });
    } else land += length;
    if (inRegion(to)) {
      points.push(native(to));
      levels.push(level(to));
    }
  }
  route.distance = land;
  route.swimDistance = swim;
  route.swimSeconds = swim / swimSpeed;
  route.terrainSeconds = land / mode.speed;
  const viaAt = (s: number) => (s >= 0 ? vias[viaOf[s] ?? -1] : undefined);
  if (startStop.class !== "ground" || endStop.class !== "ground" || startSteep || endSteep)
    route.stops = [
      legStop(startStop, first === START ? viaAt(chain[1] ?? -1) : undefined, 0, startSteep),
      legStop(endStop, nodes[reached] === GOAL ? viaAt(reached) : undefined, -1, endSteep),
    ];
  if (paths.length) route.paths = paths;
  return finish(route, spent[reached]);
}
