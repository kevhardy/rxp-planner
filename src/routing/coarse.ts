// The `coarse.bin` format and its lower-bound rules follow the data producer's
// routing artifact format.

import { CELLS, COARSE_PATH, sha256Hex, TILE_WORLD_UNITS, type ArtifactManifest, type RoutingArtifact } from "./artifact.ts";
import { Heap } from "./heap.ts";
import { keepNewest } from "./kept.ts";
import { decodeNodeKey } from "./node-key.ts";
import type { LegRequest } from "./search.ts";

const MAGIC = "RXRC";
/** The version names the byte layout and the graph rules of the producer's builder, which the ground hash does not cover. */
const VERSION = 2;
const HEADER = 64;
const NO_REGION = 0xff;
const LINE_SCALE = 2 ** 24;
const REACH = 7;
const SPAN = 2 * REACH + 1;
const SPACING = TILE_WORLD_UNITS / CELLS;

export interface CoarseBand {
  /** The steepest slope limit, in degrees, that the band serves. */
  maxSlope: number;
  component: Uint32Array;
  hopStart: Uint32Array;
  hopFrom: Uint32Array;
  hopLength: Uint16Array;
  hopSwim: Uint16Array;
  insideStart: Uint32Array;
  insideFrom: Uint32Array;
  insideSwim: Uint16Array;
}

export interface Coarse {
  ground: string;
  size: number;
  units: number;
  lineFactor: number;
  columns: number;
  rows: number;
  supercellStart: Uint32Array;
  mapOf: Uint32Array;
  maps: Uint8Array;
  exceptions: { supercell: Uint32Array; cell: Uint16Array; layer: Uint8Array; local: Uint8Array };
  bands: CoarseBand[];
}

/** Lower bounds in yards from each region to one target: of the length, and of the swim length. Infinity: no route. */
export interface CoarseBounds {
  length: Float64Array;
  swim: Float64Array;
}

function fail(problem: string): never {
  throw new Error(`${COARSE_PATH}: ${problem}`);
}

function ordered(a: Uint32Array, last: number, what: string) {
  if (a[0] !== 0 || a[a.length - 1] !== last) fail(`${what} must span ${last}`);
  for (let i = 1; i < a.length; i++) if (a[i]! < a[i - 1]!) fail(`${what} must not decrease`);
}

