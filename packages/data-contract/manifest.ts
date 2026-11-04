import type { BundleSource, UiMapId } from "./shared.ts";
import type { GameDataFile } from "./model.ts";
import type { EntityDataFile } from "./entities.ts";
import { restoreMapBounds, type MapBoundsRecords, type WorldBounds } from "./geometry.ts";
import { worldMapTiles, type WorldMapData } from "./worldMap.ts";
import { validateMapBounds, validateWorldMapData } from "./geometryValidation.ts";
import { validateCompleteGameData, validateCompleteEntityData } from "./completeData.ts";
import { SourceValidation } from "./validation.ts";
import { decodeJson } from "./json.ts";
import { validateImageContainer } from "./imageValidation.ts";
import { decodeInteriorsFile, type Interior, type InteriorsFile } from "./interiors.ts";
import { decodeInteriorSurfaces, interiorSurfacesLimit, type InteriorSurfaces } from "./interiorSurfaces.ts";
import { decodeTransportsFile, type TransportsFile } from "./transports.ts";
import { decodeGuideIconsFile, guideIconSheetSize, type GuideIconsFile } from "./guideIcons.ts";
import { object, fields, name, finite, positive, oneOf, list, optional, requireValid, datasetPath } from "./checks.ts";

/** Full source keys, including edition when the producer uses one; consumers never split keys. */
export interface SourceDisplay {
  name: string;
}
export interface DatasetAsset {
  path: string;
  /** Exact stored bytes, including a gzip layer. Transport decoding must not change them. */
  bytes: number;
  sha256: string;
  format:
    | "quests"
    | "entities"
    | "geometry"
    | "terrain"
    | "interiors"
    | "interior-surfaces"
    | "transports"
    | "guide-icons"
    | "png"
    | "jpeg"
    | "webp";
  /** One of `ASSET_VERSIONS` for the format. */
  version: 1 | 2 | 3;
  encoding: "identity" | "gzip";
}
export interface DatasetIcon {
  /** Dataset-relative asset path. */
  file: string;
  x: number;
  y: number;
  /** CSS background width when drawing the icon at 24 px. */
  width: number;
}
export interface DatasetManifest {
  version: 2;
  id: string;
  release: string;
  locale: "enUS";
  producer: { name: string; version: string };
  sources: Record<string, SourceDisplay>;
  quests: string;
  entities: string;
  geometry: string;
  terrain: string;
  /** The interiors file. Absent when the dataset has no inside maps. */
  interiors?: string;
  /** The transports file. Absent when the dataset has no rides. */
  transports?: string;
  /** The guide icons file. Absent when the dataset has no guide icons. */
  guideIcons?: string;
  /** Directory below which worldMapTiles(terrain) resolves. */
  tileBase: string;
  icons: Record<string, DatasetIcon>;
  assets: DatasetAsset[];
}
/** The Forever client's UI map bounds, from one pinned source. */
export interface DatasetGeometry {
  version: 2;
  sources: BundleSource[];
  bounds: MapBoundsRecords;
  source: string;
}
export interface ValidatedDataset {
  manifest: DatasetManifest;
  quests: GameDataFile;
  entities: EntityDataFile;
  geometry: DatasetGeometry;
  bounds: ReadonlyMap<UiMapId, WorldBounds>;
  terrain: WorldMapData;
  /** Present when the manifest names an interiors file. */
  interiors?: InteriorsFile;
  /** Present when the manifest names a transports file. */
  transports?: TransportsFile;
  /** Present when the manifest names a guide icons file. */
  guideIcons?: GuideIconsFile;
}

const ASSET_VERSIONS: Readonly<Record<DatasetAsset["format"], readonly DatasetAsset["version"][]>> = {
  quests: [3],
  entities: [2],
  geometry: [2],
  terrain: [1],
  interiors: [2],
  "interior-surfaces": [1],
  transports: [1],
  "guide-icons": [1],
  png: [1],
  jpeg: [1],
  webp: [1],
};

