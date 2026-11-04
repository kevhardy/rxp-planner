import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  artifactId,
  decodeZones,
  heightAt,
  loadArtifact,
  parseBundleRouting,
  parseManifest,
  type ReadAsset,
  type RoutingArtifact,
} from "./artifact.ts";
import { ARTIFACT_DIR, bundleJson, fixtureManifest, fixturePin, repin } from "./fixtures/repin.ts";

const reader =
  (replaced: Record<string, Uint8Array<ArrayBuffer> | undefined> = {}): ReadAsset =>
  async (path) => {
    if (path in replaced) return replaced[path];
    return new Uint8Array(await readFile(`${ARTIFACT_DIR}${path}`));
  };

async function opened(read = reader()): Promise<RoutingArtifact> {
  const pin = await fixturePin();
  const load = await loadArtifact(read, pin);
  if (!load.ok) throw new Error(load.reason);
  return load.artifact;
}

it("opens the pinned artifact and decodes a present tile", async () => {
  const artifact = await opened();
  expect(artifact.manifest.id).toBe("routing-forever-1.60.1.70124-m0-bdefc88aa88d6fe1");
  const tile = await artifact.tile([9, 22]);
  // The fixture stores col * 256 + row with offset -10 and scale 0.01.
  expect(heightAt(tile, 2, 3)).toBeCloseTo(-4.85, 10);
  expect(tile.holes[7 * 128 + 5]).toBe(1);
  expect(tile.liquids.map((l) => l.hazard)).toEqual(["water", "magma", "unknown"]);
  await expect(artifact.tile([10, 22])).rejects.toThrow("tiles/10_22.bin: not in the artifact");
});

it("fails only the tile whose bytes differ from the manifest", async () => {
  const bytes = new Uint8Array(await readFile(`${ARTIFACT_DIR}tiles/9_22.bin`));
  bytes[40]! ^= 1;
  const artifact = await opened(reader({ "tiles/9_22.bin": bytes }));
  await expect(artifact.tile([9, 22])).rejects.toThrow(/tiles\/9_22.bin: expected SHA-256/);
});

it("reports routing unavailable without an installed artifact", async () => {
  expect(await loadArtifact(reader({ "manifest.json": undefined }), await fixturePin())).toEqual({
    ok: false,
    reason: "No routing artifact is installed.",
  });
});

it("reports another map or schema as unavailable", async () => {
  const pin = await fixturePin();
  const unavailable = async (read: ReadAsset, p: unknown) => {
    const load = await loadArtifact(read, p as typeof pin);
    expect(load.ok).toBe(false);
    return load.ok ? "" : load.reason;
  };
  const otherMap = await repin((m) => (m.scope = { ...m.scope, map: 1 }));
  expect(await unavailable(reader({ "manifest.json": otherMap.bytes }), otherMap.pin)).toBe(
    "No pinned routing artifact for map 0: manifest.scope.map: expected 0, found 1",
  );
  const otherVersion = await repin((m) => Object.assign(m, { version: 5 }));
  expect(await unavailable(reader({ "manifest.json": otherVersion.bytes }), otherVersion.pin)).toMatch("manifest.version: expected 4");
  expect(await unavailable(reader({ "manifest.json": otherVersion.bytes }), pin)).toMatch(/manifest.json: expected SHA-256/);
});

it("reads the routing artifacts of a bundle.json, one for each map", async () => {
  const bundle = {
    schema: "rxp-planner-release-bundle",
    format: 1,
    version: "2026.10.14",
    routingBuild: "1.60.1.70124",
    dataset: { path: "dataset" },
    routing: [
      {
        map: 1,
        path: "routing/m1",
        id: "routing-forever-1.60.1.70124-m1-557f25612c706824",
        manifestSha256: "sha256:d9f73f6466b6227b53ebf8d33f1fc24a4bac4e320a97c4a759831abace395242",
      },
    ],
  };
  expect(parseBundleRouting(bundle)).toEqual([
    {
      map: 1,
      id: "routing-forever-1.60.1.70124-m1-557f25612c706824",
      manifestSha256: "d9f73f6466b6227b53ebf8d33f1fc24a4bac4e320a97c4a759831abace395242",
    },
  ]);
  const entry = bundle.routing[0]!;
  const refused = (change: Partial<typeof bundle>) => () => parseBundleRouting({ ...bundle, ...change });
  expect(refused({ routing: [entry, entry] })).toThrow("bundle.routing[1].map: expected one artifact for map 1");
  expect(refused({ routing: [{ ...entry, path: "routing/m0" }] })).toThrow("bundle.routing[0].path: expected routing/m1");
  expect(refused({ routing: [{ ...entry, manifestSha256: entry.manifestSha256.slice(7) }] })).toThrow(
    "bundle.routing[0].manifestSha256: expected sha256:",
  );
  expect(refused({ format: 2 })).toThrow("bundle.format: expected 1");
  expect(refused({ schema: "restedxp-routing-pins" })).toThrow("bundle.schema: expected rxp-planner-release-bundle");
  expect(() => parseBundleRouting({ version: 3, artifacts: [] })).toThrow("bundle.schema: missing");
  const eastern = await fixturePin();
  expect(parseBundleRouting(bundleJson(eastern))).toEqual([eastern]);
});

