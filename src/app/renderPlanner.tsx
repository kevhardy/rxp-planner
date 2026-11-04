import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useEffect } from "react";
import { vi } from "vitest";
import * as loader from "../data/dataset.ts";
import type { DatasetArtifact, DatasetLocation } from "../data/dataset.ts";
import { EntityIndex, type GameData, type LoadedWorldMap } from "../data/index.ts";
import { guideIconCatalog } from "../data/guideIcons.ts";
import { fixture } from "../data/manifestFixture.ts";
import { worldMap } from "../data/terrainFixture.ts";
import type { Builtins } from "../io/index.ts";
import type { StoredLibrary } from "../storage/index.ts";
import { App } from "./App.tsx";
import { startPage } from "./page.ts";
import { createStores, DEFAULT_SAVED_SETTINGS, loadSettings, type SavedSettings } from "./stores.ts";

export const unrelatedEntities = new EntityIndex({
  version: 2,
  entities: {
    npc: [[999999, "Fixture NPC"]],
    object: [[999999, "Fixture object"]],
    item: [[999999, "Fixture item"]],
    quest: [[999999, "Fixture quest"]],
    spell: [[999999, "Fixture spell"]],
  },
});

/** Sits outside StrictMode, whose simulated unmount must leave the page running. */
function StopPage({ stop }: { stop: () => void }) {
  useEffect(() => stop, [stop]);
  return null;
}

export function renderApp({
  initial,
  builtins,
  settings = DEFAULT_SAVED_SETTINGS,
  dataset,
  strict = false,
}: {
  initial: StoredLibrary;
  builtins?: Builtins | null | undefined;
  settings?: SavedSettings;
  dataset: DatasetLocation;
  strict?: boolean;
}) {
  const stores = createStores(initial, builtins, settings);
  const stop = startPage(stores, dataset);
  const app = <App stores={stores} />;
  const view = render(
    <>
      {strict ? <StrictMode>{app}</StrictMode> : app}
      <StopPage stop={stop} />
    </>,
  );
  return { ...view, stores };
}

export function fixtureArtifact(game: GameData, entities: EntityIndex, terrain: LoadedWorldMap = worldMap): DatasetArtifact {
  return {
    data: {
      manifest: fixture().manifest,
      game,
      entities,
      transports: { version: 1, nodes: [], links: [] },
      worldMap: terrain,
      guideIcons: guideIconCatalog(undefined),
      base: "/",
    },
    dispose() {},
  };
}

export async function renderPlanner({
  initial,
  builtins,
  loadGameData,
  loadEntities = () => Promise.resolve(unrelatedEntities),
  loadWorldMap,
}: {
  initial: StoredLibrary;
  builtins?: Builtins | null | undefined;
  loadGameData: () => Promise<GameData>;
  loadEntities?: () => Promise<EntityIndex>;
  loadWorldMap?: (() => Promise<LoadedWorldMap>) | undefined;
}) {
  vi.spyOn(loader, "fetchDatasetArtifact").mockImplementation(async () => {
    const [game, entities, terrain] = await Promise.all([loadGameData(), loadEntities(), loadWorldMap?.() ?? worldMap]);
    return fixtureArtifact(game, entities, terrain);
  });
  const view = renderApp({
    initial,
    builtins,
    settings: await loadSettings(),
    dataset: { manifest: "/fixture/manifest.json", base: "/fixture/" },
  });
  return { user: userEvent.setup(), ...view };
}
