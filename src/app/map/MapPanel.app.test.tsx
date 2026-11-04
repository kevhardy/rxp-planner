// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { syntheticScope } from "../../routing/fixtures/synthetic.ts";
import { extractGuides } from "../../guide/index.ts";
import type { Builtins } from "../../io/index.ts";
import { loadLibrary, loadSetting, saveSetting, type StoredLibrary } from "../../storage/index.ts";
import { renderPlanner, unrelatedEntities } from "../renderPlanner.tsx";
import { DEFAULT_SETTINGS } from "../preview/settings.ts";
import { DEFAULT_LAYOUT } from "../layout.ts";
import type { RoutingEngine, RoutingLoad } from "../routing/engine.ts";
import type { LayerPainter } from "../routing/layerPainter.ts";
import { DEFAULT_LAYERS, saveLayerChoices } from "../routing/MapLayers.tsx";
import { redo, showLine, undo, unzip } from "../testing.ts";
import { DEFAULT_MAP_SETTINGS, readMapSettings, type MapSettings } from "./mapSettings.ts";
import { addAt, areas, clientAt, data, dotCounts, ELWYNN, focusedFills, mapArea, O1, O2, O3, spawnDots, view } from "./mapPanelFixture.ts";

const routing = vi.hoisted(() => ({ load: null as (() => Promise<RoutingLoad>) | null }));
vi.mock("../routing/engine.ts", async (original) => {
  const actual = await original<typeof import("../routing/engine.ts")>();
  return { ...actual, loadRouting: () => routing.load?.() ?? actual.loadRouting() };
});

// jsdom does no layout: every element is a 1000px square at the origin, so
// a stage percentage is 10 client pixels.
beforeEach(async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 1000 }));
  await saveSetting("preview", DEFAULT_SETTINGS);
  await saveSetting("map", DEFAULT_MAP_SETTINGS);
  await saveSetting("layout", DEFAULT_LAYOUT);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface MountOptions {
  map?: Partial<MapSettings>;
  builtins?: Builtins;
  step?: number;
}

async function mountWith(options: MountOptions, ...texts: string[]) {
  const initial: StoredLibrary = {
    guides: texts.map((text, i) => ({ id: `g${i}`, text, order: i })),
    session: { guideId: options.builtins?.guides[0]?.id ?? "g0", step: options.step ?? 0, line: null },
  };
  if (options.map) await saveSetting("map", { ...DEFAULT_MAP_SETTINGS, ...options.map });
  const view = await renderPlanner({
    initial,
    builtins: options.builtins ?? null,
    loadGameData: () => Promise.resolve(data),
    loadEntities: () => Promise.resolve(unrelatedEntities),
  });
  await screen.findByRole("group", { name: /^Map of / });
  return view;
}

const mount = (...texts: string[]) => mountWith({}, ...texts);
const guideText = () => screen.getByLabelText("Guide text, read only").textContent;
const rowOf = (n: number) => document.querySelectorAll<HTMLElement>(".outline-row")[n - 1]!;
const caption = () => document.querySelector(".focus-caption")?.textContent ?? "";
const alertText = () => document.querySelector(".map-note [role=alert]")?.textContent ?? "";
const findMenu = () => screen.getByRole("region", { name: "Search" });
async function find(user: ReturnType<typeof userEvent.setup>, query: string) {
  const closed = screen.queryByRole("button", { name: "Search" });
  if (closed) await user.click(closed);
  const box = screen.getByRole("searchbox", { name: "Search quests, NPCs, items, and places" });
  await user.clear(box);
  await user.type(box, query);
}

