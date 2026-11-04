import { useSyncExternalStore } from "react";
import { useEditor, useStores } from "./context.ts";
import { loadSaved, saveSaved, type SavedSetting } from "./savedSetting.ts";
import type { Selection } from "./store.ts";

export type Theme = "light" | "dark";
export type AppMode = "edit" | "playback";

export const EDITOR_TABS = [
  { id: "lines", label: "Lines", header: true },
  { id: "settings", label: "Step settings", header: false },
  { id: "simulation", label: "XP simulation", header: false },
  { id: "raw", label: "Raw", header: true },
  { id: "guide", label: "Guide text", header: true },
] as const;

export type DockTab = (typeof EDITOR_TABS)[number]["id"];

export interface Layout {
  stepsWidth: number;
  dockHeight: number;
  dockTab: DockTab;
  showGuideSyntax: boolean;
  /** Explicit choice; null means none yet, which shows the light theme. */
  theme: Theme | null;
  mode: AppMode;
  dismissedBuiltinHints: readonly string[];
}

export type LayoutSize = "stepsWidth" | "dockHeight";

/**
 * The editor panel over the Edit map. It is "none" with no guide open, since
 * an open guide always selects a step or its header. Otherwise the user
 * closes and opens it, and only the session keeps that choice.
 */
export type EditorPanel = "none" | "open" | "closed";

interface Limits {
  min: number;
  max: number;
}

const SIZE_LIMITS: Record<LayoutSize, Limits> = {
  stepsWidth: { min: 300, max: 560 },
  dockHeight: { min: 220, max: 720 },
};

export const DEFAULT_LAYOUT: Layout = {
  stepsWidth: 380,
  dockHeight: 320,
  dockTab: "lines",
  showGuideSyntax: false,
  theme: null,
  mode: "edit",
  dismissedBuiltinHints: [],
};

/** The app's CSS `min-width`; narrower windows scroll. */
export const APP_MIN_WIDTH = 1080;
const PANE_RULE = 1;
const WORKSPACE_MIN_WIDTH = 620;
const MAP_INSET = 12;
const ZOOM_BUTTON = 32;
const MAP_STRIP = MAP_INSET + 3 * ZOOM_BUTTON + MAP_INSET;
const CARD_PADDING = 8;
const CARD_HEADER = 24;
// A leg row is 40px, and the second fact of the stop card ends at 42px.
const CARD_ROW = 42;
const CARD_RULE = 1;
const FOOT_GAP = 8;
const READOUT_PADDING = 8;
const READOUT_LINE = 16;
const STOP_FOOT = READOUT_PADDING + 2 * 2 * READOUT_LINE + READOUT_PADDING;
const ROUTE_STRIP = MAP_INSET + CARD_PADDING + CARD_HEADER + CARD_ROW + CARD_RULE + CARD_PADDING + FOOT_GAP + STOP_FOOT + MAP_INSET;
export const DOCK_INSET = 12;
const DOCK_BODY_MIN = 160;
const EDIT_SPACE_KEYS = ["height", "mapChrome", "dockHeader", "floatingStrip"] as const satisfies readonly (keyof EditSpace)[];

/**
 * What the shell measures in Edit mode. `height` is the Edit body's content
 * height, and `dockHeader` is the dock's header, in pixels. `mapChrome` is
 * the map's header plus any Routes controls that sit inside the map above or
 * below its view, so the uncovered strip is all map.
 */
export interface EditSpace {
  height: number;
  mapChrome: number;
  dockHeader: number;
  floatingStrip: boolean;
}

const UNMEASURED: EditSpace = { height: Infinity, mapChrome: 0, dockHeader: 0, floatingStrip: false };

interface Fitted {
  layout: Layout;
  limits: Record<LayoutSize, Limits>;
  workspaceMinHeight: number;
}

const clamp = (value: number, { min, max }: Limits) => Math.max(min, Math.min(max, value));
const limit = (min: number, max: number): Limits => ({ min, max: Math.max(min, max) });

function fit(preferred: Layout, appWidth: number, space: EditSpace): Fitted {
  const steps = limit(SIZE_LIMITS.stepsWidth.min, Math.min(SIZE_LIMITS.stepsWidth.max, appWidth - PANE_RULE - WORKSPACE_MIN_WIDTH));
  const uncovered = space.mapChrome + (space.floatingStrip ? ROUTE_STRIP : MAP_STRIP) + DOCK_INSET;
  const dockMin = Math.min(SIZE_LIMITS.dockHeight.max, Math.max(SIZE_LIMITS.dockHeight.min, space.dockHeader + DOCK_BODY_MIN));
  const dock = limit(dockMin, Math.min(SIZE_LIMITS.dockHeight.max, space.height - uncovered));
  return {
    layout: { ...preferred, stepsWidth: clamp(preferred.stepsWidth, steps), dockHeight: clamp(preferred.dockHeight, dock) },
    limits: { stepsWidth: steps, dockHeight: dock },
    workspaceMinHeight: uncovered + dockMin,
  };
}