const hash = (v: unknown): v is string => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
const assetFormat = (v: unknown): v is DatasetAsset["format"] => typeof v === "string" && Object.hasOwn(ASSET_VERSIONS, v);
const images = new Set(["png", "jpeg", "webp"]);

/** Structural validation only; bytes and referenced record contents need validateDataset. */
export function validateDatasetManifest(input: unknown): asserts input is DatasetManifest {
  requireValid(
    fields(input, {
      version: oneOf(2),
      id: name,
      release: name,
      locale: oneOf("enUS"),
      producer: (v) => fields(v, { name, version: name }),
      sources: (v) =>
        object(v) && Object.keys(v).length > 0 && Object.entries(v).every(([key, label]) => name(key) && fields(label, { name })),
      quests: datasetPath,
      entities: datasetPath,
      geometry: datasetPath,
      terrain: datasetPath,
      interiors: optional(datasetPath),
      transports: optional(datasetPath),
      guideIcons: optional(datasetPath),
      tileBase: datasetPath,
      icons: object,
      assets: list(object),
    }),
    "dataset manifest",
  );
  const paths = new Set<string>();
  const spellings = new Map<string, string>();
  const assets = new Map<string, DatasetAsset>();
  for (const asset of input.assets) {
    requireValid(
      fields(asset, {
        path: datasetPath,
        bytes: positive,
        sha256: hash,
        format: assetFormat,
        version: oneOf(1, 2, 3),
        encoding: oneOf("identity", "gzip"),
      }) &&
        (!images.has(asset.format) || asset.encoding === "identity") &&
        (asset.format !== "interior-surfaces" || asset.encoding === "gzip"),
      "asset declaration",
    );
    const versions = ASSET_VERSIONS[asset.format];
    requireValid(
      versions.includes(asset.version),
      `${asset.format} asset ${asset.path} version ${asset.version}, expected version ${versions.join(" or ")}`,
    );
    const path = asset.path.toLowerCase();
    requireValid(!paths.has(path), `duplicate asset path ${asset.path}`);
    paths.add(path);
    assets.set(asset.path, asset);
    const segments = asset.path.split("/");
    for (let end = 1; end <= segments.length; end++) {
      const spelling = segments.slice(0, end).join("/"),
        folded = spelling.toLowerCase();
      requireValid(!spellings.has(folded) || spellings.get(folded) === spelling, `asset directory case alias ${spelling}`);
      spellings.set(folded, spelling);
    }
  }
  for (const path of paths) {
    const parts = path.split("/");
    for (let end = 1; end < parts.length; end++)
      requireValid(!paths.has(parts.slice(0, end).join("/")), `asset file/directory collision ${path}`);
  }
  requireValid(!paths.has(input.tileBase.toLowerCase()), "tile directory");
  const reference = (path: string, format: DatasetAsset["format"]) =>
    requireValid(assets.get(path)?.format === format, `${format} asset reference ${path}`);
  reference(input.geometry, "geometry");
  reference(input.terrain, "terrain");
  reference(input.quests, "quests");
  reference(input.entities, "entities");
  if (input.interiors !== undefined) reference(input.interiors, "interiors");
  if (input.transports !== undefined) reference(input.transports, "transports");
  if (input.guideIcons !== undefined) reference(input.guideIcons, "guide-icons");
  const named: Partial<Record<DatasetAsset["format"], string | undefined>> = {
    interiors: input.interiors,
    transports: input.transports,
    "guide-icons": input.guideIcons,
  };
  for (const asset of assets.values())
    requireValid(
      !Object.hasOwn(named, asset.format) || asset.path === named[asset.format],
      `unreferenced ${asset.format} asset ${asset.path}`,
    );
  requireValid(Object.hasOwn(input.icons, "quest-giver") && Object.hasOwn(input.icons, "quest-turn-in"), "quest icon coverage");
  for (const [key, icon] of Object.entries(input.icons))
    requireValid(
      name(key) &&
        fields(icon, { file: datasetPath, x: finite, y: finite, width: (v) => finite(v) && v > 0 }) &&
        images.has(assets.get(icon.file)?.format ?? ""),
      `icon ${key}`,
    );
}

