// The checks and tile codec match the routing format in the pinned dataset release.
// Hashes use WebCrypto so the browser and Node installer share this module.

import type { InstanceId, UiMapId } from "../data/index.ts";
import { count, fail, fields, list } from "./shape.ts";

const ARTIFACT_SCHEMA = "restedxp-routing-artifact";
export const TILE_PIXELS = 512;
export const CELLS = 128;
const VERTICES = CELLS + 1;
export const TILE_WORLD_UNITS = 1600 / 3;
/** Chunks of 8 × 8 cells in one tile: 16 × 16. */
export const CHUNKS = 256;
const MAX_ZONES = 255;
export const ZONES_PATH = "zones.bin";
export const COARSE_PATH = "coarse.bin";

/** Tile [x, y] of the frame, from its origin. */
export type Tile = [number, number];
/** Where native pixel [0, 0] is. */
interface Frame {
  /** The first ADT tile column and row of the map. */
  origin: Tile;
  size: Tile;
  tilePixels: 512;
  cellsPerTile: 128;
  tileWorldUnits: number;
}
interface TileCoverage {
  tile: Tile;
  /** `present` has a tile asset; `missing` has terrain upstream but not here. A tile that is not listed has no ground. */
  state: "present" | "missing";
}
export interface Asset {
  path: string;
  bytes: number;
  /** Lowercase hex. */
  sha256: string;
}
/** The input files of the floor build, for provenance only. */
interface FloorInputs {
  dataset: { path: string; sha256: string };
  spawns: { path: string; sha256: string };
  liquidTypes: { path: string; sha256: string };
}
const FLOOR_INPUTS = ["dataset", "spawns", "liquidTypes"] as const;
/** The producer's variant, build, and map of an artifact. The ID hashes it; the planner compares only the map. */
export interface ArtifactScope {
  variant: string;
  build: string;
  map: InstanceId;
}
export interface ArtifactManifest {
  schema: typeof ARTIFACT_SCHEMA;
  version: 4;
  id: string;
  scope: ArtifactScope;
  frame: Frame;
  tiles: TileCoverage[];
  /** Zone UiMap IDs, ascending. Zone index i of `zones.bin` is `zones[i - 1]`. */
  zones: UiMapId[];
  assets: Asset[];
  floors?: FloorInputs;
  /** One climb of the floor model, in yards. Present exactly when `floors` is. */
  floorClimb?: number;
}
export type ManifestBody = Omit<ArtifactManifest, "id">;

const HAZARDS = ["water", "magma", "slime", "unknown"] as const;
export type Hazard = (typeof HAZARDS)[number];
/** One liquid surface over one chunk of 8 × 8 cells. */
export interface LiquidChunk {
  /** Chunk column and row in the tile, 0 to 15. */
  chunk: [number, number];
  /** LiquidType ID. */
  type: number;
  /** Surface height in world units, as float64. */
  surface: number;
  /** Bit y * 8 + x covers cell (x, y) of the chunk. */
  mask: bigint;
  hazard: Hazard;
}
export interface HeightTile {
  tile: Tile;
  offset: number;
  scale: number;
  /** 129 × 129 vertices, row by row from the north-west corner. */
  heights: Uint16Array;
  /** 128 × 128 cells, row by row; 1 marks a hole. */
  holes: Uint8Array;
  /** At most one for each chunk, in row order, then column order. */
  liquids: LiquidChunk[];
}

export const BUNDLE_SCHEMA = "rxp-planner-release-bundle";

/** One routing artifact of the release file. `manifestSha256` is lowercase hex, as `sha256Hex` gives. */
export interface RoutingPin {
  map: InstanceId;
  id: string;
  manifestSha256: string;
}

const MAGIC = "RXRT";
const HEADER = 32;
const HOLES = HEADER + VERTICES * VERTICES * 2;
const LIQUIDS = HOLES + (CELLS * CELLS) / 8;
const LIQUID_BYTES = 24;
const ZONES_MAGIC = "RXRZ";
const ZONES_HEADER = 8;
const FILES = [COARSE_PATH, "coverage.json", "observations.json", ZONES_PATH];