it("fits the editor around loaded Routes controls without changing its saved height", async () => {
  let toolbarHeight = 83;
  let footerPosition = "static";
  const observers = new Set<{ callback: () => void; elements: Set<Element> }>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      elements = new Set<Element>();
      readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
        observers.add(this);
      }
      observe(element: Element) {
        observers.add(this);
        this.elements.add(element);
      }
      unobserve(element: Element) {
        this.elements.delete(element);
      }
      disconnect() {
        this.elements.clear();
        observers.delete(this);
      }
    },
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  const resize = (element: Element) => {
    for (const observer of observers) if (observer.elements.has(element)) observer.callback();
  };
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("body") ? 724 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("panel-head") ? 46 : this.classList.contains("panel") ? 2 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return DOMRect.fromRect({
      width: 646,
      height: this.classList.contains("route-bar") ? toolbarHeight : this.classList.contains("route-strip") ? 64 : 1000,
    });
  });
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = computed(element);
    if (element.classList.contains("route-strip")) style.position = footerPosition;
    return style;
  });
  const manifest: RoutingEngine["manifest"] = {
    id: "m0",
    scope: syntheticScope(),
    frame: { origin: [23, 20], size: [23, 42], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
    tiles: [],
  };
  const engine: RoutingEngine = { manifest, maps: [{ manifest }], route: async () => ({ journeys: [] }), release() {} };
  let finishLoading: (load: RoutingLoad) => void = () => {};
  const loaded = new Promise<RoutingLoad>((resolve) => {
    finishLoading = resolve;
  });
  routing.load = () => loaded;
  onTestFinished(() => void (routing.load = null));
  await saveSetting("layout", { ...DEFAULT_LAYOUT, dockHeight: 600 });
  const { user } = await mount("#group T\n#name One\nstep\n.goto Elwynn Forest,40,40\n");
  const dock = screen.getByRole("separator", { name: "Resize editor" });
  expect(dock.getAttribute("aria-valuenow")).toBe("544");
  await user.click(screen.getByRole("button", { name: "Routes" }));
  await act(async () => finishLoading({ ok: true, engine, missing: [] }));
  const toolbar = await screen.findByRole("region", { name: "Route tools" });
  await waitFor(() => expect(dock.getAttribute("aria-valuemax")).toBe("397"));
  expect(dock.getAttribute("aria-valuenow")).toBe("397");
  expect(document.getElementById("app")!.style.getPropertyValue("--dock-h")).toBe("397px");
  toolbarHeight = 110;
  act(() => resize(toolbar));
  await waitFor(() => expect(dock.getAttribute("aria-valuenow")).toBe("370"));
  footerPosition = "absolute";
  act(() => resize(document.querySelector(".map-body")!));
  await waitFor(() => expect(dock.getAttribute("aria-valuenow")).toBe("359"));
  await user.click(screen.getByRole("button", { name: "Routes" }));
  await waitFor(() => expect(dock.getAttribute("aria-valuenow")).toBe("544"));
  expect(await loadSetting("layout")).toMatchObject({ dockHeight: 600 });
});

