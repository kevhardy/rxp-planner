import type { GuideIconsFile } from "../../packages/data-contract/guideIcons.ts";
import type { InteriorsFile } from "../../packages/data-contract/interiors.ts";
import {
  acceptGuideIconImage,
  acceptInteriorImage,
  acceptMapTile,
  acceptInteriorSurfaces,
  startupAssets,
  validateDataset,
  validateDatasetManifest,
  type DatasetManifest,
  type ValidatedDataset,
} from "../../packages/data-contract/manifest.ts";
import type { GameDataFile, RaceRecord } from "../../packages/data-contract/model.ts";
import type { TransportsFile } from "../../packages/data-contract/transports.ts";
import { readGameRules, type GameRules, type RuleRace } from "./gameRules.ts";
import { GameData, type RuntimeDatasetContext } from "./gameData.ts";
import { EntityIndex } from "./entities.ts";
import { GUIDE_ICONS_PROPERTY, guideIconCatalog, type GuideIconCatalog, type GuideIconSheet } from "./guideIcons.ts";
import { fromSurfaces, type SurfaceMap } from "./surfaces.ts";
import type { LoadedInteriors, LoadedWorldMap } from "./worldMap.ts";
import { errorText } from "./errorText.ts";

export interface DatasetLocation {
  manifest: string;
  base: string;
  manifestHash?: string | undefined;
}

export interface LoadedDataset {
  manifest: DatasetManifest;
  game: GameData;
  entities: EntityIndex;
  transports: TransportsFile;
  worldMap: LoadedWorldMap;
  guideIcons: GuideIconCatalog;
  guideIconSheet?: GuideIconSheet;
  base: string;
  imageUrls?: ReadonlyMap<string, string>;
}

type ReadAsset = (path: string) => Promise<Uint8Array<ArrayBuffer>>;

function lazyInteriorImages(
  data: Pick<ValidatedDataset, "manifest"> & { interiors: InteriorsFile },
  base: string,
  read: ReadAsset,
  urls: Map<string, string>,
  released?: AbortSignal,
): LoadedInteriors {
  const built = new Map<string, SurfaceMap>();
  const surfaces = once(async (id) => {
    const interior = data.interiors.interiors.find((i) => i.id === id)!;
    const map = fromSurfaces(interior, await acceptInteriorSurfaces(data, interior.surfaces, await read(interior.surfaces)));
    built.set(id, map);
    return map;
  });
  return {
    list: data.interiors.interiors,
    image: once(async (path) => {
      const bytes = await read(path);
      await acceptInteriorImage(data, path, bytes);
      released?.throwIfAborted();
      const { format } = data.manifest.assets.find((a) => a.path === path)!;
      const url = URL.createObjectURL(new Blob([bytes], { type: `image/${format}` }));
      urls.set(`${base}${path}`, url);
      return url;
    }),
    loadedSurfaces: (interior) => built.get(interior.id),
    surfaces: (interior) => surfaces(interior.id),
  };
}