export function validateDatasetGeometry(input: unknown): asserts input is DatasetGeometry {
  requireValid(fields(input, { version: oneOf(2), sources: list(object), bounds: object, source: name }), "dataset geometry");
  validateMapBounds(input.bounds);
  new SourceValidation(input.sources).require(input.source, "geometry");
}

/** Verifies one declaration's exact bytes. No disk, network, decompression, or activation. */
export async function validateDatasetAsset(asset: DatasetAsset, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  requireValid(fields(asset, { path: datasetPath, bytes: positive, sha256: hash }), "asset integrity declaration");
  requireValid(bytes.byteLength === asset.bytes, `asset size ${asset.path}`);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  requireValid(`sha256:${digest}` === asset.sha256, `asset checksum ${asset.path}`);
}

/**
 * The declared assets a consumer reads at startup. A consumer reads each
 * interior's surfaces, and every image that is not a map icon, including
 * terrain tiles and the guide icon sheet, only when it needs it.
 */
export function startupAssets(manifest: DatasetManifest): DatasetAsset[] {
  const icons = new Set(Object.values(manifest.icons).map((icon) => icon.file));
  return manifest.assets.filter((a) => a.format !== "interior-surfaces" && (!images.has(a.format) || icons.has(a.path)));
}

/**
 * Validates a whole finished artifact from stored bytes. The caller owns I/O
 * and supplies every startup asset. It may also supply other declared assets,
 * such as terrain tiles, interior images, interior surfaces, and the guide
 * icon sheet, which this then checks. Returns fresh
 * decoded records. Neither input bytes nor any active dataset are changed.
 */
