import type { InstanceId } from "../data/index.ts";
import type { Point } from "./frame.ts";
import { sha256 } from "./artifact.ts";
import { DEFAULT_LEG, DEFAULT_MAX_SLOPE } from "./plan.ts";
import { keepStopKeys, stopKeys, type ReachRequest, type StopKeys } from "./search.ts";
import { count, fail, fields, list } from "./shape.ts";
import type { Terrain } from "./terrain.ts";

export const STOP_TABLE_FORMAT = "restedxp-stop-keys";
export const STOP_TABLE_FILE = "stop-keys.json";

export interface StopSettings {
  maxSlope: number;
  swimming: boolean;
  downhill: boolean;
  damagingFalls: boolean;
  fatalFalls: boolean;
  hazards: boolean;
}

export type StopEntry = [x: number, y: number, height: number | null, keys: StopKeys];

export interface StopTable {
  format: typeof STOP_TABLE_FORMAT;
  version: 1;
  /** SHA-256 of the ground stops of the dataset's transports (scripts/routing/stop-keys.ts). */
  transports: string;
  /** SHA-256 of what `findStopKeys` gives for the probe points on the coarse fixture. It changes when the key code or the probe points change. */
  probe: string;
  settings: StopSettings;
  /** The stops of each map, for the artifact with ID `artifact`, in the order of `findStopKeys`. */
  maps: { map: InstanceId; artifact: string; stops: StopEntry[] }[];
}

export const DEFAULT_STOP_SETTINGS: StopSettings = {
  maxSlope: DEFAULT_MAX_SLOPE,
  swimming: true,
  downhill: DEFAULT_LEG.downhill,
  damagingFalls: DEFAULT_LEG.damagingFalls,
  fatalFalls: DEFAULT_LEG.fatalFalls,
  hazards: DEFAULT_LEG.hazards,
};

const SETTINGS = ["maxSlope", "swimming", "downhill", "damagingFalls", "fatalFalls", "hazards"] as const;

export function stopRequest(s: StopSettings): { leg: { downhill: boolean }; request: ReachRequest } {
  const { maxSlope, swimming, damagingFalls, fatalFalls, hazards } = s;
  return { leg: { downhill: s.downhill }, request: { maxSlope, swimming: { enabled: swimming }, damagingFalls, fatalFalls, hazards } };
}

/** Reads and checks a stop table. Throws for a value that is not one. */
export function parseStopTable(value: unknown): StopTable {
  const t = fields(value, "table", ["format", "version", "transports", "probe", "settings", "maps"]);
  if (t.format !== STOP_TABLE_FORMAT) fail("table.format", `expected ${STOP_TABLE_FORMAT}`);
  if (t.version !== 1) fail("table.version", "expected 1");
  const s = fields(t.settings, "table.settings", [...SETTINGS]);
  count(s.maxSlope, "table.settings.maxSlope", 1);
  for (const key of SETTINGS.slice(1)) if (typeof s[key] !== "boolean") fail(`table.settings.${key}`, "expected a boolean");
  const keys = (v: unknown, path: string) => {
    const k = fields(v, path, [], ["from", "to", "target"]);
    for (const side of ["from", "to"])
      if (side in k) list(k[side], `${path}.${side}`, 1_000_000).forEach((n, i) => count(n, `${path}.${side}[${i}]`, 0));
    if ("target" in k && typeof k.target !== "string") fail(`${path}.target`, "expected a string");
  };
  list(t.maps, "table.maps").forEach((m, i) => {
    const path = `table.maps[${i}]`;
    const entry = fields(m, path, ["map", "artifact", "stops"]);
    count(entry.map, `${path}.map`, 0);
    if (typeof entry.artifact !== "string") fail(`${path}.artifact`, "expected a string");
    list(entry.stops, `${path}.stops`).forEach((stop, j) => {
      const at = `${path}.stops[${j}]`;
      const [x, y, height, k, ...rest] = list(stop, at);
      count(x, `${at}[0]`, 0);
      count(y, `${at}[1]`, 0);
      if (height !== null && !Number.isFinite(height)) fail(`${at}[2]`, "expected a number or null");
      keys(k, `${at}[3]`);
      if (rest.length) fail(at, "expected 4 items");
    });
  });
  sha256(t.transports, "table.transports");
  sha256(t.probe, "table.probe");
  return value as StopTable;
}

/** Undefined, with a warning, when `read` gives no valid table. Routing then reads the region of each stop. */
export async function loadStopTable(source: string, read: () => unknown): Promise<StopTable | undefined> {
  try {
    return parseStopTable(await read());
  } catch (error) {
    console.warn(`${source}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * Seeds `stopKeys` on `terrain` with the stops of `map` for artifact
 * `artifact`, and returns their count. Other stops and settings still read
 * the region. So a missing, stale, or refused table only makes the first
 * search slower. It changes no result.
 */
export function seedStopKeys(table: StopTable, map: InstanceId, artifact: string, terrain: Terrain): number {
  const entry = table.maps.find((m) => m.map === map && m.artifact === artifact);
  if (!entry) return 0;
  const { leg, request } = stopRequest(table.settings);
  for (const [x, y, height, keys] of entry.stops) keepStopKeys(terrain, [x, y], height ?? undefined, leg, request, keys);
  return entry.stops.length;
}

/**
 * The entries of `stops` on `terrain` with `settings`, without repeats, by
 * x, then y, then height. A stop whose keys `stopKeys` does not give, such
 * as one whose region has a tile that failed to load, has no entry.
 */
export async function findStopKeys(
  terrain: Terrain,
  stops: readonly { point: Point; height?: number }[],
  settings: StopSettings,
): Promise<StopEntry[]> {
  const { leg, request } = stopRequest(settings);
  const unique = new Map(stops.map(({ point, height }) => [JSON.stringify([point, height ?? null]), { point, height }]));
  const found = await Promise.all(
    [...unique.values()].map(async ({ point, height }): Promise<StopEntry[]> => {
      const keys = await stopKeys(terrain, point, height, leg, request);
      return keys ? [[point[0], point[1], height ?? null, keys]] : [];
    }),
  );
  const height = (h: number | null) => h ?? Number.MIN_SAFE_INTEGER;
  return found.flat().sort((a, b) => a[0] - b[0] || a[1] - b[1] || height(a[2]) - height(b[2]));
}

export function stopTableText(table: StopTable): string {
  const { transports, probe, settings: s } = table;
  const head = JSON.stringify({
    format: STOP_TABLE_FORMAT,
    version: 1,
    transports,
    probe,
    settings: Object.fromEntries(SETTINGS.map((key) => [key, s[key]])),
  });
  return `${head.slice(0, -1)},"maps":[\n${table.maps.map(mapText).join(",\n")}\n]}\n`;
}

function mapText({ map, artifact, stops }: StopTable["maps"][number]): string {
  return `${JSON.stringify({ map, artifact }).slice(0, -1)},"stops":[${stops.map((e) => `\n${JSON.stringify(e)}`).join(",")}\n]}`;
}