function guideIconSheet(
  data: Pick<ValidatedDataset, "manifest"> & { guideIcons: GuideIconsFile },
  read: ReadAsset,
  released: AbortSignal,
): GuideIconSheet {
  const root = document.documentElement.style;
  let url: string | undefined;
  const load = once(async (path) => {
    const bytes = await read(path);
    await acceptGuideIconImage(data, path, bytes);
    released.throwIfAborted();
    const next = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    try {
      const image = new Image();
      image.src = next;
      await image.decode();
      released.throwIfAborted();
    } catch (error) {
      URL.revokeObjectURL(next);
      throw error;
    }
    url = next;
    root.setProperty(GUIDE_ICONS_PROPERTY, `url("${url}")`);
  });
  released.addEventListener("abort", () => {
    if (url === undefined) return;
    if (root.getPropertyValue(GUIDE_ICONS_PROPERTY) === `url("${url}")`) root.removeProperty(GUIDE_ICONS_PROPERTY);
    URL.revokeObjectURL(url);
  });
  const listeners = new Set<() => void>();
  let state: GuideIconSheet["state"] = "loading";
  const set = (next: GuideIconSheet["state"]) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const start = () => {
    set("loading");
    load(data.guideIcons.image).then(
      () => set("ready"),
      () => set("failed"),
    );
  };
  start();
  return {
    get state() {
      return state;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    retry: () => {
      if (state === "failed" && !released.aborted) start();
    },
  };
}

function once<T>(load: (path: string) => Promise<T>): (path: string) => Promise<T> {
  const pending = new Map<string, Promise<T>>();
  return (path) => {
    let value = pending.get(path);
    if (!value) {
      value = load(path);
      pending.set(path, value);
      value.catch(() => pending.delete(path));
    }
    return value;
  };
}

export interface DatasetArtifact {
  data: LoadedDataset;
  dispose: () => void;
}

const MAX_PARALLEL_ASSET_READS = 6;

async function readArtifact(manifest: unknown, read: ReadAsset, signal?: AbortSignal) {
  const input: unknown = structuredClone(manifest);
  validateDatasetManifest(input);
  const assets = startupAssets(input);
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  let next = 0;
  let stopped = false;
  try {
    await Promise.all(
      Array.from({ length: Math.min(MAX_PARALLEL_ASSET_READS, assets.length) }, async () => {
        while (!stopped && next < assets.length) {
          signal?.throwIfAborted();
          const asset = assets[next++]!;
          try {
            const bytes = await read(asset.path);
            signal?.throwIfAborted();
            if (!stopped) files.set(asset.path, bytes);
          } catch (cause) {
            stopped = true;
            throw new Error(`Could not read dataset asset ${asset.path}: ${errorText(cause)}`, { cause });
          }
        }
      }),
    );
    const data = await validateDataset(input, files, signal);
    signal?.throwIfAborted();
    return { data, files };
  } catch (error) {
    stopped = true;
    files.clear();
    throw error;
  }
}

const PREDATES = "The dataset release predates data contract 0.18.0.";

function requireGameTables(quests: GameDataFile): GameRules {
  const { flightNodes, factionNames, races, classes, raceClasses, professions, standings, xpToNextLevel } = quests;
  if (flightNodes && factionNames && races && isRuleRaces(races) && (classes || !raceClasses) && professions && standings && xpToNextLevel)
    return readGameRules({ races, professions, standings, xpToNextLevel });
  const tables = [
    "flightNodes",
    "factionNames",
    "races",
    ...(raceClasses ? (["classes"] as const) : []),
    "professions",
    "standings",
    "xpToNextLevel",
  ] as const;
  const missing = [...tables.filter((table) => quests[table] === undefined), ...(races ? missingRaceFields(races) : [])];
  throw new Error(`${PREDATES} Its quest bundle has no ${missing.join(", ")}.`);
}

const RULE_RACE_FIELDS = ["maskBit", "startingFlightNodes"] as const;

const missingRaceFields = (races: Readonly<Record<string, RaceRecord>>) =>
  RULE_RACE_FIELDS.flatMap((field) => (Object.values(races).some((race) => race[field] === undefined) ? [`races[].${field}`] : []));

const isRuleRaces = (races: Readonly<Record<string, RaceRecord>>): races is Record<string, RuleRace> => !missingRaceFields(races).length;

export function buildGameData({
  quests,
  ...dataset
}: Omit<RuntimeDatasetContext, "rules" | "sources"> & {
  quests: GameDataFile;
  sources: NonNullable<RuntimeDatasetContext["sources"]>;
}): GameData {
  return new GameData(quests, { rules: requireGameTables(quests), ...dataset });
}

function runtimeDataset(
  data: ValidatedDataset,
  base: string,
  read: ReadAsset,
  images?: { urls: Map<string, string>; released: AbortSignal },
): LoadedDataset {
  requireGameTables(data.quests);
  const { transports } = data;
  if (!transports) throw new Error(`${PREDATES} Its manifest has no transports asset.`);
  const assetBase = base.endsWith("/") ? base : `${base}/`;
  const imageUrls = images?.urls;
  const { interiors, guideIcons } = data;
  return {
    manifest: data.manifest,
    base: assetBase,
    guideIcons: guideIconCatalog(guideIcons),
    ...(images && guideIcons && { guideIconSheet: guideIconSheet({ manifest: data.manifest, guideIcons }, read, images.released) }),
    ...(imageUrls && { imageUrls }),
    game: buildGameData({ quests: data.quests, geometry: data.geometry, terrain: data.terrain, sources: data.manifest.sources }),
    entities: new EntityIndex(data.entities),
    transports,
    worldMap: {
      ...data.terrain,
      icons: data.manifest.icons,
      tileBase: `${assetBase}${data.manifest.tileBase}/`,
      ...(imageUrls && { imageUrls }),
      ...(images && {
        tile: once(async (tile) => {
          images.released.throwIfAborted();
          const path = `${data.manifest.tileBase}/${tile}`;
          const bytes = await read(path);
          await acceptMapTile(data, path, bytes);
          images.released.throwIfAborted();
          const url = URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
          images.urls.set(`${assetBase}${path}`, url);
          return url;
        }),
      }),
      ...(interiors && {
        interiors: lazyInteriorImages(
          { manifest: data.manifest, interiors },
          assetBase,
          read,
          imageUrls ?? new Map<string, string>(),
          images?.released,
        ),
      }),
    },
  };
}

export async function loadDataset(manifest: unknown, read: ReadAsset, base: string): Promise<LoadedDataset> {
  const { data, files } = await readArtifact(manifest, read);
  files.clear();
  return runtimeDataset(data, base, read);
}

export async function decodeDatasetManifest(bytes: Uint8Array<ArrayBuffer>, expected?: string): Promise<unknown> {
  if (expected !== undefined) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const actual = `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (actual !== expected) throw new Error("Dataset manifest does not match the selected content pin");
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function fetchArtifact(location: DatasetLocation, signal?: AbortSignal) {
  const local = (path: string) => {
    const url = new URL(path, window.location.href);
    if (url.origin !== window.location.origin || !["http:", "https:"].includes(url.protocol))
      throw new Error(`Dataset location must be served locally on this origin: ${path}`);
    return url;
  };
  const manifestUrl = local(location.manifest);
  const base = local(location.base.endsWith("/") ? location.base : `${location.base}/`).href;
  const controller = new AbortController();
  const active = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const read = async (url: URL) => {
    active.throwIfAborted();
    const response = await fetch(url.href, { redirect: "error", cache: "no-cache", signal: active });
    if (!response.ok) throw new Error(`Could not load ${url.pathname}: HTTP ${response.status}. ${(await response.text()).slice(0, 2000)}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  try {
    const manifest = await decodeDatasetManifest(await read(manifestUrl), location.manifestHash);
    const readAsset = (path: string) => read(new URL(path, base));
    return { ...(await readArtifact(manifest, readAsset, active)), base, read: readAsset };
  } catch (cause) {
    controller.abort();
    throw new Error(`Could not load dataset ${manifestUrl.pathname}: ${errorText(cause)}`, { cause });
  }
}

export async function fetchDatasetArtifact(location: DatasetLocation, signal: AbortSignal): Promise<DatasetArtifact> {
  const { data, files, base, read } = await fetchArtifact(location, signal);
  const imageUrls = new Map<string, string>();
  const released = new AbortController();
  const dispose = () => {
    released.abort();
    for (const url of imageUrls.values()) URL.revokeObjectURL(url);
    imageUrls.clear();
  };
  try {
    signal.throwIfAborted();
    for (const asset of data.manifest.assets) {
      const bytes = files.get(asset.path);
      if (bytes && ["png", "jpeg", "webp"].includes(asset.format)) {
        imageUrls.set(`${base}${asset.path}`, URL.createObjectURL(new Blob([bytes], { type: `image/${asset.format}` })));
      }
      files.delete(asset.path);
    }
    return { data: runtimeDataset(data, base, read, { urls: imageUrls, released: released.signal }), dispose };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    files.clear();
  }
}
