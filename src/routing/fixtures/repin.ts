import { cp, readFile } from "node:fs/promises";
import { artifactId, BUNDLE_SCHEMA, sha256Hex, type ArtifactManifest, type RoutingPin } from "../artifact.ts";

export const ARTIFACT_DIR = `${import.meta.dirname}/artifact/`;

export async function fixturePin(): Promise<RoutingPin> {
  const { id, scope, manifestSha256 } = JSON.parse(await readFile(`${import.meta.dirname}/artifact-pin.json`, "utf8")) as Pick<
    ArtifactManifest,
    "id" | "scope"
  > & { manifestSha256: string };
  return { map: scope.map, id, manifestSha256 };
}
export const bundleJson = (...pins: RoutingPin[]) => ({
  schema: BUNDLE_SCHEMA,
  format: 1,
  version: "test",
  dataset: { path: "dataset" },
  routing: pins.map(({ map, id, manifestSha256 }) => ({
    map,
    path: `routing/m${map}`,
    id,
    manifestSha256: `sha256:${manifestSha256}`,
  })),
});
export const fixtureManifest = async (): Promise<ArtifactManifest> =>
  JSON.parse(await readFile(`${ARTIFACT_DIR}manifest.json`, "utf8")) as ArtifactManifest;

export async function installFixture(dir: string): Promise<RoutingPin> {
  await cp(ARTIFACT_DIR, dir, { recursive: true });
  return fixturePin();
}

export async function floorPin(bytes: Uint8Array<ArrayBuffer>): Promise<RoutingPin> {
  const { id, scope } = JSON.parse(new TextDecoder().decode(bytes)) as ArtifactManifest;
  return { map: scope.map, id, manifestSha256: await sha256Hex(bytes) };
}

/** The fixture's manifest bytes and pin. A `change` also gives the manifest its new ID; the pin keeps the fixture's map. */
export async function repin(change?: (manifest: ArtifactManifest) => void): Promise<{ bytes: Uint8Array<ArrayBuffer>; pin: RoutingPin }> {
  if (!change) return { bytes: new Uint8Array(await readFile(`${ARTIFACT_DIR}manifest.json`)), pin: await fixturePin() };
  const manifest = await fixtureManifest();
  change(manifest);
  const { id: _, ...rest } = manifest;
  manifest.id = await artifactId(rest);
  const bytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  return { bytes, pin: { ...(await fixturePin()), id: manifest.id, manifestSha256: await sha256Hex(bytes) } };
}
