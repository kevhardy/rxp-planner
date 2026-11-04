// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { at } from "../../routing/fixtures/region.ts";
import { syntheticScope } from "../../routing/fixtures/synthetic.ts";
import type { Point } from "../../routing/frame.ts";
import type { LegUpdate } from "../../routing/journey.ts";
import { addDestination, createPlan, DEFAULT_MAX_SLOPE, DEFAULT_MODES } from "../../routing/plan.ts";
import { savePlan } from "../../storage/routing.ts";
import { zoomTo } from "../map/viewport.ts";
import type { RoutingEngine } from "./engine.ts";
import { frameAround } from "./lines.ts";
import {
  manifest,
  proj,
  A,
  W,
  B,
  world,
  pixel,
  pixelsOf,
  terrainRoute,
  type Outcome,
  defaultOutcome,
  controlRoute,
  route,
  engine,
  lastRouted,
  lastSlope,
  slopeField,
  mount,
  plan,
  client,
  mapArea,
  stop,
  stops,
  looks,
  saved,
  choose,
  labels,
  popover,
  routePanel,
  factsOf,
  facts,
  actions,
  chip,
  busy,
  leg,
  fromMenu,
  selectLeg,
  viewAt,
  legLine,
  outlines,
  tiles,
  stageView,
  savedStores,
} from "./routeWorkspaceFixture.tsx";
import { saveMaxSlope } from "./slope.tsx";
import { DEFAULT_MODE, saveTravelMode } from "./travelMode.ts";

let outcome: Outcome;
let routeGate: Promise<void>;
beforeEach(() => {
  outcome = defaultOutcome;
  routeGate = Promise.resolve();
});
controlRoute({ outcome: () => outcome, routeGate: () => routeGate });

