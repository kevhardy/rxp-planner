// A copy of the data producer's floor tile codec. The format is the floor tile
// section of its routing artifact format. Keep the decoder checks the same
// as the producer's.

import { fail, floorPath, type RoutingArtifact, type Tile } from "./artifact.ts";

const MAGIC = "RXRF";
const VERSION = 3;
const HEADER = 20;
const TILE_CELLS = 128;
const CHUNK_CELLS = 8;
const TILE_UNITS = 8192;
const MAX_TARGETS = 40;
const MAX_FLOORS = 16;
/** Mask bit 15: the swim node of the target cell. */
export const SWIM = 0x8000;
/** Cell offsets of the sides W, S, E, N, in the bit order of the side bits. */
export const SIDES: readonly Tile[] = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];

/**
 * A point relative to the north-west corner of the tile: x and y in 1/16
 * native pixel, z in 1/8 yd.
 */
export type FloorPoint = [number, number, number];
export interface FloorLayer {
  /** Height in 1/8 yd. */
  height: number;
  /** Walk links, bits 0 to 3: W, S, E, N. */
  walk: number;
  /** Drop links to side cells, bits 0 to 3: W, S, E, N. */
  drop: number;
  /** The layer joins the swim node of its cell. */
  water: boolean;
  /** A drop to a lower layer or to the swim node of the same cell. */
  fall: boolean;
  /** The layer stands in magma or slime. Only a water layer can set it. */
  hazard: boolean;
  /**
   * A descent layer: steep terrain at the cell center, alone in its cell,
   * without links or water. The planner joins it by its downhill rule.
   */
  descent: boolean;
  /**
   * One target mask for each walk bit, then each drop bit, then `fall`.
   * Absent when each link goes to layer 0 of its target cell.
   */
  masks?: number[];
  /** One drop height byte for each drop bit, then `fall`. See `dropByte`. */
  drops: number[];
}
export interface FloorCell {
  /** In ascending height. Equal heights keep their stored order. */
  layers: FloorLayer[];
  /** The surface height of the swim node in 1/8 yd. Absent: no swim node. */
  surface?: number;
  /**
   * The cell is in a building footprint. Its layers are outdoor ground
   * layers, and it has no swim node.
   */
  building: boolean;
  /** The swim node is magma or slime. Only a cell with a swim node can set it. */
  hazard: boolean;
}
export interface FloorChunk {
  /** Chunk column and row in the tile, 0 to 15. */
  chunk: Tile;
  /** 64 cells in row order: cell `y * 8 + x`. */
  cells: FloorCell[];
}
export interface Door {
  /** The tile of the attach cell, from this tile: -1 to 1. */
  tile: Tile;
  /** The attach cell, `row * 128 + column`. */
  cell: number;
  /** The attach layer; 0 for a terrain cell. */
  layer: number;
  /** The middle of the walkable part of the portal. */
  point: FloorPoint;
}
export interface Target {
  /** The dataset point, x and y in 1/16 native pixel. */
  point: Tile;
  /** The floor index; 255 for kind 1. */
  floor: number;
  /** 0: the spawn z matched the floor. 1: fallback. */
  kind: 0 | 1;
}
export interface Building {
  /** The WMO placement uniqueId. */
  placement: number;
  /** The footprint box x0, y0, x1, y1 in 1/16 native pixel. */
  box: [number, number, number, number];
  /** The index of the ground floor. */
  ground: number;
  /** Floor heights in 1/8 yd, ascending. */
  floors: number[];
  doors: Door[];
  targets: Target[];
  /**
   * For each door, for each target; then for each target pair i < j, from
   * target i to target j; then for each door pair i < j, from door i to
   * door j. An empty path means that no path exists.
   */
  paths: FloorPoint[][];
}
export interface DoorRef {
  /** The tile that holds the building, from this tile. */
  home: Tile;
  building: number;
  door: number;
}
export interface FloorTile {
  tile: Tile;
  /** In row order, then column order. */
  chunks: FloorChunk[];
  /** In wire order (`buildingOrder`). */
  buildings: Building[];
  doorRefs: DoorRef[];
  /** Endpoint hints: points outside buildings on cells with 2 or more layers. */
  hints: FloorPoint[];
}