describe("routing", () => {
  const GUIDE = "#group T\n#name One\nstep\n.goto Elwynn Forest,40,40\n";
  const frame = {
    origin: [23, 20] as [number, number],
    size: [23, 42] as [number, number],
    tilePixels: 512 as const,
    cellsPerTile: 128 as const,
    tileWorldUnits: 1600 / 3,
  };
  const everyTile = Array.from({ length: 23 * 42 }, (_, i) => ({
    tile: [i % 23, Math.floor(i / 23)] as [number, number],
    state: "present" as const,
  }));
  const engineWith = (more: Partial<RoutingEngine> = {}, tiles: RoutingEngine["manifest"]["tiles"] = []): RoutingEngine => {
    const manifest: RoutingEngine["manifest"] = { id: "m0", scope: syntheticScope(), frame, tiles };
    return { manifest, maps: [{ manifest }], route: async () => ({ journeys: [] }), release() {}, ...more };
  };
  const loadWith = (...loads: RoutingLoad[]) => {
    routing.load = vi.fn(() => Promise.resolve(loads.length > 1 ? loads.shift()! : loads[0]!));
    onTestFinished(() => void (routing.load = null));
    return routing.load;
  };
  const routes = () => screen.getByRole("button", { name: "Routes" });

  it("tries a failed routing load again when Routes opens again", async () => {
    const load = loadWith({ ok: false, reason: "The bundle did not load." }, { ok: true, engine: engineWith(), missing: [] });
    const { user } = await mount(GUIDE);
    await user.click(routes());
    await screen.findByText("The bundle did not load.");
    await user.click(routes());
    await user.click(routes());
    await screen.findByRole("region", { name: "Route tools" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("releases the engine when Routes closes, also while the zone borders still show", async () => {
    const release = vi.fn();
    loadWith({ ok: true, engine: engineWith({ release }), missing: [] });
    const { user } = await mountWith({ map: { categories: { "zone-borders": true } } }, GUIDE);
    await user.click(routes());
    await screen.findByRole("region", { name: "Route tools" });
    expect(release).not.toHaveBeenCalled();
    await user.click(routes());
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(mapArea().querySelector(".zone-borders")).not.toBeNull();
  });

  it("releases the Routes engine's layer painter before Playback asks it for tiles, each time Playback follows Routes", async () => {
    saveLayerChoices({ ...DEFAULT_LAYERS, steep: true });
    onTestFinished(() => saveLayerChoices(DEFAULT_LAYERS));
    const calls: string[] = [];
    const layers: LayerPainter = {
      image: () => undefined,
      want: (tiles) => void calls.push(`want ${tiles.length}`),
      subscribe: () => () => {},
      version: () => 0,
      release: () => void calls.push("release"),
    };
    loadWith({ ok: true, engine: engineWith({ layers, release: () => layers.release() }, everyTile), missing: [] });
    const { user } = await mount(GUIDE);
    await user.click(routes());
    await screen.findByRole("region", { name: "Route tools" });
    const playback = async (releases: number) => {
      await user.click(screen.getByRole("button", { name: "Playback" }));
      await screen.findByRole("group", { name: "Timeline" });
      await waitFor(() =>
        expect([calls.filter((c) => c === "release").length, calls.at(-1)]).toEqual([releases, expect.stringMatching(/^want [1-9]/)]),
      );
    };
    await playback(1);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(routes());
    await screen.findByRole("region", { name: "Route tools" });
    await playback(2);
  });
});

describe("Playback", () => {
  it("asks for no point while Playback shows the step", async () => {
    const { user } = await mountWith({ step: 1 }, "#group T\n#name One\nstep\n.goto Elwynn Forest,40,40\nstep\n+Talk to someone\n");
    expect(screen.getByText("Step 2 has no points. Right-click the map to add one.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Playback" }));
    await screen.findByRole("group", { name: "Timeline" });
    await user.click(await screen.findByRole("button", { name: "Next step" }));
    expect(mapArea()).toBeTruthy();
    expect(screen.queryByText(/has no points/)).toBeNull();
  });

  it("lets the selected step's pins move only while the map edits", async () => {
    const { user } = await mount("#group T\n#name One\nstep\n.goto Elwynn Forest,40,40\n");
    const pin = () => within(mapArea()).getByRole("button", { name: "Selected step 1, line 1: .goto Elwynn Forest 40.00, 40.00" });
    expect(pin().hasAttribute("aria-describedby")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Playback" }));
    await screen.findByRole("group", { name: "Timeline" });
    expect(pin().hasAttribute("aria-describedby")).toBe(false);
  });

  it("focuses again on each press after a pan, and Playback does not replay a focus", async () => {
    const { user } = await mount("#group T\n#name One\nstep\n.goto Durotar,50,50\nstep\n.goto Undercity,50,50\n");
    const FOCUSED = ["t1411", -50330.39, -65313.89, 152.6044];
    const STEP = ["t1411", -1985.03, -2719.07, 7.4641];
    await showLine(user, 1);
    const focus = () => user.click(screen.getByRole("button", { name: "Focus on map" }));
    await focus();
    expect(view()).toEqual(FOCUSED);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(view()).toEqual(["t1411", -33386.93, -43375.93, 101.7363]);
    await focus();
    expect(view()).toEqual(FOCUSED);

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Playback" }));
    await screen.findByRole("group", { name: "Timeline" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("group", { name: /^Map of / });
    expect(caption()).toBe("");
    expect(view()).toEqual(STEP);
    await showLine(user, 1);
    await focus();
    expect(view()).toEqual(FOCUSED);
    expect(caption()).toBe("Durotar 50.00, 50.00");
  });
});

describe("outline rows", () => {
  const GUIDE = "#group T\n#name One\nstep\n.complete 90,1\n.complete 226,1\n.complete 226,2\n";

  it("colors each objective row as its spawns, and shows one objective's spawns and fades the others while its row has the pointer or focus", async () => {
    const { user } = await mount(GUIDE);
    expect([1, 2, 3].map((n) => rowOf(n).style.getPropertyValue("--objective"))).toEqual([O1, O2, O3]);
    const markerFades = () =>
      within(mapArea())
        .getAllByRole("button", { name: /locations \(/ })
        .map((m) => m.style.getPropertyValue("--fade"));

    const rabid = rowOf(3);
    await user.hover(rabid);
    expect(dotCounts()).toEqual({ [O3]: 2 });
    expect(areas()).toEqual([`${O1} dim`, `${O2} dim`, `${O3} focus`]);
    expect(markerFades()).toEqual(["", "0.12"]);
    await user.unhover(rabid);
    expect(spawnDots()).toEqual([]);
    expect(areas()).toEqual([O1, O3, O2]);
    expect(markerFades()).toEqual(["", ""]);

    const starving = rowOf(2);
    act(() => starving.focus());
    expect(focusedFills()).toEqual([O2]);
    expect(markerFades()).toEqual(["0.12", ""]);
    await user.hover(starving);
    await user.unhover(starving);
    expect(focusedFills()).toEqual([O2]);
    await user.hover(rabid);
    expect(focusedFills()).toEqual([O3]);
    expect(document.activeElement).toBe(starving);
    await user.unhover(rabid);
    expect(focusedFills()).toEqual([O2]);
    act(() => starving.blur());
    expect(focusedFills()).toEqual([]);
  });

  it("clears the highlight when another step is selected", async () => {
    await mount("#group T\n#name One\nstep\n.complete 90,1\n.complete 226,1\nstep\n.complete 226,1\n");
    const row = rowOf(2);
    act(() => row.focus());
    expect(dotCounts()).toEqual({ [O2]: 4 });
    expect(areas()).toEqual([`${O1} dim`, `${O2} focus`]);
    fireEvent.click(document.getElementById("step-1")!);
    await waitFor(() => expect(areas()).toEqual([O1]));
    expect(spawnDots()).toEqual([]);
    fireEvent.click(document.getElementById("step-0")!);
    await waitFor(() => expect(areas()).toEqual([O1, O2]));
    expect(spawnDots()).toEqual([]);
  });
});

it("keeps the view when deleting the selected step selects another", async () => {
  const { user } = await mountWith(
    { step: 1 },
    "#group T\n#name One\nstep\n.goto Elwynn Forest,48.94,40.16\nstep\n.goto Duskwood,79.50,48.50\n",
  );
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  await user.click(screen.getByLabelText("Delete step 2"));
  expect(document.getElementById("step-0")!.getAttribute("aria-selected")).toBe("true");
  expect(view()).toEqual(["t1431", -16675.93, -13694.44, 21.9259]);
});

it("keeps the legend's choices across a reload", async () => {
  const legend = () => screen.getByText("Legend").closest("details")!;
  const pressed = (name: string) =>
    within(legend())
      .getByRole("button", { name: new RegExp(`^${name}(, \\d+ in view)?$`) })
      .getAttribute("aria-pressed");
  const GUIDE = "#group T\n#name One\nstep\n.goto Elwynn Forest,48.94,40.16\n";
  const { user } = await mount(GUIDE);
  await user.click(screen.getByText("Legend"));
  await user.click(within(legend()).getByRole("button", { name: "Dungeons and raids" }));
  await user.click(within(legend()).getByRole("button", { name: /^Guide points/ }));
  await waitFor(async () =>
    expect(readMapSettings(await loadSetting("map"))).toMatchObject({
      legendOpen: true,
      categories: { dungeon: false, raid: false, guide: false },
    }),
  );

  cleanup();
  await mount(GUIDE);
  expect(legend().open).toBe(true);
  expect([pressed("Dungeons and raids"), pressed("Innkeepers"), pressed("Guide points")]).toEqual(["false", "true", "false"]);
  expect(within(mapArea()).queryByRole("button", { name: /^Selected step 1/ })).toBeNull();
});

describe("Search", () => {
  it("opens a closed editor on the line that Search adds", async () => {
    const { user } = await mountWith(
      { step: 1 },
      "#group T\n#name One\nstep\n>>Talk to Innkeeper Grosk (npc #6928)\n.goto Durotar,50,50\nstep\n>>See the Defilers Emissary (npc #14990)\n.goto Undercity,50,50\n",
    );
    await user.click(screen.getByRole("button", { name: "Close editor" }));
    await find(user, "npc #14990");
    await user.click(within(findMenu()).getByRole("button", { name: /^Defilers Emissary/ }));
    await user.click(screen.getByRole("button", { name: "Add .goto to step: Thunder Bluff 44.00, 57.40" }));
    expect(screen.queryByRole("button", { name: "Open editor" })).toBeNull();
    expect(within(screen.getByRole("group", { name: "Line 3, Go to" })).getByDisplayValue("Thunder Bluff")).toBeTruthy();
  });

  it("adds a found location to a built-in through its custom copy, with undo, saving, and export", async () => {
    const G = "Test Group";
    const original = `#group ${G}\n#name A\nstep\n    .accept 1 >>Hello\n`;
    const edited = `#group ${G}\n#name A\nstep\n    .goto Durotar,51.60,41.60\n    .accept 1 >>Hello\n`;
    const builtins: Builtins = { version: "v9.9.9", guides: [{ id: "rxp:test.lua#1", text: original, order: 0, fileName: "test.lua" }] };
    const { user } = await mountWith({ builtins });
    await find(user, "npc #6928");
    await user.click(within(findMenu()).getByRole("button", { name: /^Innkeeper Grosk/ }));
    await user.click(screen.getByRole("button", { name: "Add .goto to step: Durotar 51.60, 41.60" }));
    await user.click(screen.getByRole("tab", { name: "Guide text" }));
    expect(guideText()).toBe(edited);
    expect(within(screen.getByRole("navigation", { name: "Library" })).getAllByRole("listitem")).toHaveLength(1);
    await vi.waitFor(async () => expect((await loadLibrary()).guides.map((g) => g.text)).toContain(edited));

    await undo(user);
    expect(guideText()).toBe(original);
    await redo(user);
    expect(guideText()).toBe(edited);

    let blob: Blob | undefined;
    Object.assign(URL, { createObjectURL: (b: Blob) => ((blob = b), "blob:test"), revokeObjectURL: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: "Export guide" }));
    await user.click(within(screen.getByRole("dialog", { name: "Export guide" })).getByRole("button", { name: /^Download / }));
    const files = unzip(new Uint8Array(await blob!.arrayBuffer()));
    const lua = [...files.keys()].find((f) => f.endsWith("guides.lua"))!;
    expect(extractGuides(files.get(lua)!).map((g) => g.text)).toEqual([edited]);
  });
});

describe("raw text guard", () => {
  const TEXT = "#group T\n#name One\nstep\n.goto Elwynn Forest,48.94,40.16\n";
  const BLOCKED =
    "Step 1 has raw text that is not applied. Apply or discard it before changing its points. Apply raw text Discard raw text";
  const raw = () => screen.getByLabelText("Raw text of step 1") as HTMLTextAreaElement;
  const pin = () => within(mapArea()).getByRole("button", { name: /^Selected step 1, line 1: \.goto Elwynn Forest 48\.94, 40\.16/ });
  const addPoint = (user: ReturnType<typeof userEvent.setup>) => addAt(user, ELWYNN, 45, 55);

  it("refuses every map edit while raw text waits, and allows them once it is applied or discarded", async () => {
    const { user } = await mount(TEXT);
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    await user.type(raw(), "\n.xp 2");
    expect(raw().value).toBe("step\n.goto Elwynn Forest,48.94,40.16\n.xp 2");

    await addPoint(user);
    expect(alertText()).toBe(BLOCKED);
    await user.pointer([
      { keys: "[MouseLeft>]", target: pin(), coords: clientAt(ELWYNN, 48.94, 40.16) },
      { target: pin(), coords: clientAt(ELWYNN, 60, 60) },
      { keys: "[/MouseLeft]", target: pin(), coords: clientAt(ELWYNN, 60, 60) },
    ]);
    pin().focus();
    await user.keyboard("{ArrowRight}{Enter}");
    await user.keyboard("{ArrowRight}");
    await user.tab();
    expect(pin().getAttribute("aria-label")).toBe("Selected step 1, line 1: .goto Elwynn Forest 48.94, 40.16");
    expect(alertText()).toBe(BLOCKED);
    expect(raw().value).toBe("step\n.goto Elwynn Forest,48.94,40.16\n.xp 2");

    await user.click(screen.getByRole("button", { name: "Discard raw text" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(raw().value).toBe("step\n.goto Elwynn Forest,48.94,40.16");
    await addPoint(user);
    expect(raw().value).toBe("step\n.goto Elwynn Forest,48.94,40.16\n.goto Elwynn Forest,45.00,55.00");

    await user.type(raw(), "\n.xp 3");
    await addPoint(user);
    expect(alertText()).toBe(BLOCKED);
    await user.click(screen.getByRole("button", { name: "Apply raw text" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await addPoint(user);
    await user.click(screen.getByRole("tab", { name: "Guide text" }));
    expect(guideText()).toBe(
      "#group T\n#name One\nstep\n.goto Elwynn Forest,48.94,40.16\n.goto Elwynn Forest,45.00,55.00\n.goto Elwynn Forest,45.00,55.00\n.xp 3\n",
    );

    await user.click(screen.getByRole("tab", { name: "Raw" }));
    await user.clear(raw());
    await user.type(raw(), "nonsense");
    await addPoint(user);
    await user.click(screen.getByRole("button", { name: "Apply raw text" }));
    expect(alertText()).toBe("Step text must start with a step line.");
    expect(raw().value).toBe("nonsense");
    await addPoint(user);
    expect(alertText()).toBe(BLOCKED);
    await user.click(screen.getByRole("button", { name: "Discard raw text" }));
    await addPoint(user);
    await user.click(screen.getByRole("tab", { name: "Guide text" }));
    expect(guideText()).toBe(
      "#group T\n#name One\nstep\n.goto Elwynn Forest,48.94,40.16\n.goto Elwynn Forest,45.00,55.00\n.goto Elwynn Forest,45.00,55.00\n.goto Elwynn Forest,45.00,55.00\n.xp 3\n",
    );
  });

  it.each(["points", "raw text"])(
    "opens a built-in's existing copy for a map edit by %s, changing nothing and showing no map alert",
    async (path) => {
      const G = "Test Group";
      const builtin = `#group ${G}\n#name A\nstep\n.goto Elwynn Forest,48.94,40.16\n`;
      const copy = `#group ${G} (custom)\n#name A\nstep\n.goto Elwynn Forest,48.94,40.16\n.xp 5\n`;
      const builtins: Builtins = { version: "v9.9.9", guides: [{ id: "rxp:test.lua#1", text: builtin, order: 0, fileName: "test.lua" }] };
      const { user } = await mountWith({ builtins }, copy);
      if (path === "raw text") {
        await user.click(screen.getByRole("tab", { name: "Raw" }));
        await user.type(raw(), "\n.xp 2");
        await addPoint(user);
        await user.click(screen.getByRole("button", { name: "Apply raw text" }));
      } else await addPoint(user);
      expect(screen.getByText(`Opened your copy in “${G} (custom)”. Make the change there.`)).toBeTruthy();
      expect(alertText()).toBe("");
      await user.click(screen.getByRole("tab", { name: "Guide text" }));
      expect(guideText()).toBe(copy);

      const library = within(screen.getByRole("region", { name: "RestedXP Guides" }));
      for (const name of ["RestedXP Guides", G]) {
        const toggle = library.getByRole("button", { name: new RegExp(`^${name}`) });
        if (toggle.getAttribute("aria-expanded") === "false") await user.click(toggle);
      }
      await user.click(library.getByRole("button", { name: "A" }));
      expect(screen.getByRole("heading", { name: "Step 1 of 1" })).toBeTruthy();
      expect(alertText()).toBe("");
      if (path === "raw text") {
        await user.click(screen.getByRole("tab", { name: "Raw" }));
        expect(raw().value).toBe("step\n.goto Elwynn Forest,48.94,40.16\n.xp 2");
      }
    },
  );

  it("refuses a found location while raw text waits", async () => {
    const { user } = await mount("#group T\n#name One\nstep\n.goto Durotar,50,50\n");
    await user.click(screen.getByRole("tab", { name: "Raw" }));
    await user.type(raw(), "\n.xp 2");
    await find(user, "npc #6928");
    await user.click(within(findMenu()).getByRole("button", { name: /^Innkeeper Grosk/ }));
    await user.click(screen.getByRole("button", { name: "Add .goto to step: Durotar 51.60, 41.60" }));
    expect(alertText()).toBe(BLOCKED);
    await user.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(await within(findMenu()).findByText("Copied")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Discard raw text" }));
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(screen.getByRole("button", { name: "Add .goto to step: Durotar 51.60, 41.60" }));
    await user.click(screen.getByRole("tab", { name: "Guide text" }));
    expect(guideText()).toBe("#group T\n#name One\nstep\n.goto Durotar,50,50\n.goto Durotar,51.60,41.60\n");
  });
});
