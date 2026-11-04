import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { decodeGuideIconsFile } from "../../packages/data-contract/guideIcons.ts";
import { validateCompleteEntityData, validateCompleteGameData } from "../../packages/data-contract/completeData.ts";
import type { DatasetGeometry, DatasetManifest } from "../../packages/data-contract/manifest.ts";
import { buildGameData } from "./dataset.ts";
import { EntityIndex } from "./entities.ts";
import type { LoadedWorldMap } from "./worldMap.ts";

const manifestPath = process.env.RXP_RELEASE_MANIFEST;
const base = process.env.RXP_RELEASE_BASE;
if (!manifestPath || !base) throw new Error("The release inputs need an explicit manifest and artifact root");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as DatasetManifest;
const read = (path: string): unknown => {
  const bytes = readFileSync(join(base, path));
  const asset = manifest.assets.find((a) => a.path === path);
  if (!asset) throw new Error(`Undeclared release asset: ${path}`);
  return JSON.parse((asset.encoding === "gzip" ? gunzipSync(bytes) : bytes).toString());
};
export const releaseGeometry = read(manifest.geometry) as DatasetGeometry;
export const releaseTerrain = {
  ...(read(manifest.terrain) as LoadedWorldMap),
  icons: manifest.icons,
  tileBase: `${base}/${manifest.tileBase}/`,
};
export function releaseFile() {
  const file = read(manifest.quests);
  validateCompleteGameData(file);
  return file;
}
export function releaseData() {
  return buildGameData({ quests: releaseFile(), geometry: releaseGeometry, terrain: releaseTerrain, sources: manifest.sources });
}
export function releaseEntities() {
  return new EntityIndex(releaseNames());
}
export function releaseNames() {
  const file = read(manifest.entities);
  validateCompleteEntityData(file);
  return file;
}
export function releaseGuideIcons() {
  if (!manifest.guideIcons) throw new Error("The release has no guide icons table");
  return decodeGuideIconsFile(read(manifest.guideIcons));
}