/** Reads and checks a coarse layer. Throws for bytes that are not one. */
export function decodeCoarse(bytes: Uint8Array): Coarse {
  if (bytes.length < HEADER) fail("too short");
  // A copy, so that each array is aligned.
  const buffer = new Uint8Array(bytes).buffer;
  const view = new DataView(buffer);
  if (new TextDecoder().decode(new Uint8Array(buffer, 0, 4)) !== MAGIC) fail(`expected ${MAGIC}`);
  if (view.getUint16(4, true) !== VERSION) fail(`expected version ${VERSION}`);
  const size = view.getUint16(6, true),
    columns = view.getUint16(10, true),
    rows = view.getUint16(12, true),
    bandCount = view.getUint8(14),
    units = view.getUint8(15),
    regions = view.getUint32(16, true),
    mapCount = view.getUint32(20, true),
    exceptionCount = view.getUint32(24, true),
    lineFactor = view.getUint32(28, true) / LINE_SCALE;
  if (!(size > 0 && size <= 32 && units > 0)) fail("expected a size up to 32 and units");
  if (!(lineFactor > 0 && lineFactor <= 1)) fail("expected a line factor from 0 to 1");
  const ground = Array.from(new Uint8Array(buffer, 32, 32), (b) => b.toString(16).padStart(2, "0")).join("");
  let at = HEADER;
  const take = <T>(Type: new (b: ArrayBuffer, o: number, n: number) => T, n: number, width: number): T => {
    if (at + n * width > bytes.length) fail("too short");
    const out = new Type(buffer, at, n);
    at += (n * width + 3) & ~3;
    return out;
  };
  const supercells = columns * rows;
  const supercellStart = take(Uint32Array, supercells + 1, 4);
  ordered(supercellStart, regions, "supercellStart");
  const c: Coarse = {
    ground,
    size,
    units,
    lineFactor,
    columns,
    rows,
    supercellStart,
    mapOf: take(Uint32Array, supercells, 4),
    maps: take(Uint8Array, mapCount * size * size, 1),
    exceptions: {
      supercell: take(Uint32Array, exceptionCount, 4),
      cell: take(Uint16Array, exceptionCount, 2),
      layer: take(Uint8Array, exceptionCount, 1),
      local: take(Uint8Array, exceptionCount, 1),
    },
    bands: [],
  };
  const home = new Uint32Array(regions);
  for (let s = 0; s < supercells; s++) home.fill(s, supercellStart[s], supercellStart[s + 1]);
  const decode = (start: Uint32Array, codes: Uint16Array) => {
    ordered(start, codes.length, "a start list");
    const out = new Uint32Array(codes.length);
    for (let y = 0; y < regions; y++) {
      const t = home[y]!;
      for (let i = start[y]!; i < start[y + 1]!; i++) {
        const local = codes[i]! & 0xff,
          offset = codes[i]! >> 8;
        const sx = (t % columns) + (offset % SPAN) - REACH,
          sy = Math.floor(t / columns) + Math.floor(offset / SPAN) - REACH;
        const s = sy * columns + sx;
        const inside = sx >= 0 && sx < columns && sy >= 0 && sy < rows && offset < SPAN * SPAN;
        if (!inside || supercellStart[s]! + local >= supercellStart[s + 1]!) fail("a region index is out of range");
        out[i] = supercellStart[s]! + local;
      }
    }
    return out;
  };
  for (let b = 0; b < bandCount; b++) {
    if (at + 12 > bytes.length) fail("too short");
    const maxSlope = view.getUint8(at),
      hops = view.getUint32(at + 4, true),
      inside = view.getUint32(at + 8, true);
    at += 12;
    const component = take(Uint32Array, regions, 4),
      hopStart = take(Uint32Array, regions + 1, 4),
      hopFrom = decode(hopStart, take(Uint16Array, hops, 2)),
      hopLength = take(Uint16Array, hops, 2),
      hopSwim = take(Uint16Array, hops, 2),
      insideStart = take(Uint32Array, regions + 1, 4),
      insideFrom = decode(insideStart, take(Uint16Array, inside, 2)),
      insideSwim = take(Uint16Array, inside, 2);
    c.bands.push({ maxSlope, component, hopStart, hopFrom, hopLength, hopSwim, insideStart, insideFrom, insideSwim });
  }
  if (at !== bytes.length) fail("expected no bytes after the last band");
  checkIndicesAndBandOrder(c, regions);
  return c;
}

function checkIndicesAndBandOrder(c: Coarse, regions: number) {
  const area = c.size * c.size;
  const maps = c.maps.length / area;
  for (let s = 0; s < c.mapOf.length; s++) {
    const count = c.supercellStart[s + 1]! - c.supercellStart[s]!;
    const m = c.mapOf[s]!;
    if (m > maps || count > 1 !== m > 0) fail("expected a cell map for each supercell of 2 or more regions");
    if (m)
      for (const local of c.maps.subarray((m - 1) * area, m * area))
        if (local !== NO_REGION && local >= count) fail("a cell map entry is out of range");
  }
  const { supercell, cell, layer, local } = c.exceptions;
  const key = (j: number) => (supercell[j]! * 1024 + cell[j]!) * 16 + layer[j]!;
  for (let i = 0; i < cell.length; i++) {
    const s = supercell[i]!;
    if (s >= c.mapOf.length || cell[i]! >= area || layer[i]! > 15) fail("an exception is out of range");
    if (local[i] !== NO_REGION && local[i]! >= c.supercellStart[s + 1]! - c.supercellStart[s]!) fail("an exception region is out of range");
    if (i && key(i) <= key(i - 1)) fail("exceptions must be sorted");
  }
  let last = -1;
  for (const band of c.bands) {
    if (band.maxSlope <= last) fail("expected bands in ascending slope order");
    last = band.maxSlope;
    for (const r of band.component) if (r >= regions) fail("a region index is out of range");
  }
}

