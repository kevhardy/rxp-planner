import type { Point } from "./frame.ts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { artifactId, type ArtifactManifest, loadArtifact, tilePath } from "./artifact.ts";
import { COARSE_DIR, COARSE_PLACES as PLACES, UNDER_DECK_HEIGHT, withoutCoarse } from "./fixtures/coarse.ts";
import { floorPin } from "./fixtures/repin.ts";
import { DEFAULT_LEG } from "./plan.ts";
import { coarseBound, type LegRequest, routeLeg, stopKeys } from "./search.ts";
import { createTerrain, type Terrain } from "./terrain.ts";

async function open(change?: (manifest: ArtifactManifest) => void, failing = new Set<string>()) {
  let bytes = new Uint8Array(readFileSync(`${COARSE_DIR}manifest.json`));
  if (change) {
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as ArtifactManifest;
    change(manifest);
    const { id: _, ...rest } = manifest;
    manifest.id = await artifactId(rest);
    bytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  }
  const read = async (path: string) => {
    if (failing.has(path)) throw new Error(`Could not read ${path}`);
    return path === "manifest.json" ? bytes : new Uint8Array(readFileSync(`${COARSE_DIR}${path}`));
  };
  const pin = await floorPin(bytes);
  const load = await loadArtifact(read, pin);
  if (!load.ok) throw new Error(load.reason);
  return createTerrain(load.artifact);
}

const RUN = { name: "Run", speed: 7, activation: 0 };
const REQUEST: LegRequest = { maxSlope: 50, mode: RUN, swimming: { enabled: true, speed: 4.7 }, fatalFalls: true };

async function expectRoute(terrain: Terrain, from: Point, to: Point, request = REQUEST) {
  const [withLayer, without] = [
    await routeLeg(terrain, from, to, DEFAULT_LEG, request),
    await routeLeg(withoutCoarse(terrain), from, to, DEFAULT_LEG, request),
  ];
  expect(without.kind).toBe("route");
  expect(withLayer.kind).toBe("route");
  if (withLayer.kind !== "route" || without.kind !== "route") return;
  expect(withLayer.seconds).toBeCloseTo(without.seconds, 9);
  const least = await coarseBound(terrain, { point: from }, { point: to }, DEFAULT_LEG, request);
  expect(least).toBeGreaterThan(0);
  expect(least).toBeLessThanOrEqual(without.seconds);
}

async function expectNoPath(terrain: Terrain, from: Point, to: Point, request = REQUEST) {
  expect((await routeLeg(withoutCoarse(terrain), from, to, DEFAULT_LEG, request)).kind).toBe("no-path");
  expect((await routeLeg(terrain, from, to, DEFAULT_LEG, request)).kind).toBe("no-path");
  expect(await coarseBound(terrain, { point: from }, { point: to }, DEFAULT_LEG, request)).toBe(Infinity);
}

describe("the coarse layer in the route search", () => {
  it("bounds a chain of steep descents across regions and tiles", async () => {
    const terrain = await open();
    await expectRoute(terrain, PLACES.plateau, PLACES.lowland);
    await expectRoute(terrain, PLACES.plateau, PLACES.south);
    await expectNoPath(terrain, PLACES.lowland, PLACES.plateau);
  });

  it("bounds a route through a door path", async () => {
    await expectRoute(await open(), PLACES.plateau, PLACES.court);
  });

  it("bounds a one-way drop, and proves that no route climbs it", async () => {
    const terrain = await open();
    await expectRoute(terrain, PLACES.plateau, PLACES.pit);
    await expectNoPath(terrain, PLACES.pit, PLACES.plateau);
  });

  it("bounds a route that walks and swims, and proves no route without swimming", async () => {
    const terrain = await open();
    await expectRoute(terrain, PLACES.plateau, PLACES.shore);
    await expectRoute(terrain, PLACES.plateau, PLACES.shore, { ...REQUEST, swimming: { enabled: true, speed: 9 } });
    await expectNoPath(terrain, PLACES.plateau, PLACES.shore, { ...REQUEST, swimming: { enabled: false, speed: 4.7 } });
  });

  it("does not prove no route across a tile that is missing", async () => {
    const terrain = await open((m) => m.tiles.splice(1, 0, { tile: [1, 0], state: "missing" }));
    const result = await routeLeg(terrain, PLACES.shore, PLACES.east, DEFAULT_LEG, REQUEST);
    expect(result.kind).toBe("missing-coverage");
    expect(await terrain.coarse?.()).toBeUndefined();
    expect(await coarseBound(terrain, { point: PLACES.shore }, { point: PLACES.east }, DEFAULT_LEG, REQUEST)).toBeUndefined();
  });

  it("gives no stop keys while a tile next to the stop fails to load", async () => {
    const { underDeck } = PLACES;
    const [plateau, deck] = [{ point: PLACES.plateau }, { point: underDeck, height: UNDER_DECK_HEIGHT }];
    const failing = new Set([tilePath([0, 1])]);
    const terrain = await open(undefined, failing);
    expect(await stopKeys(terrain, underDeck, UNDER_DECK_HEIGHT, DEFAULT_LEG, REQUEST)).toBeUndefined();
    expect(await coarseBound(terrain, plateau, deck, DEFAULT_LEG, REQUEST)).toBeUndefined();
    failing.clear();
    const route = await routeLeg(terrain, PLACES.plateau, underDeck, DEFAULT_LEG, { ...REQUEST, heights: { to: UNDER_DECK_HEIGHT } });
    expect(route.kind).toBe("route");
    if (route.kind !== "route") return;
    const least = await coarseBound(terrain, plateau, deck, DEFAULT_LEG, REQUEST);
    expect(least).toBeGreaterThan(0);
    expect(least).toBeLessThanOrEqual(route.seconds);
  });
});
