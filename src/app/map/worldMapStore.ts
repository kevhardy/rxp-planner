import { useContext, useSyncExternalStore } from "react";
import type { GameData, LoadedWorldMap } from "../../data/index.ts";
import { DatasetContext, useEditorStore, useGameData } from "../context.ts";
import type { EditorStore } from "../store.ts";
import { indexFeatures, type FeatureIndex } from "./features.ts";
import type { MapFocusTarget } from "./lineFocus.ts";

export interface MapFocusRequest {
  id: number;
  target: MapFocusTarget;
}

export type FocusResult = { kind: "focused" } | { kind: "unavailable"; message: string };

interface Highlight {
  owner: string;
  key: string;
}

export type HighlightBy = "hovered" | "focused";

interface WorldMapState {
  hovered: Highlight | null;
  focused: Highlight | null;
}

export class WorldMapStore {
  #state: WorldMapState = { hovered: null, focused: null };
  readonly #listeners = new Set<() => void>();
  #receiver: ((request: MapFocusRequest) => FocusResult) | null = null;
  #sequence = 0;

  getState = (): WorldMapState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  focus(target: MapFocusTarget): FocusResult {
    if (!this.#receiver) return { kind: "unavailable", message: "Open the Edit map to focus on a place." };
    return this.#receiver({ id: ++this.#sequence, target });
  }

  connectFocus(receiver: (request: MapFocusRequest) => FocusResult): () => void {
    this.#receiver = receiver;
    return () => {
      if (this.#receiver === receiver) this.#receiver = null;
    };
  }

  highlight(by: HighlightBy, owner: string, key: string): void {
    const h = this.#state[by];
    if (h?.owner !== owner || h.key !== key) this.#publish({ [by]: { owner, key } });
  }

  unhighlight(by: HighlightBy, owner: string, key?: string): void {
    const h = this.#state[by];
    if (h?.owner === owner && (key === undefined || h.key === key)) this.#publish({ [by]: null });
  }

  #publish(change: Partial<WorldMapState>): void {
    this.#state = { ...this.#state, ...change };
    for (const listener of this.#listeners) listener();
  }
}

const stores = new WeakMap<EditorStore, WorldMapStore>();

export function useWorldMapStore(): WorldMapStore {
  const editor = useEditorStore();
  let store = stores.get(editor);
  if (!store) stores.set(editor, (store = new WorldMapStore()));
  return store;
}

export function useHighlight(owner: string): string | null {
  const store = useWorldMapStore();
  const highlight = useSyncExternalStore(store.subscribe, () => store.getState().hovered ?? store.getState().focused);
  return highlight?.owner === owner ? highlight.key : null;
}

const indexes = new WeakMap<LoadedWorldMap, { data: GameData; index: FeatureIndex }>();

export function useFeatures(): FeatureIndex | null {
  const data = useGameData();
  const dataset = useContext(DatasetContext);
  const map = dataset?.data?.worldMap;
  if (!data || !map) return null;
  let cached = indexes.get(map);
  if (cached?.data !== data) indexes.set(map, (cached = { data, index: indexFeatures(data, data.terrainMap(map)) }));
  return cached.index;
}