export const tilePath = ([x, y]: Tile) => `tiles/${x}_${y}.bin`;
export const floorPath = ([x, y]: Tile) => `floors/${x}_${y}.bin`;

/** Height in world units of vertex (col, row). */
export const heightAt = (tile: HeightTile, col: number, row: number) =>
  tile.offset + tile.scale * (tile.heights[row * VERTICES + col] ?? Number.NaN);

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const scopeName = (s: ArtifactScope) => `${s.variant} ${s.build} map ${s.map}`;

/** Throws unless `value` is a bundle.json that this planner can read. Gives its routing artifacts, in its order. */
export function parseBundleRouting(value: unknown): RoutingPin[] {
  const root = fields(value, "bundle", ["schema", "format", "version", "dataset", "routing"], ["routingBuild"]);
  if (root.schema !== BUNDLE_SCHEMA) fail("bundle.schema", `expected ${BUNDLE_SCHEMA}`);
  if (root.format !== 1) fail("bundle.format", "expected 1");
  const maps = new Set<number>();
  return list(root.routing, "bundle.routing").map((entry, i) => {
    const path = `bundle.routing[${i}]`;
    const r = fields(entry, path, ["map", "path", "id", "manifestSha256"]);
    const map = count(r.map, `${path}.map`, 0);
    if (maps.has(map)) fail(`${path}.map`, `expected one artifact for map ${map}`);
    maps.add(map);
    if (r.path !== `routing/m${map}`) fail(`${path}.path`, `expected routing/m${map}`);
    if (typeof r.id !== "string" || !r.id) fail(`${path}.id`, "expected text");
    if (typeof r.manifestSha256 !== "string" || !r.manifestSha256.startsWith("sha256:")) fail(`${path}.manifestSha256`, "expected sha256:");
    const manifestSha256 = sha256(r.manifestSha256.slice(7), `${path}.manifestSha256`);
    return { map, id: r.id, manifestSha256 };
  });
}