export async function validateDataset(
  input: unknown,
  files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>,
  signal?: AbortSignal,
): Promise<ValidatedDataset> {
  const manifest: unknown = structuredClone(input);
  validateDatasetManifest(manifest);
  const m = manifest;
  const startup = startupAssets(m);
  const declared = new Map(m.assets.map((a) => [a.path, a]));
  requireValid(startup.every((a) => files.has(a.path)) && [...files.keys()].every((path) => declared.has(path)), "supplied asset coverage");
  const decoded = new Map<string, unknown>();
  for (const asset of startup) {
    signal?.throwIfAborted();
    const bytes = new Uint8Array(files.get(asset.path)!);
    await validateDatasetAsset(asset, bytes);
    if (images.has(asset.format)) {
      validateImageContainer(asset.format, bytes, asset.path);
    } else {
      requireValid(gzipped(bytes) === (asset.encoding === "gzip"), `asset encoding ${asset.path}`);
      decoded.set(asset.path, await decodeJson(bytes));
    }
  }
  const geometry = decoded.get(m.geometry);
  validateDatasetGeometry(geometry);
  const terrain = decoded.get(m.terrain);
  validateWorldMapData(terrain);
  const used = new Set([m.geometry, m.terrain]);
  const image = (path: string, format?: "webp") => {
    requireValid(
      datasetPath(path) && images.has(declared.get(path)?.format ?? "") && (!format || declared.get(path)?.format === format),
      `image asset reference ${path}`,
    );
    used.add(path);
  };
  for (const icon of Object.values(m.icons)) image(icon.file);
  const markerCategories = new Set(terrain.pois.map((poi) => poi.category));
  for (const category of terrain.categories)
    if (markerCategories.has(category.key)) requireValid(Object.hasOwn(m.icons, category.icon), `category icon ${category.icon}`);
  const tileCount = terrain.areas.reduce(
    (sum, area) =>
      sum +
      Object.values(area.tiles).reduce((total, runs) => total + runs.reduce((count, [, first, last]) => count + last - first + 1, 0), 0),
    0,
  );
  requireValid(tileCount <= m.assets.length, "tile asset coverage");
  const tiles = new Set(worldMapTiles(terrain));
  mapTiles.set(terrain, tiles);
  for (const path of tiles) image(`${m.tileBase}/${path}`, "webp");
  const interiors = m.interiors === undefined ? undefined : decodeInteriorsFile(decoded.get(m.interiors));
  const uses = interiors ? interiorImageUses(interiors) : new Map<string, InteriorImageUse[]>();
  for (const path of uses.keys()) {
    requireValid(declared.get(path)?.format === "webp", `interior image reference ${path}`);
    used.add(path);
  }
  const surfaceUses = interiors ? interiorSurfaceUses(interiors) : new Map<string, Interior>();
  for (const path of surfaceUses.keys()) {
    requireValid(declared.get(path)?.format === "interior-surfaces", `interior surfaces reference ${path}`);
    used.add(path);
  }
  const guideIcons = m.guideIcons === undefined ? undefined : decodeGuideIconsFile(decoded.get(m.guideIcons));
  if (guideIcons) {
    const sheet = guideIcons.image;
    requireValid(declared.get(sheet)?.format === "png" && !used.has(sheet), `guide icons image reference ${sheet}`);
    used.add(sheet);
  }
  const quests = decoded.get(m.quests);
  validateCompleteGameData(quests);
  const entities = decoded.get(m.entities);
  validateCompleteEntityData(entities);
  const instanceOf = (uiMapId: UiMapId) => geometry.bounds[uiMapId]?.instance;
  for (const c of quests.continents) requireValid(instanceOf(c.uiMapId) === c.instance, `continent ${c.uiMapId} bounds`);
  const zoneIds = new Set(quests.zones.map((z) => z.id));
  for (const q of quests.quests)
    for (const facts of [q, ...Object.values(q.byFaction ?? {})])
      for (const p of [...(facts.startPoints ?? []), ...(facts.endPoints ?? []), ...(facts.objectivePoints ?? [])]) {
        requireValid(zoneIds.has(p.zoneId), `quest ${q.id} point zone reference`);
        requireValid(instanceOf(p.uiMapId) === p.world.instance, `quest ${q.id} point map reference`);
      }
  const instances = new Set(Object.values(geometry.bounds).map((b) => b.instance));
  for (const [id, node] of Object.entries(quests.flightNodes ?? {}))
    requireValid(instances.has(node.world.instance), `flight node ${id} map reference`);
  const transports = m.transports === undefined ? undefined : decodeTransportsFile(decoded.get(m.transports));
  for (const node of transports?.nodes ?? []) requireValid(instances.has(node.world.instance), `transport node ${node.id} map reference`);
  const fileNames = (table?: Record<string, { fileName: string }>) => table && new Set(Object.values(table).map((r) => r.fileName));
  const classNames = fileNames(quests.classes),
    raceNames = fileNames(quests.races);
  transports?.links.forEach(({ requires }, i) => {
    requireValid(!classNames || requires.class === undefined || classNames.has(requires.class), `transport link ${i} class reference`);
    requireValid(!raceNames || requires.race === undefined || raceNames.has(requires.race), `transport link ${i} race reference`);
  });
  const interiorMaps = new Map(interiors?.interiors.map((i) => [i.id, i.map]));
  for (const [id, npc] of Object.entries(quests.npcs ?? {}))
    for (const s of npc.spawns ?? [])
      if ("interior" in s) requireValid(interiorMaps.get(s.interior) === s.world.instance, `NPC ${id} spawn interior reference`);
  used.add(m.quests);
  used.add(m.entities);
  if (m.interiors !== undefined) used.add(m.interiors);
  if (m.transports !== undefined) used.add(m.transports);
  if (m.guideIcons !== undefined) used.add(m.guideIcons);
  for (const value of [geometry, terrain, quests, entities]) checkSourceLabels(value, m.sources);
  requireValid(
    m.assets.every((a) => used.has(a.path)),
    "unreferenced declared asset",
  );
  const dataset: ValidatedDataset = { manifest: m, quests, entities, geometry, bounds: restoreMapBounds(geometry.bounds), terrain };
  if (guideIcons) dataset.guideIcons = guideIcons;
  const startupPaths = new Set(startup.map((a) => a.path));
  for (const [path, bytes] of files) {
    const surfaces = surfaceUses.get(path);
    if (surfaces) await checkInteriorSurfaces(declared.get(path)!, surfaces, bytes);
    else if (path.startsWith(`${m.tileBase}/`) && tiles.has(path.slice(m.tileBase.length + 1))) await acceptMapTile(dataset, path, bytes);
    else if (path === guideIcons?.image) await acceptGuideIconImage(dataset, path, bytes);
    else if (uses.has(path) || !startupPaths.has(path)) await checkInteriorImage(declared.get(path)!, uses.get(path), bytes);
  }
  if (interiors) dataset.interiors = interiors;
  if (transports) dataset.transports = transports;
  return dataset;
}

