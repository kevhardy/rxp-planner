import { useSyncExternalStore } from "react";
import { fitsSetting, PLAYBACK_SETTING_ENTRIES, readPlaybackChoices, type PlaybackChoices } from "../../rules/index.ts";
import { useStores } from "../context.ts";
import { loadSaved, saveSaved, type SavedSetting } from "../savedSetting.ts";

const SAVED: SavedSetting<PlaybackChoices> = {
  key: "playback",
  unsavedKey: "restedxp-planner:unsaved-playback",
  read: readPlaybackChoices,
  defaults: {},
  name: "the Playback settings",
};

export function loadPlaybackChoices(): Promise<PlaybackChoices> {
  return loadSaved(SAVED);
}

export class PlaybackSettingsStore {
  #choices: PlaybackChoices;
  readonly #listeners = new Set<() => void>();

  constructor(choices: PlaybackChoices) {
    this.#choices = choices;
  }

  getState = (): PlaybackChoices => this.#choices;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  update(change: Readonly<Record<string, unknown>>): void {
    const next: Record<string, unknown> = { ...this.#choices };
    for (const [key, spec] of PLAYBACK_SETTING_ENTRIES) if (fitsSetting(spec, change[key])) next[key] = change[key];
    this.#set(readPlaybackChoices(next));
  }

  reset(): void {
    this.#set({});
  }

  #set(choices: PlaybackChoices): void {
    if (PLAYBACK_SETTING_ENTRIES.every(([key]) => choices[key] === this.#choices[key])) return;
    this.#choices = choices;
    for (const listener of this.#listeners) listener();
    saveSaved(SAVED, choices);
  }
}

export function usePlaybackSettingsStore(): PlaybackSettingsStore {
  return useStores().playbackSettings;
}

export function usePlaybackChoices(): PlaybackChoices {
  const store = usePlaybackSettingsStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}