/**
 * The drop height byte of a drop in 1/8 yd: 0.5 yd steps, rounded up, with
 * 255 for 127.5 yd or more. A drop into swim-deep water stores 0 instead.
 */
export function dropByte(drop: number): number {
  if (!Number.isInteger(drop) || drop < 0) fail("drop", `expected an integer of at least 0, found ${drop}`);
  return Math.min(255, Math.ceil(drop / 4));
}

const bits = (n: number) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1);
const pathCount = (doors: number, targets: number) => doors * targets + (targets * (targets - 1)) / 2 + (doors * (doors - 1)) / 2;

export function encodeFloor(tile: FloorTile): Uint8Array {
  const path = floorPath(tile.tile);
  const out = writer(path);
  out.text(MAGIC);
  out.u16(VERSION);
  out.u16(tile.tile[0]);
  out.u16(tile.tile[1]);
  out.u16(tile.chunks.length);
  out.u16(tile.buildings.length);
  out.u16(tile.doorRefs.length);
  out.u16(tile.hints.length);
  out.u16(0);
  const chunks = tile.chunks.map((c, i) => {
    const where = `${path} chunk ${i}`;
    if (c.cells.length !== 64) fail(where, "expected 64 cells");
    const w = writer(where);
    for (const cell of c.cells) {
      if (cell.layers.length > 15) fail(where, "expected at most 15 layers in a cell");
      w.u8(cell.layers.length | (cell.surface === undefined ? 0 : 0x10) | (cell.building ? 0x20 : 0) | (cell.hazard ? 0x40 : 0));
      for (const l of cell.layers) {
        const side = (v: number) => Number.isInteger(v) && v >= 0 && v <= 15;
        if (!side(l.walk) || !side(l.drop)) fail(where, "expected walk links and drop links from 0 to 15");
        const links = bits(l.walk) + bits(l.drop) + (l.fall ? 1 : 0);
        if (l.masks && l.masks.length !== links) fail(where, "expected one mask for each link");
        if (l.drops.length !== bits(l.drop) + (l.fall ? 1 : 0)) fail(where, "expected one drop height for each drop link");
        w.i16(l.height);
        w.u8(l.walk | (l.drop << 4));
        w.u8((l.water ? 1 : 0) | (l.fall ? 2 : 0) | (l.masks ? 4 : 0) | (l.hazard ? 8 : 0) | (l.descent ? 0x10 : 0));
        for (const m of l.masks ?? []) w.u16(m);
        for (const d of l.drops) w.u8(d);
      }
      if (cell.surface !== undefined) w.i16(cell.surface);
    }
    return w.bytes;
  });
  for (const [i, c] of tile.chunks.entries()) {
    out.u8(c.chunk[0]);
    out.u8(c.chunk[1]);
    out.u16(chunks[i]?.length ?? 0);
  }
  for (const c of chunks) out.bytes.push(...c);
  for (const [i, b] of tile.buildings.entries()) {
    if (b.paths.length !== pathCount(b.doors.length, b.targets.length))
      fail(`${path} building ${i}`, "expected one path for each door and target, then for each target pair, then for each door pair");
    out.u32(b.placement);
    for (const v of b.box) out.i16(v);
    out.u8(b.doors.length);
    out.u8(b.floors.length);
    out.u8(b.ground);
    out.u8(0);
    out.u16(b.targets.length);
    for (const f of b.floors) out.i16(f);
    for (const d of b.doors) {
      out.i8(d.tile[0]);
      out.i8(d.tile[1]);
      out.u16(d.cell);
      out.u8(d.layer);
      out.u8(0);
      out.point(d.point);
    }
    for (const t of b.targets) {
      out.i16(t.point[0]);
      out.i16(t.point[1]);
      out.u8(t.floor);
      out.u8(t.kind);
    }
    for (const p of b.paths) {
      out.u8(p.length);
      for (const q of p) out.point(q);
    }
  }
  for (const r of tile.doorRefs) {
    out.i8(r.home[0]);
    out.i8(r.home[1]);
    out.u16(r.building);
    out.u8(r.door);
    out.u8(0);
  }
  for (const h of tile.hints) out.point(h);
  const bytes = Uint8Array.from(out.bytes);
  decodeFloor(bytes, tile.tile);
  return bytes;
}