const mapTiles = new WeakMap<WorldMapData, Set<string>>();

/** Checks one terrain tile's exact membership, declared WebP format, size, SHA-256, and container. */
export async function acceptMapTile(
  dataset: Pick<ValidatedDataset, "manifest" | "terrain">,
  path: string,
  input: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const { manifest, terrain } = dataset;
  let tiles = mapTiles.get(terrain);
  if (!tiles) {
    tiles = new Set(worldMapTiles(terrain));
    mapTiles.set(terrain, tiles);
  }
  const prefix = `${manifest.tileBase}/`;
  const asset = manifest.assets.find((a) => a.path === path);
  requireValid(
    asset && asset.format === "webp" && path.startsWith(prefix) && tiles.has(path.slice(prefix.length)),
    `map tile reference ${path}`,
  );
  const bytes = new Uint8Array(input);
  await validateDatasetAsset(asset, bytes);
  validateImageContainer("webp", bytes, path);
}

/**
 * Validates the stored bytes of a validated dataset's guide icon sheet, such
 * as when a consumer first draws an icon. Checks that the guide icons file
 * names `path`, the declared PNG format, size, and SHA-256, and that the
 * image's header gives the sheet size of the file's rows and columns. Like
 * every image check, it does not decode pixels. Neither input changes.
 */
export async function acceptGuideIconImage(
  dataset: Pick<ValidatedDataset, "manifest" | "guideIcons">,
  path: string,
  input: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const { manifest, guideIcons } = dataset;
  const asset = manifest.assets.find((a) => a.path === path);
  requireValid(asset && asset.format === "png" && path === guideIcons?.image, `guide icons image reference ${path}`);
  const bytes = new Uint8Array(input);
  await validateDatasetAsset(asset, bytes);
  const header = validateImageContainer("png", bytes, path);
  const size = guideIconSheetSize(guideIcons.icons.length, guideIcons.columns);
  requireValid(header.width === size.width && header.height === size.height, `guide icons image size ${path}`);
}

/**
 * Validates the stored bytes of one interior image of a validated dataset,
 * such as when a consumer first shows it. Checks the declared size and
 * SHA-256, the image format, and the interior's image size. Neither input
 * changes.
 */
export async function acceptInteriorImage(
  dataset: Pick<ValidatedDataset, "manifest" | "interiors">,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const asset = dataset.manifest.assets.find((a) => a.path === path);
  requireValid(asset, `interior image reference ${path}`);
  await checkInteriorImage(asset, dataset.interiors && interiorImageUses(dataset.interiors).get(path), bytes);
}

/**
 * Validates the stored bytes of one interior's surfaces asset of a validated
 * dataset, and returns them decoded. Checks the declared size and SHA-256,
 * the gzip layer, and every byte of the surfaces. Neither input changes.
 */
