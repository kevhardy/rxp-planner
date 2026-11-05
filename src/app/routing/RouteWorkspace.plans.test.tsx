// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { Point } from "../../routing/frame.ts";
import { DEFAULT_LEG, DEFAULT_MAX_SLOPE } from "../../routing/plan.ts";
import { done, openDb, ROUTE_PLANS } from "../../storage/db.ts";
import { deletePlan, loadPlans, savePlan } from "../../storage/routing.ts";
import { DEFAULT_LAYERS, saveLayerChoices } from "./MapLayers.tsx";
import { saveNewLegs } from "./newLegs.tsx";
import type { ClosedRoute } from "./useRouteFit.ts";
import {
  A,
  W,
  B,
  pixelsOf,
  typed,
  route,
  engine,
  lastRouted,
  mount,
  mountRoutes,
  plan,
  mapArea,
  stageView,
  shownView,
  stop,
  stops,
  rightClick,
  choose,
  popover,
  routePanel,
  chip,
  undoText,
  leg,
  fromMenu,
  finishNewRoute,
  deleteRoute,
  selectLeg,
  savedStores,
} from "./routeWorkspaceFixture.tsx";
import { saveMaxSlope } from "./slope.tsx";
import { DEFAULT_MODE, saveTravelMode } from "./travelMode.ts";

let loadGate = Promise.resolve();
let loadFails: Error | null = null;
let loads = 0;
let saveFails: Error | null = null;
let holdNextSave: Promise<void> | null = null;
let saves: Promise<void>[] = [];
let savedIds: string[] = [];
let deleteFails: Error | null = null;
vi.mock("../../storage/routing.ts", async (original) => {
  const storage = await original<typeof import("../../storage/routing.ts")>();
  return {
    ...storage,
    loadPlans: async (...args: Parameters<typeof storage.loadPlans>) => {
      loads++;
      await loadGate;
      if (loadFails) throw loadFails;
      return storage.loadPlans(...args);
    },
    savePlan: (...args: Parameters<typeof storage.savePlan>) => {
      const hold = holdNextSave;
      holdNextSave = null;
      savedIds.push(args[0].id);
      const save = (async () => {
        await hold;
        if (saveFails) throw saveFails;
        return storage.savePlan(...args);
      })();
      saves.push(save);
      return save;
    },
    deletePlan: async (...args: Parameters<typeof storage.deletePlan>) => {
      if (deleteFails) throw deleteFails;
      return storage.deletePlan(...args);
    },
  };
});

afterEach(() => {
  loadGate = Promise.resolve();
  loadFails = null;
  loads = 0;
  saveFails = null;
  holdNextSave = null;
  saves = [];
  savedIds = [];
  deleteFails = null;
});

