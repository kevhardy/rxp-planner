import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadArtifact, type RoutingPin } from "../../src/routing/artifact.ts";
import { COARSE_DIR, COARSE_PLACES, UNDER_DECK_HEIGHT } from "../../src/routing/fixtures/coarse.ts";
import { floorPin } from "../../src/routing/fixtures/repin.ts";
import { worldToNative, type Point } from "../../src/routing/frame.ts";
import type { TransportsFile } from "../../packages/data-contract/transports.ts";
import {
  DEFAULT_STOP_SETTINGS,
  findStopKeys,
  parseStopTable,
  STOP_TABLE_FILE,
  STOP_TABLE_FORMAT,
  stopTableText,
  type StopSettings,
  type StopTable,
} from "../../src/routing/stop-table.ts";
import { createTerrain } from "../../src/routing/terrain.ts";
import { installedArtifact } from "./installed.ts";
import { DATA_DIR, datasetDir, installedMaps, installedRouting, installedTransports } from "../dataset/local.ts";

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const groundStops = (file: TransportsFile, maps: readonly number[]) =>
  file.nodes.filter((n) => maps.includes(n.world.instance) && !n.air).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export const transportsHash = (file: TransportsFile, maps: readonly number[]) =>
  sha256(groundStops(file, maps).map(({ id, world: { instance, x, y }, height }) => [id, instance, [x, y], height ?? null]));

const { underDeck, ...ground } = COARSE_PLACES;
const PROBE: { point: Point; height?: number }[] = [
  ...Object.values(ground).map((point) => ({ point })),
  { point: underDeck, height: UNDER_DECK_HEIGHT },
];

export async function probeHash(settings: StopSettings): Promise<string> {
  const read = async (path: string) => new Uint8Array(await readFile(`${COARSE_DIR}${path}`));
  const pin = await floorPin(await read("manifest.json"));
  const load = await loadArtifact(read, pin);
  if (!load.ok) throw new Error(load.reason);
  return sha256(await findStopKeys(createTerrain(load.artifact), PROBE, settings));
}

export async function buildStopTable(file: TransportsFile, data = DATA_DIR): Promise<StopTable> {
  const maps = await installedMaps(data);
  const settings = DEFAULT_STOP_SETTINGS;
  const table: StopTable = {
    format: STOP_TABLE_FORMAT,
    version: 1,
    transports: transportsHash(file, maps),
    probe: await probeHash(settings),
    settings,
    maps: [],
  };
  for (const map of maps) {
    const artifact = await installedArtifact(map, data);
    const stops = groundStops(file, [map]).flatMap(({ world, height }) => {
      const at = worldToNative(artifact.manifest, world);
      return at ? [{ point: at.map(Math.round) as Point, ...(height !== undefined && { height }) }] : [];
    });
    table.maps.push({ map, artifact: artifact.manifest.id, stops: await findStopKeys(createTerrain(artifact), stops, settings) });
  }
  return table;
}

async function matchesInstall(table: StopTable, pins: readonly RoutingPin[], file: TransportsFile): Promise<boolean> {
  const settings = DEFAULT_STOP_SETTINGS;
  return (
    isDeepStrictEqual(table.settings, settings) &&
    table.transports ===
      transportsHash(
        file,
        pins.map((p) => p.map),
      ) &&
    isDeepStrictEqual(
      table.maps.map(({ map, artifact }) => [map, artifact]),
      pins.map(({ map, id }) => [map, id]),
    ) &&
    table.probe === (await probeHash(settings))
  );
}

export async function ensureStopTable(data = DATA_DIR): Promise<void> {
  const pins = await installedRouting(data);
  if (!pins.length) return;
  const path = join(data, STOP_TABLE_FILE);
  const old = await readFile(path, "utf8")
    .then((text) => parseStopTable(JSON.parse(text)))
    .catch(() => undefined);
  const file = await installedTransports(datasetDir(data));
  if (old && (await matchesInstall(old, pins, file))) return;
  console.log(`Writing ${path}.`);
  await writeFile(`${path}.new`, stopTableText(await buildStopTable(file, data)));
  await rename(`${path}.new`, path);
}