export async function acceptInteriorSurfaces(
  dataset: Pick<ValidatedDataset, "manifest" | "interiors">,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<InteriorSurfaces> {
  const asset = dataset.manifest.assets.find((a) => a.path === path);
  const interior = dataset.interiors && interiorSurfaceUses(dataset.interiors).get(path);
  requireValid(asset && interior, `interior surfaces reference ${path}`);
  return checkInteriorSurfaces(asset, interior, bytes);
}

async function checkInteriorSurfaces(asset: DatasetAsset, interior: Interior, input: Uint8Array<ArrayBuffer>) {
  const bytes = new Uint8Array(input);
  await validateDatasetAsset(asset, bytes);
  requireValid(gzipped(bytes), `asset encoding ${asset.path}`);
  return decodeInteriorSurfaces(await gunzipSurfaces(asset.path, interior, bytes), interior);
}

async function gunzipSurfaces(path: string, interior: Interior, gzip: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const headerBytes = interior.size[0] * interior.size[1] * 3 + 4;
  const reader = new Blob([gzip]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  let limit = interiorSurfacesLimit(interior.size);
  let headerRead = false;
  for (;;) {
    const { done, value } = await reader.read().catch((error: unknown) => {
      const { message, cause } = error as Error & { cause?: Error };
      throw new Error(`Invalid asset gzip ${path} (${cause?.message || message || "unreadable"})`, { cause: error });
    });
    if (done) return joined(chunks, size);
    chunks.push(value);
    size += value.length;
    if (!headerRead && size >= headerBytes) {
      const head = joined(chunks, size);
      chunks.splice(0, chunks.length, head);
      limit = headerLimit(interior, head, headerBytes);
      headerRead = true;
    }
    if (size > limit) await reader.cancel();
    requireValid(size <= limit, `interior ${interior.id} surfaces size above ${limit} bytes`);
  }
}

// The limit with every pixel stacked is more than a gigabyte for a city, so the header's stacked count lowers it.
function headerLimit(interior: Interior, head: Uint8Array<ArrayBuffer>, headerBytes: number): number {
  const stacked = new DataView(head.buffer).getUint32(headerBytes - 4);
  return interiorSurfacesLimit(interior.size, stacked);
}

function joined(chunks: readonly Uint8Array[], size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const surfaceUses = new WeakMap<InteriorsFile, Map<string, Interior>>();
function interiorSurfaceUses(file: InteriorsFile): Map<string, Interior> {
  let uses = surfaceUses.get(file);
  if (uses) return uses;
  uses = new Map();
  for (const interior of file.interiors) {
    requireValid(!uses.has(interior.surfaces), `duplicate interior surfaces reference ${interior.surfaces}`);
    uses.set(interior.surfaces, interior);
  }
  surfaceUses.set(file, uses);
  return uses;
}

type InteriorImageUse = [width: number, height: number];

const imageUses = new WeakMap<InteriorsFile, Map<string, InteriorImageUse[]>>();
function interiorImageUses(file: InteriorsFile): Map<string, InteriorImageUse[]> {
  let uses = imageUses.get(file);
  if (uses) return uses;
  uses = new Map();
  for (const { ground, size } of file.interiors)
    for (const path of [ground.minimap, ground.plan, ground.indoor]) if (path) uses.set(path, [...(uses.get(path) ?? []), size]);
  imageUses.set(file, uses);
  return uses;
}

async function checkInteriorImage(asset: DatasetAsset, uses: readonly InteriorImageUse[] | undefined, input: Uint8Array<ArrayBuffer>) {
  const { path } = asset;
  requireValid(uses && asset.format === "webp", `interior image reference ${path}`);
  const bytes = new Uint8Array(input);
  await validateDatasetAsset(asset, bytes);
  const header = validateImageContainer(asset.format, bytes, path);
  for (const [width, height] of uses) requireValid(header.width === width && header.height === height, `interior image size ${path}`);
}

const gzipped = (bytes: Uint8Array) => bytes[0] === 0x1f && bytes[1] === 0x8b;

function checkSourceLabels(value: unknown, labels: Record<string, SourceDisplay>): void {
  if (Array.isArray(value)) {
    for (const child of value) checkSourceLabels(child, labels);
  } else if (object(value))
    for (const [key, child] of Object.entries(value)) {
      if (key === "source" && typeof child === "string") requireValid(Object.hasOwn(labels, child), `source display ${child}`);
      if (key === "evidence" && object(child)) {
        for (const source of Object.keys(child)) requireValid(Object.hasOwn(labels, source), `source display ${source}`);
      } else if (key !== "pins") checkSourceLabels(child, labels);
    }
}