describe("route workspace", () => {
  it("says that routes did not load, offers Reload page, and folds the reason under Details", async () => {
    const user = await mount(undefined, () => Promise.resolve({ ok: false, reason: "No routing artifact is installed." }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Routes did not load")).toBeTruthy();
    expect(within(alert).getByText("Reload the page to try again.")).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "Reload page" })).toBeTruthy();
    const reason = within(alert).getByText("No routing artifact is installed.");
    expect(reason.closest("details")?.open).toBe(false);
    await user.click(within(alert).getByText("Details"));
    expect(reason.closest("details")?.open).toBe(true);
  });

  it("says that routing loads until the artifact loads", async () => {
    await mount(undefined, () => new Promise(() => {}));
    expect((await screen.findByText("Loading routing…")).getAttribute("role")).toBeNull();
  });

  it("keeps the routing engine through StrictMode's remount, and releases it when Routes closes", async () => {
    const release = vi.fn();
    await mount(
      plan(A, B),
      () => Promise.resolve({ ok: true, engine: { ...engine, release }, missing: [] }),
      undefined,
      null,
      undefined,
      true,
    );
    expect(release).not.toHaveBeenCalled();
    cleanup();
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });

  it("says when a route did not save, and clears the message when the next save works", async () => {
    saveFails = new Error("The disk is full.");
    const user = await mount();
    await rightClick(user, A);
    await choose(user, "Start a route here");
    await rightClick(user, B);
    await choose(user, "End the route here");
    expect((await screen.findByRole("alert")).textContent).toBe("The route did not save: The disk is full.");

    saveFails = null;
    await user.pointer({ keys: "[MouseRight]", target: stop("Start") });
    await choose(user, "Swap to destination");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect((await loadPlans()).map(pixelsOf)).toEqual([[B, A]]);
  });

  it("keeps no save message when an earlier save fails after a later save works", async () => {
    const user = await mount(plan(A, B));
    let failHeld = (_: Error) => {};
    holdNextSave = new Promise((_, reject) => (failHeld = reject));
    await user.pointer({ keys: "[MouseRight]", target: stop("Start") });
    await choose(user, "Swap to destination");
    await user.pointer({ keys: "[MouseRight]", target: stop("Start") });
    await choose(user, "Swap to destination");
    await waitFor(() => expect(stops()).toEqual([A, B]));

    failHeld(new Error("The disk is full."));
    await act(() => Promise.allSettled(saves));
    expect(screen.queryByRole("alert")).toBeNull();
    expect((await loadPlans()).map(pixelsOf)).toEqual([[A, B]]);
  });

  it("keeps no save message when a save fails after undo saves the same route again", async () => {
    const { id } = plan(A, B);
    await savePlan(plan(A, B));
    let failHeld = (_: Error) => {};
    holdNextSave = new Promise((_, reject) => (failHeld = reject));
    const user = await mount();
    await waitFor(() => expect(stops()).toEqual([A, B]));
    const held = saves.at(-1);
    await user.pointer({ keys: "[MouseRight]", target: stop("Start") });
    await choose(user, "Swap to destination");
    await waitFor(() => expect(stops()).toEqual([B, A]));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(savedIds).toEqual([id, id, id, id]);
    await act(() => Promise.allSettled(saves.filter((save) => save !== held)));

    failHeld(new Error("The disk is full."));
    await act(() => Promise.allSettled(saves));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("saves each route that opens", async () => {
    await savePlan({ ...plan(A, B), id: "first" });
    await savePlan({ ...plan(A, W, B), id: "second" });
    savedIds = [];
    const user = await mount();
    await waitFor(() => expect(stops()).toEqual([A, B]));
    expect(savedIds).toEqual(["first"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Route plan" }), "Route 2");
    await waitFor(() => expect(stops()).toEqual([A, W, B]));
    expect(savedIds).toEqual(["first", "second"]);
  });

  it("says when a route did not save after another route opened", async () => {
    await savePlan({ ...plan(A, W, B), id: "second" });
    const user = await mount(plan(A, B));
    await waitFor(() => expect(stops()).toEqual([A, B]));
    let failHeld = (_: Error) => {};
    holdNextSave = new Promise((_, reject) => (failHeld = reject));
    await user.pointer({ keys: "[MouseRight]", target: stop("Start") });
    await choose(user, "Swap to destination");
    await user.selectOptions(screen.getByRole("combobox", { name: "Route plan" }), "Route 2");
    await waitFor(() => expect(stops()).toEqual([A, W, B]));

    failHeld(new Error("The disk is full."));
    await act(() => Promise.allSettled(saves));
    expect(screen.getByRole("alert").textContent).toBe("The route did not save: The disk is full.");
  });

  it("keeps the save message of a route when an older save of another route works", async () => {
    await savePlan({ ...plan(A, W, B), id: "second" });
    const user = await mount(plan(A, B));
    await waitFor(() => expect(stops()).toEqual([A, B]));
    let passHeld = () => {};
    holdNextSave = new Promise((resolve) => (passHeld = resolve));
    await user.pointer({ keys: "[MouseRight]", target: stop("Start") });
    await choose(user, "Swap to destination");
    await user.selectOptions(screen.getByRole("combobox", { name: "Route plan" }), "Route 2");
    await waitFor(() => expect(stops()).toEqual([A, W, B]));
    saveFails = new Error("The disk is full.");
    await user.pointer({ keys: "[MouseRight]", target: stop("Start") });
    await choose(user, "Swap to destination");
    expect((await screen.findByRole("alert")).textContent).toBe("The route did not save: The disk is full.");

    saveFails = null;
    passHeld();
    await act(() => Promise.allSettled(saves));
    expect(screen.getByRole("alert").textContent).toBe("The route did not save: The disk is full.");
  });

  it.each(["Delete route", "Clear route"])("keeps no save message when a save fails after %s", async (action) => {
    const user = await mount(plan(A, B));
    let failHeld = (_: Error) => {};
    holdNextSave = new Promise((_, reject) => (failHeld = reject));
    await user.pointer({ keys: "[MouseRight]", target: stop("Start") });
    await choose(user, "Swap to destination");
    if (action === "Delete route") await deleteRoute(user);
    else await fromMenu(user, "Clear route");
    await waitFor(async () => expect(await loadPlans()).toEqual([]));

    failHeld(new Error("The disk is full."));
    await act(() => Promise.allSettled(saves));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when Delete route or Clear route leaves the route in this browser", async () => {
    const user = await mount(plan(A, B));
    const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "Route plan" });
    deleteFails = new Error("The database is closed.");
    await fromMenu(user, "Delete route…");
    await user.click(within(screen.getByRole("dialog", { name: "Delete this route?" })).getByRole("button", { name: "Delete" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The route was not deleted: The database is closed.");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Route 1"]);

    await fromMenu(user, "Clear route");
    expect((await screen.findByRole("alert")).textContent).toBe("The cleared route was not deleted: The database is closed.");
    expect([...select.options].map((o) => o.textContent)).toEqual(["New route"]);
  });

  it("starts a route from two right-clicks and saves it", async () => {
    const user = await mount();
    await waitFor(() => expect(chip()).toBe("Right-click the map to start a route, or set the start in the Route menu."));
    await rightClick(user, A);
    await choose(user, "Start a route here");
    expect(chip()).toBe("Right-click where the route ends, or set the destination in the Route menu.");
    await rightClick(user, B);
    await choose(user, "End the route here");
    await waitFor(() => expect(stops()).toEqual([A, B]));
    expect(stop("Start")).toBeTruthy();
    await waitFor(async () => expect((await loadPlans()).map(pixelsOf)).toEqual([[A, B]]));
  });

  it("allows no edits until the saved routes load, then opens the first", async () => {
    await savePlan(plan(A, B));
    let release = () => {};
    loadGate = new Promise((resolve) => (release = resolve));
    const user = await mount();
    await screen.findByText("Loading saved routes…");
    await rightClick(user, A);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: "Route" })).toBeNull();

    release();
    await waitFor(() => expect(stops()).toEqual([A, B]));
    expect(screen.getByRole("combobox", { name: "Route plan" })).toHaveProperty("value", lastRouted().id);
  });

  it("loads the saved routes once each time Routes opens", async () => {
    loads = 0;
    const user = await mount(plan(A, B));
    await user.pointer({ keys: "[MouseRight]", target: stop("Start") });
    await choose(user, "Swap to destination");
    await waitFor(() => expect(stops()).toEqual([B, A]));
    expect(loads).toBe(1);

    cleanup();
    await mount();
    await screen.findByRole("option", { name: "Route 1" });
    expect(loads).toBe(2);
  });

  it("shows a note and no routes when the saved routes do not load", async () => {
    await savePlan(plan(A, B));
    loadFails = new Error("The database is closed.");
    await mount();
    const note = await screen.findByText(/^Saved routes did not load/);
    expect([note.textContent, note.getAttribute("role")]).toEqual(["Saved routes did not load: The database is closed.", null]);
    const options = screen.getByRole<HTMLSelectElement>("combobox", { name: "Route plan" }).options;
    expect([...options].map((o) => o.textContent)).toEqual(["New route"]);
    expect(chip()).toBe("Right-click the map to start a route, or set the start in the Route menu.");
  });

  it("reopens the route that was open when Routes closed", async () => {
    await savePlan(plan(A, B));
    await savePlan({ ...plan(A, W, B), id: "second" });
    const closed: RefObject<ClosedRoute | null> = { current: null };
    const user = await mountRoutes(closed);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Route plan" }), "Route 2");
    await waitFor(() => expect(stops()).toEqual([A, W, B]));
    cleanup();
    await mountRoutes(closed);

    await screen.findByRole("option", { name: "Route 2" });
    expect(screen.getByRole("combobox", { name: "Route plan" })).toHaveProperty("value", "second");
  });

  it("keeps the map view when Routes reopens on the same route, and fits a route that it opens in its place", async () => {
    await savePlan({ ...plan(A, B), id: "first" });
    const closed: RefObject<ClosedRoute | null> = { current: null };
    let user = await mountRoutes(closed);
    await waitFor(() => expect(routePanel()).not.toBeNull());
    const fitted = shownView();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    const zoomed = shownView();
    expect(zoomed).not.toEqual(fitted);
    cleanup();
    user = await mountRoutes(closed);
    await screen.findByRole("option", { name: "Route 1" });
    expect(shownView()).toEqual(zoomed);

    await deletePlan("first");
    await savePlan({ ...plan(A, B), id: "second" });
    cleanup();
    await mountRoutes(closed);
    await screen.findByRole("option", { name: "Route 1" });
    await waitFor(() => expect(shownView()).toEqual(fitted));
  });

  it("reopens New route when it was open when Routes closed", async () => {
    await savePlan(plan(A, B));
    const closed: RefObject<ClosedRoute | null> = { current: null };
    const user = await mountRoutes(closed);
    await waitFor(() => expect(stops()).toEqual([A, B]));
    await fromMenu(user, "New route");
    cleanup();
    await mountRoutes(closed);

    await screen.findByRole("option", { name: "Route 1" });
    expect(screen.getByRole("combobox", { name: "Route plan" })).toHaveProperty("value", "");
  });

  it("fits the route when Routes reopens after it closed before routing was ready", async () => {
    await savePlan({ ...plan(A, B), id: "first" });
    await mountRoutes({ current: null });
    await waitFor(() => expect(routePanel()).not.toBeNull());
    const fitted = stageView();
    cleanup();
    const closed: RefObject<ClosedRoute | null> = { current: null };
    await mount(undefined, () => new Promise(() => {}), undefined, null, undefined, false, closed);
    await screen.findByText("Loading routing…");
    cleanup();
    await mountRoutes(closed);

    await screen.findByRole("option", { name: "Route 1" });
    await waitFor(() => expect(stageView()).toBe(fitted));
  });

  it("routes with the saved slope, mode, and new legs, and shows the saved layers, while one saved route cannot be read", async () => {
    saveMaxSlope(20);
    saveTravelMode("Epic mount");
    saveLayerChoices({ ...DEFAULT_LAYERS, image: false });
    saveNewLegs({ ...DEFAULT_LEG, otherFaction: true });
    onTestFinished(() => {
      saveMaxSlope(DEFAULT_MAX_SLOPE);
      saveTravelMode(DEFAULT_MODE);
      saveLayerChoices(DEFAULT_LAYERS);
      saveNewLegs(DEFAULT_LEG);
      return deletePlan("unreadable");
    });
    const db = await openDb();
    const tx = db.transaction(ROUTE_PLANS, "readwrite");
    tx.objectStore(ROUTE_PLANS).put({ id: "unreadable", stops: "none" });
    await done(tx);

    const user = await mount(undefined, undefined, await savedStores());
    await screen.findByText(/^Saved routes did not load/);
    await user.click(screen.getByRole("button", { name: "Layers" }));
    const mapImage = screen.getByRole<HTMLInputElement>("checkbox", { name: "Map image" }).checked;
    await user.keyboard("{Escape}");
    await rightClick(user, A);
    await choose(user, "Start a route here");
    await rightClick(user, B);
    await choose(user, "End the route here");
    await waitFor(() => expect(route).toHaveBeenCalled());
    const [plan, slope, , , , mode] = route.mock.calls.at(-1)!;
    expect({ slope, mode, legs: plan.legs, mapImage }).toEqual({
      slope: 20,
      mode: "Epic mount",
      legs: [{ ...DEFAULT_LEG, otherFaction: true }],
      mapImage: false,
    });
  });

  it("fills the coordinate dialog with the routed point at the middle of the view", async () => {
    const user = await mount(plan(A, B));
    await screen.findByRole("button", { name: "Route" });
    await fromMenu(user, "Add destination…");
    expect(screen.getByRole("textbox", { name: "World yards (x, y)" })).toHaveProperty(
      "value",
      expect.stringMatching(/^-?\d+\.\d{2}, -?\d+\.\d{2}$/),
    );
  });

  it("creates and extends a route from the keyboard", async () => {
    const user = await mount();
    const C: Point = [1000, 2000];
    const D: Point = [5000, 2000];
    const enter = async (title: string, p: Point) => {
      const field = within(screen.getByRole("dialog", { name: title })).getByRole("textbox", { name: "World yards (x, y)" });
      await user.clear(field);
      await user.type(field, `${typed(p)}{Enter}`, { skipClick: true });
      expect(screen.queryByRole("dialog")).toBeNull();
    };

    await screen.findByRole("button", { name: "Route" });
    await fromMenu(user, "Set start…");
    await enter("Set the start", A);
    expect(stop("Start of the new route")).toBeTruthy();
    await fromMenu(user, "Set destination…");
    await enter("Set the destination", B);
    await waitFor(() => expect(stops()).toEqual([A, B]));

    stop("Start").focus();
    await user.keyboard("{Enter}");
    within(popover()!).getByRole("button", { name: "Add stop after the start…" }).focus();
    await user.keyboard("{Enter}");
    await enter("Add a stop after the start", W);
    await waitFor(() => expect(stops()).toEqual([A, W, B]));
    expect(stop("Waypoint 1").classList.contains("selected")).toBe(true);
    expect(document.activeElement).toBe(stop("Waypoint 1"));
    expect(undoText()).toBe("Undo insert waypoint 1");

    await fromMenu(user, "Add point and start there…");
    await enter("Add a new start", C);
    await waitFor(() => expect(stops()).toEqual([C, A, W, B]));
    expect([stop("Start").classList.contains("selected"), undoText()]).toEqual([true, "Undo add a start"]);
    await fromMenu(user, "Add destination…");
    await enter("Add a destination", D);
    await waitFor(() => expect(stops()).toEqual([C, A, W, B, D]));
    expect([stop("Destination").classList.contains("selected"), undoText()]).toEqual([true, "Undo add a destination"]);

    const trigger = screen.getByRole("button", { name: "Route" });
    await fromMenu(user, "Add destination…");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await fromMenu(user, "Add destination…");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(stop("Destination").getAttribute("aria-label")).toBe(`Destination at world yards ${typed(D)}`);
  });

  it("closes the Route menu when an action runs, and keeps focus on its button", async () => {
    const user = await mount(plan(A, B));
    const trigger = screen.getByRole("button", { name: "Route" });
    await fromMenu(user, "Delete route…");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(within(screen.getByRole("dialog", { name: "Delete this route?" })).getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(trigger);

    await fromMenu(user, "New route");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "New route" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("combobox", { name: "Route plan" })).toHaveProperty("value", "");
  });

  it("keeps the map view on New route", async () => {
    const user = await mount(plan(A, B));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(shownView()).toEqual({ center: [3072, 3113], zoom: 18.07 });
    await fromMenu(user, "New route");
    expect(screen.getByRole("combobox", { name: "Route plan" })).toHaveProperty("value", "");
    expect(shownView()).toEqual({ center: [3072, 3113], zoom: 18.07 });
  });

  it("keeps the map view on Delete route", async () => {
    const user = await mount(plan(A, B));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(shownView()).toEqual({ center: [3072, 3113], zoom: 18.07 });
    await deleteRoute(user);
    expect(shownView()).toEqual({ center: [3072, 3113], zoom: 18.07 });
  });

  it("keeps the map view when a new route is finished", async () => {
    const user = await mount(plan(A, B));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(shownView()).toEqual({ center: [3072, 3113], zoom: 18.07 });
    await finishNewRoute(user, W, B);
    await waitFor(() => expect(document.querySelectorAll(".route-lines .leg-route")).toHaveLength(1));
    expect(shownView()).toEqual({ center: [3072, 3113], zoom: 18.07 });
  });

  it("clears the route in place as one undoable edit, and Undo brings it back under its name", async () => {
    await savePlan({ ...plan(W, B), id: "route-b" });
    const user = await mount({ ...plan(A, B), id: "route-a" });
    const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "Route plan" });
    const options = () => [...select.options].map((o) => o.textContent);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect([select.value, options()]).toEqual(["route-a", ["Route 1", "Route 2"]]);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    const zoomed = stageView();

    await fromMenu(user, "Clear route");
    expect([select.value, options()]).toEqual(["", ["New route", "Route 1"]]);
    expect(stageView()).toBe(zoomed);
    expect(document.getElementById(undo.getAttribute("aria-describedby")!)!.textContent).toBe("Undo clear route");
    await waitFor(async () => expect((await loadPlans()).map((p) => p.id)).toEqual(["route-b"]));

    await user.click(undo);
    expect([select.value, options()]).toEqual(["route-a", ["Route 1", "Route 2"]]);
    await waitFor(() => expect(stops()).toEqual([A, B]));
    await waitFor(async () => expect((await loadPlans()).map((p) => p.id)).toEqual(["route-a", "route-b"]));
    expect(undo).toHaveProperty("disabled", true);
  });

  it("drops the start of a new route when Undo brings back a cleared route", async () => {
    const user = await mount(plan(A, B));
    await fromMenu(user, "Clear route");
    await fromMenu(user, "Set start…");
    const field = within(screen.getByRole("dialog", { name: "Set the start" })).getByRole("textbox", { name: "World yards (x, y)" });
    await user.clear(field);
    await user.type(field, `${typed(W)}{Enter}`, { skipClick: true });
    expect(stop("Start of the new route").getAttribute("aria-label")).toBe(`Start of the new route at world yards ${typed(W)}`);

    await user.click(screen.getByRole("button", { name: "Undo" }));
    const pins = [...document.querySelectorAll("[aria-label*=' at world yards ']")].map((pin) => pin.getAttribute("aria-label"));
    expect(pins).toEqual([`Start at world yards ${typed(A)}`, `Destination at world yards ${typed(B)}`]);
    await user.click(screen.getByRole("button", { name: "Route" }));
    expect(screen.queryByRole("button", { name: "Cancel the new route" })).toBeNull();
  });

  it("shows the route on the map without a leg list, puts the bar before the map in the Tab order, and tabs along the route", async () => {
    const user = await mount(plan(A, W, B));
    await waitFor(() => expect(document.querySelectorAll(".route-lines .leg-route")).toHaveLength(2));
    expect(screen.getAllByRole("list").every((list) => routePanel()!.contains(list))).toBe(true);
    expect(popover()).toBeNull();

    const bar = screen.getByRole("region", { name: "Route tools" });
    const order: string[] = [];
    for (let i = 0; i < 40 && document.activeElement !== stop("Destination"); i++) {
      await user.tab();
      if (bar.contains(document.activeElement)) order.push("bar");
      else if (mapArea().contains(document.activeElement)) order.push("map");
    }
    const first = order.indexOf("map");
    expect(order.slice(0, first)).toEqual(["bar", "bar", "bar", "bar", "bar"]);
    expect(order.slice(first)).not.toContain("bar");

    const route = [stop("Start"), leg(1), stop("Waypoint 1"), leg(2), stop("Destination")];
    stop("Start").focus();
    for (const next of route.slice(1)) {
      await user.tab();
      expect(document.activeElement).toBe(next);
    }
    for (const previous of route.slice(0, -1).reverse()) {
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(previous);
    }
    stop("Destination").focus();
    await user.tab();
    expect(document.activeElement!.closest(".map-zoom")).toBeTruthy();
  });

  it("reloads saved plans with their edits", async () => {
    const user = await mount(plan(A, B));
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Route plan" }).selectedOptions[0]!.textContent).toBe("Route 1");
    await waitFor(() => expect(document.querySelectorAll(".route-lines .leg-route")).toHaveLength(1));
    await selectLeg(user, 1);
    await user.click(screen.getByRole("checkbox", { name: "Follow terrain" }));
    await waitFor(async () => expect((await loadPlans())[0]!.legs[0]!.followTerrain).toBe(false));

    cleanup();
    await mount();
    await waitFor(() => expect(document.querySelectorAll(".route-lines .leg-straight")).toHaveLength(1));
    await selectLeg(user, 1);
    expect(screen.getByRole("checkbox", { name: "Follow terrain" })).toHaveProperty("checked", false);
    expect(stop("Destination")).toBeTruthy();
  });
});
