import { startAutosave, type SaveStatus, type StoredLibrary } from "../storage/index.ts";
import type { EditorStore } from "./store.ts";

export class AutosaveStore {
  readonly #editor: EditorStore;
  readonly #saved: StoredLibrary;
  #status: SaveStatus = "saved";
  readonly #listeners = new Set<() => void>();

  constructor(editor: EditorStore, saved: StoredLibrary) {
    this.#editor = editor;
    this.#saved = saved;
  }

  getState = (): SaveStatus => this.#status;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Saves the editor's changes until `stop`, which saves what is still pending. */
  start(): () => void {
    const autosave = startAutosave(this.#editor, this.#saved, (status, error) => {
      this.#status = status;
      for (const listener of this.#listeners) listener();
      if (error) console.error("Could not save the library", error);
    });
    // IndexedDB cannot finish a save while the page unloads, so pending
    // changes go to localStorage, or the browser asks before leaving.
    const leave = (e: Event) => {
      if (!autosave.saveBeforeLeaving() && e.type === "beforeunload") e.preventDefault();
      autosave.flush();
    };
    window.addEventListener("beforeunload", leave);
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("pagehide", leave);
      autosave.stop();
      autosave.flush();
    };
  }
}