/** Links into other tiles stay unchecked. */
export function decodeFloor(bytes: Uint8Array, expected: Tile): FloorTile {
  const path = floorPath(expected);
  const r = reader(bytes, path);
  if (bytes.length < HEADER) fail(path, `expected at least ${HEADER} bytes`);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) fail(path, `expected the magic bytes ${MAGIC}`);
  r.skip(4);
  if (r.u16() !== VERSION) fail(path, `expected version ${VERSION}`);
  const tile: Tile = [r.u16(), r.u16()];
  if (tile.join() !== expected.join()) fail(path, `holds tile ${tile.join("_")}`);
  const chunkCount = r.u16(),
    buildingCount = r.u16(),
    refCount = r.u16(),
    hintCount = r.u16();
  if (r.u16() !== 0) fail(path, "expected zero padding");
  if (chunkCount > 256) fail(path, "expected at most 256 chunks");

  const index: { chunk: Tile; length: number }[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk: Tile = [r.u8(), r.u8()];
    if (chunk[0] > 15 || chunk[1] > 15) fail(`${path} chunk ${i}`, "expected a chunk from 0 to 15");
    const previous = index.at(-1)?.chunk;
    if (previous && order(rc(previous), rc(chunk)) >= 0)
      fail(`${path} chunk ${i}`, "expected chunks in row order, then column order, without repeats");
    index.push({ chunk, length: r.u16() });
  }
  const chunks: FloorChunk[] = [];
  for (const [i, { chunk, length }] of index.entries()) {
    const start = r.at();
    const cells: FloorCell[] = [];
    for (let c = 0; c < 64; c++) {
      const where = `${path} chunk ${i} cell ${c}`;
      const head = r.u8();
      if (head & 0x80) fail(where, "expected head bit 7 zero");
      const count = head & 0x0f;
      const building = (head & 0x20) !== 0;
      const hazard = (head & 0x40) !== 0;
      if (building && head & 0x10) fail(where, "expected no swim node in a building cell");
      if (hazard && !(head & 0x10)) fail(where, "hazard swim node without a swim node");
      const layers: FloorLayer[] = [];
      for (let l = 0; l < count; l++) {
        const at = `${where} layer ${l}`;
        const height = r.i16();
        if (layers.length && height < (layers.at(-1)?.height ?? 0)) fail(at, "expected layers in ascending height");
        const sides = r.u8(),
          flags = r.u8();
        if (flags & 0xe0) fail(at, "expected flag bits 5 to 7 zero");
        const layer: FloorLayer = {
          height,
          walk: sides & 0x0f,
          drop: sides >> 4,
          water: (flags & 1) !== 0,
          fall: (flags & 2) !== 0,
          hazard: (flags & 8) !== 0,
          descent: (flags & 0x10) !== 0,
          drops: [],
        };
        if (layer.descent && (sides || flags & 0x0f)) fail(at, "expected a descent layer without links, water, or masks");
        if (layer.water && !(head & 0x10)) fail(at, "water layer without a swim node");
        if (layer.hazard && !layer.water) fail(at, "hazard layer that is not a water layer");
        const drops = bits(layer.drop) + (layer.fall ? 1 : 0);
        if (flags & 4) {
          const links = bits(layer.walk) + drops;
          layer.masks = Array.from({ length: links }, () => r.u16());
        }
        layer.drops = Array.from({ length: drops }, () => r.u8());
        layers.push(layer);
      }
      if (count > 1 && layers.some((l) => l.descent)) fail(where, "expected a descent layer alone in its cell");
      const cell: FloorCell = { layers, building, hazard };
      if (head & 0x10) cell.surface = r.i16();
      cells.push(cell);
    }
    if (r.at() - start !== length) fail(`${path} chunk ${i}`, `expected ${length} bytes, found ${r.at() - start}`);
    chunks.push({ chunk, cells });
  }

  const byChunk = new Map(chunks.map((c) => [c.chunk[1] * 16 + c.chunk[0], c]));
  const inTile = (x: number, y: number) => x >= 0 && y >= 0 && x < TILE_CELLS && y < TILE_CELLS;
  /** Undefined for a cell of this tile that uses the terrain rule. */
  const floorCellAt = (x: number, y: number) => byChunk.get((y >> 3) * 16 + (x >> 3))?.cells[(y & 7) * CHUNK_CELLS + (x & 7)];
  for (const [i, { chunk, cells }] of chunks.entries())
    for (const [c, cell] of cells.entries())
      for (const [l, layer] of cell.layers.entries()) {
        const at = `${path} chunk ${i} cell ${c} layer ${l}`;
        const x = chunk[0] * CHUNK_CELLS + (c & 7),
          y = chunk[1] * CHUNK_CELLS + (c >> 3);
        const links: { side: Tile; walk: boolean }[] = [];
        for (const [s, side] of SIDES.entries()) if (layer.walk & (1 << s)) links.push({ side, walk: true });
        for (const [s, side] of SIDES.entries()) if (layer.drop & (1 << s)) links.push({ side, walk: false });
        if (layer.fall) links.push({ side: [0, 0], walk: false });
        for (const [j, { side, walk }] of links.entries()) {
          const mask = layer.masks ? (layer.masks[j] ?? 0) : 1;
          if (!mask) fail(at, "empty mask");
          if (walk && mask & SWIM) fail(at, "swim target on a walk link");
          // Drop heights follow the drop links only, so skip the walk links.
          const drop = walk ? 0 : layer.drops[j - bits(layer.walk)];
          if (mask & SWIM && drop) fail(at, "swim target with a drop height other than 0");
          if (!inTile(x + side[0], y + side[1])) continue;
          const target = floorCellAt(x + side[0], y + side[1]);
          if (target && !layer.masks && !target.layers.length) fail(at, "link without masks into a cell without layers");
          if (target && mask & SWIM && target.surface === undefined) fail(at, "swim target without water");
          const count = target ? target.layers.length : 1;
          const top = 31 - Math.clz32(mask & ~SWIM);
          if (top >= count) fail(at, `mask bit ${top} at or above the layer count ${count} of the target cell`);
        }
      }

  const inReach = (v: number) => v >= -TILE_UNITS && v <= 2 * TILE_UNITS;
  const buildings: Building[] = [];
  for (let b = 0; b < buildingCount; b++) {
    const where = `${path} building ${b}`;
    const placement = r.u32();
    const box: Building["box"] = [r.i16(), r.i16(), r.i16(), r.i16()];
    if (!box.every(inReach)) fail(where, "expected the box at most 1 tile from this tile");
    const [x0, y0, x1, y1] = box;
    if (x0 + x1 < 0 || x0 + x1 >= 2 * TILE_UNITS || y0 + y1 < 0 || y0 + y1 >= 2 * TILE_UNITS)
      fail(where, "expected the middle of the box in this tile");
    const doorCount = r.u8(),
      floorCount = r.u8(),
      ground = r.u8();
    if (r.u8() !== 0) fail(where, "expected zero padding");
    const targetCount = r.u16();
    if (!doorCount) fail(where, "expected at least 1 door");
    if (!floorCount || floorCount > MAX_FLOORS) fail(where, `expected 1 to ${MAX_FLOORS} floors`);
    if (ground >= floorCount) fail(where, "expected the ground floor in the floors");
    if (targetCount > MAX_TARGETS) fail(where, `expected at most ${MAX_TARGETS} targets`);
    const floors: number[] = [];
    for (let f = 0; f < floorCount; f++) {
      floors.push(r.i16());
      if (f && order([floors[f - 1] ?? 0], [floors[f] ?? 0]) >= 0)
        fail(`${where} floor ${f}`, "expected ascending floor heights, without repeats");
    }
    const doors: Door[] = [];
    for (let d = 0; d < doorCount; d++) {
      const at = `${where} door ${d}`;
      const door: Door = {
        tile: [r.i8(), r.i8()],
        cell: r.u16(),
        layer: r.u8(),
        point: [0, 0, 0],
      };
      if (r.u8() !== 0) fail(at, "expected zero padding");
      door.point = r.point();
      if (Math.abs(door.tile[0]) > 1 || Math.abs(door.tile[1]) > 1) fail(at, "expected an attach tile from -1 to 1");
      if (door.cell >= TILE_CELLS * TILE_CELLS) fail(at, `expected an attach cell below ${TILE_CELLS * TILE_CELLS}`);
      if (!inReach(door.point[0]) || !inReach(door.point[1])) fail(at, "expected the door point at most 1 tile from this tile");
      if (!door.tile[0] && !door.tile[1]) {
        const target = floorCellAt(door.cell % TILE_CELLS, Math.floor(door.cell / TILE_CELLS));
        if (door.layer >= (target ? target.layers.length : 1)) fail(at, "expected an attach layer of the attach cell");
        if (target?.building) fail(at, "expected an attach cell that is not a building cell");
      }
      const previous = doors.at(-1);
      if (previous && order(doorKey(previous), doorKey(door)) >= 0) fail(at, "expected doors in wire order, without repeats");
      doors.push(door);
    }
    const targets: Target[] = [];
    for (let t = 0; t < targetCount; t++) {
      const at = `${where} target ${t}`;
      const point: Tile = [r.i16(), r.i16()];
      const floor = r.u8(),
        kind = r.u8();
      if (kind !== 0 && kind !== 1) fail(at, "expected kind 0 or 1");
      if (kind === 0 ? floor >= floorCount : floor !== 255) fail(at, "expected a floor index for kind 0, or 255 for kind 1");
      if (!inReach(point[0]) || !inReach(point[1])) fail(at, "expected the point at most 1 tile from this tile");
      const target: Target = { point, floor, kind };
      const previous = targets.at(-1);
      if (previous && order(targetKey(previous), targetKey(target)) >= 0) fail(at, "expected targets in wire order, without repeats");
      targets.push(target);
    }
    // A null start is a target of kind 1, so its path must be empty.
    const ends: { start: FloorPoint | null; end: Target | Door }[] = [];
    for (const door of doors) for (const end of targets) ends.push({ start: door.point, end });
    for (const [i, from] of targets.entries())
      for (const end of targets.slice(i + 1))
        ends.push({
          start: from.kind || end.kind ? null : [...from.point, floors[from.floor] ?? 0],
          end,
        });
    for (const [i, from] of doors.entries()) for (const end of doors.slice(i + 1)) ends.push({ start: from.point, end });
    const paths: FloorPoint[][] = [];
    for (const [p, { start, end }] of ends.entries()) {
      const at = `${where} path ${p}`;
      const count = r.u8();
      if (count === 1) fail(at, "expected 0 or 2 to 255 points");
      const points = Array.from({ length: count }, () => r.point());
      paths.push(points);
      if (!count) continue;
      if (!start) fail(at, "expected no path to a target of kind 1");
      if (points[0]?.join() !== start.join()) fail(at, "expected the door point or the start target first");
      const last = points.at(-1) ?? [0, 0, 0];
      if ("cell" in end) {
        if (last.join() !== end.point.join()) fail(at, "expected the end door point last");
      } else if (
        last[0] !== end.point[0] ||
        last[1] !== end.point[1] ||
        (end.kind === 0 ? last[2] !== floors[end.floor] : !floors.includes(last[2]))
      )
        fail(at, "expected the end target at the height of its floor last");
    }
    const previous = buildings.at(-1);
    if (previous && buildingOrder(previous, { placement, box, doors }) >= 0)
      fail(where, "expected buildings in wire order, without repeats");
    buildings.push({ placement, box, ground, floors, doors, targets, paths });
  }

  const doorRefs: DoorRef[] = [];
  for (let i = 0; i < refCount; i++) {
    const at = `${path} door reference ${i}`;
    const ref: DoorRef = {
      home: [r.i8(), r.i8()],
      building: r.u16(),
      door: r.u8(),
    };
    if (r.u8() !== 0) fail(at, "expected zero padding");
    const [dx, dy] = ref.home;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (!dx && !dy)) fail(at, "expected a home tile from -1 to 1, other than this tile");
    const previous = doorRefs.at(-1);
    if (previous && order(refKey(previous), refKey(ref)) >= 0) fail(at, "expected door references in wire order, without repeats");
    doorRefs.push(ref);
  }

  const hints: FloorPoint[] = [];
  for (let i = 0; i < hintCount; i++) {
    const at = `${path} hint ${i}`;
    const hint = r.point();
    const [x, y] = [hint[0] >> 6, hint[1] >> 6];
    const cell = inTile(x, y) ? floorCellAt(x, y) : undefined;
    if (!cell || cell.layers.length < 2) fail(at, "expected a cell of this tile with 2 or more layers");
    const previous = hints.at(-1);
    if (previous && order(hintKey(previous), hintKey(hint)) >= 0) fail(at, "expected hints in wire order, without repeats");
    hints.push(hint);
  }
  if (r.at() !== bytes.length) fail(path, `expected the file to end after the last hint, at byte ${r.at()}`);
  return { tile, chunks, buildings, doorRefs, hints };
}

