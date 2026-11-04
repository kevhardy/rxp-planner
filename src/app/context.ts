import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { guideIconCatalog, type GuideIconCatalog, type GuideIconSheet } from "../data/guideIcons.ts";
import type { EntityIndex, GameData } from "../data/index.ts";
import { rowNames, type RowNames } from "../rules/index.ts";
import type { AutosaveStore } from "./autosave.ts";
import type { DatasetState, DatasetStore } from "./datasetStore.ts";
import type { LayoutStore } from "./layout.ts";
import type { MapSettingsStore } from "./map/mapSettings.ts";
import type { PlaybackSettingsStore } from "./playback/settings.ts";
import type { PlaybackStore } from "./playback/store.ts";
import type { SettingsStore } from "./preview/settings.ts";
import type { RoutingStore } from "./routing/routingStore.ts";
import type { RouteSettingsStore } from "./routing/settings.ts";
import type { EditorState, EditorStore } from "./store.ts";

export interface Stores {
  editor: EditorStore;
  autosave: AutosaveStore;
  dataset: DatasetStore;
  layout: LayoutStore;
  preview: SettingsStore;
  map: MapSettingsStore;
  playback: PlaybackStore;
  playbackSettings: PlaybackSettingsStore;
  routeSettings: RouteSettingsStore;
  routing: RoutingStore;
}

export const StoresContext = createContext<Stores | null>(null);

/** Null where no App holds the Import dialog, as in a component test. */
export const OpenImportContext = createContext<(() => void) | null>(null);

/** Game data once loaded; `null` while loading or if it failed to load. */
export const GameDataContext = createContext<GameData | null>(null);

/** The entity names once loaded; `null` while loading or if they failed to load. */
export const EntityContext = createContext<EntityIndex | null>(null);

/** The dataset's guide icons; empty while it loads, after a failure, and for a release without them. Only the picker reads `sheet`. */
export const GuideIconsContext = createContext<{ catalog: GuideIconCatalog; sheet: GuideIconSheet | undefined }>({
  catalog: guideIconCatalog(undefined),
  sheet: undefined,
});

export function useGuideIcons(): GuideIconCatalog {
  return useContext(GuideIconsContext).catalog;
}

export const EntityErrorContext = createContext(false);

export function useStores(): Stores {
  const stores = useContext(StoresContext);
  if (!stores) throw new Error("useStores needs a StoresContext provider");
  return stores;
}

export function useEditorStore(): EditorStore {
  return useStores().editor;
}

export function useEditor(): EditorState {
  const store = useEditorStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}

export function useGameData(): GameData | null {
  return useContext(GameDataContext);
}

export function useEntities(): EntityIndex | null {
  return useContext(EntityContext);
}

export function useRowNames(): RowNames {
  const data = useGameData();
  const entities = useEntities();
  return useMemo(() => rowNames(data, entities), [data, entities]);
}

export function useEntitiesFailed(): boolean {
  return useContext(EntityErrorContext);
}

export const DatasetContext = createContext<DatasetState | null>(null);
