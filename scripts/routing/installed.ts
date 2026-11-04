import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorldLocation } from "../../src/data/index.ts";
import { loadArtifact } from "../../src/routing/artifact.ts";
import { loadStopTable, seedStopKeys, STOP_TABLE_FILE, type StopTable } from "../../src/routing/stop-table.ts";
import { createTerrain } from "../../src/routing/terrain.ts";
import { DATA_DIR, installedRouting, loadRouting } from "../dataset/local.ts";

export async function installedArtifact(map = 0, data = DATA_DIR) {
  const pin = (await installedRouting(data)).find((p) => p.map === map);
  if (!pin) throw new Error(`No routing artifact is installed for map ${map}. Install it with pnpm data:install.`);
  const { manifestBytes, files } = await loadRouting(pin, data);
  const load = await loadArtifact(async (path) => (path === "manifest.json" ? manifestBytes : files.get(path)), pin);
  if (!load.ok) throw new Error(load.reason);
  return load.artifact;
}

export async function openInstalled(map = 0) {
  const artifact = await installedArtifact(map);
  const terrain = createTerrain(artifact);
  const file = join(DATA_DIR, STOP_TABLE_FILE);
  const table = await (stopTable ??= loadStopTable(file, async () => JSON.parse(await readFile(file, "utf8"))));
  if (table) seedStopKeys(table, map, artifact.manifest.id, terrain);
  return { artifact, terrain };
}

const CACHE_CELL_YARDS = 5;

export function travelCacheKey(from: WorldLocation, to: WorldLocation) {
  const cell = (p: WorldLocation) => `${Math.round(p.x / CACHE_CELL_YARDS)},${Math.round(p.y / CACHE_CELL_YARDS)}`;
  return `${from.instance} ${cell(from)} ${cell(to)}`;
}

let stopTable: Promise<StopTable | undefined> | undefined;