/** Follows the data producer's manifest parser. */
export function parseManifest(value: unknown): ArtifactManifest {
  if (isRecord(value) && value.version !== 4) fail("manifest.version", "expected 4");
  const root = fields(
    value,
    "manifest",
    ["schema", "version", "id", "scope", "frame", "tiles", "zones", "assets"],
    ["floors", "floorClimb"],
  );
  if (root.schema !== ARTIFACT_SCHEMA) fail("manifest.schema", `expected ${ARTIFACT_SCHEMA}`);
  const scope = parseScope(root.scope, "manifest.scope");
  const prefix = `routing-${scope.variant}-${scope.build}-m${scope.map}-`;
  if (typeof root.id !== "string" || !root.id.startsWith(prefix) || !/^[0-9a-f]{16}$/.test(root.id.slice(prefix.length)))
    fail("manifest.id", `expected ${prefix} and 16 hex digits`);
  const f = fields(root.frame, "manifest.frame", ["origin", "size", "tilePixels", "cellsPerTile", "tileWorldUnits"]);
  const origin = pair(f.origin, "manifest.frame.origin", 0, 63);
  const size = pair(f.size, "manifest.frame.size", 1, 64);
  if (origin[0] + size[0] > 64 || origin[1] + size[1] > 64) fail("manifest.frame.size", "expected the frame inside the 64 × 64 map");
  if (f.tilePixels !== TILE_PIXELS) fail("manifest.frame.tilePixels", `expected ${TILE_PIXELS}`);
  if (f.cellsPerTile !== CELLS) fail("manifest.frame.cellsPerTile", `expected ${CELLS}`);
  if (f.tileWorldUnits !== TILE_WORLD_UNITS) fail("manifest.frame.tileWorldUnits", `expected ${TILE_WORLD_UNITS}`);
  const present = new Set<string>();
  const floors = new Set<string>();
  let last = -1;
  for (const [i, value] of list(root.tiles, "manifest.tiles").entries()) {
    const path = `manifest.tiles[${i}]`;
    const t = fields(value, path, ["tile", "state"]);
    const [x, y] = pair(t.tile, `${path}.tile`, 0, 63);
    if (x >= size[0] || y >= size[1]) fail(`${path}.tile`, "expected a tile inside the frame");
    if (y * 64 + x <= last) fail(`${path}.tile`, "expected tiles in row order, then column order");
    last = y * 64 + x;
    if (t.state !== "present" && t.state !== "missing") fail(`${path}.state`, "expected one of present, missing");
    if (t.state !== "present") continue;
    present.add(tilePath([x, y]));
    floors.add(floorPath([x, y]));
  }
  let lastZone = 0;
  for (const [i, zone] of list(root.zones, "manifest.zones", MAX_ZONES).entries()) {
    if (count(zone, `manifest.zones[${i}]`, 1) <= lastZone) fail(`manifest.zones[${i}]`, "expected ascending, distinct UiMap IDs");
    lastZone = zone as number;
  }
  let lastPath = "";
  let floorAssets = 0;
  for (const [i, value] of list(root.assets, "manifest.assets").entries()) {
    const path = `manifest.assets[${i}]`;
    const a = fields(value, path, ["path", "bytes", "sha256"]);
    if (typeof a.path !== "string" || a.path <= lastPath) fail(`${path}.path`, "expected ascending, distinct paths");
    if (floors.has(a.path)) floorAssets++;
    else if (!FILES.includes(a.path) && !present.delete(a.path))
      fail(`${path}.path`, "expected a JSON file, a present tile, or the floor tile of a present tile");
    lastPath = a.path;
    count(a.bytes, `${path}.bytes`, 1);
    sha256(a.sha256, `${path}.sha256`);
  }
  const [missing] = present;
  if (missing) fail("manifest.assets", `missing ${missing}`);
  if (!(root.assets as Asset[]).some((a) => a.path === ZONES_PATH)) fail("manifest.assets", `missing ${ZONES_PATH}`);
  if (!floorAssets !== !("floors" in root)) fail("manifest.floors", floorAssets ? "missing" : "expected only with floor assets");
  if ("floors" in root) {
    const inputs = fields(root.floors, "manifest.floors", [...FLOOR_INPUTS]);
    for (const name of FLOOR_INPUTS) {
      const input = fields(inputs[name], `manifest.floors.${name}`, ["path", "sha256"]);
      if (typeof input.path !== "string" || !input.path) fail(`manifest.floors.${name}.path`, "expected a path");
      sha256(input.sha256, `manifest.floors.${name}.sha256`);
    }
  }
  if (!floorAssets !== !("floorClimb" in root)) fail("manifest.floorClimb", floorAssets ? "missing" : "expected only with floor assets");
  if ("floorClimb" in root && !(Number.isFinite(root.floorClimb) && (root.floorClimb as number) > 0))
    fail("manifest.floorClimb", "expected a finite number above 0");
  return value as ArtifactManifest;
}

const canonicalFloors = (floors: ManifestBody["floors"]) =>
  floors ? Object.fromEntries(FLOOR_INPUTS.map((name) => [name, { path: floors[name].path, sha256: floors[name].sha256 }])) : null;

/** The ID that the manifest's scope, frame, tiles, assets, zones, `floors`, and `floorClimb` (each or null) give. */
export async function artifactId(m: ManifestBody): Promise<string> {
  const parts: unknown[] = [
    m.scope.variant,
    m.scope.build,
    m.scope.map,
    m.frame.origin,
    m.frame.size,
    m.tiles.map((t) => [...t.tile, t.state]),
    m.assets.map((a) => [a.path, a.bytes, a.sha256]),
    m.zones,
    canonicalFloors(m.floors),
    m.floorClimb ?? null,
  ];
  const hash = await sha256Hex(new TextEncoder().encode(JSON.stringify(parts)));
  return `routing-${m.scope.variant}-${m.scope.build}-m${m.scope.map}-${hash.slice(0, 16)}`;
}

async function readManifest(bytes: Uint8Array<ArrayBuffer>): Promise<ArtifactManifest> {
  const manifest = parseManifest(json(bytes, "manifest.json"));
  const { id, ...rest } = manifest;
  const expected = await artifactId(rest);
  if (id !== expected) fail("manifest.id", `expected ${expected}`);
  return manifest;
}