/** A tile without a floor tile uses the terrain rule in all its cells. */
export async function readFloor(artifact: Pick<RoutingArtifact, "manifest" | "read">, tile: Tile): Promise<FloorTile | undefined> {
  const path = floorPath(tile);
  if (!artifact.manifest.assets.some((a) => a.path === path)) return undefined;
  return decodeFloor(await artifact.read(path), tile);
}

function order(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
const rc = ([column, row]: Tile) => [row, column];
const buildingKey = ({ placement, box: [x0, y0, x1, y1] }: Pick<Building, "placement" | "box">) => [placement, y0, x0, y1, x1];
/** One placement can have several buildings in a tile with the same box, so the doors break the tie. */
function buildingOrder(a: Pick<Building, "placement" | "box" | "doors">, b: Pick<Building, "placement" | "box" | "doors">): number {
  const head = order(buildingKey(a), buildingKey(b));
  if (head) return head;
  for (let i = 0; i < Math.min(a.doors.length, b.doors.length); i++) {
    const d = order(doorKey(a.doors[i] as Door), doorKey(b.doors[i] as Door));
    if (d) return d;
  }
  return a.doors.length - b.doors.length;
}
const doorKey = (d: Door) => [d.point[1], d.point[0], d.point[2], d.tile[1], d.tile[0], d.cell, d.layer];
const targetKey = (t: Target) => [t.point[1], t.point[0], t.floor, t.kind];
const refKey = (r: DoorRef) => [r.home[1], r.home[0], r.building, r.door];
const hintKey = ([x, y, z]: FloorPoint) => [y, x, z];

function reader(bytes: Uint8Array, path: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const take = (size: number) => {
    if (at + size > bytes.length) fail(path, `expected more bytes after byte ${at}`);
    const start = at;
    at += size;
    return start;
  };
  const r = {
    at: () => at,
    skip: (size: number) => void take(size),
    u8: () => view.getUint8(take(1)),
    i8: () => view.getInt8(take(1)),
    u16: () => view.getUint16(take(2), true),
    i16: () => view.getInt16(take(2), true),
    u32: () => view.getUint32(take(4), true),
    point: (): FloorPoint => [r.i16(), r.i16(), r.i16()],
  };
  return r;
}

function writer(path: string) {
  const bytes: number[] = [];
  const int = (type: string, min: number, max: number, size: number) => (v: number) => {
    if (!Number.isInteger(v) || v < min || v > max) fail(path, `cannot store ${v} as ${type}`);
    for (let i = 0; i < size; i++) bytes.push(Math.floor(v / 256 ** i) & 0xff);
  };
  const w = {
    bytes,
    text: (s: string) => bytes.push(...new TextEncoder().encode(s)),
    u8: int("u8", 0, 0xff, 1),
    i8: int("i8", -0x80, 0x7f, 1),
    u16: int("u16", 0, 0xffff, 2),
    i16: int("i16", -0x8000, 0x7fff, 2),
    u32: int("u32", 0, 0xffff_ffff, 4),
    point: (p: FloorPoint) => {
      for (const v of p) w.i16(v);
    },
  };
  return w;
}
