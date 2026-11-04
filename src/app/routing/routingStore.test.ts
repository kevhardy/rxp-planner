// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { decodeTransportsFile } from "../../../packages/data-contract/transports.ts";
import * as datasetLoader from "../../data/dataset.ts";
import { zoneData } from "../../data/plannerFixture.ts";
import { syntheticScope } from "../../routing/fixtures/synthetic.ts";
import { fixtureArtifact, unrelatedEntities } from "../renderPlanner.tsx";
import { createStores } from "../stores.ts";
import { searchLane, type RoutingEngine, type RoutingLoad } from "./engine.ts";
import { layerPainter } from "./layerPainter.ts";

vi.mock("./engine.ts", async (original) => ({
  ...(await original<typeof import("./engine.ts")>()),
  searchLane: vi.fn((engine: RoutingEngine) => ({ ...engine, release: vi.fn() })),
}));

afterEach(() => {
  vi.mocked(searchLane).mockClear();
  vi.restoreAllMocks();
});

const manifest: RoutingEngine["manifest"] = {
  id: "m0",
  scope: syntheticScope(),
  frame: { origin: [23, 20], size: [23, 42], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
  tiles: [],
};

const settle = () => new Promise((resolve) => setTimeout(resolve));

function routing() {
  const engine = { manifest, maps: [{ manifest }], route: () => new Promise<never>(() => {}), release: vi.fn(), layers: layerPainter() };
  const loads: { resolve: (load: RoutingLoad) => void; reject: (error: Error) => void }[] = [];
  const stores = createStores(undefined, undefined, undefined, {
    loadRouting: () =>
      new Promise<RoutingLoad>((resolve, reject) => {
        loads.push({ resolve, reject });
      }),
  });
  const ready = async (i = 0) => {
    loads[i]!.resolve({ ok: true, engine, missing: [] });
    await settle();
  };
  return { engine, loads, store: stores.routing, stores, ready };
}

it("loads once for every use, and shows nothing until the load ends", async () => {
  const { engine, loads, store, ready } = routing();
  store.retain("routes");
  store.retain("playback");
  store.retain("zones");
  expect([loads.length, store.getState().load]).toEqual([1, null]);
  await ready();
  expect([loads.length, store.getState().load]).toEqual([1, { ok: true, engine, missing: [] }]);
});

it("loads again when a use is retained after a load in which no map loaded", async () => {
  const { loads, store } = routing();
  store.retain("zones");
  loads[0]!.resolve({ ok: false, reason: "No routing artifact is installed." });
  await settle();
  expect(store.getState().load).toEqual({ ok: false, reason: "No routing artifact is installed." });
  store.retain("routes");
  expect([loads.length, store.getState().load]).toEqual([2, null]);
  loads[1]!.reject(new Error("offline"));
  await settle();
  expect(store.getState().load).toEqual({ ok: false, reason: "offline" });
});

it("releases the engine a microtask after the last Routes holder leaves, and not when Routes mounts again in that task", async () => {
  const { engine, store, ready } = routing();
  store.retain("zones");
  const release = store.retain("routes");
  await ready();
  release();
  const again = store.retain("routes");
  await settle();
  expect(engine.release).not.toHaveBeenCalled();
  again();
  await settle();
  expect([engine.release.mock.calls.length, store.getState().load]).toEqual([1, { ok: true, engine, missing: [] }]);
});

it("releases an engine that arrives after the last Routes holder left", async () => {
  const { engine, store, ready } = routing();
  store.retain("routes")();
  await settle();
  await ready();
  expect([engine.release.mock.calls.length, store.getState().load]).toEqual([1, { ok: true, engine, missing: [] }]);
});

it("keeps an engine that arrives after Routes left and came back", async () => {
  const { engine, store, ready } = routing();
  store.retain("routes")();
  await settle();
  store.retain("routes");
  await ready();
  expect([engine.release.mock.calls.length, store.getState().load?.ok]).toEqual([0, true]);
});

it("makes Playback's lane once, keeps it through a remount, and releases it when Playback leaves", async () => {
  const { engine, store, ready } = routing();
  const release = store.retain("playback");
  await ready();
  const { lane } = store.getState();
  release();
  const again = store.retain("playback");
  await settle();
  expect([vi.mocked(searchLane).mock.calls, store.getState().lane]).toEqual([[[engine]], lane]);
  again();
  await settle();
  expect([vi.mocked(lane!.release).mock.calls.length, store.getState().lane]).toEqual([1, null]);
});

it("gives Playback the engine's painter only after Routes released the engine", async () => {
  const { engine, store, ready } = routing();
  const routes = store.retain("routes");
  await ready();
  store.retain("playback");
  routes();
  expect(store.getState().painter).toBeNull();
  await Promise.resolve();
  expect([engine.release.mock.calls.length, store.getState().painter]).toEqual([1, engine.layers]);
});

it("places the dataset's rides on the engine's maps, and keeps the preview character's rides until its race or class changes", async () => {
  const seconds = { min: 60, average: 60, max: 60 };
  const transports = decodeTransportsFile({
    version: 1,
    nodes: [
      { id: "IRONFORGE", name: "Ironforge", world: { instance: 0, x: -1320, y: -4840 } },
      { id: "STORMWIND", name: "Stormwind City", world: { instance: 0, x: 520, y: -8360 } },
    ],
    links: [
      { service: "Deeprun Tram", mode: "tram", from: "IRONFORGE", to: "STORMWIND", requires: { faction: "Alliance" }, seconds },
      { service: "Druid flight", mode: "druid-flight", from: "STORMWIND", to: "IRONFORGE", requires: { class: "DRUID" }, seconds },
    ],
  });
  const artifact = fixtureArtifact(zoneData([]), unrelatedEntities);
  vi.spyOn(datasetLoader, "fetchDatasetArtifact").mockResolvedValue({ ...artifact, data: { ...artifact.data, transports } });
  const { store, stores, ready } = routing();
  stores.dataset.select({ manifest: "/fixture/manifest.json", base: "/fixture/" });
  store.retain("routes");
  await ready();
  const rides = () => {
    const { links, faction } = store.getState().rides;
    return [faction, links.map((link) => link.service)];
  };
  expect([store.getState().placed.length, rides()]).toEqual([2, ["Alliance", ["Deeprun Tram"]]]);

  const before = store.getState().rides;
  stores.preview.update({ showAll: true });
  expect(store.getState().rides).toBe(before);
  stores.preview.update({ race: "NightElf", class: "DRUID" });
  expect(rides()).toEqual(["Alliance", ["Deeprun Tram", "Druid flight"]]);
  stores.preview.update({ race: "Tauren" });
  expect(rides()).toEqual(["Horde", ["Deeprun Tram", "Druid flight"]]);
});
