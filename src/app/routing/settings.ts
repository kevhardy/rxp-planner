import { useSyncExternalStore } from "react";
import { DEFAULT_LEG, DEFAULT_MAX_SLOPE, type Leg } from "../../routing/plan.ts";
import { useStores } from "../context.ts";
import { DEFAULT_LAYERS, loadLayerChoices, saveLayerChoices, type LayerChoices } from "./MapLayers.tsx";
import { loadNewLegs, saveNewLegs } from "./newLegs.tsx";
import { loadMaxSlope, saveMaxSlope } from "./slope.tsx";
import { DEFAULT_MODE, loadTravelMode, saveTravelMode } from "./travelMode.ts";

export interface RouteSettings {
  maxSlope: number;
  newLegs: Leg;
  mode: string;
  layers: LayerChoices;
}

export const DEFAULT_ROUTE_SETTINGS: RouteSettings = {
  maxSlope: DEFAULT_MAX_SLOPE,
  newLegs: DEFAULT_LEG,
  mode: DEFAULT_MODE,
  layers: DEFAULT_LAYERS,
};

export async function loadRouteSettings(): Promise<RouteSettings> {
  const [maxSlope, newLegs, mode, layers] = await Promise.all([loadMaxSlope(), loadNewLegs(), loadTravelMode(), loadLayerChoices()]);
  return { maxSlope, newLegs, mode, layers };
}

const SAVE: { [K in keyof RouteSettings]: (value: RouteSettings[K]) => void } = {
  maxSlope: saveMaxSlope,
  newLegs: saveNewLegs,
  mode: saveTravelMode,
  layers: saveLayerChoices,
};

export class RouteSettingsStore {
  #settings: RouteSettings;
  readonly #listeners = new Set<() => void>();

  constructor(settings: RouteSettings) {
    this.#settings = settings;
  }

  getState = (): RouteSettings => this.#settings;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  set<K extends keyof RouteSettings>(key: K, value: RouteSettings[K]): void {
    this.#settings = { ...this.#settings, [key]: value };
    for (const listener of this.#listeners) listener();
    SAVE[key](value);
  }
}

export function useRouteSettingsStore(): RouteSettingsStore {
  return useStores().routeSettings;
}

export function useRouteSettings(): RouteSettings {
  const store = useRouteSettingsStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}
