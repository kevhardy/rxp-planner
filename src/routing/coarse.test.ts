import { afterEach, describe, expect, it, vi } from "vitest";
import { COARSE_PATH, TILE_PIXELS, TILE_WORLD_UNITS, type ArtifactManifest } from "./artifact.ts";
import { decodeCoarse, groundHash, loadCoarse, regionOf } from "./coarse.ts";
import { encodeNodeKey } from "./node-key.ts";

const frame = { origin: [0, 0], size: [1, 1], tilePixels: TILE_PIXELS, cellsPerTile: 128, tileWorldUnits: TILE_WORLD_UNITS };
const manifest = (paths: string[], tiles = [{ tile: [0, 0], state: "present" }]) =>
  ({
    frame,
    tiles,
    assets: ["tiles/0_0.bin", ...paths].map((path) => ({ path, bytes: 1, sha256: "0".repeat(64) })),
  }) as unknown as ArtifactManifest;

const REACH = 7,
  SPAN = 2 * REACH + 1;
const sourceRegionCode = (dx: number, dy: number, local: number) => (((dy + REACH) * SPAN + dx + REACH) << 8) | local;

function oneRegionLayer(ground: string, swim: number, code = sourceRegionCode(0, 0, 0)) {
  const supercells = 16;
  const words = (list: number[]) => new Uint8Array(Uint32Array.from(list).buffer);
  const halves = (list: number[]) => {
    const out = new Uint8Array((list.length * 2 + 3) & ~3);
    out.set(new Uint8Array(Uint16Array.from(list).buffer));
    return out;
  };
  const header = new Uint8Array(64);
  const view = new DataView(header.buffer);
  header.set(new TextEncoder().encode("RXRC"));
  view.setUint16(4, 2, true);
  view.setUint16(6, 32, true);
  view.setUint16(10, 4, true);
  view.setUint16(12, 4, true);
  view.setUint8(14, 1);
  view.setUint8(15, 8);
  view.setUint32(16, 1, true);
  view.setUint32(28, 0.89 * 2 ** 24, true);
  for (let i = 0; i < 32; i++) header[32 + i] = Number.parseInt(ground.slice(i * 2, i * 2 + 2), 16);
  const band = new Uint8Array(12);
  band[0] = 89;
  new DataView(band.buffer).setUint32(8, 1, true);
  const parts = [
    header,
    words([0, ...Array(supercells).fill(1)]),
    words(Array(supercells).fill(0)),
    band,
    words([0]),
    words([0, 0]),
    words([0, 1]),
    halves([code]),
    halves([swim * 8]),
  ];
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) bytes.set(p, (at += p.length) - p.length);
  return bytes;
}

const key = (x: number, y: number, k = 0) => encodeNodeKey(x, y, k);
const run = { name: "Run", speed: 7, activation: 0 };

afterEach(() => vi.restoreAllMocks());

describe("the coarse layer", () => {
  it("finds the region of a node and bounds the seconds by its length and swim length", async () => {
    const coarse = decodeCoarse(oneRegionLayer("0".repeat(64), 1));
    expect([regionOf(coarse, key(31, 31)), regionOf(coarse, key(32, 0))]).toEqual([0, -1]);
    const ground = await groundHash(manifest([COARSE_PATH]));
    const loaded = (await loadCoarse({ manifest: manifest([COARSE_PATH]), read: async () => oneRegionLayer(ground, 1) }))!;
    const band = loaded.band(49)!;
    expect(loaded.band(90)).toBeUndefined();
    const to = loaded.toward(band, [key(0, 0)]);
    const swimming = { enabled: true, speed: 4.7 };
    expect(loaded.seconds(to, [key(5, 5)], { mode: run, swimming })).toBeCloseTo(1 / 4.7 - 1 / 7, 9);
    expect(loaded.seconds(to, [key(5, 5)], { mode: run, swimming: { ...swimming, enabled: false } })).toBe(Infinity);
    expect(loaded.seconds(to, [key(40, 5)], { mode: run, swimming })).toBeUndefined();
    expect(loaded.separated(band, [key(5, 5)], [key(0, 0)])).toBe(false);
  });

  it("refuses a code for a region that is not there", () => {
    for (const code of [sourceRegionCode(0, 0, 1), sourceRegionCode(-1, 0, 0)])
      expect(() => decodeCoarse(oneRegionLayer("0".repeat(64), 1, code))).toThrow("a region index is out of range");
  });

  it("is left out when the artifact has none, or when it does not fit the artifact's ground", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const read = async () => oneRegionLayer("0".repeat(64), 0);
    expect(await loadCoarse({ manifest: manifest([]), read })).toBeUndefined();
    expect(await loadCoarse({ manifest: manifest([COARSE_PATH]), read })).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(`${COARSE_PATH}: expected the ground hash of the tiles and floor tiles`);
  });

  it("is left out for another version, and for an artifact with a missing tile", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ground = await groundHash(manifest([COARSE_PATH]));
    const old = oneRegionLayer(ground, 0);
    new DataView(old.buffer, old.byteOffset).setUint16(4, 1, true);
    expect(await loadCoarse({ manifest: manifest([COARSE_PATH]), read: async () => old })).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(`${COARSE_PATH}: expected version 2`);
    const missing = manifest(
      [COARSE_PATH],
      [
        { tile: [0, 0], state: "present" },
        { tile: [1, 0], state: "missing" },
      ],
    );
    expect(await loadCoarse({ manifest: missing, read: async () => oneRegionLayer(ground, 0) })).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(`${COARSE_PATH}: expected no missing tiles: a route can cross one`);
  });
});