/** Throws unless the manifest bytes are the pinned artifact, with the ID that their content gives, for the map of `pin`. */
export async function checkManifest(bytes: Uint8Array<ArrayBuffer>, pin: RoutingPin): Promise<ArtifactManifest> {
  const hash = await sha256Hex(bytes);
  if (hash !== pin.manifestSha256) fail("manifest.json", `expected SHA-256 ${pin.manifestSha256}, found ${hash}`);
  const manifest = await readManifest(bytes);
  if (manifest.id !== pin.id) fail("manifest.id", `expected ${pin.id}`);
  if (manifest.scope.map !== pin.map) fail("manifest.scope.map", `expected ${pin.map}, found ${manifest.scope.map}`);
  return manifest;
}

/** Throws unless the bytes have the asset's size and SHA-256. */
export async function checkAsset(asset: Asset, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  if (bytes.length !== asset.bytes) fail(asset.path, `expected ${asset.bytes} bytes, found ${bytes.length}`);
  const hash = await sha256Hex(bytes);
  if (hash !== asset.sha256) fail(asset.path, `expected SHA-256 ${asset.sha256}, found ${hash}`);
}

/** Reads one tile file and checks that it is tile `expected`. */
export function decodeTile(bytes: Uint8Array, expected: Tile): HeightTile {
  const path = tilePath(expected);
  if (bytes.length < LIQUIDS) fail(path, `expected at least ${LIQUIDS} bytes`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) fail(path, `expected the magic bytes ${MAGIC}`);
  if (view.getUint16(4, true) !== 1) fail(path, "expected version 1");
  const tile: Tile = [view.getUint16(6, true), view.getUint16(8, true)];
  if (tile.join() !== expected.join()) fail(path, `holds tile ${tile.join("_")}`);
  const liquidCount = view.getUint16(10, true);
  if (view.getUint32(12, true) !== 0) fail(path, "expected zero padding");
  const offset = view.getFloat64(16, true),
    scale = view.getFloat64(24, true);
  if (!Number.isFinite(offset) || !Number.isFinite(scale) || scale < 0)
    fail(path, "expected a finite offset and a finite scale of at least 0");
  if (liquidCount > 256 || bytes.length !== LIQUIDS + liquidCount * LIQUID_BYTES)
    fail(path, `expected ${LIQUIDS} bytes and 24 for each liquid chunk`);
  const heights = new Uint16Array(VERTICES * VERTICES);
  for (let i = 0; i < heights.length; i++) heights[i] = view.getUint16(HEADER + i * 2, true);
  const holes = new Uint8Array(CELLS * CELLS);
  for (let i = 0; i < holes.length; i++) holes[i] = ((bytes[HOLES + (i >> 3)] ?? 0) >> (i & 7)) & 1;
  const liquids: LiquidChunk[] = [];
  for (let i = 0; i < liquidCount; i++) {
    const at = LIQUIDS + i * LIQUID_BYTES,
      where = `${path} liquid ${i}`;
    const cx = bytes[at] ?? 0,
      cy = bytes[at + 1] ?? 0;
    if (cx > 15 || cy > 15) fail(where, "expected a chunk from 0 to 15");
    const previous = liquids.at(-1)?.chunk;
    if (previous && previous[1] * 16 + previous[0] >= cy * 16 + cx) fail(where, "expected chunks in row order, then column order");
    const surface = view.getFloat64(at + 8, true);
    if (!Number.isFinite(surface)) fail(where, "expected a finite surface");
    const mask = view.getBigUint64(at + 16, true);
    if (!mask) fail(where, "expected at least one cell in the mask");
    const hazard = HAZARDS[bytes[at + 4] ?? 255];
    if (!hazard) fail(where, "expected a hazard class from 0 to 3");
    if (bytes[at + 5] || bytes[at + 6] || bytes[at + 7]) fail(where, "expected zero padding");
    liquids.push({ chunk: [cx, cy], type: view.getUint16(at + 2, true), surface, mask, hazard });
  }
  return { tile, offset, scale, heights, holes, liquids };
}

