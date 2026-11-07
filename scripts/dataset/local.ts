import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDataset, validateDatasetManifest } from "../../packages/data-contract/manifest.ts";
import type { TransportsFile } from "../../packages/data-contract/transports.ts";
import type { DatasetLocation } from "../../src/data/dataset.ts";
import { readDataset } from "../../src/data/node.ts";
import {
  checkAsset,
  checkManifest,
  decodeTile,
  decodeZones,
  floorPath,
  parseBundleRouting,
  tilePath,
  ZONES_PATH,
  type RoutingPin,
} from "../../src/routing/artifact.ts";
import { decodeFloor } from "../../src/routing/floor.ts";
import { errorText } from "../../src/data/errorText.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const DATA_DIR = join(REPO, ".local-data");

export interface Loaded {
  manifestBytes: Buffer<ArrayBuffer>;
  files: Map<string, Uint8Array<ArrayBuffer>>;
}

export const datasetDir = (data = DATA_DIR) => resolve(REPO, process.env.RXP_DATASET || join(data, "dataset"));

async function readAll(base: string, paths: string[]) {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const path of paths) files.set(path, await readFile(join(base, path)));
  return files;
}

const notInstalled = (dir: string, cause: unknown) =>
  new Error(`Could not load the dataset in ${dir}. Install it with pnpm data:install. ${errorText(cause)}`, { cause });

const hashManifest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export const installedManifestHash = async (dir = datasetDir()) => hashManifest(await readFile(join(dir, "manifest.json")));

export async function validateInstalled(dir = datasetDir()) {
  try {
    const manifestBytes = await readFile(join(dir, "manifest.json"));
    const manifest: unknown = JSON.parse(manifestBytes.toString("utf8"));
    validateDatasetManifest(manifest);
    const files = await readAll(
      dir,
      manifest.assets.map((a) => a.path),
    );
    const { quests, transports } = await validateDataset(manifest, files);
    const manifestHash = hashManifest(manifestBytes);
    const location: DatasetLocation = { manifest: join(dir, "manifest.json"), base: dir, manifestHash };
    return { manifest, manifestBytes, manifestHash, files, location, quests, transports };
  } catch (cause) {
    throw notInstalled(dir, cause);
  }
}

export async function installedDataset(dir = datasetDir()) {
  try {
    return await readDataset({ manifest: join(dir, "manifest.json"), base: dir });
  } catch (cause) {
    throw notInstalled(dir, cause);
  }
}

export async function installedTransports(dir = datasetDir()): Promise<TransportsFile> {
  const { transports } = await validateInstalled(dir);
  if (!transports) throw new Error(`The dataset in ${dir} has no transports asset. Install a newer release file with pnpm data:install.`);
  return transports;
}

export function undefinedIfMissing(error: unknown): undefined {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
  throw error;
}

export async function installedRouting(data = DATA_DIR): Promise<RoutingPin[]> {
  const text = await readFile(join(data, "bundle.json"), "utf8").catch(undefinedIfMissing);
  return text === undefined ? [] : parseBundleRouting(JSON.parse(text));
}

export const installedMaps = async (data = DATA_DIR) => (await installedRouting(data)).map((p) => p.map);

export async function loadRouting(pin: RoutingPin, data = DATA_DIR): Promise<Loaded> {
  const dir = join(data, "routing", `m${pin.map}`);
  const manifestBytes = await readFile(join(dir, "manifest.json"));
  const manifest = await checkManifest(manifestBytes, pin);
  const files = await readAll(
    dir,
    manifest.assets.map((a) => a.path),
  );
  for (const asset of manifest.assets) await checkAsset(asset, files.get(asset.path)!);
  const present = manifest.tiles.filter((t) => t.state === "present");
  for (const { tile } of present) decodeTile(files.get(tilePath(tile))!, tile);
  decodeZones(files.get(ZONES_PATH)!, present.length, manifest.zones.length);
  for (const { tile } of present) {
    const floor = files.get(floorPath(tile));
    if (floor) decodeFloor(floor, tile);
  }
  return { manifestBytes, files };
}