it("refuses a version 2 manifest", () => {
  const scope = { variant: "forever", build: "1.60.1.70124", map: 0 };
  const manifest = {
    schema: "restedxp-routing-artifact",
    version: 2,
    id: "routing-forever-1.60.1.70124-m0-040383e35bb7a41b",
    scope,
    frame: { origin: [23, 20], size: [23, 42], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
    tiles: [{ tile: [9, 22], state: "present" }],
    zones: [1426, 1432],
    assets: [
      { path: "catalog.json", bytes: 2, sha256: "33b7dc1d254c0aec4831cfb233455a33bca7e93a43dd7f2c240c3375fe9d9d72" },
      { path: "tiles/9_22.bin", bytes: 35362, sha256: "0".repeat(64) },
      { path: "zones.bin", bytes: 264, sha256: "1".repeat(64) },
    ],
    catalog: { revision: 4, sha256: "33b7dc1d254c0aec4831cfb233455a33bca7e93a43dd7f2c240c3375fe9d9d72" },
  };
  expect(() => parseManifest(manifest)).toThrow("manifest.version: expected 4");
});

it("checks the producer's ID, which covers the floor inputs and the floor climb", async () => {
  const manifest = parseManifest(await fixtureManifest());
  const { id, ...rest } = manifest;
  expect(await artifactId(rest)).toBe(id);
  expect(manifest.floors?.dataset.path).toBe("data/entities-forever.json.gz");
  expect(manifest.floorClimb).toBe(1.0666664);
  const changed = await repin((m) => (m.floors!.spawns.sha256 = "0".repeat(64)));
  expect(changed.pin.id).not.toBe(id);
  const climb = await repin((m) => (m.floorClimb = 2));
  expect(climb.pin.id).not.toBe(id);
});

it.each(
  readdirSync(new URL("fixtures/records/invalid/", import.meta.url))
    .filter((name) => name.startsWith("manifest-"))
    .map((name) => [name, new URL(`fixtures/records/invalid/${name}`, import.meta.url)] as const),
)("refuses the producer's invalid case %s", (_, url) => {
  const { error, input } = JSON.parse(readFileSync(url, "utf8")) as { error: string; input: unknown };
  expect(() => parseManifest(input)).toThrow(error);
});

it("decodes zones.bin and refuses a file that does not match the manifest", async () => {
  const bytes = new Uint8Array(await readFile(`${ARTIFACT_DIR}zones.bin`));
  // The fixture's one tile: chunk rows 0 to 7 are zone index 1, then index 2, except the last chunk, which has no zone.
  const [tile] = decodeZones(bytes, 1, 2);
  expect([tile![0], tile![127], tile![128], tile![255]]).toEqual([1, 1, 2, 0]);
  const changed = (at: number, value: number) => bytes.map((b, i) => (i === at ? value : b));
  expect(() => decodeZones(changed(0, 0x51), 1, 2)).toThrow("zones.bin: expected the magic bytes RXRZ");
  expect(() => decodeZones(bytes.subarray(0, -1), 1, 2)).toThrow("zones.bin: expected 8 bytes and 256 for each present tile");
  expect(() => decodeZones(bytes, 2, 2)).toThrow("zones.bin: expected 8 bytes and 256 for each present tile");
  expect(() => decodeZones(changed(6, 2), 1, 2)).toThrow("zones.bin: expected 1 tiles");
  expect(() => decodeZones(changed(4, 2), 1, 2)).toThrow("zones.bin: expected version 1");
  expect(() => decodeZones(changed(20, 3), 1, 2)).toThrow("zones.bin: expected zone indexes from 0 to 2, found 3");
  expect(() => decodeZones(bytes, 1, 3)).toThrow("zones.bin: expected a chunk for each zone, found none for zone 3");
});