/** Index `cy * 16 + cx` of each tile array is chunk (cx, cy). */
export function decodeZones(bytes: Uint8Array, tiles: number, zones: number): Uint8Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length !== ZONES_HEADER + tiles * CHUNKS)
    fail(ZONES_PATH, `expected ${ZONES_HEADER} bytes and ${CHUNKS} for each present tile`);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== ZONES_MAGIC) fail(ZONES_PATH, `expected the magic bytes ${ZONES_MAGIC}`);
  if (view.getUint16(4, true) !== 1) fail(ZONES_PATH, "expected version 1");
  if (view.getUint16(6, true) !== tiles) fail(ZONES_PATH, `expected ${tiles} tiles`);
  const used = new Set<number>();
  for (const index of bytes.subarray(ZONES_HEADER)) {
    if (index > zones) fail(ZONES_PATH, `expected zone indexes from 0 to ${zones}, found ${index}`);
    used.add(index);
  }
  for (let index = 1; index <= zones; index++)
    if (!used.has(index)) fail(ZONES_PATH, `expected a chunk for each zone, found none for zone ${index}`);
  return Array.from({ length: tiles }, (_, i) => bytes.slice(ZONES_HEADER + i * CHUNKS, ZONES_HEADER + (i + 1) * CHUNKS));
}

/** Gives the bytes of a path relative to the artifact root, or undefined when the file is absent. */
export type ReadAsset = (path: string) => Promise<Uint8Array<ArrayBuffer> | undefined>;

/** A pinned artifact whose manifest has been checked. Each read checks its asset's size and hash. */
export interface RoutingArtifact {
  manifest: ArtifactManifest;
  read(path: string): Promise<Uint8Array<ArrayBuffer>>;
  /** A present tile. Throws for a missing or unlisted tile, or for bytes that differ from the manifest. */
  tile: (tile: Tile) => Promise<HeightTile>;
}

export type ArtifactLoad = { ok: true; artifact: RoutingArtifact } | { ok: false; reason: string };

/** Tiles are checked only when read. */
export async function loadArtifact(read: ReadAsset, pin: RoutingPin): Promise<ArtifactLoad> {
  let manifest: ArtifactManifest;
  try {
    const bytes = await read("manifest.json");
    if (!bytes) return { ok: false, reason: "No routing artifact is installed." };
    manifest = await checkManifest(bytes, pin);
  } catch (error) {
    return {
      ok: false,
      reason: `No pinned routing artifact for map ${pin.map}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const assets = new Map(manifest.assets.map((a) => [a.path, a]));
  const readAsset = async (path: string) => {
    const asset = assets.get(path);
    if (!asset) fail(path, "not in the artifact");
    const bytes = await read(path);
    if (!bytes) fail(path, "missing");
    await checkAsset(asset, bytes);
    return bytes;
  };
  return {
    ok: true,
    artifact: {
      manifest,
      read: readAsset,
      tile: async (tile) => decodeTile(await readAsset(tilePath(tile)), tile),
    },
  };
}

/** Reads assets over HTTP from `base`, such as `${import.meta.env.BASE_URL}routing/`. */
export function fetchAssets(base: string): ReadAsset {
  return async (path) => {
    const response = await fetch(`${base}${path}`, { cache: "no-cache" });
    if (response.status === 404) return undefined;
    if (!response.ok) fail(path, `HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
}

export function sha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(path, "expected a lowercase hex SHA-256");
  return value;
}

export function parseScope(value: unknown, path: string): ArtifactScope {
  const s = fields(value, path, ["variant", "build", "map"]);
  if (typeof s.variant !== "string" || !s.variant) fail(`${path}.variant`, "expected text");
  if (typeof s.build !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(s.build)) fail(`${path}.build`, "expected four dot-separated integers");
  count(s.map, `${path}.map`, 0);
  return value as ArtifactScope;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function pair(value: unknown, path: string, min: number, max: number): Tile {
  const p = list(value, path);
  if (p.length !== 2 || !p.every((n) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max))
    fail(path, `expected two integers from ${min} to ${max}`);
  return value as Tile;
}

export function json(bytes: Uint8Array, path: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(path, "expected UTF-8 JSON");
  }
}