export function readLayout(saved: unknown): Layout {
  const s = (typeof saved === "object" && saved !== null ? saved : {}) as Record<string, unknown>;
  const pick = <K extends keyof Layout>(key: K, valid: (v: unknown) => boolean): Layout[K] =>
    valid(s[key]) ? (s[key] as Layout[K]) : DEFAULT_LAYOUT[key];
  const size = (key: LayoutSize) =>
    pick(key, (v) => typeof v === "number" && Number.isFinite(v) && v >= SIZE_LIMITS[key].min && v <= SIZE_LIMITS[key].max);
  const bool = (v: unknown) => typeof v === "boolean";
  return {
    stepsWidth: size("stepsWidth"),
    dockHeight: size("dockHeight"),
    dockTab: pick("dockTab", (v) => EDITOR_TABS.some((tab) => tab.id === v)),
    showGuideSyntax: pick("showGuideSyntax", bool),
    theme: pick("theme", (v) => v === null || v === "light" || v === "dark"),
    mode: pick("mode", (v) => v === "edit" || v === "playback"),
    dismissedBuiltinHints: pick("dismissedBuiltinHints", (v) => Array.isArray(v) && v.every((id) => typeof id === "string")),
  };
}

const SAVED: SavedSetting<Layout> = {
  key: "layout",
  unsavedKey: "restedxp-planner:unsaved-layout",
  read: readLayout,
  defaults: DEFAULT_LAYOUT,
  name: "the layout",
};

export function loadLayout(): Promise<Layout> {
  return loadSaved(SAVED);
}

/**
 * A request to show the editor for `selection` of guide `guide` (its
 * `viewId`): scroll its line row into view, or focus the line's first field.
 */
export interface EditorNavigation {
  guide: string;
  selection: Selection;
  destination: "outline" | "editor";
}

export class LayoutStore {
  #preferred: Layout;
  #fitted: Fitted;
  #appWidth = Infinity;
  #space = UNMEASURED;
  #navigation: EditorNavigation | null = null;
  #editorOpen = true;
  readonly #listeners = new Set<() => void>();

  constructor(layout: Layout) {
    this.#preferred = layout;
    this.#fitted = fit(layout, this.#appWidth, this.#space);
  }

  getState = (): Layout => this.#fitted.layout;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  limits(size: LayoutSize): Limits {
    return this.#fitted.limits[size];
  }

  editorOpen = (): boolean => this.#editorOpen;

  workspaceMinHeight(): number {
    return this.#fitted.workspaceMinHeight;
  }

  setAppWidth(width: number): void {
    if (width === this.#appWidth) return;
    this.#appWidth = width;
    this.#publish(this.#preferred);
  }

  setEditSpace(space: EditSpace): void {
    const old = this.#space;
    if (EDIT_SPACE_KEYS.every((key) => space[key] === old[key])) return;
    this.#space = space;
    this.#publish(this.#preferred);
  }

  /**
   * Changes the preferences; gutters pass sizes within `limits`. `save: false`
   * skips storage, for the steps of a drag that saves at its end.
   */
  update(change: Partial<Layout>, { save = true } = {}): void {
    if (change.mode === "playback") this.#navigation = null;
    this.#publish({ ...this.#preferred, ...change });
    if (save) saveSaved(SAVED, this.#preferred);
  }

  openEditor(): void {
    this.#setEditorOpen(true);
  }

  closeEditor(): void {
    this.#setEditorOpen(false);
  }

  /**
   * Opens the editor on Lines and leaves a request for the editor to take
   * with `takeEditorNavigation`. It publishes even when the editor was open
   * on Lines, so the editor sees each request.
   */
  revealEditor(navigation: EditorNavigation): void {
    this.#navigation = navigation;
    this.#editorOpen = true;
    this.update({ dockTab: "lines" }, { save: this.#preferred.dockTab !== "lines" });
  }

  /** The latest editor navigation, once. */
  takeEditorNavigation(): EditorNavigation | null {
    const navigation = this.#navigation;
    this.#navigation = null;
    return navigation;
  }

  #setEditorOpen(open: boolean): void {
    if (open === this.#editorOpen) return;
    this.#editorOpen = open;
    for (const listener of this.#listeners) listener();
  }

  #publish(preferred: Layout): void {
    this.#preferred = preferred;
    this.#fitted = fit(preferred, this.#appWidth, this.#space);
    for (const listener of this.#listeners) listener();
  }
}

export function useLayoutStore(): LayoutStore {
  return useStores().layout;
}

export function useLayout(): Layout {
  const store = useLayoutStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}

export function useEditorPanel(): EditorPanel {
  const store = useLayoutStore();
  const { current } = useEditor();
  const open = useSyncExternalStore(store.subscribe, store.editorOpen);
  return !current ? "none" : open ? "open" : "closed";
}

export function useTheme(): Theme {
  return useLayout().theme ?? "light";
}

export function startTheme(store: LayoutStore): () => void {
  const root = document.documentElement;
  const apply = () => {
    const theme = store.getState().theme ?? "light";
    if (root.dataset.theme !== theme) root.dataset.theme = theme;
  };
  apply();
  const stop = store.subscribe(apply);
  return () => {
    stop();
    delete root.dataset.theme;
  };
}
