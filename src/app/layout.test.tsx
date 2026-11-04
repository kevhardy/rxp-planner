// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameData } from "../data/index.ts";
import { loadLibrary, loadSetting, saveLibrary, saveSetting } from "../storage/index.ts";
import { renderPlanner } from "./renderPlanner.tsx";
import { DEFAULT_LAYOUT, LayoutStore, loadLayout, readLayout } from "./layout.ts";
import { shownText } from "./testing.ts";
import { DEFAULT_SAVED_SETTINGS, loadSettings } from "./stores.ts";

const storage = vi.hoisted(() => ({ failLoad: false }));
vi.mock("../storage/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/index.ts")>();
  return {
    ...actual,
    loadSetting: (key: string) => (storage.failLoad ? Promise.reject(new Error("no storage")) : actual.loadSetting(key)),
  };
});

const noGameData = () => new Promise<GameData>(() => {});
const app = () => document.getElementById("app")!;

function setWindowWidth(width: number) {
  window.innerWidth = width;
  window.dispatchEvent(new Event("resize"));
}

beforeEach(async () => {
  storage.failLoad = false;
  localStorage.clear();
  window.innerWidth = 1920;
  await saveSetting("layout", {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function measure(height: number): (height: number) => void {
  let body = height;
  let observed: () => void = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observed = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("body") ? body : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("panel-head") ? 46 : this.classList.contains("panel") ? 2 : 0;
  });
  return (next) => {
    body = next;
    observed();
  };
}

const GUIDE = "#group Mine\n#name A\nstep\n    .accept 1 >> Hello\nstep\n    .accept 2\n";

async function openGuide() {
  await saveLibrary([{ id: "a", text: GUIDE, order: 0 }], [], { guideId: "a", step: 0, line: null });
}

async function mount() {
  const { user } = await renderPlanner({ initial: await loadLibrary(), builtins: null, loadGameData: noGameData });
  return user;
}

const SPACE = { height: 900, mapChrome: 48, dockHeader: 48, floatingStrip: false };

describe("layout store", () => {
  it("keeps valid saved fields and falls back to defaults for the rest", () => {
    expect(readLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(
      readLayout({
        stepsWidth: 420,
        dockHeight: "300",
        showGuideSyntax: true,
        theme: "blue",
      }),
    ).toEqual({ ...DEFAULT_LAYOUT, stepsWidth: 420, showGuideSyntax: true });
    expect(readLayout({ theme: "dark" }).theme).toBe("dark");
    expect([readLayout({ mode: "playback" }).mode, readLayout({ mode: "review" }).mode]).toEqual(["playback", "edit"]);
    expect([
      readLayout({ dismissedBuiltinHints: ["rxp:A.lua#1"] }).dismissedBuiltinHints,
      readLayout({ dismissedBuiltinHints: ["rxp:A.lua#1", 2] }).dismissedBuiltinHints,
    ]).toEqual([["rxp:A.lua#1"], []]);
  });

  it("loads a layout saved with the Quests card's size and fold", () => {
    expect(readLayout({ stepsWidth: 420, questsHeight: 300, questsFolded: true })).toEqual({ ...DEFAULT_LAYOUT, stepsWidth: 420 });
  });

  it("loads a layout saved with the Warnings sheet's size and fold", () => {
    expect(readLayout({ stepsWidth: 420, dockHeight: 400, warningsHeight: 300, warningsFolded: false })).toEqual({
      ...DEFAULT_LAYOUT,
      stepsWidth: 420,
      dockHeight: 400,
    });
  });

  it("loads a layout saved before the dock, and checks each dock field alone", () => {
    expect(readLayout({ stepsWidth: 500, mapWidth: 640 })).toEqual({ ...DEFAULT_LAYOUT, stepsWidth: 500 });
    const dock = { dockHeight: 400, dockTab: "raw" };
    expect(readLayout(dock)).toEqual({ ...DEFAULT_LAYOUT, ...dock });
    expect(readLayout({ ...dock, dockHeight: 219 })).toEqual({ ...DEFAULT_LAYOUT, ...dock, dockHeight: 320 });
    expect(readLayout({ ...dock, dockHeight: 721 })).toEqual({ ...DEFAULT_LAYOUT, ...dock, dockHeight: 320 });
    expect(readLayout({ ...dock, dockHeight: "400" })).toEqual({ ...DEFAULT_LAYOUT, ...dock, dockHeight: 320 });
    expect(readLayout({ ...dock, dockTab: "map" })).toEqual({ ...DEFAULT_LAYOUT, ...dock, dockTab: "lines" });
  });

  it("loads a layout saved with the dock's fold", () => {
    expect(readLayout({ dockHeight: 400, dockFolded: true, dockTab: "raw" })).toEqual({
      ...DEFAULT_LAYOUT,
      dockHeight: 400,
      dockTab: "raw",
    });
  });

  it("saves changes and loads them in a new store", async () => {
    const store = new LayoutStore(DEFAULT_LAYOUT);
    store.update({ dockHeight: 480, theme: "light" });
    await vi.waitFor(async () => expect(await loadSetting("layout")).toMatchObject({ dockHeight: 480 }));
    await vi.waitFor(() => expect(localStorage.length).toBe(0));

    expect(await loadLayout()).toEqual({ ...DEFAULT_LAYOUT, dockHeight: 480, theme: "light" });
  });

  it("fits the steps to the app width without saving", async () => {
    await saveSetting("layout", { stepsWidth: 560 });
    const store = new LayoutStore(await loadLayout());
    store.setAppWidth(1080);
    expect(store.getState().stepsWidth).toBe(1080 - 1 - 620);
    expect(store.limits("stepsWidth")).toEqual({ min: 300, max: 1080 - 1 - 620 });
    store.setAppWidth(1920);
    expect(store.getState().stepsWidth).toBe(560);
    expect(await loadSetting("layout")).toEqual({ stepsWidth: 560 });
  });

  it("keeps the preferred sizes when an unrelated change saves", async () => {
    await saveSetting("layout", { stepsWidth: 560 });
    const store = new LayoutStore(await loadLayout());
    store.setAppWidth(1080);
    store.update({ theme: "dark" });
    await vi.waitFor(async () => expect(await loadSetting("layout")).toMatchObject({ stepsWidth: 560, theme: "dark" }));
    expect(store.getState().stepsWidth).toBe(459);
  });

  it("fits the editor over the map below the map's header and strip", () => {
    const store = new LayoutStore({ ...DEFAULT_LAYOUT, dockHeight: 600 });
    expect(store.getState().dockHeight).toBe(600);
    expect(store.limits("dockHeight")).toEqual({ min: 220, max: 720 });

    store.setEditSpace({ ...SPACE, height: 700 });
    expect(store.getState().dockHeight).toBe(700 - 48 - 120 - 12);
    expect(store.limits("dockHeight")).toEqual({ min: 220, max: 700 - 48 - 120 - 12 });
    expect(store.workspaceMinHeight()).toBe(48 + 120 + 12 + 220);

    store.setEditSpace({ ...SPACE, height: 1400 });
    expect(store.getState().dockHeight).toBe(600);
  });

  it("leaves a map card its header and a row above the route foot while Routes floats its strip over the map", () => {
    const store = new LayoutStore({ ...DEFAULT_LAYOUT, dockHeight: 720 });
    store.setEditSpace({ ...SPACE, floatingStrip: true });
    expect(store.limits("dockHeight").max).toBe(900 - 48 - 195 - 12);
    expect(store.workspaceMinHeight()).toBe(48 + 195 + 12 + 220);

    store.setEditSpace({ ...SPACE, floatingStrip: false });
    expect(store.getState().dockHeight).toBe(720);
  });

  it("keeps the minimums when the space cannot fit them", () => {
    const store = new LayoutStore(DEFAULT_LAYOUT);
    store.setEditSpace({ ...SPACE, height: 400, mapChrome: 90, dockHeader: 80 });
    expect(store.getState().dockHeight).toBe(80 + 160);
    expect(store.limits("dockHeight")).toEqual({ min: 80 + 160, max: 80 + 160 });
    expect(store.workspaceMinHeight()).toBe(90 + 120 + 12 + 80 + 160);
  });

  it("closes and opens the editor without saving, and keeps its height", async () => {
    await saveSetting("layout", { dockHeight: 400 });
    const store = new LayoutStore(await loadLayout());
    const heard = vi.fn();
    store.subscribe(heard);
    store.closeEditor();
    store.closeEditor();
    expect([store.editorOpen(), heard.mock.calls.length]).toEqual([false, 1]);
    store.openEditor();
    expect([store.editorOpen(), store.getState().dockHeight]).toEqual([true, 400]);
    expect(await loadSetting("layout")).toEqual({ dockHeight: 400 });
  });

  it("opens the editor on Lines for a navigation that it takes once", async () => {
    const store = new LayoutStore({ ...DEFAULT_LAYOUT, dockTab: "raw" });
    store.closeEditor();
    const heard = vi.fn();
    store.subscribe(heard);
    const navigation = { guide: "g", selection: { step: 1, line: 2 }, destination: "outline" } as const;
    store.revealEditor(navigation);
    expect([store.editorOpen(), store.getState().dockTab]).toEqual([true, "lines"]);
    await vi.waitFor(async () => expect(await loadSetting("layout")).toMatchObject({ dockTab: "lines" }));
    store.revealEditor(navigation);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(store.takeEditorNavigation()).toEqual(navigation);
    expect(store.takeEditorNavigation()).toBeNull();

    store.revealEditor(navigation);
    store.update({ mode: "playback" });
    expect(store.takeEditorNavigation()).toBeNull();
  });

  it("writes the unsaved copy of a change at its key, and loads its valid fields over the saved layout", async () => {
    new LayoutStore(DEFAULT_LAYOUT).update({ dockHeight: 450 });
    expect(JSON.parse(localStorage.getItem("restedxp-planner:unsaved-layout")!)).toMatchObject({ dockHeight: 450 });
    await vi.waitFor(() => expect(localStorage.getItem("restedxp-planner:unsaved-layout")).toBeNull());

    await saveSetting("layout", { stepsWidth: 500, dockHeight: 500 });
    localStorage.setItem("restedxp-planner:unsaved-layout", '{"dockHeight":"tall","stepsWidth":420}');
    const layout = await loadLayout();
    expect([layout.stepsWidth, layout.dockHeight]).toEqual([420, 320]);
  });

  it("renders with the default settings when they cannot be read", async () => {
    storage.failLoad = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await loadSettings()).toEqual(DEFAULT_SAVED_SETTINGS);
    expect(warn.mock.calls.map(([message]) => String(message)).sort()).toEqual([
      "Could not load the Playback settings",
      "Could not load the layout",
      "Could not load the map settings",
      "Could not load the preview settings",
      "Could not load the route map layers",
      "Could not load the route settings",
      "Could not load the settings for new legs",
      "Could not load the travel mode",
    ]);
    await mount();
    expect(app().style.getPropertyValue("--steps-w")).toBe("380px");
    expect(screen.getByRole("button", { name: /^Preview as / }).textContent).toContain("Warrior");
  });
});

describe("gutters", () => {
  it("resize the steps column with arrow keys within its limits", async () => {
    await saveSetting("layout", { stepsWidth: 540 });
    const user = await mount();
    const gutter = screen.getByRole("separator", { name: "Resize steps" });
    expect(gutter.getAttribute("aria-orientation")).toBe("vertical");
    expect(gutter.getAttribute("aria-valuenow")).toBe("540");

    gutter.focus();
    await user.keyboard("{ArrowRight}");
    expect(app().style.getPropertyValue("--steps-w")).toBe("556px");
    await user.keyboard("{ArrowRight}");
    expect(app().style.getPropertyValue("--steps-w")).toBe("560px");
    expect(gutter.getAttribute("aria-valuenow")).toBe("560");
    await user.keyboard("{ArrowLeft}");
    expect(gutter.getAttribute("aria-valuenow")).toBe("544");
    await vi.waitFor(async () => expect(await loadSetting("layout")).toMatchObject({ stepsWidth: 544 }));

    await user.keyboard("{ArrowLeft>17/}");
    expect(gutter.getAttribute("aria-valuenow")).toBe("300");
    expect(app().style.getPropertyValue("--steps-w")).toBe("300px");
  });

  it("fit a narrow window from the first render", async () => {
    await saveSetting("layout", { stepsWidth: 560 });
    window.innerWidth = 900;
    await mount();
    expect(app().style.getPropertyValue("--steps-w")).toBe("459px");
  });

  it("keep 459px for the steps at the app's least width and give the rest back", async () => {
    await saveSetting("layout", { stepsWidth: 560 });
    await mount();
    const steps = screen.getByRole("separator", { name: "Resize steps" });
    expect(steps.getAttribute("aria-valuenow")).toBe("560");

    act(() => setWindowWidth(1080));
    expect(app().style.getPropertyValue("--steps-w")).toBe("459px");
    expect(steps.getAttribute("aria-valuenow")).toBe("459");
    expect(steps.getAttribute("aria-valuemax")).toBe("459");
    act(() => setWindowWidth(900));
    expect(app().style.getPropertyValue("--steps-w")).toBe("459px");

    act(() => setWindowWidth(1920));
    expect(steps.getAttribute("aria-valuemax")).toBe("560");
    expect(app().style.getPropertyValue("--steps-w")).toBe("560px");
  });

  it("resize the editor with arrow keys and a drag, and save at the drag end", async () => {
    await openGuide();
    const user = await mount();
    const gutter = screen.getByRole("separator", { name: "Resize editor" });
    expect(gutter.getAttribute("aria-orientation")).toBe("horizontal");
    expect([gutter.getAttribute("aria-valuemin"), gutter.getAttribute("aria-valuemax")]).toEqual(["220", "720"]);
    gutter.focus();
    await user.keyboard("{ArrowUp}");
    expect(app().style.getPropertyValue("--dock-h")).toBe("336px");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(gutter.getAttribute("aria-valuenow")).toBe("304");
    await vi.waitFor(async () => expect(await loadSetting("layout")).toMatchObject({ dockHeight: 304 }));

    // jsdom has no pointer capture.
    gutter.setPointerCapture = vi.fn();
    fireEvent.pointerDown(gutter, { button: 0, pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(gutter, { pointerId: 1, clientY: 400 });
    expect(gutter.getAttribute("aria-valuenow")).toBe("404");
    fireEvent.pointerMove(gutter, { pointerId: 1, clientY: -1000 });
    expect(gutter.getAttribute("aria-valuenow")).toBe("720");
    fireEvent.pointerMove(gutter, { pointerId: 1, clientY: 400 });
    expect((await loadLayout()).dockHeight).toBe(304);
    fireEvent.pointerUp(gutter, { pointerId: 1 });
    expect((await loadLayout()).dockHeight).toBe(404);
    await vi.waitFor(async () => expect(await loadSetting("layout")).toMatchObject({ dockHeight: 404 }));
  });

  it("fit the editor to the measured body, with limits from the same fit, and keep it while Warnings open", async () => {
    await saveSetting("layout", { dockHeight: 600 });
    await openGuide();
    const resize = measure(700);
    const user = await mount();
    const dock = screen.getByRole("separator", { name: "Resize editor" });
    expect([dock.getAttribute("aria-valuenow"), dock.getAttribute("aria-valuemax")]).toEqual(["520", "520"]);
    expect(app().style.getPropertyValue("--dock-h")).toBe(`${700 - 48 - 120 - 12}px`);
    expect(app().style.getPropertyValue("--dock-inset")).toBe("12px");
    expect(app().style.getPropertyValue("--workspace-min-h")).toBe(`${48 + 120 + 12 + 220}px`);

    await user.click(screen.getByRole("button", { name: /^Warnings/ }));
    expect(screen.getByRole("region", { name: "Warnings" })).toBeTruthy();
    expect(app().style.getPropertyValue("--dock-h")).toBe("520px");

    act(() => resize(300));
    expect(app().style.getPropertyValue("--dock-h")).toBe("220px");
    expect([dock.getAttribute("aria-valuemin"), dock.getAttribute("aria-valuemax")]).toEqual(["220", "220"]);

    act(() => resize(700));
    expect(app().style.getPropertyValue("--dock-h")).toBe("520px");
    expect(await loadSetting("layout")).toEqual({ dockHeight: 600 });
  });
});

describe("editor panel", () => {
  const workspace = () => document.querySelector(".editor-workspace")!;

  it("does not show without a guide", async () => {
    await saveLibrary([], ["a"], { guideId: null, step: null, line: null });
    await mount();
    expect(workspace().getAttribute("data-editor")).toBe("none");
    expect(screen.queryByRole("region", { name: "Editor" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open editor" })).toBeNull();
  });

  it("closes from its header, and opens from the map header, the selected step, Enter, and the Header row", async () => {
    await saveSetting("layout", { dockHeight: 400, dockTab: "raw" });
    await openGuide();
    const user = await mount();
    const close = async () => {
      await user.click(screen.getByRole("button", { name: "Close editor" }));
      expect(screen.queryByRole("region", { name: "Editor" })).toBeNull();
      expect(screen.queryByRole("separator", { name: "Resize editor" })).toBeNull();
      expect(workspace().getAttribute("data-editor")).toBe("closed");
    };
    const heading = () => within(screen.getByRole("region", { name: "Editor" })).getByRole("heading", { level: 2 }).textContent;

    await close();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open editor" }));
    expect(document.getElementById("step-0")!.getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Open editor" }));
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Raw" }));
    expect(screen.queryByRole("button", { name: "Open editor" })).toBeNull();

    await close();
    await user.click(document.getElementById("step-0")!);
    expect(heading()).toBe("Step 1 of 2");

    await close();
    screen.getByRole("listbox", { name: "Steps of A" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tab", { name: "Lines" }).getAttribute("aria-selected")).toBe("true");

    await close();
    await user.click(document.getElementById("step-header")!);
    expect(heading()).toBe("Header");
    await vi.waitFor(async () => expect(await loadSetting("layout")).toMatchObject({ dockHeight: 400, dockTab: "lines" }));
  });

  it("keeps a field's draft that the close cannot apply, and shows it when the editor opens again", async () => {
    await openGuide();
    const user = await mount();
    const field = () => screen.getByRole("textbox", { name: ">> text" });
    await user.clear(field());
    await user.type(field(), "Hello -- there");
    await user.click(screen.getByRole("button", { name: "Close editor" }));
    expect(screen.queryByRole("textbox", { name: ">> text" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open editor" }));
    expect(shownText(field())).toBe("Hello -- there");
    expect(screen.getByRole("alert").textContent).toBe('RXP would read "    .accept 1 >> Hello -- there" differently');
    expect((await loadLibrary()).guides.find((g) => g.id === "a")!.text).toBe(GUIDE);
  });
});

describe("theme toggle", () => {
  it("switches to dark, swaps its label, and keeps the choice", async () => {
    const user = await mount();
    expect(document.documentElement.dataset.theme).toBe("light");
    const toggle = screen.getByRole("button", { name: "Dark mode" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await user.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(toggle.getAttribute("aria-label")).toBe("Light mode");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await vi.waitFor(async () => expect(await loadSetting("layout")).toMatchObject({ theme: "dark" }));

    cleanup();
    await mount();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Light mode" })).toBeTruthy();
  });

  it("opens light on a dark system until a choice is saved", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    await saveSetting("layout", { theme: null });
    await mount();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: "Dark mode" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("leaves the document root when the planner closes", async () => {
    await mount();
    expect(document.documentElement.dataset.theme).toBe("light");
    cleanup();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