/** A coarse layer fits the artifact when its ground hash agrees with this one. */
export async function groundHash(manifest: Pick<ArtifactManifest, "frame" | "assets">): Promise<string> {
  const { origin, size, tilePixels, cellsPerTile, tileWorldUnits } = manifest.frame;
  const ground = manifest.assets
    .filter((a) => a.path.startsWith("tiles/") || a.path.startsWith("floors/"))
    .map((a) => [a.path, a.sha256])
    .sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
  const text = JSON.stringify({ frame: { origin, size, tilePixels, cellsPerTile, tileWorldUnits }, ground });
  return sha256Hex(new TextEncoder().encode(text));
}

export function regionOf(c: Coarse, key: number): number {
  const { column: x, row: y, layer: k } = decodeNodeKey(key);
  const { size, columns } = c;
  const sx = Math.floor(x / size),
    sy = Math.floor(y / size);
  if (sx >= columns || sy >= c.rows) return -1;
  const s = sy * columns + sx;
  const first = c.supercellStart[s]!,
    count = c.supercellStart[s + 1]! - first;
  if (count < 2) return count ? first : -1;
  const cell = (y % size) * size + (x % size);
  let local = c.maps[(c.mapOf[s]! - 1) * size * size + cell] ?? NO_REGION;
  if (k > 0) {
    const { supercell, cell: cells, layer, local: locals } = c.exceptions;
    const want = (s * 1024 + cell) * 16 + k;
    let [lo, hi] = [0, cells.length - 1];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const found = (supercell[mid]! * 1024 + cells[mid]!) * 16 + layer[mid]!;
      if (found === want) {
        local = locals[mid]!;
        break;
      }
      if (found < want) lo = mid + 1;
      else hi = mid - 1;
    }
  }
  return local === NO_REGION ? -1 : first + local;
}

