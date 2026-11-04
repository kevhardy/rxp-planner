import type { DatasetLocation } from "../data/dataset.ts";
import { startAgentTools } from "./agentTools.ts";
import type { Stores } from "./context.ts";
import { APP_MIN_WIDTH, startTheme, type LayoutStore } from "./layout.ts";
import type { EditorStore } from "./store.ts";

/**
 * Call before the first render, so the first paint has the theme and the
 * fitted widths, and StrictMode starts no second load.
 */
export function startPage(stores: Stores, dataset: DatasetLocation): () => void {
  stores.dataset.select(dataset);
  const stops = [
    startTheme(stores.layout),
    startAppWidth(stores.layout),
    stores.autosave.start(),
    startUndoKeys(stores.editor),
    startAgentTools(stores),
    () => stores.dataset.clear(),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}

function startAppWidth(layout: LayoutStore): () => void {
  const fit = () => layout.setAppWidth(Math.max(window.innerWidth, APP_MIN_WIDTH));
  fit();
  window.addEventListener("resize", fit);
  return () => window.removeEventListener("resize", fit);
}

function startUndoKeys(editor: EditorStore): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || document.getElementById("app")?.hasAttribute("inert")) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) editor.undo();
    else if ((key === "z" && e.shiftKey) || key === "y") editor.redo();
    else return;
    e.preventDefault();
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
