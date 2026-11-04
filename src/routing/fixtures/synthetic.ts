// The tiles follow the data producer's routing artifact format.

import { artifactId, floorPath, sha256Hex, tilePath, ZONES_PATH, type ArtifactScope, type ManifestBody, type RoutingPin, type Tile } from "../artifact.ts";
import { encodeFloor, type FloorTile } from "../floor.ts";

function flatTile([x, y]: Tile): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(35362);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RXRT"));
  view.setUint16(4, 1, true);
  view.setUint16(6, x, true);
  view.setUint16(8, y, true);
  view.setFloat64(24, 1, true);
  return bytes;
}

export const syntheticScope = (map = 0): ArtifactScope => ({ variant: "synthetic", build: "0.0.0.0", map });

export function emptyZones(tiles: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(8 + 256 * tiles);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RXRZ"));
  view.setUint16(4, 1, true);
  view.setUint16(6, tiles, true);
  return bytes;
}

/** `present` tiles are frame-relative. `floors` gives the floor tiles. */
export async function flatArtifact(
  map: number,
  origin: Tile,
  size: Tile,
  present: Tile[],
  floors: FloorTile[] = [],
): Promise<{ files: Map<string, Uint8Array<ArrayBuffer>>; pin: RoutingPin }> {
  const files = new Map<string, Uint8Array<ArrayBuffer>>([[ZONES_PATH, emptyZones(present.length)]]);
  for (const tile of present) files.set(tilePath(tile), flatTile(tile));
  for (const floor of floors) files.set(floorPath(floor.tile), Uint8Array.from(encodeFloor(floor)));
  const assets = await Promise.all([...files].map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await sha256Hex(bytes) })));
  assets.sort((a, b) => (a.path < b.path ? -1 : 1));
  const input = { path: "synthetic", sha256: "0".repeat(64) };
  const rest: ManifestBody = {
    schema: "restedxp-routing-artifact",
    version: 4,
    scope: syntheticScope(map),
    frame: { origin, size, tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
    tiles: present.map((tile) => ({ tile, state: "present" as const })).sort((a, b) => a.tile[1] - b.tile[1] || a.tile[0] - b.tile[0]),
    zones: [],
    assets,
    ...(floors.length && { floors: { dataset: input, spawns: input, liquidTypes: input }, floorClimb: 1.0666664 }),
  };
  const id = await artifactId(rest);
  const manifest = new TextEncoder().encode(`${JSON.stringify({ ...rest, id }, null, 2)}\n`);
  files.set("manifest.json", manifest);
  const pin: RoutingPin = { map, id, manifestSha256: await sha256Hex(manifest) };
  return { files, pin };
}
