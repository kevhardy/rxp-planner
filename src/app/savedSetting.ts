// Settings saved per browser, such as the layout. IndexedDB loses a save when
// the page unloads during it. So each save first writes a copy to
// localStorage, which writes at once, and removes the copy when IndexedDB has
// the value. The next load prefers a copy that is still there.

import { loadSetting, saveSetting } from "../storage/index.ts";

export interface SavedSetting<T> {
  key: string;
  unsavedKey: `restedxp-planner:${string}`;
  read: (saved: unknown) => T;
  defaults: T;
  name: string;
}

/**
 * The saved value, or the defaults if it cannot be read. A readable copy
 * from an interrupted save wins, and is saved to IndexedDB again.
 */
export async function loadSaved<T>(setting: SavedSetting<T>): Promise<T> {
  const unsaved = readUnsaved(setting.unsavedKey);
  if (unsaved !== undefined) {
    const value = setting.read(unsaved);
    saveSaved(setting, value);
    return value;
  }
  return loadSetting(setting.key).then(setting.read, (error: unknown) => {
    console.warn(`Could not load ${setting.name}`, error);
    return setting.defaults;
  });
}

export function saveSaved<T>(setting: SavedSetting<T>, value: T): void {
  const text = JSON.stringify(value);
  try {
    localStorage.setItem(setting.unsavedKey, text);
  } catch {
    // Without localStorage, only a save the page outlasts keeps the value.
  }
  saveSetting(setting.key, value).then(
    () => {
      try {
        if (localStorage.getItem(setting.unsavedKey) === text) localStorage.removeItem(setting.unsavedKey);
      } catch {
        // The saved value stands; the next load saves the copy again.
      }
    },
    (error: unknown) => console.error(`Could not save ${setting.name}`, error),
  );
}

function readUnsaved(key: string): object | undefined {
  try {
    const text = globalThis.localStorage?.getItem(key);
    const value: unknown = text ? JSON.parse(text) : undefined;
    return typeof value === "object" && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}
