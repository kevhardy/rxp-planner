import type { Builtins } from "../io/index.ts";
import type { PlaybackChoices } from "../rules/index.ts";
import type { StoredLibrary } from "../storage/index.ts";
import { AutosaveStore } from "./autosave.ts";
import type { Stores } from "./context.ts";
import { DatasetStore } from "./datasetStore.ts";
import { DEFAULT_LAYOUT, LayoutStore, loadLayout, type Layout } from "./layout.ts";
import { DEFAULT_MAP_SETTINGS, loadMapSettings, MapSettingsStore, type MapSettings } from "./map/mapSettings.ts";
import { loadPlaybackChoices, PlaybackSettingsStore } from "./playback/settings.ts";
import { PlaybackStore } from "./playback/store.ts";
import { DEFAULT_SETTINGS, loadPreviewSettings, SettingsStore, type PreviewSettings } from "./preview/settings.ts";
import { loadRouting, type RoutingLoad } from "./routing/engine.ts";
import { RoutingStore } from "./routing/routingStore.ts";
import { DEFAULT_ROUTE_SETTINGS, loadRouteSettings, RouteSettingsStore, type RouteSettings } from "./routing/settings.ts";
import { EditorStore } from "./store.ts";

export interface SavedSettings {
  layout: Layout;
  preview: PreviewSettings;
  map: MapSettings;
  playback: PlaybackChoices;
  routes: RouteSettings;
}

export const DEFAULT_SAVED_SETTINGS: SavedSettings = {
  layout: DEFAULT_LAYOUT,
  preview: DEFAULT_SETTINGS,
  map: DEFAULT_MAP_SETTINGS,
  playback: {},
  routes: DEFAULT_ROUTE_SETTINGS,
};

/** Reads the saved settings in parallel; it never rejects. */
export async function loadSettings(): Promise<SavedSettings> {
  const [layout, preview, map, playback, routes] = await Promise.all([
    loadLayout(),
    loadPreviewSettings(),
    loadMapSettings(),
    loadPlaybackChoices(),
    loadRouteSettings(),
  ]);
  return { layout, preview, map, playback, routes };
}

/**
 * The stores fetch nothing and listen to no page events until `startPage`.
 * They only subscribe to each other. Routing loads on its first retain.
 */
export function createStores(
  library: StoredLibrary = { guides: [] },
  builtins?: Builtins | null,
  settings: SavedSettings = DEFAULT_SAVED_SETTINGS,
  options: { loadRouting?: () => Promise<RoutingLoad> } = {},
): Stores {
  const editor = new EditorStore(library, builtins);
  const dataset = new DatasetStore();
  const preview = new SettingsStore(editor, settings.preview);
  dataset.subscribe(() => preview.setGame(dataset.getState().data?.game));
  return {
    editor,
    autosave: new AutosaveStore(editor, library),
    dataset,
    layout: new LayoutStore(settings.layout),
    preview,
    map: new MapSettingsStore(settings.map),
    playback: new PlaybackStore(),
    playbackSettings: new PlaybackSettingsStore(settings.playback),
    routeSettings: new RouteSettingsStore(settings.routes),
    routing: new RoutingStore(dataset, preview, options.loadRouting ?? loadRouting),
  };
}