function supercellOf(c: Coarse, x: number): number {
  let [lo, hi] = [0, c.supercellStart.length - 2];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c.supercellStart[mid]! <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function boundsTo(c: Coarse, band: CoarseBand, targets: readonly number[]): CoarseBounds {
  const regions = band.component.length;
  const length = new Float64Array(regions).fill(Infinity),
    swim = new Float64Array(regions).fill(Infinity);
  for (const key of targets) {
    const b = regionOf(c, key);
    if (b < 0) continue;
    const { column: tx, row: ty } = decodeNodeKey(key);
    for (let i = band.insideStart[b]!; i < band.insideStart[b + 1]!; i++) {
      const x = band.insideFrom[i]!;
      const s = supercellOf(c, x);
      const x0 = (s % c.columns) * c.size,
        y0 = Math.floor(s / c.columns) * c.size;
      const dx = Math.max(0, x0 - tx, tx - (x0 + c.size - 1)),
        dy = Math.max(0, y0 - ty, ty - (y0 + c.size - 1));
      length[x] = Math.min(length[x]!, c.lineFactor * Math.hypot(dx, dy) * SPACING);
      swim[x] = Math.min(swim[x]!, band.insideSwim[i]! / c.units);
    }
  }
  backwardDijkstra(band, length, band.hopLength, c.units);
  backwardDijkstra(band, swim, band.hopSwim, c.units);
  return { length, swim };
}

function backwardDijkstra(band: CoarseBand, dist: Float64Array, weights: Uint16Array, units: number) {
  const heap = new Heap();
  for (let x = 0; x < dist.length; x++) if (dist[x]! < Infinity) heap.push(x, dist[x]!);
  for (let e = heap.pop(); e; e = heap.pop()) {
    const { id: y, cost: d } = e;
    if (d > dist[y]!) continue;
    for (let i = band.hopStart[y]!; i < band.hopStart[y + 1]!; i++) {
      const x = band.hopFrom[i]!;
      const next = d + weights[i]! / units;
      if (next < dist[x]!) {
        dist[x] = next;
        heap.push(x, next);
      }
    }
  }
}

const KEPT_BOUNDS = 128;

export interface CoarseLayer {
  coarse: Coarse;
  /** The band that serves slope limit `maxSlope`; undefined above the steepest band. */
  band(maxSlope: number): CoarseBand | undefined;
  /** Whether no node of `from` (node keys) has a route to a node of `to` in `band`. False when a node has no region. */
  separated(band: CoarseBand, from: readonly number[], to: readonly number[]): boolean;
  /** The bounds to the nodes `to`, kept for later calls. */
  toward(band: CoarseBand, to: readonly number[]): CoarseBounds;
  /**
   * A lower bound in seconds on a ground leg from the nodes `from` with the
   * bounds `to`, in `mode` with `swimming`: Infinity when no leg exists,
   * undefined when a node has no region.
   */
  seconds(to: CoarseBounds, from: readonly number[], request: Pick<LegRequest, "mode" | "swimming">): number | undefined;
  /** Whether the layer proves that no ground leg with `request` goes from a node of `from` to a node of `to`. */
  unreachable(from: readonly number[], to: readonly number[], request: Pick<LegRequest, "maxSlope" | "mode" | "swimming">): boolean;
}

function coarseLayer(coarse: Coarse): CoarseLayer {
  const kept = new Map<string, CoarseBounds>();
  const regions = (keys: readonly number[]) => {
    const out = keys.map((key) => regionOf(coarse, key));
    return out.every((r) => r >= 0) ? out : undefined;
  };
  const layer: CoarseLayer = {
    coarse,
    band: (maxSlope) => coarse.bands.find((b) => maxSlope <= b.maxSlope),
    separated(band, from, to) {
      const [a, b] = [regions(from), regions(to)];
      if (!a?.length || !b?.length) return false;
      const ends = new Set(b.map((r) => band.component[r]));
      return !a.some((r) => ends.has(band.component[r]));
    },
    toward(band, to) {
      const key = `${band.maxSlope} ${to.join()}`;
      const bounds = kept.get(key) ?? boundsTo(coarse, band, to);
      kept.delete(key);
      keepNewest(kept, key, bounds, KEPT_BOUNDS);
      return bounds;
    },
    seconds(to, from, { mode, swimming }) {
      const sources = regions(from);
      if (!sources?.length) return undefined;
      const swim = swimming.enabled ? swimming.speed : 0;
      const fastest = Math.max(mode.speed, swim);
      const swimPenaltyPerYard = swim > 0 ? Math.max(0, 1 / swim - 1 / mode.speed) : Infinity;
      let least = Infinity;
      for (const r of sources) {
        const length = to.length[r]!,
          swimLength = to.swim[r]!;
        if (length === Infinity) continue;
        least = Math.min(least, length / fastest + (swimLength > 0 ? swimLength * swimPenaltyPerYard : 0));
      }
      return least;
    },
    unreachable(from, to, request) {
      const band = layer.band(request.maxSlope);
      return !!band && (layer.separated(band, from, to) || layer.seconds(layer.toward(band, to), from, request) === Infinity);
    },
  };
  return layer;
}

/**
 * The layer treats a tile that is not present as closed ground, but a route
 * can cross a `missing` tile. So an artifact with a `missing` tile has no
 * layer. A layer that cannot be read is left out with a warning, and routing
 * uses the straight-line bounds.
 */
export async function loadCoarse(artifact: Pick<RoutingArtifact, "manifest" | "read">): Promise<CoarseLayer | undefined> {
  const { manifest } = artifact;
  if (!manifest.assets.some((a) => a.path === COARSE_PATH)) return undefined;
  try {
    if (manifest.tiles.some((t) => t.state === "missing")) fail("expected no missing tiles: a route can cross one");
    const coarse = decodeCoarse(await artifact.read(COARSE_PATH));
    const [cols, rows] = manifest.frame.size;
    if (coarse.columns !== Math.ceil((cols * CELLS) / coarse.size) || coarse.rows !== Math.ceil((rows * CELLS) / coarse.size))
      fail("expected supercells that cover the frame");
    if (coarse.ground !== (await groundHash(manifest))) fail("expected the ground hash of the tiles and floor tiles");
    return coarseLayer(coarse);
  } catch (error) {
    console.warn(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}
