// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { syntheticScope } from "../../routing/fixtures/synthetic.ts";
import type { Interior } from "../../../packages/data-contract/interiors.ts";
import { fromSurfaces } from "../../data/surfaces.ts";
import { EntityIndex, GameData, mapToWorld, type LoadedWorldMap } from "../../data/index.ts";
import { interiorsFixture } from "../../data/manifestFixture.ts";
import { MAP_BOUNDS, plannerContext, plannerFile } from "../../data/plannerFixture.ts";
import { worldMap } from "../../data/terrainFixture.ts";
import { insertStep } from "../../guide/index.ts";
import type { Builtins } from "../../io/index.ts";
import type { ZoneGrid } from "../../routing/zones.ts";
import { loadSetting, saveSetting } from "../../storage/index.ts";
import { DEFAULT_SETTINGS } from "../preview/settings.ts";
import { DEFAULT_LAYOUT } from "../layout.ts";
import type { RoutingEngine, RoutingLoad } from "../routing/engine.ts";
import { projection, round } from "../routing/lines.ts";
import { questRow, withHyjalQuest, zonePoint, ZONES } from "../testing.ts";
import { DEFAULT_MAP_SETTINGS, readMapSettings, type MapSettings } from "./mapSettings.ts";
import {
  addAt,
  areas,
  clientAt,
  data,
  dotCounts,
  DUSKWOOD,
  ELWYNN,
  flank,
  focusedFills,
  mapArea,
  mapShown,
  npc,
  O1,
  O2,
  O3,
  ORGRIMMAR,
  rabid,
  spawnDots,
  spawns,
  stageAt,
  starving,
  STORMWIND,
  transform,
  view,
  withQuests,
} from "./mapPanelFixture.ts";
import { markerLabel } from "./questMarkers.ts";
import { renderMap, type MapOptions } from "./renderMap.tsx";
import type { HighlightBy } from "./worldMapStore.ts";
import { cascade } from "../ui/testing.ts";

const routing = vi.hoisted(() => ({ load: null as (() => Promise<RoutingLoad>) | null }));
vi.mock("../routing/engine.ts", async (original) => {
  const actual = await original<typeof import("../routing/engine.ts")>();
  return { ...actual, loadRouting: () => routing.load?.() ?? actual.loadRouting() };
});

// jsdom has no Worker to trace an outline in.
const outline = vi.hoisted(() =>
  vi.fn<typeof import("./outline.ts").outline>(async () => ({
    width: 1,
    height: 1,
    path: "M0,0L1,0L1,1L0,1Z",
    masks: { two: "", more: "", twoEdge: "", moreEdge: "" },
  })),
);
vi.mock("./outline.ts", () => ({ outline }));

vi.mock("./questMarkers.ts", async (original) => {
  const actual = await original<typeof import("./questMarkers.ts")>();
  return { ...actual, markerLabel: vi.fn(actual.markerLabel) };
});

const mapStyles = readFileSync(join(import.meta.dirname, "map.css"), "utf8");

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

let mounted: Awaited<ReturnType<typeof renderMap>>;

async function mountWith(options: Partial<MapOptions>, ...texts: string[]) {
  mounted = await renderMap({ data, ...options, texts });
  return mounted;
}

const mount = (...texts: string[]) => mountWith({}, ...texts);

function observeResizes(): Map<Element, () => void> {
  const resized = new Map<Element, () => void>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe(el: Element) {
        resized.set(el, this.callback);
      }
      disconnect() {}
    },
  );
  onTestFinished(() => void vi.unstubAllGlobals());
  return resized;
}

const editor = () => mounted.stores.editor;
const guideText = () => editor().getState().current!.record.text;
const select = (step: number | null, line: number | null = null) => act(() => editor().select({ step, line }));
const undo = () => act(() => editor().undo());
const redo = () => act(() => editor().redo());
const highlight = (by: HighlightBy, key: string) =>
  act(() => mounted.worldMap.highlight(by, `g0:${editor().getState().selection.step}`, key));
const unhighlight = (by: HighlightBy, key: string) =>
  act(() => mounted.worldMap.unhighlight(by, `g0:${editor().getState().selection.step}`, key));
const focusLine = (index = 0) => {
  const { current, selection } = editor().getState();
  let result;
  act(() => void (result = mounted.worldMap.focus({ kind: "line", doc: current!.doc, at: { step: selection.step!, index } })));
  return result;
};
const caption = () => document.querySelector(".focus-caption")?.textContent ?? "";
const noRouting = () => {
  routing.load = () => Promise.resolve({ ok: false, reason: "No routing artifact is installed." });
  onTestFinished(() => void (routing.load = null));
};

const shapePoints = (uiMapId: number, ...xy: [number, number][]) =>
  xy
    .map(([x, y]) => stageAt(uiMapId, x, y))
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
const changedLines = (before: string, after: string) => {
  const [a, b] = [before.split("\n"), after.split("\n")];
  expect(b).toHaveLength(a.length);
  return a.flatMap((line, i) => (line === b[i] ? [] : [[line, b[i]]]));
};

