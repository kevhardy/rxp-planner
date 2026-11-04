import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadArtifact, tilePath } from "./artifact.ts";
import { COARSE_DIR, COARSE_PLACES, UNDER_DECK_HEIGHT } from "./fixtures/coarse.ts";
import { floorPin } from "./fixtures/repin.ts";
import { DEFAULT_LEG } from "./plan.ts";
import { coarseBound, stopKeys } from "./search.ts";
import {
  DEFAULT_STOP_SETTINGS,
  findStopKeys,
  parseStopTable,
  seedStopKeys,
  STOP_TABLE_FORMAT,
  stopRequest,
  stopTableText,
  type StopTable,
} from "./stop-table.ts";
import { createTerrain } from "./terrain.ts";

async function open(failing = new Set<string>()) {
  const reads: string[] = [];
  const read = async (path: string) => {
    reads.push(path);
    if (failing.has(path)) throw new Error(`Could not read ${path}`);
    return new Uint8Array(readFileSync(`${COARSE_DIR}${path}`));
  };
  const pin = await floorPin(new Uint8Array(readFileSync(`${COARSE_DIR}manifest.json`)));
  const load = await loadArtifact(read, pin);
  if (!load.ok) throw new Error(load.reason);
  reads.length = 0;
  return { terrain: createTerrain(load.artifact), id: load.artifact.manifest.id, tiles: () => reads.filter((p) => p !== "coarse.bin") };
}

const PLATEAU_COURT_AND_DECK = [
  { point: COARSE_PLACES.plateau },
  { point: COARSE_PLACES.court },
  { point: COARSE_PLACES.underDeck, height: UNDER_DECK_HEIGHT },
];
const TILE_IN_EVERY_STOP_REGION = tilePath([0, 1]);
const { leg, request } = stopRequest(DEFAULT_STOP_SETTINGS);

async function table(): Promise<StopTable> {
  const { terrain, id } = await open();
  const stops = await findStopKeys(terrain, PLATEAU_COURT_AND_DECK, DEFAULT_STOP_SETTINGS);
  const t = { format: STOP_TABLE_FORMAT, version: 1, transports: "0".repeat(64), probe: "1".repeat(64), settings: DEFAULT_STOP_SETTINGS };
  return { ...t, maps: [{ map: 0, artifact: id, stops }] } as StopTable;
}

describe("the stop table", () => {
  it("holds the keys that stopKeys finds, and no stop whose region fails to load", async () => {
    const { stops } = (await table()).maps[0]!;
    expect(stops).toHaveLength(3);
    const fresh = await open();
    for (const [x, y, height, keys] of stops)
      expect(await stopKeys(fresh.terrain, [x, y], height ?? undefined, leg, request)).toEqual(keys);
    const failing = await open(new Set([TILE_IN_EVERY_STOP_REGION]));
    expect(await findStopKeys(failing.terrain, PLATEAU_COURT_AND_DECK, DEFAULT_STOP_SETTINGS)).toEqual([]);
  });

  it("gives its keys without a read of the stop's region", async () => {
    const t = await table();
    const { terrain, id, tiles } = await open();
    expect(seedStopKeys(t, 0, id, terrain)).toBe(3);
    for (const [x, y, height, keys] of t.maps[0]!.stops)
      expect(await stopKeys(terrain, [x, y], height ?? undefined, leg, request)).toBe(keys);
    expect(tiles()).toEqual([]);
  });

  it("is refused for another artifact, and stopKeys then reads the region", async () => {
    const t = await table();
    const { terrain, tiles } = await open();
    expect(seedStopKeys(t, 0, "another-artifact", terrain)).toBe(0);
    expect(seedStopKeys(t, 1, t.maps[0]!.artifact, terrain)).toBe(0);
    const [x, y, , keys] = t.maps[0]!.stops[0]!;
    expect(await stopKeys(terrain, [x, y], undefined, leg, request)).toEqual(keys);
    expect(tiles().length).toBeGreaterThan(0);
  });

  it("serves only its own settings", async () => {
    const t = await table();
    const { terrain, id, tiles } = await open();
    seedStopKeys(t, 0, id, terrain);
    const [x, y] = t.maps[0]!.stops[0]!;
    await stopKeys(terrain, [x, y], undefined, leg, { ...request, maxSlope: 89 });
    expect(tiles().length).toBeGreaterThan(0);
  });

  it("bounds a ground leg from its keys, without a read of either stop's region", async () => {
    const t = await table();
    const { terrain, id, tiles } = await open();
    seedStopKeys(t, 0, id, terrain);
    const r = { ...request, mode: { name: "Run", speed: 7, activation: 0 }, swimming: { enabled: true, speed: 4.7 } };
    const bound = await coarseBound(terrain, { point: COARSE_PLACES.plateau }, { point: COARSE_PLACES.court }, DEFAULT_LEG, r);
    expect(bound).toBeCloseTo(34.4623, 4);
    expect(tiles()).toEqual([]);
  });

  it("reads back its own bytes, and refuses a malformed table", async () => {
    const t = await table();
    const text = stopTableText(t);
    expect(stopTableText(parseStopTable(JSON.parse(text)))).toBe(text);
    type Breakable = {
      version: unknown;
      settings: Record<string, unknown>;
      maps: [{ stops: [[unknown, unknown, unknown, Record<string, unknown>]] }];
    };
    const bad = (change: (value: Breakable) => void) => {
      const value = JSON.parse(text) as Breakable;
      change(value);
      return () => parseStopTable(value);
    };
    expect(bad((v) => (v.version = 2))).toThrow("table.version");
    expect(bad((v) => (v.settings.swimming = "yes"))).toThrow("table.settings.swimming");
    expect(bad((v) => v.maps[0].stops[0].pop())).toThrow("table.maps[0].stops[0][3]");
    expect(bad((v) => (v.maps[0].stops[0][3].from = [-1]))).toThrow("table.maps[0].stops[0][3].from[0]");
    expect(bad((v) => (v.maps[0].stops[0][3].extra = 1))).toThrow("unknown field");
  });
});
