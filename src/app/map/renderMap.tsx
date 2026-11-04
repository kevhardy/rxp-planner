import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EntityIndex, GameData, LoadedWorldMap } from "../../data/index.ts";
import { guideIconCatalog } from "../../data/guideIcons.ts";
import { fixture } from "../../data/manifestFixture.ts";
import { worldMap as fixtureWorldMap } from "../../data/terrainFixture.ts";
import type { Builtins } from "../../io/index.ts";
import { saveSetting } from "../../storage/index.ts";
import { DatasetContext, EntityContext, GameDataContext, StoresContext } from "../context.ts";
import { unrelatedEntities } from "../renderPlanner.tsx";
import { createStores, loadSettings } from "../stores.ts";
import { DEFAULT_MAP_SETTINGS, type MapSettings } from "./mapSettings.ts";
import { MapColumn } from "./MapPanel.tsx";
import { useWorldMapStore, type WorldMapStore } from "./worldMapStore.ts";

export interface MapOptions {
  data: GameData;
  texts?: string[];
  map?: Partial<MapSettings>;
  worldMap?: LoadedWorldMap;
  builtins?: Builtins;
  step?: number | null;
  entities?: EntityIndex;
}

export async function renderMap({
  data,
  texts = [],
  map,
  worldMap = fixtureWorldMap,
  builtins,
  step = 0,
  entities = unrelatedEntities,
}: MapOptions) {
  if (map) await saveSetting("map", { ...DEFAULT_MAP_SETTINGS, ...map });
  const stores = createStores(
    {
      guides: texts.map((text, i) => ({ id: `g${i}`, text, order: i })),
      session: { guideId: builtins?.guides[0]?.id ?? "g0", step, line: null },
    },
    builtins ?? null,
    await loadSettings(),
  );
  stores.preview.setGame(data);
  const dataset = {
    data: {
      manifest: fixture().manifest,
      game: data,
      entities,
      transports: { version: 1 as const, nodes: [], links: [] },
      worldMap,
      guideIcons: guideIconCatalog(undefined),
      base: "/",
    },
  };
  const probe: { store?: WorldMapStore } = {};
  function WorldMapProbe() {
    probe.store = useWorldMapStore();
    return null;
  }
  const view = render(
    <StoresContext.Provider value={stores}>
      <DatasetContext.Provider value={dataset}>
        <GameDataContext.Provider value={data}>
          <EntityContext.Provider value={entities}>
            <MapColumn />
            <WorldMapProbe />
          </EntityContext.Provider>
        </GameDataContext.Provider>
      </DatasetContext.Provider>
    </StoresContext.Provider>,
  );
  return { user: userEvent.setup(), stores, worldMap: probe.store!, ...view };
}