describe("route workspace", () => {
  it("shows a leg between continents as a quiet note, not a failure", async () => {
    const kalimdor: RoutingEngine["manifest"] = {
      ...manifest,
      scope: syntheticScope(1),
      frame: { ...manifest.frame, origin: [0, 0], size: [64, 64] },
    };
    const both = { ...engine, maps: [...engine.maps, { manifest: kalimdor }] };
    const across = addDestination(plan(A, B), at([20937, 16081], null, kalimdor));
    const user = await mount(across, () => Promise.resolve({ ok: true, engine: both, missing: [] }));
    await waitFor(() => expect(labels()).toEqual(["no ground route between continents"]));
    expect(legLine(2).look).toBe("leg-crossing");
    expect(chip()).toMatch(/ · not counting 1 crossing between continents$/);
    expect(document.querySelector(".route-chip")!.className).not.toMatch(/route-(error|warn)/);
    await selectLeg(user, 2);
    expect(facts()).toContain("Result: No ground route between continents");
    expect(popover()!.querySelector(".route-error, .route-warn")).toBeNull();
  });

  it("keeps failed legs visible, and draws a route that skipped tiles without terrain data as a terrain route", async () => {
    outcome = (from, to, _leg, i) =>
      i === 0
        ? { kind: "no-path", endpoint: "end" }
        : i === 1
          ? { kind: "missing-coverage", tiles: tiles(2), route: terrainRoute([from, [3500, 3800], to]) }
          : { kind: "limit", cells: 2_000_000, route: terrainRoute([from, to]) };
    const user = await mount(plan(A, W, B, A));
    await waitFor(() => expect(labels()).toEqual(["no-path at the leg's end", "limit, provisional route"]));
    expect(legLine(1)).toEqual({ look: "leg-failed", points: `${viewAt(A)} ${viewAt(W)}` });
    expect(legLine(2)).toEqual({ look: "leg-route", points: `${viewAt(W)} ${viewAt([3500, 3800])} ${viewAt(B)}` });
    expect(legLine(3).look).toBe("leg-provisional");
    expect(chip()).toBe("no route · no terrain data for 2 nearby tiles · search limit · no path on leg 1");
    expect(document.querySelector(".route-chip")!.classList.contains("route-error")).toBe(true);

    await selectLeg(user, 1);
    expect(facts()).toEqual(["Stops: Start → Waypoint 1", "Result: No path: the end is blocked, too steep, or in water", "Time: unknown"]);
    expect(popover()!.querySelector(".route-error")).not.toBeNull();
    await selectLeg(user, 2);
    expect(facts().slice(1, 4)).toEqual([
      "Result: Terrain route",
      "Time: 10 s · 1,650 yd",
      "Note: Skipped a possibly faster route through 2 tiles without terrain data. Show on map",
    ]);
    expect(popover()!.querySelector(".route-error, .route-warn")).toBeNull();
    await selectLeg(user, 3);
    expect(facts().slice(1, 3)).toEqual([
      "Result: Search limit: needs 2,000,000 cells; provisional route shown",
      "Time: 10 s · 2,083 yd (provisional)",
    ]);
  });

  it("outlines the open leg's tiles without terrain data until its panel closes or another leg opens", async () => {
    const skipped = ([3, 4, 7] as const).map((c) => ({ tile: [c, 5] as [number, number], at: [c * 512, 2600] as Point }));
    outcome = (from, to, _leg, i) =>
      i === 0 ? { kind: "missing-coverage", tiles: skipped, route: terrainRoute([from, to]) } : terrainRoute([from, to]);
    const user = await mount(plan(A, W, B));
    await waitFor(() => expect(chip()).toBe("20 s · 2,244 yd · skipped 3 tiles without terrain data"));
    expect(outlines()).toEqual([]);
    await selectLeg(user, 1);
    const square = (c: number) => [c, c + 1, c + 1, c].map((x, k) => viewAt([x * 512, k < 2 ? 2560 : 3072])).join(" ");
    expect(outlines()).toEqual([square(3), square(4), square(7)]);
    const labels = [...document.querySelectorAll<HTMLElement>(".skipped-label")];
    expect(labels.map((l) => l.textContent)).toEqual(["No terrain data", "No terrain data"]);
    const centre = (p: Point) => proj.toView(p, 0)!;
    expect(labels.map((l) => [parseFloat(l.style.getPropertyValue("--at-x")), parseFloat(l.style.getPropertyValue("--at-y"))])).toEqual(
      [centre([2304, 2816]), centre([3840, 2816])].map(({ x, y }) => [expect.closeTo(x, 6), expect.closeTo(y, 6)]),
    );
    await user.click(within(popover()!).getByRole("button", { name: "Close" }));
    expect(outlines()).toEqual([]);

    await selectLeg(user, 1);
    expect(outlines()).toHaveLength(3);
    await selectLeg(user, 2);
    expect(outlines()).toEqual([]);
    expect(document.querySelector(".skipped-label")).toBeNull();
  });

  it("shows the open leg's tiles without terrain data on the map", async () => {
    const skipped = ([3, 4, 7] as const).map((c) => ({ tile: [c, 5] as [number, number], at: [c * 512, 2600] as Point }));
    outcome = (from, to) => ({ kind: "missing-coverage", tiles: skipped, route: terrainRoute([from, to]) });
    const user = await mount(plan(A, B));
    await waitFor(() => expect(chip()).toBe("10 s · 2,083 yd · skipped 3 tiles without terrain data"));
    await selectLeg(user, 1);
    await user.click(within(popover()!).getByRole("button", { name: "Show on map" }));
    const around = frameAround([proj.toView([3 * 512, 5 * 512], 0)!, proj.toView([8 * 512, 6 * 512], 0)!], 1, 3)!;
    const { s, tx, ty } = zoomTo(
      { ...around, inset: { top: 12, right: 60, bottom: 84, left: 12 } },
      { vw: 1000, vh: 1000, w: 1000, h: 1000 },
      40,
    );
    expect(stageView()).toBe(`translate(${tx}px, ${ty}px) scale(${s})`);
  });

  it("gives the total and each routing state in the summary chip", async () => {
    let release = () => {};
    routeGate = new Promise((resolve) => (release = resolve));
    const user = await mount(plan(A, B));
    expect(chip()).toBe("Finding walking paths…");
    release();
    await waitFor(() => expect(chip()).toBe("10 s · 2,083 yd"));
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Mode" }).value).toBe("Run");

    outcome = (from, to) => ({ kind: "missing-coverage", tiles: tiles(5), route: terrainRoute([from, to]) });
    await selectLeg(user, 1);
    await user.click(screen.getByRole("checkbox", { name: "Downhill shortcuts" }));
    await waitFor(() => expect(chip()).toBe("10 s · 2,083 yd · skipped 5 tiles without terrain data"));
    expect(document.querySelector(".route-chip")!.className).toBe("route-chip");
    expect(facts()[1]).toBe("Result: Terrain route");
    await user.click(stop("Start"));
    expect(facts()[1]).toBe("Leaves by: leg 1, 10 s, 2,083 yd");

    outcome = () => ({ kind: "missing-coverage", tiles: tiles(5) });
    await selectLeg(user, 1);
    await user.click(screen.getByRole("checkbox", { name: "Downhill shortcuts" }));
    await waitFor(() => expect(chip()).toBe("no route · no terrain data for 5 nearby tiles"));

    outcome = () => ({ kind: "limit", cells: 2_000_000 });
    await user.click(screen.getByRole("checkbox", { name: "Downhill shortcuts" }));
    await waitFor(() => expect(chip()).toBe("no route · search limit"));

    outcome = (from, to) => ({ kind: "straight", points: [from, to], distance: 100, activation: 0, seconds: 10 });
    await user.click(screen.getByRole("checkbox", { name: "Follow terrain" }));
    await waitFor(() => expect(chip()).toBe("about 10 s · 100 yd · 1 straight leg"));
  });

  it("shows a routing failure in the summary chip, logs its error, and searches again on request", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => logged.mockRestore());
    const error = new Error("The worker stopped.");
    let fails = true;
    const failing: RoutingEngine["route"] = async (p, working, maxSlope) => {
      const journeys = await route(p, working, maxSlope);
      if (fails) throw error;
      return journeys;
    };
    const user = await mount(plan(A, B), () => Promise.resolve({ ok: true, engine: { ...engine, route: failing }, missing: [] }));
    await waitFor(() => expect(chip()).toBe("The route search failed."));
    expect(busy()).toBe(false);
    expect(logged).toHaveBeenCalledWith("Route search failed", error);
    await selectLeg(user, 1);
    expect(facts()).toEqual(["Stops: Start → Destination", "Result: The route search failed."]);
    await user.click(stop("Start"));
    expect(facts()[1]).toBe("Leaves by: leg 1, routing failed");
    fails = false;
    await user.click(screen.getByRole("button", { name: "Search again" }));
    await waitFor(() => expect(chip()).not.toBe("The route search failed."));
    expect(screen.queryByRole("button", { name: "Search again" })).toBeNull();
  });

  it("routes a failed plan again when it returns after another plan", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => logged.mockRestore());
    const failing: RoutingEngine["route"] = async (p, working, maxSlope) => {
      const journeys = await route(p, working, maxSlope);
      if (p.id === "second") throw new Error("The worker stopped.");
      return journeys;
    };
    await savePlan(createPlan(world(B), world(A), "second"));
    const user = await mount(plan(A, B), () => Promise.resolve({ ok: true, engine: { ...engine, route: failing }, missing: [] }));
    const first = lastRouted().id;
    await waitFor(() => expect(chip()).not.toBe("Finding walking paths…"));
    const plans = screen.getByRole("combobox", { name: "Route plan" });
    await user.selectOptions(plans, "second");
    await waitFor(() => expect(chip()).toBe("The route search failed."));
    const calls = route.mock.calls.length;
    await user.selectOptions(plans, first);
    expect([chip() === "Finding walking paths…", route.mock.calls.length]).toEqual([false, calls]);
    await user.selectOptions(plans, "second");
    await waitFor(() => expect(route).toHaveBeenCalledTimes(calls + 1));
  });

  it("marks the chip busy while a route search runs, until its result or a drag stops it", async () => {
    let release = () => {};
    routeGate = new Promise((resolve) => (release = resolve));
    await mount(plan(A, W, B));
    expect([chip(), busy()]).toEqual(["Finding walking paths…", true]);
    const pin = stop("Waypoint 1");
    fireEvent.pointerDown(pin, { button: 0, ...client(W) });
    fireEvent.pointerMove(pin, client([3300, 3400]));
    expect(route.mock.calls.at(-1)![2]!.aborted).toBe(true);
    expect(busy()).toBe(false);
    fireEvent.pointerUp(pin, client([3300, 3400]));
    await waitFor(() => expect(stops()).toEqual([A, [3300, 3400], B]));
    expect(busy()).toBe(true);
    release();
    await waitFor(() => expect(chip()).not.toBe("Finding walking paths…"));
    expect(busy()).toBe(false);

    const [searches, total] = [route.mock.calls.length, chip()];
    const moved = stop("Waypoint 1");
    fireEvent.pointerDown(moved, { button: 0, ...client([3300, 3400]) });
    fireEvent.pointerMove(moved, client([3500, 3600]));
    expect(busy()).toBe(false);
    fireEvent.pointerCancel(moved);
    await waitFor(() => expect(chip()).toBe(total));
    expect([busy(), route.mock.calls.length]).toEqual([false, searches]);
  });

  it("shows each leg's result once it is known, keeps an unchanged leg's result through a drag, and shows a recent result on undo", async () => {
    const progressive: RoutingEngine["route"] = (p, maxSlope, signal, onLegs) => {
      onLegs?.([{ mode: DEFAULT_MODES[0]!.name, leg: 0, result: outcome(pixel(p.stops[0]!), pixel(p.stops[1]!), p.legs[0]!, 0) }]);
      return route(p, maxSlope, signal);
    };
    const drag = async (to: Point) => {
      const pin = stop("Destination");
      const from = stops().at(-1)!;
      fireEvent.pointerDown(pin, { button: 0, ...client(from) });
      fireEvent.pointerMove(pin, client(to));
      expect(looks()).toEqual(["leg-route", "leg-preview"]);
      fireEvent.pointerUp(pin, client(to));
      await waitFor(() => expect(stops()).toEqual([A, W, to]));
      expect(looks()).toEqual(["leg-route", "leg-pending"]);
    };
    let release = () => {};
    routeGate = new Promise((resolve) => (release = resolve));
    const user = await mount(plan(A, W, B), () => Promise.resolve({ ok: true, engine: { ...engine, route: progressive }, missing: [] }));
    await waitFor(() => expect(looks()).toEqual(["leg-route", "leg-pending"]));
    expect(chip()).toBe("Finding walking paths…");
    await selectLeg(user, 1);
    expect(facts()[2]).toBe("Time: 10 s · 1,122 yd");

    await drag([4200, 3200]);
    release();
    await waitFor(() => expect(looks()).toEqual(["leg-route", "leg-route"]));

    routeGate = new Promise((resolve) => (release = resolve));
    await drag([4300, 3300]);
    const calls = route.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect([looks(), chip() === "Finding walking paths…", route.mock.calls.length]).toEqual([["leg-route", "leg-route"], false, calls]);
    await waitFor(async () => expect(pixelsOf(await saved())).toEqual([A, W, [4200, 3200]]));
    release();
  });

  it("shows a leg as searching its rides, and shows no path only when that search ends with none", async () => {
    const run = DEFAULT_MODES[0]!.name;
    const own = outcome;
    outcome = (from, to, leg, i) => (i === 0 ? { kind: "no-path", endpoint: "end" } : own(from, to, leg, i));
    let report: (updates: LegUpdate[]) => void = () => {};
    const rides: RoutingEngine["route"] = (p, maxSlope, signal, onLegs) => {
      report = onLegs!;
      onLegs!(
        p.legs.map((leg, i) => ({
          mode: run,
          leg: i,
          result: outcome(pixel(p.stops[i]!), pixel(p.stops[i + 1]!), leg, i),
          searching: true,
        })),
      );
      return route(p, maxSlope, signal);
    };
    let release = () => {};
    routeGate = new Promise((resolve) => (release = resolve));
    const user = await mount(plan(A, W, B), () => Promise.resolve({ ok: true, engine: { ...engine, route: rides }, missing: [] }));
    await waitFor(() => expect(looks()).toEqual(["leg-pending", "leg-route"]));
    await selectLeg(user, 1);
    const phase = () => [chip(), labels(), facts().find((f) => f.startsWith("Result: "))];
    expect(phase()).toEqual([
      "No walking path. Searching rides…",
      ["No walking path. Searching rides…"],
      "Result: No walking path. Searching rides…",
    ]);
    for (const [ride, words] of [
      ["ship", "No walking path. Trying boats…"],
      ["flight", "No walking path. Trying flights…"],
    ] as const) {
      act(() => report([{ mode: run, leg: 0, result: { kind: "no-path", endpoint: "end" }, searching: true, trying: ride }]));
      expect(phase()).toEqual([words, [words], `Result: ${words}`]);
    }

    act(() => report([{ mode: run, leg: 0, result: { kind: "no-path", endpoint: "end" } }]));
    expect([looks(), labels()]).toEqual([["leg-failed", "leg-route"], ["no-path at the leg's end"]]);
    release();
    await waitFor(() => expect(chip()).not.toBe("Finding walking paths…"));
    expect(looks()).toEqual(["leg-failed", "leg-route"]);
  });

  it("cancels a ride search in the worker, shows no path for no leg, and searches again on request or on a change", async () => {
    const run = DEFAULT_MODES[0]!.name;
    const own = outcome;
    outcome = (from, to, leg, i) => (i === 0 ? { kind: "no-path", endpoint: "end" } : own(from, to, leg, i));
    let reports = true;
    const rides: RoutingEngine["route"] = (p, maxSlope, signal, onLegs) => {
      if (reports)
        onLegs!([
          { mode: run, leg: 0, result: outcome(pixel(p.stops[0]!), pixel(p.stops[1]!), p.legs[0]!, 0), searching: true, trying: "ship" },
        ]);
      return route(p, maxSlope, signal);
    };
    routeGate = new Promise(() => {});
    const user = await mount(plan(A, W, B), () => Promise.resolve({ ok: true, engine: { ...engine, route: rides }, missing: [] }));
    await waitFor(() => expect(chip()).toBe("No walking path. Trying boats…"));
    const calls = route.mock.calls.length;
    const cancel = screen.getByRole("button", { name: "Cancel search" });
    cancel.focus();
    await user.keyboard("{Enter}");

    expect([chip(), busy(), labels(), looks()]).toEqual([
      "Search cancelled.",
      false,
      ["Search cancelled.", "Search cancelled."],
      ["leg-pending", "leg-pending"],
    ]);
    expect(route.mock.calls.at(-1)![2]!.aborted).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search again" }));
    await selectLeg(user, 1);
    expect(facts()).toContain("Result: Search cancelled.");

    reports = false;
    await user.click(screen.getByRole("button", { name: "Search again" }));
    expect([chip(), labels(), route.mock.calls.length]).toEqual(["Finding walking paths…", [], calls + 1]);
    await user.click(screen.getByRole("button", { name: "Cancel search" }));
    reports = true;
    await user.pointer({ keys: "[MouseRight]", target: stop("Waypoint 1") });
    await choose(user, "Remove");
    await waitFor(() => expect([chip(), route.mock.calls.length]).toEqual(["No walking path. Trying boats…", calls + 2]));
  });

  it("labels on the map only a leg whose rides are searched, and gives a leg that still walks its phase in its card", async () => {
    const run = DEFAULT_MODES[0]!.name;
    const rides: RoutingEngine["route"] = (p, maxSlope, signal, onLegs) => {
      onLegs!([{ mode: run, leg: 1, result: { kind: "limit", cells: 2_000_000 }, searching: true, trying: "ship" }]);
      return route(p, maxSlope, signal);
    };
    routeGate = new Promise(() => {});
    const user = await mount(plan(A, W, B), () => Promise.resolve({ ok: true, engine: { ...engine, route: rides }, missing: [] }));
    await waitFor(() => expect(chip()).toBe("Trying boats…"));
    expect([labels(), looks()]).toEqual([["Trying boats…"], ["leg-pending", "leg-pending"]]);
    await selectLeg(user, 1);
    expect(facts()).toEqual(["Stops: Start → Waypoint 1", "Result: Finding walking paths…"]);
    await selectLeg(user, 2);
    expect(facts()).toEqual(["Stops: Waypoint 1 → Destination", "Result: Trying boats…"]);
  });

  it("keeps a finished leg through a cancel, and marks only the unfinished leg cancelled", async () => {
    const run = DEFAULT_MODES[0]!.name;
    const rides: RoutingEngine["route"] = (p, maxSlope, signal, onLegs) => {
      onLegs!([{ mode: run, leg: 0, result: { kind: "no-path", endpoint: "end" } }]);
      return route(p, maxSlope, signal);
    };
    routeGate = new Promise(() => {});
    const user = await mount(plan(A, W, B), () => Promise.resolve({ ok: true, engine: { ...engine, route: rides }, missing: [] }));
    await waitFor(() => expect(looks()).toEqual(["leg-failed", "leg-pending"]));
    await user.click(screen.getByRole("button", { name: "Cancel search" }));
    expect([chip(), labels(), looks()]).toEqual([
      "Search cancelled.",
      ["no-path at the leg's end", "Search cancelled."],
      ["leg-failed", "leg-pending"],
    ]);
    await selectLeg(user, 1);
    expect(facts()[1]).toBe("Result: No path: the end is blocked, too steep, or in water");
    await selectLeg(user, 2);
    expect(facts()).toEqual(["Stops: Waypoint 1 → Destination", "Result: Search cancelled."]);
    await user.click(stop("Waypoint 1"));
    expect(facts().slice(1)).toEqual([
      "Arrives by: leg 1, No path: the end is blocked, too steep, or in water",
      "Leaves by: leg 2, Search cancelled.",
    ]);
    await fromMenu(user, "Copy route as text");
    await screen.findByText("Copied the route as text");
    expect(JSON.parse(await navigator.clipboard.readText()).context.results).toEqual([
      { status: "no-path", endpoint: "end" },
      { status: "calculating" },
    ]);
  });

  it("shows a search that ends without a message as a route with no movement modes", async () => {
    const failing: RoutingEngine["route"] = async (p, working, maxSlope) => {
      await route(p, working, maxSlope);
      throw new Error("");
    };
    const user = await mount(plan(A, B), () => Promise.resolve({ ok: true, engine: { ...engine, route: failing }, missing: [] }));
    await waitFor(() => expect(chip()).toBe("No movement modes to route."));
    expect([busy(), document.querySelector(".route-chip")!.className]).toEqual([false, "route-chip route-error"]);
    await selectLeg(user, 1);
    expect(facts()).toEqual(["Stops: Start → Destination", "Result: No movement modes to route."]);
    await user.click(stop("Start"));
    expect(facts()[1]).toBe("Leaves by: leg 1, routing failed");
    await fromMenu(user, "Copy route as text");
    await screen.findByText("Copied the route as text");
    expect(JSON.parse(await navigator.clipboard.readText()).context.results).toEqual([
      { status: "failed", reason: "No movement modes to route." },
    ]);
  });

  it("selects a waypoint by pointer or keyboard, shows its leg times and actions, and returns focus on close", async () => {
    const user = await mount(plan(A, W, B));
    await waitFor(() => expect(chip()).toBe("20 s · 2,244 yd"));
    await user.click(stop("Waypoint 1"));
    expect(screen.getByRole("region", { name: "Waypoint 1" })).toBe(popover());
    expect(facts()).toEqual([
      "Point: world yards 1675.00, 2858.33",
      "Arrives by: leg 1, 10 s, 1,122 yd",
      "Leaves by: leg 2, 10 s, 1,122 yd",
    ]);
    expect(actions()).toEqual(["Remove", "Edit coordinates…", "Add stop after waypoint 1…"]);
    await user.click(within(popover()!).getByRole("button", { name: "Close" }));
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(stop("Waypoint 1"));

    stop("Start").focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "Start" })).toBe(popover());
    expect(facts()).toEqual(["Point: world yards 2716.67, 3275.00", "Leaves by: leg 1, 10 s, 1,122 yd"]);
    expect(actions()).toEqual(["Swap to destination", "Add stop after the start…"]);
    within(popover()!).getByRole("button", { name: "Swap to destination" }).focus();
    await user.keyboard("{Escape}");
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(stop("Start"));

    await user.click(stop("Waypoint 1"));
    await user.click(within(popover()!).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(stops()).toEqual([A, B]));
    expect(popover()).toBeNull();
    expect(document.activeElement!.closest(".map-zoom")).toBeTruthy();
  });

  it("selects a leg by pointer or keyboard, shows its result and settings, and returns focus on close", async () => {
    const user = await mount(plan(A, B));
    await waitFor(() => expect(chip()).toBe("10 s · 2,083 yd"));
    expect(leg(1).dataset.inView).toBe("true");
    await user.pointer({ keys: "[MouseLeft]", target: mapArea(), coords: client([3000, 3000]) });
    expect(screen.getByRole("region", { name: "Leg 1 of 1" })).toBe(popover());
    expect(leg(1).getAttribute("aria-pressed")).toBe("true");
    expect(facts()).toEqual([
      "Stops: Start → Destination",
      "Result: Terrain route",
      "Time: 10 s · 2,083 yd",
      "Swimming: None",
      "Steep descents: None",
    ]);
    expect(within(popover()!).queryByRole("button", { name: "About falls" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Follow terrain" })).toHaveProperty("checked", true);
    expect(screen.getByRole("checkbox", { name: "Downhill shortcuts" })).toHaveProperty("checked", true);
    await user.click(within(popover()!).getByRole("button", { name: "Close" }));
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(leg(1));

    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "Leg 1 of 1" })).toBe(popover());
    screen.getByRole("checkbox", { name: "Follow terrain" }).focus();
    await user.keyboard("{Escape}");
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(leg(1));
  });

  it("shows a leg's swimming", async () => {
    outcome = (from, to) => ({ ...terrainRoute([from, to]), swims: [0], swimDistance: 40, swimSeconds: 8.5 });
    const user = await mount(plan(A, B));
    await waitFor(() => expect(chip()).toBe("10 s · 2,083 yd"));
    await selectLeg(user, 1);
    expect(facts().slice(3)).toEqual(["Swimming: 40 yd, 9 s", "Steep descents: None"]);
  });

  it("shows each leg's own time when stops repeat, and no times while the plan routes again", async () => {
    outcome = (from, to, _leg, i) => ({
      kind: "straight",
      points: [from, to],
      distance: 100,
      activation: i === 0 ? 3 : 0,
      seconds: i === 0 ? 10.14 : 7.14,
    });
    const user = await mount(plan(A, B, A, B));
    await waitFor(() => expect(chip()).toBe("about 24 s · 300 yd · 3 straight legs"));
    await user.click(stop("Waypoint 2"));
    expect(facts().slice(1)).toEqual(["Arrives by: leg 2, 7 s, 100 yd (estimate)", "Leaves by: leg 3, 7 s, 100 yd (estimate)"]);
    await user.click(stop("Waypoint 1"));
    expect(facts()[1]).toBe("Arrives by: leg 1, 10 s, 100 yd (estimate)");

    let release = () => {};
    routeGate = new Promise((resolve) => (release = resolve));
    await selectLeg(user, 1);
    await user.click(screen.getByRole("checkbox", { name: "Follow terrain" }));
    await waitFor(() => expect(chip()).toBe("Finding walking paths…"));
    expect(facts()).toEqual(["Stops: Start → Waypoint 1", "Result: Finding walking paths…"]);
    release();
    await waitFor(() => expect(facts()[2]).toBe("Time: 10 s · 100 yd (estimate)"));
  });

  it("drops the legs that a search reports after a new slope replaced it", async () => {
    onTestFinished(() => saveMaxSlope(DEFAULT_MAX_SLOPE));
    const run = DEFAULT_MODES[0]!.name;
    const reports: ((updates: LegUpdate[]) => void)[] = [];
    const streams: RoutingEngine["route"] = (p, maxSlope, signal, onLegs) => {
      reports.push(onLegs!);
      return route(p, maxSlope, signal);
    };
    routeGate = new Promise(() => {});
    const user = await mount(plan(A, W, B), () => Promise.resolve({ ok: true, engine: { ...engine, route: streams }, missing: [] }));
    await user.clear(slopeField());
    await user.type(slopeField(), "20");
    await waitFor(() => expect(lastSlope()).toBe(20));
    act(() => reports[1]!([{ mode: run, leg: 0, result: terrainRoute([A, W]) }]));
    expect(looks()).toEqual(["leg-route", "leg-pending"]);

    act(() => reports[0]!([{ mode: run, leg: 1, result: terrainRoute([W, B]) }]));
    expect([reports.length, looks()]).toEqual([2, ["leg-route", "leg-pending"]]);
  });

  it("stops the route search when Routes closes", async () => {
    routeGate = new Promise(() => {});
    await mount(plan(A, B));
    const signal = route.mock.calls.at(-1)![2]!;
    expect(signal.aborted).toBe(false);
    cleanup();
    await waitFor(() => expect(signal.aborted).toBe(true));
  });

  it("routes every plan with one saved slope, and a new slope stops the earlier search", async () => {
    onTestFinished(() => saveMaxSlope(DEFAULT_MAX_SLOPE));
    await savePlan(createPlan(world(B), world(A), "second"));
    let user = await mount(plan(A, B));
    await waitFor(() => expect(chip()).not.toBe("Finding walking paths…"));
    expect(lastSlope()).toBe(DEFAULT_MAX_SLOPE);
    expect(screen.getByRole("region", { name: "Route tools" }).querySelector(".route-slope")!.textContent).toBe("Max slope°");
    expect(slopeField().value).toBe("50");

    let open = () => {};
    routeGate = new Promise<void>((resolve) => (open = resolve));
    await user.clear(slopeField());
    await user.type(slopeField(), "20");
    await waitFor(() => expect(lastSlope()).toBe(20));
    expect(chip()).toBe("Finding walking paths…");
    const earlier = route.mock.calls.at(-1)!;
    await user.clear(slopeField());
    await user.type(slopeField(), "120{Enter}");
    expect(slopeField().value).toBe("89");
    expect(earlier[2]!.aborted).toBe(true);
    expect(route.mock.calls.map((call) => call[1])).toEqual([DEFAULT_MAX_SLOPE, 20, 89]);
    open();
    await waitFor(() => expect(chip()).not.toBe("Finding walking paths…"));
    await user.clear(slopeField());
    await user.tab();
    expect(slopeField().value).toBe("89");
    expect(route).toHaveBeenCalledTimes(3);

    cleanup();
    route.mockClear();
    user = await mount(undefined, undefined, await savedStores());
    await waitFor(() => expect(route).toHaveBeenCalled());
    expect([lastRouted().id, lastSlope(), slopeField().value]).toEqual(["2026-10-03T00:00:00.000Z", 89, "89"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Route plan" }), "second");
    await waitFor(() => expect(lastRouted().id).toBe("second"));
    expect(lastSlope()).toBe(89);
  });

  it("routes only the travel mode, Run unless the user chose another, and keeps each mode's result", async () => {
    onTestFinished(() => saveTravelMode(DEFAULT_MODE));
    let user = await mount(plan(A, B));
    const mode = () => screen.getByRole<HTMLSelectElement>("combobox", { name: "Mode" });
    const modes = () => route.mock.calls.map((call) => call[5]);
    await waitFor(() => expect(chip()).toBe("10 s · 2,083 yd"));
    expect([mode().value, [...mode().options].map((o) => o.text), modes()]).toEqual(["Run", DEFAULT_MODES.map((m) => m.name), ["Run"]]);

    let open = () => {};
    routeGate = new Promise<void>((resolve) => (open = resolve));
    await user.selectOptions(mode(), "Epic mount");
    expect([chip(), busy(), modes()]).toEqual(["Finding walking paths…", true, ["Run", "Epic mount"]]);
    open();
    await waitFor(() => expect(chip()).toBe("10 s · 2,083 yd"));
    expect(factsOf(routePanel()!)[1]).toBe("Mode: Epic mount");

    await user.selectOptions(mode(), "Run");
    expect([chip(), busy(), factsOf(routePanel()!)[1], modes()]).toEqual(["10 s · 2,083 yd", false, "Mode: Run", ["Run", "Epic mount"]]);

    await user.selectOptions(mode(), "Epic mount");
    cleanup();
    route.mockClear();
    user = await mount(undefined, undefined, await savedStores());
    await waitFor(() => expect(route).toHaveBeenCalled());
    expect([modes(), mode().value]).toEqual([["Epic mount"], "Epic mount"]);
  });
});