describe("map panel", () => {
  it("adds a .goto or .waypoint in zone percentages from the menu where the map is right-clicked", async () => {
    const text = "#group T\n#name One\nstep\n>>Talk to Eagan\n.goto Elwynn Forest,48.94,40.16\n.accept 33\n";
    const { user } = await mount(text);
    expect(mapShown().value).toBe("t1429");

    await user.pointer({ keys: "[MouseLeft]", target: mapArea(), coords: clientAt(ELWYNN, 45, 55) });
    expect(guideText()).toBe(text);

    await user.pointer({ keys: "[MouseRight]", target: mapArea(), coords: clientAt(ELWYNN, 45, 55) });
    const menu = screen.getByRole("menu", { name: "Elwynn Forest 45.00, 55.00" });
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Add .goto" }));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Add .waypoint" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();

    await addAt(user, ELWYNN, 45, 55);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(guideText()).toBe(
      "#group T\n#name One\nstep\n>>Talk to Eagan\n.goto Elwynn Forest,48.94,40.16\n.goto Elwynn Forest,45.00,55.00\n.accept 33\n",
    );
    await addAt(user, ELWYNN, 50, 60, "Add .waypoint");
    expect(guideText()).toContain(".goto Elwynn Forest,45.00,55.00\n.waypoint Elwynn Forest,50.00,60.00\n.accept 33");
  });

  it("moves a world-coordinate pin with the keyboard, changing only its line, and undo restores it", async () => {
    const { user } = await mountWith(
      { step: 1 },
      "#group T\n#name One\nstep\n.goto Elwynn Forest,40,40\nstep\n>>Talk to Viktori\n.goto 1431/0,-1258.63,-10513.89\n.xp 25\n",
    );
    const before = guideText();

    expect(mapShown().value).toBe("t1431");
    const pin = within(mapArea()).getByRole("button", { name: "Selected step 2, line 2: .goto Duskwood 77.48, 44.29" });
    pin.focus();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}{ArrowDown}{ArrowDown}{Enter}");

    expect(changedLines(before, guideText())).toEqual([[".goto 1431/0,-1258.63,-10513.89", ".goto Duskwood,78.44,44.89"]]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Selected step 2, line 2: .goto Duskwood 78.44, 44.89");

    undo();
    expect(guideText()).toBe(before);
  });

  it("drags a pin to rewrite its line and keeps the arguments after the coordinates", async () => {
    const { user } = await mount("#group T\n#name One\nstep\n.goto Elwynn Forest,40,40,15 >> Go here\n.accept 33\n");
    const pin = within(mapArea()).getByRole("button", { name: /^Selected step 1, line 1: \.goto/ });
    await user.pointer([
      { keys: "[MouseLeft>]", target: pin, coords: clientAt(ELWYNN, 40, 40) },
      { target: pin, coords: clientAt(ELWYNN, 45, 42) },
      { keys: "[/MouseLeft]", target: pin, coords: clientAt(ELWYNN, 45.5, 42.5) },
    ]);
    expect(guideText()).toBe("#group T\n#name One\nstep\n.goto Elwynn Forest,45.50,42.50,15 >> Go here\n.accept 33\n");
  });

  it("shows the route workspace from Routes with no guide open", async () => {
    noRouting();
    const { user } = await mount();
    expect(screen.getByText("No guide open")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Routes" }));
    expect(screen.getByRole("button", { name: "Routes" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("group", { name: /^Route map/ })).toBeTruthy();
    expect(within(await screen.findByRole("alert")).getByText("Routes did not load")).toBeTruthy();
  });

  it("opens no menu beside the map", async () => {
    const { user } = await mount("#group T\n#name One\nstep\n.goto Elwynn Forest,48.94,40.16\n");
    await user.pointer({ keys: "[MouseRight]", target: mapArea(), coords: { clientX: 200, clientY: 1025 } });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("drops a cancelled drag so leaving the pin does not place it", async () => {
    const text = "#group T\n#name One\nstep\n.goto Elwynn Forest,40,40\n";
    const { user } = await mount(text);
    const pin = within(mapArea()).getByRole("button", { name: /^Selected step 1, line 1: \.goto/ });
    const start = pin.style.getPropertyValue("--at-x");
    await user.pointer([
      { keys: "[MouseLeft>]", target: pin, coords: { clientX: 400, clientY: 400 } },
      { target: pin, coords: { clientX: 450, clientY: 420 } },
    ]);
    expect(pin.style.getPropertyValue("--at-x")).toBe("45%");
    fireEvent.pointerCancel(pin);
    expect(pin.style.getPropertyValue("--at-x")).toBe(start);
    await user.tab();
    await user.pointer({ keys: "[/MouseLeft]", target: pin, coords: { clientX: 455, clientY: 425 } });
    expect(guideText()).toBe(text);
  });

  it("shows every RXP point command and drags only .goto and .waypoint", async () => {
    const text =
      "#group T\n#name One\nstep\n.goto Durotar,50,50\nstep\n.pin Elwynn Forest,40,40\n.questgoto Elwynn Forest,45,45,10,33,1\n.pin Nowhere,1,2\n";
    const { user } = await mountWith({ step: 1 }, text);
    expect(mapShown().value).toBe("t1429");
    const pin = within(mapArea()).getByRole("button", { name: "Selected step 2, line 1: .pin Elwynn Forest 40.00, 40.00" });
    expect(
      within(mapArea()).getByRole("button", { name: "Selected step 2, line 2: .questgoto Elwynn Forest 45.00, 45.00 (optional)" }),
    ).toBeTruthy();
    expect(screen.getByText(/^Line 3 \(\.pin\) is not on the map: RXP has no zone named "Nowhere"/)).toBeTruthy();
    expect(screen.queryByText(/has no points/)).toBeNull();

    pin.focus();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(guideText()).toBe(text);
  });

  it("keeps an optional point editable, and undo restores it", async () => {
    const text = "#group T\n#name One\nstep\n.goto Elwynn Forest,20,20,60,0\n.goto Elwynn Forest,40,40\n";
    const { user } = await mount(text);
    within(mapArea()).getByRole("button", { name: "Selected step 1, line 1: .goto Elwynn Forest 20.00, 20.00 (optional)" }).focus();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(guideText()).toBe("#group T\n#name One\nstep\n.goto Elwynn Forest,20.19,20.00,60,0\n.goto Elwynn Forest,40,40\n");
    undo();
    expect(guideText()).toBe(text);
  });

  it("asks for a point only where the map can take one", async () => {
    await mountWith({ step: 1 }, "#group T\n#name One\nstep\n.goto Elwynn Forest,40,40\nstep\n+Talk to someone\n");
    expect(screen.getByText("Step 2 has no points. Right-click the map to add one.")).toBeTruthy();
    select(0);
    expect(screen.queryByText(/has no points/)).toBeNull();
  });

  it("makes no edit when a pin is dropped where it stands", async () => {
    const text = "#group T\n#name One\nstep\n.goto Elwynn Forest,48.94,40.16\n";
    const { user } = await mount(text);
    const pin = () => within(mapArea()).getByRole("button", { name: /^Selected step 1, line 1: \.goto/ });
    pin().focus();
    await user.keyboard("{ArrowRight}{ArrowLeft}{Enter}");
    expect(pin().classList.contains("selected")).toBe(false);
    expect(guideText()).toBe(text);
  });

  it("keeps a faint pin's button when its step becomes selected", async () => {
    const { user } = await mount("#group T\n#name One\nstep\n.goto Elwynn Forest,40,40\nstep\n.goto Elwynn Forest,50,50\n");
    const faint = within(mapArea()).getByRole("button", { name: "Upcoming step 2: .goto Elwynn Forest 50.00, 50.00" });
    await user.click(faint);
    expect(within(mapArea()).getByRole("button", { name: "Selected step 2, line 1: .goto Elwynn Forest 50.00, 50.00" })).toBe(faint);
  });

  describe("steps around the selection", () => {
    const guide = `#group T\n#name Steps\n${Array.from({ length: 13 }, (_, i) => `step\n.goto Elwynn Forest,${10 + i * 5},50\n`).join("")}`;
    const sidePins = () =>
      [...mapArea().querySelectorAll<HTMLElement>(".pin-previous, .pin-upcoming")].map((p) => [
        Number(p.textContent),
        p.classList.contains("pin-previous") ? "previous" : "upcoming",
        Number(p.style.getPropertyValue("--fade")),
      ]);
    const routes = () =>
      [...mapArea().querySelectorAll("polyline.route:not(.casing)")].map((l) => [
        l.getAttribute("class"),
        l.getAttribute("points"),
        Number(l.parentElement!.getAttribute("opacity") ?? 1),
      ]);
    const show = async (side: "Previous" | "Upcoming", state: "Hidden" | "Dimmed" | "Shown") => {
      const menu = screen.getByRole("button", { name: "Step display" });
      if (menu.getAttribute("aria-expanded") === "false") await mounted.user.click(menu);
      return within(screen.getByRole("group", { name: `${side} steps` })).getByRole("button", { name: state });
    };

    it("selects a faded pin's step, and clears the side pins of the last step", async () => {
      const { user } = await mountWith({ step: 2 }, guide);
      expect(sidePins().map(([step, side]) => [step, side])).toEqual(Array.from({ length: 10 }, (_, i) => [i + 4, "upcoming"]));
      await user.click(within(mapArea()).getByRole("button", { name: /^Upcoming step 13: \.goto/ }));
      expect(within(mapArea()).getByRole("button", { name: /^Selected step 13, line 1: \.goto/ })).toBeTruthy();
      expect(sidePins()).toEqual([]);
    });

    it("draws each step's .line and .loop paths in its side's color", async () => {
      const style = document.head.appendChild(document.createElement("style"));
      style.textContent = mapStyles;
      onTestFinished(() => style.remove());
      const paths =
        "#group T\n#name Paths\nstep\n.line Elwynn Forest,10,10,20,20\nstep\n.loop 25,Elwynn Forest,30,30,40,30,40,40\nstep\n.line Elwynn Forest,50,50,60,60\n";
      await mountWith({ map: { previousSteps: "shown", upcomingSteps: "shown" }, step: 1 }, paths);
      const strokes = [...mapArea().querySelectorAll(".rxp-line")].map((l) => [l.getAttribute("points"), getComputedStyle(l).stroke]);
      expect(strokes).toEqual([
        [shapePoints(ELWYNN, [10, 10], [20, 20]), "var(--step-previous)"],
        [shapePoints(ELWYNN, [50, 50], [60, 60]), "var(--step-upcoming)"],
        [shapePoints(ELWYNN, [30, 30], [40, 30], [40, 40]), "var(--pin)"],
      ]);
    });

    it("sets each side hidden, dimmed, or shown from the legend", async () => {
      const { user } = await mountWith({ step: 2 }, guide);
      expect((await show("Previous", "Hidden")).getAttribute("aria-pressed")).toBe("true");
      expect((await show("Upcoming", "Dimmed")).getAttribute("aria-pressed")).toBe("true");

      await user.click(await show("Previous", "Dimmed"));
      expect(sidePins().filter(([, side]) => side === "previous")).toEqual([
        [1, "previous", 0.4],
        [2, "previous", 0.4],
      ]);
      expect(routes().filter(([name]) => name !== "route upcoming")).toEqual([
        ["route previous", shapePoints(ELWYNN, [10, 50], [15, 50]), 0.4],
        ["route selected", shapePoints(ELWYNN, [15, 50], [20, 50]), 1],
      ]);
      await user.click(within(mapArea()).getByRole("button", { name: "Previous step 1: .goto Elwynn Forest 10.00, 50.00" }));
      expect(within(mapArea()).getByRole("button", { name: /^Selected step 1, line 1: \.goto/ })).toBeTruthy();
      select(2);

      await user.click(await show("Previous", "Shown"));
      await user.click(await show("Upcoming", "Hidden"));
      expect(sidePins()).toEqual([
        [1, "previous", 1],
        [2, "previous", 1],
      ]);
      expect(routes().map(([name]) => name)).toEqual(["route previous", "route selected"]);
      await user.click(await show("Upcoming", "Shown"));
      expect(sidePins().filter(([, side]) => side === "upcoming")).toEqual(Array.from({ length: 10 }, (_, i) => [i + 4, "upcoming", 1]));
      await waitFor(async () =>
        expect(readMapSettings(await loadSetting("map"))).toMatchObject({ previousSteps: "shown", upcomingSteps: "shown" }),
      );
    });
  });

  it("draws one quest marker for a giver and ender at one spot, above the route pin", async () => {
    await mount("#group T\n#name One\nstep\n.goto Duskwood,79.50,48.50\n.accept 174\n.turnin 174\n");
    const route = within(mapArea()).getByRole("button", { name: /^Selected step 1, line 1: \.goto/ });
    const [marker, ...others] = within(mapArea()).getAllByRole("button", { name: /Look to the Stars/ });
    expect(others).toEqual([]);
    expect(marker!.classList.contains("pin-both")).toBe(true);
    const icons = [...marker!.querySelectorAll<HTMLElement>(".map-icon")].map(
      (i) => `${i.style.getPropertyValue("--image-x")} ${i.style.getPropertyValue("--image-y")}`,
    );
    expect(icons).toEqual(["-24 -48", "-48 -48"]);
    expect(route.compareDocumentPosition(marker!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("marks each objective once and draws its spawns as areas, without dots", async () => {
    const { user } = await mount("#group T\n#name One\nstep\n.complete 90,1\n.complete 226,1\n.complete 226,2\n");
    const markers = within(mapArea()).getAllByRole("button", { name: /locations \(/ });
    expect(markers.map((m) => m.getAttribute("aria-label")!.replace(/ \(.*/, ""))).toEqual([
      "Seasoned Wolf Kabobs: Lean Wolf Flank, nearest the middle of 3 locations; Wolves at Our Heels: Rabid Dire Wolf, nearest the middle of 2 locations",
      "Wolves at Our Heels: Starving Dire Wolf, nearest the middle of 4 locations",
    ]);
    expect(areas()).toEqual([O1, O3, O2]);
    for (const path of mapArea().querySelectorAll(".areas path")) expect(path.getAttribute("d")).toMatch(/^(M[^MZ]+Z)+$/);
    expect(spawnDots()).toEqual([]);
    expect(markers.map((m) => m.style.getPropertyValue("--fill"))).toEqual([`conic-gradient(${O1} 0% 50%, ${O3} 50% 100%)`, O2]);

    await user.click(markers[0]!);
    await user.click(screen.getByRole("menuitem", { name: "Add .goto" }));
    expect(guideText()).toBe("#group T\n#name One\nstep\n.goto Duskwood,32.00,30.00\n.complete 90,1\n.complete 226,1\n.complete 226,2\n");
  });

  it("keeps the focus highlight and legend count of an inferred objective", async () => {
    const inferred = withQuests([
      questRow(90, "Seasoned Wolf Kabobs", {
        textObjectives: [{ name: "Lean Wolf Flank", need: "kills", link: { kind: "item", id: 1015 } }],
        objectivePoints: spawns(DUSKWOOD, flank, [30, 30], [32, 30], [34, 30]),
      }),
    ]);
    await mountWith({ data: inferred }, "#group T\n#name One\nstep\n.complete 90,1\n");
    const marker = within(mapArea()).getByRole("button", { name: /Lean Wolf Flank \(inferred from page order\), nearest/ });
    expect(marker.style.getPropertyValue("--fill")).toBe(O1);
    highlight("focused", "90:1");
    expect(dotCounts()).toEqual({ [O1]: 3 });
    expect(areas()).toEqual([`${O1} focus`]);
    const toggle = screen.getByRole("button", { name: "Objective spawns, 3 in view" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a hovered row's objective over a focused row's, and the focused row's again when the pointer leaves", async () => {
    await mount("#group T\n#name One\nstep\n.complete 90,1\n.complete 226,1\n.complete 226,2\n");
    highlight("focused", "226:1");
    expect(focusedFills()).toEqual([O2]);
    highlight("hovered", "226:2");
    expect(focusedFills()).toEqual([O3]);
    unhighlight("hovered", "226:2");
    expect(focusedFills()).toEqual([O2]);
    unhighlight("focused", "226:1");
    expect(focusedFills()).toEqual([]);
  });

  it("marks a focused objective by its spawn dots, and by rings while Objective spawns is hidden, saving no layer", async () => {
    const text = "#group T\n#name One\nstep\n.complete 226,1\n";
    const rings = () => mapArea().querySelectorAll(".focus-mark").length;
    await mount(text);
    expect(focusLine()).toEqual({ kind: "focused" });
    expect(mapShown().value).toBe("t1431");
    expect([dotCounts(), rings()]).toEqual([{ [O1]: 4 }, 0]);
    cleanup();

    await mountWith({ map: { categories: { "objective-spawns": false } } }, text);
    focusLine();
    expect([spawnDots(), rings()]).toEqual([[], 3]);
    expect(readMapSettings(await loadSetting("map")).categories).toEqual({ "objective-spawns": false });
  });

  it("draws a spawn that objectives share once, in slices of each one's color", async () => {
    const drops = (from: typeof starving, ...xy: [number, number][]) => spawns(DUSKWOOD, { ...from, kind: "item" }, ...xy);
    const file = plannerFile();
    const shared = new GameData(
      {
        ...file,
        droppers: { ...file.droppers, "1015": [213, 565].map((id) => ({ id, type: "npc" as const })) },
        quests: [
          questRow(226, "Wolves at Our Heels", {
            questLevel: 21,
            requiredLevel: 19,
            objectives: [{ index: 1, type: "monster", id: 213, ids: [213], name: "Starving Dire Wolf" }],
            objectivePoints: spawns(DUSKWOOD, starving, [60.8, 16.8], [61.6, 16.8], [64.4, 18.1]),
          }),
          questRow(90, "Seasoned Wolf Kabobs", {
            questLevel: 25,
            requiredLevel: 18,
            objectives: [{ index: 1, type: "item", id: 1015, ids: [1015], name: "Lean Wolf Flank" }],
            objectivePoints: [...drops(starving, [60.8, 16.8], [61.6, 16.8], [64.4, 18.1]), ...drops(rabid, [33.1, 29.1], [29.6, 28.6])],
          }),
        ],
      },
      plannerContext,
    );
    const guide = "#group T\n#name One\nstep\n.goto Duskwood,30.00,40.00\n.goto Duskwood,70.00,40.00\n.complete 226,1\n.complete 90,1\n";
    await mountWith({ data: shared }, guide);
    const both = `conic-gradient(${O1} 0% 50%, ${O2} 50% 100%)`;
    expect(spawnDots()).toEqual([]);
    highlight("hovered", "226:1");
    expect(dotCounts()).toEqual({ [both]: 3 });
    highlight("hovered", "90:1");
    expect(dotCounts()).toEqual({ [both]: 3, [O2]: 2 });
    const above = [mapArea().querySelector(".route")!, mapArea().querySelector(".pin")!];
    for (const dot of mapArea().querySelectorAll(".areas, .spawns, .spawn"))
      for (const later of above) expect(dot.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    for (let i = 0; i < 5; i++) fireEvent.wheel(mapArea(), { deltaY: -100, clientX: 0, clientY: 0 });
    expect(dotCounts()).toEqual({ [O2]: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(dotCounts()).toEqual({ [both]: 3, [O2]: 2 });
  });
});

describe("quest locations off the continents' zone maps", () => {
  it("marks a Zephras Isle quest location and adds a .goto there", async () => {
    const { user } = await mount("#group T\n#name One\nstep\n.accept 92461\n");
    expect(mapShown().value).toBe("t2521");
    expect(screen.queryByText(/is not on the map/)).toBeNull();
    await user.click(
      within(mapArea()).getByRole("button", {
        name: "Starts Harmony in Balance: Rorian the Dayseeker (Zephras Isle 42.0, 23.4). Adds a point here.",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Add .goto" }));
    expect(guideText()).toBe("#group T\n#name One\nstep\n.goto Zephras Isle,42.00,23.40\n.accept 92461\n");
  });

  it("adds a location on a map RXP has no name for with its map ID, from the keyboard", async () => {
    const { user } = await mountWith({ data: withHyjalQuest(data) }, "#group T\n#name One\nstep\n.accept 4005\n");
    expect(mapShown().value).toBe("t2482");
    const marker = within(mapArea()).getByRole("button", {
      name: "Starts Aquementas: Eridan Bluewind (Mount Hyjal 11.2, 99.2). Adds a point here.",
    });
    marker.focus();
    await user.keyboard("{Enter}{Enter}");
    const pin = within(mapArea()).getByRole("button", { name: "Selected step 1, line 1: .goto Mount Hyjal 11.17, 99.17" });
    for (const side of ["--at-x", "--at-y"]) {
      expect(parseFloat(pin.style.getPropertyValue(side))).toBeCloseTo(parseFloat(marker.style.getPropertyValue(side)), 3);
    }
    expect(screen.queryByText(/is not on the map/)).toBeNull();
    expect(guideText()).toBe("#group T\n#name One\nstep\n.goto 2482,11.17,99.17\n.accept 4005\n");
  });
});

describe("terrain", () => {
  const GUIDE = "#group T\n#name One\nstep\n.goto Elwynn Forest,48.94,40.16\nstep\n.goto Duskwood,79.50,48.50\n";
  const tiles = () => [...mapArea().querySelectorAll<HTMLImageElement>("img.tile")].map((t) => t.getAttribute("src")!);
  const loadedTile = () =>
    waitFor(() => {
      const tile = mapArea().querySelector<HTMLImageElement>("img.tile");
      expect(tile).not.toBeNull();
      return tile!;
    });
  const viewportSize = (width: number, height: number) =>
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect(this.classList.contains("map-viewport") ? { width, height } : { width: 1000, height: 1000 });
    });
  const mountGuide = (options: Partial<MapOptions> = {}, text = GUIDE) => mountWith(options, text);

  it("shows the Forever terrain from local tiles and follows the step's zone", async () => {
    await mountGuide();
    expect(mapShown().value).toBe("t1429");
    expect(mapArea().getAttribute("aria-label")).toMatch(/^Map of Azeroth \(terrain\)\./);
    await waitFor(() => {
      const urls = tiles();
      for (const url of urls)
        expect(url).toMatch(/^\/world-map\/test\/tiles\/(kalimdor|eastern-kingdoms|zephras-isle)\/\d+\/\d+\/\d+\.webp$/);
      expect([...new Set(urls.map((u) => Number(u.split("/")[5])))].sort((a, b) => a - b)).toEqual([worldMap.minZoom, 6]);
    });

    const pin = within(mapArea()).getByRole("button", { name: "Selected step 1, line 1: .goto Elwynn Forest 48.94, 40.16" });
    expect(pin.style.getPropertyValue("--at-x")).toMatch(/%$/);
    expect([...mapArea().querySelectorAll(".place-zone")].map((l) => l.firstChild!.textContent)).toContain("Elwynn Forest");
    expect(["dungeon", "innkeeper", "battlemaster"].map((c) => mapArea().querySelectorAll(`[data-category="${c}"]`).length)).toEqual([
      1, 1, 0,
    ]);
    expect(within(mapArea()).getAllByRole("button", { name: /: Dungeons \(\d+–\d+\)$/ })).toHaveLength(1);

    select(1);
    expect(mapShown().value).toBe("t1431");
  });

  it("draws labels, markers, lines, and pins on the overlay, with only tiles on the stage under it", async () => {
    await mountGuide();
    const area = mapArea();
    await waitFor(() => expect(area.querySelectorAll(".map-stage img.tile")).toHaveLength(9));
    expect(area.querySelectorAll(".map-stage .place, .map-stage .poi, .map-stage .pin, .map-stage svg")).toHaveLength(0);
    expect([".place-zone", ".poi", ".pin", "svg"].map((s) => area.querySelectorAll(`.map-overlay ${s}`).length)).toEqual([1, 2, 2, 4]);
    const [tx, ty] = transform();
    expect(area.querySelector<HTMLElement>(".map-overlay")!.style.getPropertyValue("--pan")).toBe(`translate(${tx}px, ${ty}px)`);
  });

  it.each([1, 2])("uses published world-level features at pixel density %d", async (density) => {
    vi.stubGlobal("devicePixelRatio", density);
    try {
      viewportSize(418, 714);
      const { user } = await mountGuide();
      const settings = await loadSetting("map");
      await user.selectOptions(mapShown(), "t0");
      expect(mapArea().querySelectorAll(".place-capital")).toHaveLength(1);
      expect(mapArea().querySelectorAll(".poi-instances, .poi-transport, .place-zone")).toHaveLength(3);
      expect(mapArea().querySelectorAll(".routes g")).toHaveLength(1);
      expect(within(mapArea()).getByRole("button", { name: "Selected step 1, line 1: .goto Elwynn Forest 48.94, 40.16" })).toBeTruthy();

      await user.selectOptions(mapShown(), "t1429");
      expect(mapArea().querySelectorAll(".poi-instances")).toHaveLength(1);
      expect(mapArea().querySelectorAll(".poi-transport")).toHaveLength(0);
      expect(mapArea().querySelectorAll(".routes g")).toHaveLength(1);
      expect(mapArea().querySelectorAll(".poi-name")).toHaveLength(1);
      expect(await loadSetting("map")).toEqual(settings);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports tiles that fail to load and asks for them again on retry, keeping the view", async () => {
    const { user } = await mountGuide();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const rounded = () => transform().map((n) => n.toFixed(6));
    const before = rounded();
    expect(screen.queryByRole("alert")).toBeNull();
    const tile = await loadedTile();
    fireEvent.error(tile);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Some terrain tiles did not load.");
    expect(tiles()).not.toContain(tile.getAttribute("src"));
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(tiles()).toContain(tile.getAttribute("src")));
    expect(rounded()).toEqual(before);
    expect(mapShown().value).toBe("t1429");
  });

  it("keeps the tile alert after the failed tile leaves the view, and shows the tile again only on retry", async () => {
    const { user } = await mountGuide();
    const shown = () => [...mapArea().querySelectorAll<HTMLImageElement>("img.tile")].map((t) => t.getAttribute("src")!);
    const detail = await waitFor(() => {
      const tile = [...mapArea().querySelectorAll<HTMLImageElement>("img.tile")].find((t) => t.getAttribute("src")!.split("/")[5] === "6");
      expect(tile).toBeDefined();
      return tile!;
    });
    const src = detail.getAttribute("src")!;
    fireEvent.error(detail);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect([mapArea().contains(detail), screen.getByRole("alert").textContent]).toEqual([false, "Some terrain tiles did not load. Retry"]);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await act(async () => {});
    expect([shown().includes(src), screen.getByRole("alert").textContent]).toEqual([false, "Some terrain tiles did not load. Retry"]);
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(shown()).toContain(src));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  describe("view", () => {
    const ELWYNN_VIEW = [-8316.33, -6423.47, 11.3709] as const;
    const ELWYNN_ZOOMED = [-12724.49, -9885.2, 17.0564] as const;
    const DUSKWOOD_VIEW = [-10950.62, -8962.96, 14.6173] as const;
    const DUSKWOOD_ZOOMED = [-16675.93, -13694.44, 21.9259] as const;
    const zoomIn = () => fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    it("keeps the zoomed Azeroth view after Routes", async () => {
      noRouting();
      const { user } = await mountGuide();
      await user.selectOptions(mapShown(), "t0");
      zoomIn();
      expect(view()).toEqual(["t0", -250, -250, 1.5]);
      await user.click(screen.getByRole("button", { name: "Routes" }));
      await user.click(screen.getByRole("button", { name: "Routes" }));
      expect(view()).toEqual(["t0", -250, -250, 1.5]);
    });

    it("moves to a picked step or map", async () => {
      const { user } = await mountGuide();
      expect(view()).toEqual(["t1429", ...ELWYNN_VIEW]);
      zoomIn();
      select(1);
      expect(view()).toEqual(["t1431", ...DUSKWOOD_VIEW]);
      zoomIn();
      await user.selectOptions(mapShown(), `t${ELWYNN}`);
      expect(view()).toEqual(["t1429", ...ELWYNN_VIEW]);
    });

    it("keeps a picked map when a line of the step is selected", async () => {
      const { user } = await mountGuide({ step: 1 });
      await user.selectOptions(mapShown(), `t${ELWYNN}`);
      zoomIn();
      select(1, 0);
      expect(view()).toEqual(["t1429", ...ELWYNN_ZOOMED]);
    });

    it("keeps a picked map across an edit of the step", async () => {
      const { user } = await mountGuide({ step: 1 });
      await user.selectOptions(mapShown(), `t${ELWYNN}`);
      zoomIn();
      await addAt(user, DUSKWOOD.uiMapId, 50, 50);
      within(mapArea()).getByRole("button", { name: "Selected step 2, line 2: .goto Duskwood 50.00, 50.00" });
      expect(view()).toEqual(["t1429", ...ELWYNN_ZOOMED]);
    });

    it("keeps the view when an edit moves the step's point to another map", async () => {
      const { user } = await mountGuide();
      zoomIn();
      await addAt(user, DUSKWOOD.uiMapId, 50, 50);
      within(mapArea()).getByRole("button", { name: "Selected step 1, line 2: .goto Duskwood 50.00, 50.00" });
      expect(view()).toEqual(["t1429", ...ELWYNN_ZOOMED]);
    });

    it.each([
      [
        "zoomed",
        0,
        "#group Test Group\n#name A\nstep\n.goto Elwynn Forest,48.94,40.16\n.goto Duskwood,50.00,50.00\nstep\n.goto Duskwood,79.50,48.50\n",
      ],
      [
        "picked",
        1,
        "#group Test Group\n#name A\nstep\n.goto Elwynn Forest,48.94,40.16\nstep\n.goto Duskwood,79.50,48.50\n.goto Duskwood,50.00,50.00\n",
      ],
    ])("keeps the %s view when the first map edit of a built-in opens its custom copy", async (kind, step, edited) => {
      const builtin = `#group Test Group\n#name A\n${GUIDE.split("\n").slice(2).join("\n")}`;
      const builtins: Builtins = { version: "v9.9.9", guides: [{ id: "rxp:test.lua#1", text: builtin, order: 0, fileName: "test.lua" }] };
      const { user } = await mountWith({ builtins, step });
      if (kind === "picked") await user.selectOptions(mapShown(), `t${ELWYNN}`);
      zoomIn();
      await addAt(user, DUSKWOOD.uiMapId, 50, 50);
      expect(editor().getState().current).toMatchObject({ builtin: false, group: "Test Group (custom)" });
      expect(guideText()).toBe(edited);
      expect(view()).toEqual(["t1429", ...ELWYNN_ZOOMED]);
    });

    it("keeps the view when the selection clears", async () => {
      await mountGuide({ step: 1 });
      zoomIn();
      select(null);
      expect(view()).toEqual(["t1431", ...DUSKWOOD_ZOOMED]);
    });

    it("keeps the view when an edit selects a step after the selection clears", async () => {
      await mountGuide({ step: 1 });
      zoomIn();
      select(null);
      act(() => void editor().edit((d) => insertStep(d, 0), { step: 0, line: null }));
      expect(editor().getState().selection).toEqual({ step: 0, line: null });
      expect(view()).toEqual(["t1431", ...DUSKWOOD_ZOOMED]);
    });

    it("keeps the view when another faction's quest giver stands elsewhere", async () => {
      const STORMWIND_ZOOMED = [-25007.13, -19794.92, 34.0719] as const;
      const split = questRow(9389, "Flickering Flames in the Eastern Kingdoms", {
        byFaction: {
          Alliance: { startPoints: spawns(STORMWIND, npc("start", 16817, "Festival Loremaster"), [50.03, 71.95]) },
          Horde: { startPoints: spawns(ORGRIMMAR, npc("start", 16818, "Festival Talespinner"), [42.77, 34.95]) },
        },
      });
      await mountGuide({ data: withQuests([split]) }, "#group T\n#name One\nstep\n.accept 9389\nstep\n.goto Duskwood,79.50,48.50\n");
      zoomIn();
      expect(view()).toEqual(["t1453", ...STORMWIND_ZOOMED]);
      act(() => mounted.stores.preview.update({ race: "Orc" }));
      within(mapArea()).getByRole("button", {
        name: "Starts Flickering Flames in the Eastern Kingdoms: Festival Talespinner (Orgrimmar 42.8, 35.0). Adds a point here.",
      });
      expect(view()).toEqual(["t1453", ...STORMWIND_ZOOMED]);
    });

    it("moves to the step that undo and redo change", async () => {
      const { user } = await mountGuide();
      await user.selectOptions(mapShown(), `t${DUSKWOOD.uiMapId}`);
      await addAt(user, DUSKWOOD.uiMapId, 50, 50);
      expect(view()).toEqual(["t1431", ...DUSKWOOD_VIEW]);
      undo();
      expect(view()).toEqual(["t1429", ...ELWYNN_VIEW]);
      redo();
      expect(view()).toEqual(["t1431", ...DUSKWOOD_VIEW]);
    });
  });

  describe("legend", () => {
    const legend = () => screen.getByText("Legend").closest("details")!;
    const row = (name: string) => within(legend()).getByRole("button", { name: new RegExp(`^${name}(, \\d+ in view)?$`) });
    const isPressed = (el: HTMLElement) => el.getAttribute("aria-pressed");
    const saved = async () => readMapSettings(await loadSetting("map"));

    it("toggles categories and groups, saves them, and resets to the defaults", async () => {
      const farley = worldMap.pois.find((p) => p.name === "Innkeeper Farley")!;
      const local = {
        ...worldMap,
        pois: worldMap.pois.map((p) => (p.category === "battlemaster" ? { ...p, x: farley.x + 100, y: farley.y } : p)),
      };
      const { user } = await mountGuide({ map: { allFactions: true }, worldMap: local });
      const services = within(legend()).getByRole("button", { name: "Services" });
      expect(isPressed(services)).toBe("mixed");
      expect(isPressed(row("Innkeepers"))).toBe("true");
      expect(isPressed(row("Battlemasters"))).toBe("false");

      await user.click(within(legend()).getByRole("button", { name: "Dungeons and raids" }));
      await user.click(services);
      expect(isPressed(services)).toBe("true");
      expect(mapArea().querySelectorAll(".poi-instances")).toHaveLength(0);
      expect(mapArea().querySelectorAll('[data-category="battlemaster"]')).toHaveLength(3);
      await user.click(services);
      expect(isPressed(services)).toBe("false");
      row("Innkeepers").focus();
      await user.keyboard(" ");
      expect(isPressed(row("Innkeepers"))).toBe("true");
      expect(isPressed(services)).toBe("mixed");
      await user.click(row("Guide points"));
      expect(within(mapArea()).queryByRole("button", { name: /^Selected step 1/ })).toBeNull();
      expect((await saved()).categories).toMatchObject({ dungeon: false, raid: false, battlemaster: false, innkeeper: true, guide: false });

      await user.click(within(legend()).getByRole("button", { name: "Reset to defaults" }));
      expect(mapArea().querySelectorAll(".poi-instances")).toHaveLength(1);
      expect(mapArea().querySelectorAll('[data-category="battlemaster"]')).toHaveLength(0);
      expect(within(mapArea()).getByRole("button", { name: /^Selected step 1/ })).toBeTruthy();
      expect(await saved()).toEqual(DEFAULT_MAP_SETTINGS);
    });

    it("says Some beside a partly shown group's eye, out of the accessible names that already say mixed", async () => {
      const { user } = await mountGuide();
      const services = within(legend()).getByRole("group", { name: "Services" });
      const stateWord = () => services.querySelector(".legend-heading .legend-state");
      expect([stateWord()?.textContent, stateWord()?.getAttribute("aria-hidden")]).toEqual(["Some", "true"]);
      expect(within(services).getByRole("button", { name: "Services" }).getAttribute("aria-pressed")).toBe("mixed");

      await user.click(within(services).getByRole("button", { name: "Services" }));
      expect(stateWord()).toBeNull();
    });

    it("sets shown names at regular weight, under the bold group heading", async () => {
      await mountGuide();
      const weight = (el: Element | null): string | undefined =>
        el ? (cascade(el, "font-weight")?.value ?? weight(el.parentElement)) : undefined;
      expect([
        weight(screen.getByRole("heading", { name: "Services" })),
        weight(row("Innkeepers").querySelector(".legend-name")),
        weight(row("Battlemasters").querySelector(".legend-name")),
      ]).toEqual(["var(--font-weight-bold)", "var(--font-weight-regular)", "var(--font-weight-regular)"]);
    });

    it("draws the shape of a plain point's group beside the group's heading, and other rows with their sprite", async () => {
      await mountGuide();
      const heading = screen.getByRole("heading", { name: "Services" });
      expect(heading.querySelector(".group-mark")!.className).toBe("group-mark poi-services");
      expect(screen.getByRole("heading", { name: "Guide points" }).querySelector(".group-mark")!.className).toBe("group-mark guide");
      expect(row("Innkeepers").querySelector(".map-icon")).toBeNull();
      expect(row("Ships").querySelector(".map-icon")!.className).toBe("map-icon");
      expect(screen.getByRole("heading", { name: "Transport" }).querySelector(".group-mark")).toBeNull();
    });

    it("lists the groups drawn as plain shapes right after the guide's own marks", async () => {
      await mountGuide();
      const groups = within(legend())
        .getAllByRole("group")
        .map((g) => g.querySelector("h3")!.textContent);
      expect(groups).toEqual([
        "Guide points",
        "Services",
        "Repair and vendors",
        "Training and supplies",
        "Class trainers",
        "Quests",
        "Map labels",
        "Dungeons and raids",
        "Transport",
        "Quest givers",
        "Skyborne",
        "Rare NPCs",
        "Filters",
      ]);
    });

    it("groups the zone labels, zone borders, and landmark labels under Map labels, which shows or hides all three", async () => {
      const { user } = await mountGuide();
      const labels = within(legend()).getByRole("group", { name: "Map labels" });
      expect(
        within(labels)
          .getAllByRole("button")
          .map((b) => b.getAttribute("aria-label") ?? b.textContent),
      ).toEqual(["Map labels", "Zone and capital labels, 1 in view", "Zone borders", "Landmark labels, 0 in view"]);
      const eye = within(labels).getByRole("button", { name: "Map labels" });
      expect(isPressed(eye)).toBe("mixed");
      await user.click(eye);
      expect([row("Zone and capital labels"), row("Zone borders"), row("Landmark labels")].map(isPressed)).toEqual([
        "true",
        "true",
        "true",
      ]);
      await user.click(eye);
      expect(isPressed(eye)).toBe("false");
      expect((await saved()).categories).toMatchObject({ zones: false, "zone-borders": false, landmarks: false });
    });

    it("sets previous steps to Shown from the Step display popover, and the Previous row names the choice", async () => {
      const { user } = await mount("#group T\n#name Two\nstep\n.goto Elwynn Forest,10,50\nstep\n.goto Elwynn Forest,20,50\n");
      const stepRows = () =>
        [...legend().querySelectorAll(".legend-step")].map((r) => [...r.querySelectorAll("span")].flatMap((s) => s.textContent || []));
      expect(stepRows()).toEqual([["Selected step"], ["Optional point"], ["Previous", "Hidden"], ["Upcoming", "Dimmed"]]);

      const menu = within(legend()).getByRole("button", { name: "Step display" });
      await user.click(menu);
      await user.click(within(screen.getByRole("group", { name: "Previous steps" })).getByRole("button", { name: "Shown" }));
      expect(stepRows()[2]).toEqual(["Previous", "Shown"]);
      await waitFor(async () => expect((await saved()).previousSteps).toBe("shown"));

      await user.keyboard("{Escape}");
      expect(menu.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(menu);
    });

    it("moves Tab through the Guide points heading in the order it shows: Step display, then the group's eye", async () => {
      const { user } = await mount("#group T\n#name One\nstep\n.goto Elwynn Forest,10,50\n");
      act(() => within(legend()).getByText("Legend").focus());
      const reached = [];
      for (let i = 0; i < 2; i++) {
        await user.tab();
        reached.push(document.activeElement!.getAttribute("aria-label") ?? document.activeElement!.textContent);
      }
      expect(reached).toEqual(["Step display", "Guide points"]);
    });

    it("shows the on state of a group eye and a row eye on the icon only, with no fill", async () => {
      await mount("#group T\n#name One\nstep\n.goto Elwynn Forest,10,50\n");
      const eye = within(legend()).getByRole("button", { name: "Guide points" });
      const rowEye = row("Objective spawns");
      expect([
        eye.getAttribute("aria-pressed"),
        rowEye.getAttribute("aria-pressed"),
        cascade(eye, "background")?.value,
        cascade(eye.querySelector("svg")!, "background")?.value,
        cascade(rowEye.querySelector("svg:last-child")!, "background")?.value,
      ]).toEqual(["true", "true", "none", undefined, undefined]);
    });

    it("draws a shown eye in a heavier stroke than a crossed eye", async () => {
      await mount("#group T\n#name One\nstep\n.goto Elwynn Forest,10,50\n");
      const stroke = (svg: Element) => Number(cascade(svg, "stroke-width")?.value ?? svg.getAttribute("stroke-width"));
      const crossed = stroke(legend().querySelector(".legend-step svg.off")!);
      const shown = [
        within(legend()).getByRole("button", { name: "Guide points" }).querySelector("svg")!,
        row("Objective spawns").querySelector("svg:last-child")!,
        legend().querySelector(".legend-step:not(.off) svg")!,
      ].map(stroke);
      expect(shown.map((width) => width > crossed)).toEqual([true, true, true]);
    });

    it("closes the Step display popover from its close button and returns focus to the button", async () => {
      const { user } = await mount("#group T\n#name One\nstep\n.goto Elwynn Forest,10,50\n");
      const menu = within(legend()).getByRole("button", { name: "Step display" });
      await user.click(menu);
      await user.click(within(screen.getByRole("region", { name: "Step display" })).getByRole("button", { name: "Close Step display" }));
      expect(menu.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("region", { name: "Step display" })).toBeNull();
      expect(document.activeElement).toBe(menu);
    });

    it("hides objective areas and dots from their row, keeping pins and objective markers, and Guide points toggles both", async () => {
      const { user } = await mount(
        "#group T\n#name One\nstep\n.goto Duskwood,79.50,48.50\n.complete 90,1\n.complete 226,1\n.complete 226,2\n",
      );
      const guidePoints = within(legend()).getByRole("button", { name: "Guide points" });
      const spawnRow = () => row("Objective spawns");
      const pins = () => within(mapArea()).queryAllByRole("button", { name: /^Selected step 1|locations \(/ }).length;
      expect(spawnRow().getAttribute("aria-label")).toBe("Objective spawns, 9 in view");
      expect(areas()).toHaveLength(3);
      expect(pins()).toBe(3);
      highlight("focused", "226:1");
      expect(spawnDots()).toHaveLength(4);

      fireEvent.click(spawnRow());
      expect(areas()).toEqual([]);
      expect(spawnDots()).toEqual([]);
      expect(pins()).toBe(3);
      unhighlight("focused", "226:1");
      expect(isPressed(guidePoints)).toBe("mixed");
      expect(spawnRow().getAttribute("aria-label")).toBe("Objective spawns, 9 in view");

      await user.click(guidePoints);
      expect(isPressed(spawnRow())).toBe("true");
      expect(areas()).toHaveLength(3);
      await user.click(guidePoints);
      expect(isPressed(guidePoints)).toBe("false");
      expect(isPressed(spawnRow())).toBe("false");
      expect(pins()).toBe(0);
      expect((await saved()).categories).toEqual({ guide: false, "objective-spawns": false });
      await user.click(spawnRow());
      expect(isPressed(guidePoints)).toBe("mixed");
      expect(areas()).toEqual([]);
      for (let i = 0; i < 4; i++) fireEvent.wheel(mapArea(), { deltaY: -100, clientX: 300, clientY: 300 });
      expect(spawnRow().getAttribute("aria-label")).toBe("Objective spawns, 5 in view");
    });

    it("counts each category's markers in view that pass the faction filter", async () => {
      const { user } = await mountGuide();
      expect(row("Innkeepers").getAttribute("aria-label")).toBe("Innkeepers, 1 in view");
      await user.selectOptions(mapShown(), "t0");
      expect(row("Innkeepers").getAttribute("aria-label")).toBe("Innkeepers, 1 in view");
      expect(row("Battlemasters").getAttribute("aria-label")).toBe("Battlemasters, 0 in view");
      expect(row("Zone and capital labels").getAttribute("aria-label")).toBe("Zone and capital labels, 2 in view");
      await user.click(row("Innkeepers"));
      const allFactions = within(legend()).getByRole("button", { name: "All factions" });
      await user.click(allFactions);
      expect(isPressed(allFactions)).toBe("true");
      expect(row("Innkeepers").getAttribute("aria-label")).toBe("Innkeepers, 2 in view");
      expect(row("Battlemasters").getAttribute("aria-label")).toBe("Battlemasters, 3 in view");
      expect((await saved()).allFactions).toBe(true);
    });

    it("keeps the counts in view while the map has no size", async () => {
      const resized = observeResizes();
      await mountGuide();
      expect(row("Innkeepers").getAttribute("aria-label")).toBe("Innkeepers, 1 in view");
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return DOMRect.fromRect(this.classList.contains("map-viewport") ? { width: 0, height: 0 } : { width: 1000, height: 1000 });
      });
      act(() => resized.get(mapArea())!());
      expect(screen.getByRole("button", { name: "Zoom in" })).toHaveProperty("disabled", true);
      expect(row("Innkeepers").getAttribute("aria-label")).toBe("Innkeepers, 1 in view");
    });

    const WETLANDS = { id: 11, uiMapId: 1437 };
    const wetlands = (x: number, y: number, kind: string, id: number, name: string) => zonePoint(WETLANDS, x, y, npc(kind, id, name));
    const whelgar = wetlands(38.81, 52.39, "start", 1077, "Prospector Whelgar");
    const ormersRevenge = questRow(294, "Ormer's Revenge", {
      questLevel: 24,
      requiredLevel: 22,
      zoneIds: [11],
      startPoints: [wetlands(38, 51.2, "start", 1078, "Ormer Ironbraid")],
    });
    const mountQuests = async (step: number, extra: ReturnType<typeof questRow>[] = []) => {
      await saveSetting("preview", { ...DEFAULT_SETTINGS, race: "Dwarf", startLevel: { level: 24, xp: 0 } });
      const data = withQuests([
        questRow(98313, "For Further Study", {
          questLevel: 32,
          requiredLevel: 24,
          zoneIds: [11, 1537],
          startPoints: [whelgar],
          endPoints: [zonePoint(ZONES.ironforge, 77.54, 11.82, npc("turn-in", 2916, "Historian Karnik"))],
        }),
        questRow(98824, "Prehistoric Prism", {
          questLevel: 31,
          requiredLevel: 24,
          zoneIds: [11, 1537],
          startPoints: [whelgar],
          endPoints: [zonePoint(ZONES.ironforge, 69.93, 18.55, npc("turn-in", 5387, "High Explorer Magellas"))],
          objectives: [{ type: "item", id: 270865, ids: [270865], name: "Titan Relic", need: "kills" }],
        }),
        questRow(472, "Fall of Dun Modr", {
          questLevel: 30,
          requiredLevel: 25,
          zoneIds: [11],
          startPoints: [wetlands(10.8, 55.8, "start", 2097, "Harlo Barnaby")],
        }),
        questRow(299, "Uncovering the Past", { questLevel: 27, requiredLevel: 22, zoneIds: [11], startPoints: [whelgar] }),
        ...extra,
      ]);
      const entities = new EntityIndex({
        version: 2,
        entities: {
          item: [[6948, "Hearthstone"]],
          quest: [[98313, "For Further Study"]],
          npc: [[1077, "Prospector Whelgar"]],
          spell: [[78, "Heroic Strike"]],
          object: [[256, "WANTED"]],
        },
      });
      const text = "#group T\n#name One\nstep\n.goto Wetlands,38.81,52.39\n.accept 98313\n.accept 98824\nstep\n.goto Wetlands,38,51.2\n";
      return mountGuide({ data, entities, step }, text);
    };
    const marker = (name: string) =>
      within(mapArea())
        .queryAllByRole("button", { name: new RegExp(`^${name}[\\n:]`) })
        .find((b) => b.classList.contains("quest-marker")) ?? null;

    it("marks where the simulated character can accept and turn in quests, from the legend's choices", async () => {
      const { user } = await mountQuests(1);
      const icon = (name: string) => marker(name)!.querySelector(".map-icon")!;
      const allQuests = () => within(legend()).getByRole("button", { name: "All quests" });

      await waitFor(() => expect(marker("Prospector Whelgar")).not.toBeNull());
      expect(marker("Harlo Barnaby")).toBeNull();
      expect(row("Available").getAttribute("aria-label")).toBe("Available, 1 in view");
      expect(row("Turn-ins").getAttribute("aria-label")).toBe("Turn-ins, 2 in view");
      expect(isPressed(allQuests())).toBe("false");

      await user.click(allQuests());
      expect(icon("Harlo Barnaby").classList.contains("dim")).toBe(true);
      expect(row("Available").getAttribute("aria-label")).toBe("Available, 2 in view");
      await user.click(within(mapArea()).getByRole("button", { name: "Zoom in" }));
      expect(row("Available").getAttribute("aria-label")).toBe("Available, 1 in view");
      expect(icon("Historian Karnik").classList.contains("incomplete")).toBe(false);
      expect(icon("High Explorer Magellas").classList.contains("incomplete")).toBe(true);
      await user.click(row("Turn-ins"));
      expect(marker("Historian Karnik")).toBeNull();
      expect(marker("Prospector Whelgar")).not.toBeNull();
      expect(await saved()).toMatchObject({ allQuests: true, categories: { "quest-turn-in": false } });

      await user.click(within(legend()).getByRole("button", { name: "Reset to defaults" }));
      expect(marker("Harlo Barnaby")).toBeNull();
      expect(marker("Historian Karnik")).not.toBeNull();
      expect(await saved()).toEqual(DEFAULT_MAP_SETTINGS);
    });

    it("leaves the selected step's own quests off the markers only while Guide points draws their pins", async () => {
      const { user } = await mountQuests(0);
      await waitFor(() => expect(marker("Prospector Whelgar")).not.toBeNull());
      const pin = () => within(mapArea()).queryByRole("button", { name: /^Starts For Further Study/ });
      expect(pin()).not.toBeNull();
      expect(marker("Prospector Whelgar")!.getAttribute("aria-label")).toBe(
        "Prospector Whelgar\nAvailable: Uncovering the Past (level 27)",
      );
      await user.click(row("Guide points"));
      expect(pin()).toBeNull();
      expect(marker("Prospector Whelgar")!.getAttribute("aria-label")).toBe(
        "Prospector Whelgar\nAvailable: Uncovering the Past (level 27)\nAvailable: Prehistoric Prism (level 31)\nAvailable: For Further Study (level 32)",
      );
    });

    it("lets the keyboard read each quest marker in view, one stop per place in reading order, and opens a card of every quest", async () => {
      const dailyDelivery = questRow(469, "Daily Delivery", {
        questLevel: 21,
        requiredLevel: 18,
        zoneIds: [11],
        startPoints: [wetlands(49.8, 39.4, "start", 2093, "Einar Stonegrip")],
      });
      const razormawNeedling = questRow(98245, "Razormaw Needling", {
        questLevel: 29,
        requiredLevel: 21,
        zoneIds: [11],
        startPoints: [wetlands(49.4, 42, "start", 270637, "Howin Kindfeather")],
      });
      const { user } = await mountQuests(1, [dailyDelivery, razormawNeedling, ormersRevenge]);
      await waitFor(() => expect(marker("Ormer Ironbraid")).not.toBeNull());
      expect(marker("Prospector Whelgar")).toBeNull();
      const digSite = () => marker("Ormer Ironbraid")!;
      expect(digSite().getAttribute("aria-label")).toBe(
        "Ormer Ironbraid: 1 to accept\nProspector Whelgar: 1 to accept\nSelect for every quest",
      );
      digSite().focus();
      await user.tab();
      expect(document.activeElement).toBe(marker("Historian Karnik"));
      expect(screen.getByRole("tooltip").textContent).toBe(
        "Historian Karnik: 1 to turn in\nHigh Explorer Magellas: 1 to turn in\nSelect for every quest",
      );

      await user.click(within(mapArea()).getByRole("button", { name: "Zoom in" }));
      await user.click(within(mapArea()).getByRole("button", { name: "Zoom in" }));
      expect(marker("Historian Karnik")!.tabIndex).toBe(-1);
      marker("Prospector Whelgar")!.focus();
      await user.tab();
      expect(document.activeElement!.classList.contains("quest-marker")).toBe(false);
      await user.click(within(mapArea()).getByRole("button", { name: "Reset zoom" }));
      expect(marker("Historian Karnik")!.tabIndex).toBe(0);

      const north = () => marker("Einar Stonegrip")!;
      expect(north().getAttribute("aria-label")).toBe(
        "Einar Stonegrip: 1 to accept\nHowin Kindfeather: 1 to accept\nOrmer Ironbraid: 1 to accept\nand 1 more\nSelect for every quest",
      );
      await user.click(north());
      const card = screen.getByRole("dialog", { name: "Quests here" });
      expect(
        within(card)
          .getAllByRole("heading", { level: 3 })
          .map((h) => h.textContent),
      ).toEqual(["Einar Stonegrip", "Howin Kindfeather", "Ormer Ironbraid", "Prospector Whelgar"]);
      expect(
        within(card)
          .getAllByRole("listitem")
          .map((li) => [...li.querySelectorAll(".quest-preview-status, .quest-toggle")].map((e) => e.textContent).join(": ")),
      ).toEqual([
        "Daily Delivery (level 21): Available",
        "Razormaw Needling (level 29): Available",
        "Ormer's Revenge (level 24): Available",
        "Uncovering the Past (level 27): Available",
      ]);
      await user.click(within(card).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(north());

      await user.click(marker("Historian Karnik")!);
      const enders = screen.getByRole("dialog", { name: "Quests here" });
      expect(
        within(enders)
          .getAllByRole("listitem")
          .map((li) => [...li.querySelectorAll(".quest-preview-status, .quest-toggle")].map((e) => e.textContent).join(": ")),
      ).toEqual(["For Further Study (level 32): Turn in: complete", "Prehistoric Prism (level 31): Turn in: not complete"]);
    });

    it("adds a step after the selected one that accepts or turns in a quest chosen from a marker's menu, with undo", async () => {
      const { user } = await mountQuests(1, [ormersRevenge]);
      await waitFor(() => expect(marker("Historian Karnik")).not.toBeNull());
      const before = guideText();
      const items = (menu: HTMLElement) =>
        within(menu)
          .getAllByRole("menuitem")
          .map((i) => i.getAttribute("aria-label") ?? i.textContent);

      await user.click(within(mapArea()).getByRole("button", { name: "Zoom in" }));
      await user.pointer({ keys: "[MouseRight]", target: marker("Historian Karnik")! });
      const menu = screen.getByRole("menu", { name: "Historian Karnik" });
      expect(items(menu)).toEqual(["Historian Karnik", "For Further Study", "Turn in For Further Study"]);
      const links = [...menu.querySelectorAll("a")];
      expect(links.map((l) => [l.getAttribute("href"), l.getAttribute("target")])).toEqual([
        ["https://www.wowhead.com/forever/npc=2916", "_blank"],
        ["https://www.wowhead.com/forever/quest=98313", "_blank"],
      ]);
      expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Turn in For Further Study" }));
      await user.click(within(menu).getByRole("menuitem", { name: "Turn in For Further Study" }));
      expect(guideText()).toBe(`${before}step\n.goto Ironforge,77.54,11.82\n.turnin 98313\n`);
      undo();
      expect(guideText()).toBe(before);

      marker("Ormer Ironbraid")!.focus();
      fireEvent.contextMenu(marker("Ormer Ironbraid")!);
      const shared = screen.getByRole("menu", { name: "Quests here" });
      expect(items(within(shared).getByRole("group", { name: "Prospector Whelgar" }))).toEqual([
        "Prospector Whelgar",
        "Uncovering the Past",
        "Accept Uncovering the Past · Prospector Whelgar",
      ]);
      expect(items(within(shared).getByRole("group", { name: "Ormer Ironbraid" }))).toEqual([
        "Ormer Ironbraid",
        "Ormer's Revenge",
        "Accept Ormer's Revenge · Ormer Ironbraid",
      ]);
      fireEvent.wheel(within(shared).getAllByRole("menuitem")[0]!, { deltaY: 100 });
      expect(screen.getByRole("menu", { name: "Quests here" })).toBe(shared);
      await user.keyboard("{Escape}");
      expect(document.activeElement).toBe(marker("Ormer Ironbraid"));
      fireEvent.contextMenu(marker("Ormer Ironbraid")!);
      await user.keyboard("{End}{Enter}");
      expect(guideText()).toBe(`${before}step\n.goto Wetlands,38.81,52.39\n.accept 299\n`);
    });

    it("draws the quest markers again only when they change, not on a highlight or a line selection", async () => {
      const { user } = await mountQuests(1);
      await waitFor(() => expect(marker("Prospector Whelgar")).not.toBeNull());
      const markerRenders = vi.mocked(markerLabel);
      const drawn = markerRenders.mock.calls.length;
      select(1, 0);
      highlight("hovered", "98824:1");
      expect(markerRenders.mock.calls.length).toBe(drawn);
      await user.click(within(legend()).getByRole("button", { name: "All quests" }));
      expect(markerRenders.mock.calls.length).toBeGreaterThan(drawn);
    });

    it("does not draw the quest markers again on a pan", async () => {
      const { user } = await mountQuests(1);
      await waitFor(() => expect(marker("Prospector Whelgar")).not.toBeNull());
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (!this.classList.contains("map-stage")) return DOMRect.fromRect({ width: 1000, height: 1000 });
        const [x, y, zoom] = transform();
        const aspect = Number(mapArea().style.getPropertyValue("--aspect"));
        const width = Math.min(1000, 1000 * aspect) * zoom;
        return DOMRect.fromRect({ x, y, width, height: width / aspect });
      });
      const markerRenders = vi.mocked(markerLabel);
      const drawn = markerRenders.mock.calls.length;
      const before = transform();
      await user.pointer([
        { keys: "[MouseLeft>]", target: mapArea(), coords: { clientX: 500, clientY: 500 } },
        { target: mapArea(), coords: { clientX: 520, clientY: 510 } },
        { keys: "[/MouseLeft]", target: mapArea(), coords: { clientX: 520, clientY: 510 } },
      ]);
      expect(transform()).not.toEqual(before);
      expect(markerRenders.mock.calls.length).toBe(drawn);
    });

    it("opens no map menu and does not pan for a press inside a quest card", async () => {
      const { user } = await mountQuests(1);
      await waitFor(() => expect(marker("Prospector Whelgar")).not.toBeNull());
      await user.click(marker("Prospector Whelgar")!);
      const card = screen.getByRole("dialog", { name: "Prospector Whelgar" });
      const before = transform();
      await user.pointer({ keys: "[MouseRight]", target: card });
      expect(screen.queryByRole("menu")).toBeNull();
      await user.pointer([
        { keys: "[MouseLeft>]", target: card, coords: { clientX: 500, clientY: 500 } },
        { target: card, coords: { clientX: 700, clientY: 600 } },
        { keys: "[/MouseLeft]", target: card, coords: { clientX: 700, clientY: 600 } },
      ]);
      expect(transform()).toEqual(before);
    });

    it("opens a long quest card at its top, focused on its close button", async () => {
      const eric = zonePoint({ id: 1, uiMapId: 1426 }, 46.6, 53.8, npc("start", 265813, "Eric Brighthammer"));
      const camping = (
        [
          [96031, "Camping 101: Leatherworking"],
          [96044, "Camping 101: Blacksmithing"],
          [96046, "Camping 101: Mining"],
          [96047, "Camping 101: First Aid"],
          [96050, "Camping 101: Fishing"],
          [96055, "Camping 101: Herbalism"],
          [96056, "Camping 101: Skinning"],
          [96058, "Camping 101: Engineering"],
          [96608, "The Great Outdoors"],
          [96629, "Camping 101: Cooking"],
        ] as const
      ).map(([id, name]) => questRow(id, name, { questLevel: 6, requiredLevel: 4, startPoints: [eric] }));
      const { user } = await mountQuests(1, camping);
      await user.click(within(legend()).getByRole("button", { name: "All quests" }));
      await waitFor(() => expect(marker("Eric Brighthammer")).not.toBeNull());
      marker("Eric Brighthammer")!.focus();
      await user.keyboard("{Enter}");
      const card = screen.getByRole("dialog", { name: "Eric Brighthammer" });
      const close = within(card).getByRole("button", { name: "Close" });
      expect(document.activeElement).toBe(close);
      expect(within(card).getAllByRole("listitem")).toHaveLength(10);
      expect(card.scrollTop).toBe(0);
      await user.click(close);
      expect(document.activeElement).toBe(marker("Eric Brighthammer"));
    });

    it("starts closed, and opens and saves that it is open", async () => {
      const { user } = await mountGuide();
      expect(legend().open).toBe(false);
      await user.click(screen.getByText("Legend"));
      expect(legend().open).toBe(true);
      await waitFor(async () => expect((await saved()).legendOpen).toBe(true));
    });

    it("ends the open body above the strip's bottom, and marks the body only while rows sit below its end", async () => {
      const resized: (() => void)[] = [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          private readonly callback: () => void;
          constructor(callback: () => void) {
            this.callback = callback;
          }
          observe() {
            resized.push(this.callback);
          }
          disconnect() {}
        },
      );
      onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      await mountGuide({ map: { legendOpen: true } });
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (this.matches(".map-top")) return DOMRect.fromRect({ width: 1000, height: 600 });
        if (this.matches(".map-legend")) return DOMRect.fromRect({ y: 60, width: 280, height: 448 });
        if (this.matches(".legend-body")) return DOMRect.fromRect({ y: 100, width: 280, height: 400 });
        return DOMRect.fromRect({ y: 100, width: 280, height: 0 });
      });
      const scrollHeight = vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(800);
      vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(492);
      const body = legend().querySelector<HTMLElement>(".legend-body")!;
      act(() => resized.forEach((fit) => fit()));
      expect(body.hasAttribute("data-clipped")).toBe(true);

      body.scrollTop = 800 - 492;
      fireEvent.scroll(body);
      expect(body.hasAttribute("data-clipped")).toBe(false);
      body.scrollTop = 0;
      fireEvent.scroll(body);
      expect(body.hasAttribute("data-clipped")).toBe(true);

      scrollHeight.mockReturnValue(492);
      act(() => resized.forEach((fit) => fit()));
      expect(body.style.maxHeight).toBe(`${600 - 100 - 8}px`);
      expect(body.hasAttribute("data-clipped")).toBe(false);
    });

    it("ends an overflowing body on its last whole row, and keeps a body that fits at its full height", async () => {
      const resized: (() => void)[] = [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          private readonly callback: () => void;
          constructor(callback: () => void) {
            this.callback = callback;
          }
          observe() {
            resized.push(this.callback);
          }
          disconnect() {}
        },
      );
      onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      await mountGuide({ map: { legendOpen: true } });
      const body = legend().querySelector<HTMLElement>(".legend-body")!;
      const rows = [...body.querySelectorAll(".legend-row, .legend-step, .legend-filter")];
      let stripHeight = 600;
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (this.matches(".map-top")) return DOMRect.fromRect({ width: 1000, height: stripHeight });
        if (this.matches(".map-legend")) return DOMRect.fromRect({ y: 60, width: 280, height: 448 });
        if (this === body) return DOMRect.fromRect({ y: 100, width: 280, height: 400 });
        const row = rows.indexOf(this);
        if (row >= 0) return DOMRect.fromRect({ y: 101 + 30 * row, width: 280, height: 30 });
        return DOMRect.fromRect({ y: 100, width: 280, height: 0 });
      });
      const scrollHeight = vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(800);
      vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(492);

      // Row 15 ends at 481 px, and row 16 at 511 px, past the 492 px of room.
      act(() => resized.forEach((fit) => fit()));
      expect(body.style.maxHeight).toBe("481px");
      expect(body.hasAttribute("data-clipped")).toBe(true);

      // Row 1 ends at 61 px, and row 2 at 91 px.
      const ends = [5, 29, 30].map((past) => {
        stripHeight = 108 + 61 + past;
        act(() => resized.forEach((fit) => fit()));
        return body.style.maxHeight;
      });
      expect(ends).toEqual(["61px", "61px", "91px"]);

      stripHeight = 600;
      scrollHeight.mockReturnValue(400);
      act(() => resized.forEach((fit) => fit()));
      expect(body.style.maxHeight).toBe("492px");
      expect(body.hasAttribute("data-clipped")).toBe(false);
    });

    it("ends the body before a heading whose first row does not fit", async () => {
      const resized: (() => void)[] = [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          private readonly callback: () => void;
          constructor(callback: () => void) {
            this.callback = callback;
          }
          observe() {
            resized.push(this.callback);
          }
          disconnect() {}
        },
      );
      onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      await mountGuide({ map: { legendOpen: true } });
      const body = legend().querySelector<HTMLElement>(".legend-body")!;
      const lines = [...body.querySelectorAll(".legend-heading, .legend-row, .legend-step, .legend-filter")];
      const labels = lines.indexOf(screen.getByRole("heading", { name: "Map labels" }).parentElement!);
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (this.matches(".map-top")) return DOMRect.fromRect({ width: 1000, height: 108 + 30 * (labels + 1) + 10 });
        if (this.matches(".map-legend")) return DOMRect.fromRect({ y: 60, width: 280, height: 448 });
        if (this === body) return DOMRect.fromRect({ y: 100, width: 280, height: 400 });
        const line = lines.indexOf(this);
        if (line >= 0) return DOMRect.fromRect({ y: 100 + 30 * line, width: 280, height: 30 });
        return DOMRect.fromRect({ y: 100, width: 280, height: 0 });
      });
      vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(800);
      vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(492);

      act(() => resized.forEach((fit) => fit()));
      expect(body.style.maxHeight).toBe(`${30 * labels}px`);
    });
  });
});

describe("features", () => {
  const GUIDE =
    "#group T\n#name One\nstep\n>>Talk to Innkeeper Grosk (npc #6928)\n.goto Durotar,50,50\nstep\n>>See the Defilers Emissary (npc #14990)\n.goto Undercity,50,50\n";
  const PLAIN = "#group T\n#name One\nstep\n.goto Durotar,50,50\nstep\n.goto Undercity,50,50\n";
  const scale = () => Number(mapArea().style.getPropertyValue("--zoom"));
  const marked = () => [...mapArea().querySelectorAll(".poi.marked, .poi-item.marked")].map((e) => e.getAttribute("aria-label"));
  const drawn = (category: string) => mapArea().querySelectorAll(`.poi[data-category="${category}"]:not(.marked)`).length;
  const savedCategories = async () => readMapSettings(await loadSetting("map")).categories;
  const findMenu = () => screen.getByRole("region", { name: "Search" });
  const areas = () =>
    within(findMenu())
      .getAllByRole("heading", { level: 5 })
      .map((h) => h.textContent);
  async function find(user: ReturnType<typeof userEvent.setup>, query: string) {
    const closed = screen.queryByRole("button", { name: "Search" });
    if (closed) await user.click(closed);
    const box = screen.getByRole("searchbox", { name: "Search quests, NPCs, items, and places" });
    await user.clear(box);
    await user.type(box, query);
  }
  const mountGuide = (options: Partial<MapOptions> = {}, text = GUIDE) => mountWith(options, text);

  it("keeps Search above the editor as its cover changes while Search stays open", async () => {
    const resized = observeResizes();
    onTestFinished(() => void document.body.style.removeProperty("--panel-cover"));
    document.body.style.setProperty("--panel-cover", "400px");
    const { user } = await mountGuide();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect(this.matches(".search-panel") ? { y: 200, width: 560, height: 180 } : { width: 1000, height: 1000 });
    });
    await user.click(screen.getByRole("button", { name: "Search" }));
    const panel = findMenu();
    expect(panel.style.maxHeight).toBe("392px");
    for (const [cover, height] of [
      [600, "192px"],
      [0, "792px"],
      [400, "392px"],
    ] as const) {
      document.body.style.setProperty("--panel-cover", `${cover}px`);
      act(() => resized.get(document.querySelector(".map-top")!)?.());
      expect(panel.style.maxHeight).toBe(height);
    }
  });

  it("adds only a coordinate line from a found NPC's locations, and offers no Add for a result row", async () => {
    const { user } = await mountGuide({ step: 1 });
    expect(drawn("battlemaster")).toBe(0);
    await find(user, "npc #14990");
    await user.click(within(findMenu()).getByRole("button", { name: /^Defilers Emissary/ }));

    await user.click(screen.getByRole("button", { name: "Add .goto to step: Thunder Bluff 44.00, 57.40" }));
    await user.click(screen.getByRole("button", { name: "Add .waypoint to step: Orgrimmar 50.40, 65.80" }));
    expect(guideText()).toBe(
      "#group T\n#name One\nstep\n>>Talk to Innkeeper Grosk (npc #6928)\n.goto Durotar,50,50\nstep\n>>See the Defilers Emissary (npc #14990)\n.goto Undercity,50,50\n.goto Thunder Bluff,44.00,57.40\n.waypoint Orgrimmar,50.40,65.80\n",
    );
    await find(user, "Innkeeper");
    expect(within(findMenu()).getAllByRole("button", { name: /^Innkeeper/ })).toHaveLength(2);
    expect(within(findMenu()).queryByRole("button", { name: /^Add / })).toBeNull();
  });

  it("shows a chosen location on the terrain, marking it whatever its layer, without saving any layer", async () => {
    const { user } = await mountGuide({ step: 1 }, PLAIN);
    await find(user, "Defilers Emissary");
    await user.click(within(findMenu()).getByRole("button", { name: /^Defilers Emissary/ }));
    await user.click(screen.getByRole("button", { name: "Show on map: Thunder Bluff 44.00, 57.40" }));
    expect(screen.queryByRole("region", { name: "Search" })).toBeNull();
    expect(mapShown().value).toBe("t1456");
    expect(scale()).toBeGreaterThan(1);
    expect(marked()).toEqual(["Defilers Emissary: Battlemasters"]);
    expect(drawn("battlemaster")).toBe(0);
    expect(await savedCategories()).toEqual({});

    select(0);
    expect(marked()).toEqual([]);
    expect(mapShown().value).toBe("t1411");
    await find(user, "To Booty Bay");
    await user.click(within(findMenu()).getByRole("button", { name: /^To Booty Bay/ }));
    expect(areas()).toEqual(["The Barrens", "Stranglethorn Vale"]);
    await user.click(screen.getByRole("button", { name: "Show on map: Stranglethorn Vale Arrival" }));
    expect(marked()).toEqual(["To Booty Bay: Ships"]);
    expect(mapShown().value).toBe("t1434");
    await find(user, "Elwynn Forest");
    await user.click(within(within(findMenu()).getByRole("list", { name: "Zone" })).getByRole("button", { name: "Elwynn Forest" }));
    await user.click(screen.getByRole("button", { name: /^Show on map: Elwynn Forest/ }));
    expect(mapShown().value).toBe("t1429");
    expect(marked()).toEqual([]);
  });

  it("finds an NPC's services at one spot as one location, and shows every service's marker there", async () => {
    const grosk = worldMap.pois.find((p) => p.entity?.id === 6928)!;
    const served: LoadedWorldMap = {
      ...worldMap,
      categories: [...worldMap.categories, { key: "food", group: "npc", name: "Food & Drink", icon: "food" }],
      pois: [...worldMap.pois, { ...grosk, category: "food" }],
    };
    const { user } = await mountGuide({ worldMap: served }, PLAIN);
    await find(user, "npc #6928");
    await user.click(within(findMenu()).getByRole("button", { name: "Innkeeper Grosk npc #6928" }));
    await user.click(screen.getByRole("button", { name: "Show on map: Durotar 51.60, 41.60" }));
    expect(marked()).toEqual(["Innkeeper Grosk: Innkeepers", "Innkeeper Grosk: Food & Drink"]);
  });

  it("copies a reference to the clipboard without editing, and shows the text to copy by hand when that fails", async () => {
    // user-event stands in for the clipboard.
    const { user } = await mountGuide({}, PLAIN);
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    const copy = async () => {
      await user.click(screen.getByRole("button", { name: "Copy reference" }));
      expect(await within(findMenu()).findByText("Copied")).toBeTruthy();
      return writeText.mock.lastCall?.[0];
    };
    await find(user, "npc #6928");
    await user.click(within(findMenu()).getByRole("button", { name: /^Innkeeper Grosk/ }));
    expect(await copy()).toBe("Innkeeper Grosk (npc #6928)");
    await find(user, "To Booty Bay");
    await user.click(within(findMenu()).getByRole("button", { name: /^To Booty Bay/ }));
    expect(await copy()).toBe("To Booty Bay by ship");
    await find(user, "Deadmines");
    await user.click(within(within(findMenu()).getByRole("list", { name: "Dungeons" })).getByRole("button", { name: "Deadmines" }));
    expect(await copy()).toBe("Deadmines");

    writeText.mockRejectedValue(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(await within(findMenu()).findByText("Copy failed: denied")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Reference text to copy" })).toHaveProperty("value", "Deadmines");
    expect(guideText()).toBe(PLAIN);
  });

  it("focuses the place of the selected line, choosing the zone of the step's coordinates among several", async () => {
    await mountGuide();
    focusLine();
    expect(mapShown().value).toBe("t1411");
    expect(marked()).toEqual(["Innkeeper Grosk: Innkeepers"]);
    expect(caption()).toBe("Innkeeper Grosk: 1 location in Durotar");

    select(1);
    expect(caption()).toBe("");
    focusLine();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mapShown().value).toBe("t1458");
    expect(caption()).toBe("Defilers Emissary: 1 location in Undercity, more in 2 other zones");
    expect(marked()).toEqual(Array(3).fill("Defilers Emissary: Battlemasters"));
  });

  it("focuses a line in the middle of the map that the editor leaves uncovered", async () => {
    document.body.style.setProperty("--panel-cover", "400px");
    onTestFinished(() => void document.body.style.removeProperty("--panel-cover"));
    await mountGuide({}, PLAIN);
    focusLine();
    expect(view()).toEqual(["t1411", -50330.39, -65513.89, 152.6044]);
  });

  it("leaves Routes to focus a line", async () => {
    noRouting();
    const { user } = await mountGuide({}, PLAIN);
    await user.click(screen.getByRole("button", { name: "Routes" }));
    expect(screen.getByRole("button", { name: "Routes" }).getAttribute("aria-pressed")).toBe("true");
    focusLine();
    expect(screen.getByRole("button", { name: "Routes" }).getAttribute("aria-pressed")).toBe("false");
    expect(mapShown().value).toBe("t1411");
    expect(caption()).toBe("Durotar 50.00, 50.00");
    const at = stageAt(1411, 50, 50);
    const rings = [...mapArea().querySelectorAll<HTMLElement>(".focus-mark")].map((m) => [
      m.style.getPropertyValue("--at-x"),
      m.style.getPropertyValue("--at-y"),
    ]);
    expect(rings).toEqual([[`${at.x}%`, `${at.y}%`]]);
  });

  it("marks the step's references by default, has a layer toggle, and marks a focused NPC while its layer is off", async () => {
    const { user } = await mountGuide({ map: { categories: { innkeeper: false } } });
    expect(marked()).toEqual(["Innkeeper Grosk: Innkeepers"]);
    expect(drawn("innkeeper")).toBe(0);
    await user.click(screen.getByRole("button", { name: "Step references" }));
    expect(marked()).toEqual([]);
    expect(await savedCategories()).toEqual({ innkeeper: false, references: false });

    focusLine();
    expect(marked()).toEqual(["Innkeeper Grosk: Innkeepers"]);
    expect(await savedCategories()).toEqual({ innkeeper: false, references: false });
    select(1);
    expect(marked()).toEqual([]);
    expect(drawn("innkeeper")).toBe(0);
  });

  it("ends a focus when a map is picked, and shows a focus over a picked map with its caption", async () => {
    const { user } = await mountGuide();
    focusLine();
    expect([mapShown().value, caption()]).toEqual(["t1411", "Innkeeper Grosk: 1 location in Durotar"]);
    await user.selectOptions(mapShown(), `t${DUSKWOOD.uiMapId}`);
    expect([mapShown().value, caption()]).toEqual(["t1431", ""]);
    focusLine();
    expect([mapShown().value, caption()]).toEqual(["t1411", "Innkeeper Grosk: 1 location in Durotar"]);
  });

  it("focuses on the place in the picked map, or in the map that the last focus shows", async () => {
    const { user } = await mountGuide({ step: 1 });
    await user.selectOptions(mapShown(), "t1456");
    focusLine();
    expect(mapShown().value).toBe("t1456");
    expect(caption()).toMatch(/^Defilers Emissary: 1 location in Thunder Bluff/);
    focusLine();
    expect(mapShown().value).toBe("t1456");
    expect(caption()).toMatch(/^Defilers Emissary: 1 location in Thunder Bluff/);
  });

  it("ends a focus when another step is selected, so the step shows its own map when selected again", async () => {
    await mountGuide(
      { map: { categories: { references: false } } },
      "#group T\n#name One\nstep\n>>Innkeeper Grosk (npc #6928)\n.goto Elwynn Forest,50,50\nstep\n.goto Undercity,50,50\n",
    );
    expect(mapShown().value).toBe("t1429");
    focusLine();
    expect(mapShown().value).toBe("t1411");
    expect(marked()).toEqual(["Innkeeper Grosk: Innkeepers"]);
    select(1);
    expect(mapShown().value).toBe("t1458");
    select(0);
    expect(mapShown().value).toBe("t1429");
    expect(marked()).toEqual([]);
    expect(await savedCategories()).toEqual({ references: false });
  });

  it("says why a line has no place and keeps the view", async () => {
    await mountGuide({}, "#group T\n#name One\nstep\n>>Open the Crate (object #7000)\n.goto Nowhere,40,40\n");
    const before = view();
    expect(focusLine()).toEqual({ kind: "unavailable", message: "The dataset has no location for object #7000." });
    expect(focusLine(1)).toEqual({ kind: "unavailable", message: '.goto is not on the map: RXP has no zone named "Nowhere".' });
    expect(view()).toEqual(before);
    expect(caption()).toBe("");
  });

  it("opens a marker's card by click or keyboard, with copy, show, and add, instead of adding a point where it stands", async () => {
    const { user } = await mountGuide({ map: { allFactions: true } }, PLAIN);
    const marker = () => within(mapArea()).getByRole("button", { name: "Innkeeper Grosk: Innkeepers" });
    await user.pointer({ keys: "[MouseLeft]", target: marker().querySelector(".poi-icon")!, coords: { clientX: 500, clientY: 500 } });
    let dialog = screen.getByRole("dialog", { name: "Innkeeper Grosk" });
    expect(within(dialog).getByRole("button", { name: "Copy reference" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Add .goto to step: Durotar 51.60, 41.60" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(guideText()).toBe("#group T\n#name One\nstep\n.goto Durotar,50,50\n.goto Durotar,51.60,41.60\nstep\n.goto Undercity,50,50\n");

    marker().focus();
    await user.keyboard("{Enter}");
    dialog = screen.getByRole("dialog", { name: "Innkeeper Grosk" });
    await user.click(within(dialog).getByRole("button", { name: "Show on map: Durotar 51.60, 41.60" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(marked()).toEqual(["Innkeeper Grosk: Innkeepers"]);
    await user.click(mapArea().querySelector(".poi.marked")!);
    expect(screen.getByRole("dialog", { name: "Innkeeper Grosk" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(guideText().match(/\.goto /g)).toHaveLength(3);
  });

  describe("markers", () => {
    const npc = (name: string, category: string, id: number, side: 0 | 1 | 2, dx: number) => ({
      name,
      category,
      area: "kalimdor" as const,
      x: 20887.2 + dx,
      y: 16055.7,
      side,
      level: 0,
      entity: { type: "npc" as const, id },
    });
    const crowded: LoadedWorldMap = {
      ...worldMap,
      categories: [
        ...worldMap.categories,
        { key: "class-trainer-warrior", group: "class-trainers", name: "Warrior Trainers", icon: "class-warrior" },
        { key: "class-trainer-mage", group: "class-trainers", name: "Mage Trainers", icon: "class-mage" },
      ],
      pois: [
        ...worldMap.pois,
        npc("Frang", "class-trainer-warrior", 3153, 2, 20),
        npc("Innkeeper Wiley", "innkeeper", 6791, 0, 40),
        npc("Mai'ah", "class-trainer-mage", 5884, 2, 60),
      ],
    };
    const mountCrowded = (map: Partial<MapSettings>, text = PLAIN) => mountGuide({ map, worldMap: crowded }, text);
    const drawnNames = () =>
      [...mapArea().querySelectorAll(".poi:not(.marked), .poi-item:not(.marked)")].map((e) => e.getAttribute("aria-label")!.split(":")[0]);

    it("groups overlapping markers into one keyboard stop that lists each by name and picks it", async () => {
      const { user } = await mountCrowded({ allFactions: true });
      expect(mapShown().value).toBe("t1411");
      const row = within(mapArea()).getByRole("button", { name: "3 markers: Innkeeper Grosk, Frang, Innkeeper Wiley" });
      const items = within(mapArea()).getAllByRole("button", { name: /^(Innkeeper Grosk|Frang|Innkeeper Wiley): / });
      expect(items.map((b) => [b.getAttribute("aria-label"), b.tabIndex])).toEqual([
        ["Innkeeper Grosk: Innkeepers", -1],
        ["Frang: Warrior Trainers", -1],
        ["Innkeeper Wiley: Innkeepers", -1],
      ]);
      expect(row.tabIndex).toBe(0);

      row.focus();
      for (const item of [...items, items[0]!]) {
        await user.keyboard("{ArrowDown}");
        expect(document.activeElement).toBe(item);
      }
      await user.keyboard("{ArrowUp}");
      expect(document.activeElement).toBe(items[2]);
      await user.keyboard("{Escape}");
      expect(document.activeElement).toBe(row);
      expect(row.getAttribute("aria-expanded")).toBe("true");
      expect(document.getElementById(row.getAttribute("aria-controls")!)!.contains(items[0]!)).toBe(true);

      await user.tab();
      const next = document.activeElement;
      expect(row.getAttribute("aria-expanded")).toBe("false");
      row.focus();
      await user.keyboard("{ArrowDown}{Shift>}{Tab}{/Shift}");
      expect(document.activeElement).toBe(row);
      await user.keyboard("{ArrowDown}{ArrowDown}{Tab}");
      expect(document.activeElement).toBe(next);

      await user.click(row);
      expect(document.activeElement).toBe(items[0]);
      await user.keyboard("{ArrowDown}{Enter}");
      expect(screen.getByRole("dialog", { name: "Frang" })).toBeTruthy();
      await user.keyboard("{Escape}");
      expect(document.activeElement).toBe(row);
      await user.click(items[2]!);
      expect(screen.getByRole("dialog", { name: "Innkeeper Wiley" })).toBeTruthy();
      await user.keyboard("{Escape}");
      expect(document.activeElement).toBe(row);
    });

    it("keeps a row's list inside the visible map as the map zooms, and scrolls it without zooming the map", async () => {
      const resized = observeResizes();
      const { user } = await mountCrowded({ allFactions: true });
      const row = within(mapArea()).getByRole("button", { name: /^3 markers/ });
      const list = mapArea().querySelector<HTMLElement>(".map-viewport > .poi-list")!;
      let rowAt = { x: 950, y: 980, width: 20, height: 20 };
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return DOMRect.fromRect(this === row ? rowAt : { x: 0, y: 0, width: 1000, height: 1000 });
      });
      let tall = 150;
      Object.defineProperties(list, { scrollHeight: { get: () => tall }, offsetWidth: { value: 200 } });
      const placed = () => [list.style.top, list.style.left, list.style.maxHeight];
      const zoom = scale();
      await user.hover(row);
      expect(placed()).toEqual(["830px", "796px", "150px"]);
      expect(list.style.maxWidth).toBe("320px");
      document.body.style.setProperty("--panel-cover", "400px");
      onTestFinished(() => void document.body.style.removeProperty("--panel-cover"));
      act(() => resized.get(mapArea().querySelector(".poi-cover")!)!());
      expect(placed()).toEqual(["446px", "796px", "150px"]);
      fireEvent.wheel(list, { deltaY: -100 });
      expect(scale()).toBe(zoom);
      await user.hover(within(list).getAllByRole("button")[0]!);
      expect(list.classList).toContain("open");

      rowAt = { x: 100, y: 40, width: 20, height: 20 };
      tall = 1000;
      fireEvent.wheel(row, { deltaY: -100 });
      expect(scale()).toBeGreaterThan(zoom);
      expect(placed()).toEqual(["60px", "100px", "536px"]);
    });

    it("moves a clicked row's list clear of the row's ring when keyboard focus returns to the row, below and above, keeps it there with focus in the list, and opens a hovered row's list against the row", async () => {
      const { user } = await mountCrowded({ allFactions: true });
      const row = within(mapArea()).getByRole("button", { name: /^3 markers/ });
      const list = mapArea().querySelector<HTMLElement>(".map-viewport > .poi-list")!;
      let rowAt = { x: 100, y: 100, width: 20, height: 20 };
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return DOMRect.fromRect(this === row ? rowAt : { x: 0, y: 0, width: 1000, height: 1000 });
      });
      Object.defineProperties(list, { scrollHeight: { value: 150 }, offsetWidth: { value: 200 } });
      // As map.css sets it, which jsdom does not load.
      row.style.setProperty("--mark-reach", "8px");
      await user.click(row);
      expect(list.style.top).toBe("120px");
      await user.keyboard("{ArrowDown}{Escape}");
      expect(list.style.top).toBe("128px");
      await user.keyboard("{ArrowDown}");
      rowAt = { x: 100, y: 200, width: 20, height: 20 };
      fireEvent.wheel(row, { deltaY: -100 });
      expect(list.style.top).toBe("228px");
      await user.keyboard("{Escape}");
      rowAt = { x: 100, y: 900, width: 20, height: 20 };
      fireEvent.wheel(row, { deltaY: -100 });
      expect([list.style.top, list.style.maxHeight]).toEqual(["742px", "150px"]);
      act(() => row.blur());
      await user.hover(row);
      expect(list.style.top).toBe("750px");
    });

    it("moves a row's list clear of the ring that a key press shows when a pointer closed a card and focus returned to the row", async () => {
      const { user } = await mountCrowded({ allFactions: true });
      const row = within(mapArea()).getByRole("button", { name: /^3 markers/ });
      const list = mapArea().querySelector<HTMLElement>(".map-viewport > .poi-list")!;
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return DOMRect.fromRect(this === row ? { x: 100, y: 100, width: 20, height: 20 } : { x: 0, y: 0, width: 1000, height: 1000 });
      });
      Object.defineProperties(list, { scrollHeight: { value: 150 }, offsetWidth: { value: 200 } });
      row.style.setProperty("--mark-reach", "8px");
      await user.click(row);
      await user.click(within(list).getAllByRole("button")[0]!);
      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(document.activeElement).toBe(row);
      expect(list.style.top).toBe("120px");
      console.log("DBG before", row.matches(":focus-visible"), document.activeElement === row);
      await user.keyboard("x");
      console.log("DBG after", row.matches(":focus-visible"), document.activeElement === row, list.style.top);
      expect(list.style.top).toBe("128px");
    });

    it("puts a marked NPC in the row it overlaps, first, so the one row reaches every NPC there", async () => {
      const map = { ...crowded, pois: [...crowded.pois, npc("Innkeeper Vizzie", "innkeeper", 11118, 0, 50)] };
      const { user } = await mountGuide({ worldMap: map }, GUIDE);
      const row = within(mapArea()).getByRole("button", { name: "3 markers: Innkeeper Grosk, Innkeeper Wiley, Innkeeper Vizzie" });
      expect(row.querySelectorAll(".poi-icon")).toHaveLength(2);
      expect(row.querySelector(".poi-icon.marked")).toBe(row.querySelector(".poi-icon"));
      expect(row.querySelector(".poi-name")!.textContent).toBe("Innkeeper Grosk");
      expect(mapArea().querySelectorAll(".poi")).toHaveLength(1);
      expect(marked()).toEqual(["Innkeeper Grosk: Innkeepers"]);

      row.focus();
      await user.keyboard("{ArrowDown}{Enter}");
      expect(screen.getByRole("dialog", { name: "Innkeeper Grosk" })).toBeTruthy();
      await user.keyboard("{Escape}{ArrowDown}{ArrowDown}{Enter}");
      expect(screen.getByRole("dialog", { name: "Innkeeper Wiley" })).toBeTruthy();
    });

    it("marks an NPC that the step names though the faction filter hides it", async () => {
      await mountCrowded({}, GUIDE);
      expect(drawnNames()).toEqual(["To Booty Bay", "Innkeeper Wiley"]);
      expect(marked()).toEqual(["Innkeeper Grosk: Innkeepers"]);
    });
  });
});

describe("coordinate readout", () => {
  const readout = () => document.querySelector(".coord-readout")!;
  const rows = () =>
    [...readout().children].map((row) =>
      [...row.children]
        .slice(0, row.hasAttribute("data-off-map") ? 2 : undefined)
        .map((c) => [...(c.children.length ? c.children : [c])].flatMap((e) => e.textContent || []).join(" "))
        .join(" | "),
    );

  it("hides until the cursor is over the map or a point is selected, and shows the cursor and the selected point", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => frames.push(frame));
    const draw = () => act(() => frames.splice(0).forEach((frame) => frame(0)));
    const { user } = await mount("#group T\n#name One\nstep\n.goto Elwynn Forest,48.94,40.16\n");
    draw();
    expect([readout().classList.contains("idle"), rows()]).toEqual([true, ["Cursor | —"]]);

    fireEvent.pointerMove(mapArea(), clientAt(ELWYNN, 45, 55));
    draw();
    expect([readout().classList.contains("idle"), rows()]).toEqual([
      false,
      ["Cursor | 45.00, 55.00 Elwynn Forest | 45.53, 71.08 Eastern Kingdoms"],
    ]);
    fireEvent.pointerLeave(mapArea());
    draw();
    expect(readout().classList.contains("idle")).toBe(true);

    await user.click(within(mapArea()).getByRole("button", { name: /^Selected step 1, line 1:/ }));
    draw();
    expect([readout().classList.contains("idle"), rows()]).toEqual([
      false,
      ["Point | 48.94, 40.16 Elwynn Forest | 45.92, 69.61 Eastern Kingdoms", "Cursor | —"],
    ]);
  });
});

describe("zone borders", () => {
  it("draws the zone grids' borders while its saved legend toggle is on, and loads routing only then", async () => {
    const frame = {
      origin: [23, 20] as [number, number],
      size: [23, 42] as [number, number],
      tilePixels: 512 as const,
      cellsPerTile: 128 as const,
      tileWorldUnits: 1600 / 3,
    };
    const manifest: RoutingEngine["manifest"] = { id: "m0", scope: syntheticScope(), frame, tiles: [] };
    const tiles = Array.from<Uint8Array | undefined>({ length: 23 * 42 });
    tiles[22 * 23 + 13] = Uint8Array.from({ length: 256 }, (_, i) => (i % 16 < 8 ? 1 : 2));
    const zones: ZoneGrid = { scope: syntheticScope(), frame, zones: [0, 1426, 1432], tiles };
    const read = vi.fn(() => Promise.reject(new Error("tile did not load")));
    const east = Array.from<Uint8Array | undefined>({ length: 23 * 42 });
    east[22 * 23 + 14] = tiles[22 * 23 + 13];
    const failing: ZoneGrid = { ...zones, tiles: east, read };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    const maps = [
      { manifest, zones },
      { manifest, zones: failing },
    ];
    const engine = { manifest, maps } as unknown as RoutingEngine;
    routing.load = vi.fn(() => Promise.resolve({ ok: true as const, engine, missing: [] }));
    onTestFinished(() => void (routing.load = null));

    const { user } = await mount("#group T\n#name One\nstep\n.goto Elwynn Forest,48.94,40.16\n");
    const toggle = screen.getByRole("button", { name: "Zone borders" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(mapArea().querySelector(".zone-borders")).toBeNull();
    expect(routing.load).not.toHaveBeenCalled();

    await user.click(toggle);
    const proj = projection(worldMap, [manifest]);
    const [from, to] = [proj.toView([6912, 11264], 0)!, proj.toView([6912, 11776], 0)!];
    await waitFor(() =>
      expect(mapArea().querySelector(".zone-border-line")?.getAttribute("d")).toBe(
        `M${round(from.x)} ${round(from.y)}L${round(to.x)} ${round(to.y)}`,
      ),
    );
    await waitFor(async () => expect(readMapSettings(await loadSetting("map")).categories).toEqual({ "zone-borders": true }));
    expect(warn).toHaveBeenCalledWith("Zone borders did not load", expect.any(Error));

    await user.click(toggle);
    expect(mapArea().querySelector(".zone-borders")).toBeNull();
    const reads = read.mock.calls.length;
    await user.click(toggle);
    await waitFor(() => expect(read.mock.calls.slice(reads)).toContainEqual([[14, 22]]));
  });
});

describe("inside maps", () => {
  const middle = mapToWorld(MAP_BOUNDS.get(ELWYNN)!, 50, 50);
  const { interiors, surfaces } = interiorsFixture();
  const around = (id: string, label: string, kind: Interior["kind"], yards: number): Interior => ({
    ...interiors.interiors[0]!,
    id,
    label,
    kind,
    bounds: { north: middle.y + yards, south: middle.y - yards, west: middle.x + yards, east: middle.x - yards },
  });
  const insideMap = (): LoadedWorldMap => ({
    ...worldMap,
    interiors: {
      list: [around("stormwind", "Stormwind City", "city", 300), around("stormwind-harbor-66885945", "Stormwind Harbor", "building", 100)],
      image: async (path) => `blob:${path}`,
      surfaces: async (interior) => fromSurfaces(interior, surfaces),
      loadedSurfaces: () => undefined,
    },
  });
  const image = () =>
    mapArea().querySelector("image.interior-layer")?.getAttribute("href")?.replace("blob:interiors/the-deadmines-35530/", "");
  const box = () => ["Stormwind City", "Stormwind Harbor"].find((name) => screen.queryByRole("group", { name }));

  const zoom = (name: "Zoom in" | "Zoom out") => fireEvent.click(screen.getByRole("button", { name }));

  it("shows the ground of the smallest interior that holds the middle of the view once it is 160 pixels across, with no routing and no surfaces read", async () => {
    routing.load = vi.fn();
    onTestFinished(() => void (routing.load = null));
    outline.mockClear();
    const map = insideMap();
    const loads = vi.spyOn(map.interiors!, "image");
    const surfaces = [vi.spyOn(map.interiors!, "surfaces"), vi.spyOn(map.interiors!, "loadedSurfaces")];
    const { user } = await mountWith({ worldMap: map }, "#group T\n#name One\nstep\n.goto Duskwood,50,50\n");
    expect([box(), loads.mock.calls]).toEqual([undefined, []]);

    await user.selectOptions(mapShown(), `t${ELWYNN}`);
    await waitFor(() => expect([box(), image()]).toEqual(["Stormwind City", "ground-minimap.webp"]));
    zoom("Zoom out");
    expect([box(), image()]).toEqual([undefined, undefined]);
    const shown = [];
    for (let i = 0; i < 4; i++) {
      zoom("Zoom in");
      shown.push(box());
    }
    expect(shown).toEqual(["Stormwind City", "Stormwind City", "Stormwind City", "Stormwind Harbor"]);
    zoom("Zoom out");
    expect(box()).toBe("Stormwind City");
    expect(routing.load).not.toHaveBeenCalled();
    expect([new Set(outline.mock.calls.map(([, interior]) => interior.id)), surfaces.map((f) => f.mock.calls)]).toEqual([
      new Set(["stormwind", "stormwind-harbor-66885945"]),
      [[], []],
    ]);
  });

  it("keeps the guide's points on top of an inside map, and adds a point over it", async () => {
    const { user } = await mountWith({ worldMap: insideMap() }, "#group T\n#name One\nstep\n.goto Elwynn Forest,50,50\n");
    await waitFor(() => expect(image()).toBe("ground-minimap.webp"));
    const pin = within(mapArea()).getByRole("button", { name: "Selected step 1, line 1: .goto Elwynn Forest 50.00, 50.00" });
    const layer = mapArea().querySelector("image.interior-layer")!;
    expect(layer.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await addAt(user, ELWYNN, 51, 49);
    expect(guideText()).toBe("#group T\n#name One\nstep\n.goto Elwynn Forest,50,50\n.goto Elwynn Forest,51.00,49.00\n");
  });

  it("puts the Inside map box first in the map's top row, and names the stripes in the legend", async () => {
    await mountWith({ worldMap: insideMap() }, "#group T\n#name One\nstep\n.goto Elwynn Forest,50,50\n");
    const inside = screen.getByRole("group", { name: "Stormwind City" });
    expect([...inside.parentElement!.children].map((c) => c.firstElementChild?.textContent?.trim())).toEqual(["Stormwind City", "Legend"]);
    const stacks = screen.getByRole("group", { name: "Inside maps" });
    expect(stacks.textContent).toBe("Inside maps2 levels stack here3 or more levels stack here");
  });
});
