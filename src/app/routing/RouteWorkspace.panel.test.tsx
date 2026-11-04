// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { Point } from "../../routing/frame.ts";
import type { LegResult } from "../../routing/search.ts";
import { zoomTo } from "../map/viewport.ts";
import { cascade } from "../ui/testing.ts";
import { frameAround } from "./lines.ts";
import {
  proj,
  A,
  W,
  B,
  terrainRoute,
  type Outcome,
  defaultOutcome,
  controlRoute,
  route,
  rectOf,
  mount,
  plan,
  client,
  mapArea,
  stageView,
  shownView,
  stop,
  popover,
  routePanel,
  factsOf,
  facts,
  stepLists,
  summaryButton,
  chip,
  leg,
  fromMenu,
  selectLeg,
  viewAt,
  legLine,
} from "./routeWorkspaceFixture.tsx";

let outcome: Outcome;
let routeGate: Promise<void>;
beforeEach(() => {
  outcome = defaultOutcome;
  routeGate = Promise.resolve();
});
controlRoute({ outcome: () => outcome, routeGate: () => routeGate });

describe("route panel", () => {
  const ground = (from: Point, to: Point) => ({ kind: "ground", map: 0, from, to, result: terrainRoute([from, to]) });
  const dock: Point = [2500, 3000];
  const harbor: Point = [2800, 3200];
  const rideShip = () => {
    const at = (id: string, point: Point) => ({ id, name: id, map: 0, point });
    const ship = {
      service: "ship-southshore-loop",
      mode: "ship",
      from: at("Menethil Harbor", dock),
      to: at("Southshore Harbor", harbor),
      requires: { faction: "Alliance" },
      seconds: { min: 10, average: 30, max: 60 },
    };
    outcome = (from, to, _leg, i) =>
      i === 0
        ? ({
            kind: "transport",
            parts: [ground(from, dock), { kind: "ride", link: ship }, ground(harbor, to)],
            seconds: 50,
          } as unknown as LegResult)
        : terrainRoute([from, to]);
  };
  const rows = () =>
    within(routePanel()!)
      .getAllByRole("button", { name: /^Show leg / })
      .map((row) => {
        const steps = row.closest("li")!.querySelector("ol");
        return [
          row.getAttribute("aria-label"),
          document.getElementById(row.getAttribute("aria-describedby")!)!.textContent,
          ...(steps ? [[...steps.children].map((step) => step.textContent)] : []),
        ];
      });

  it("shows the stops, mode, and total, then a row for each leg with its pins, rides, distance, and one time", async () => {
    rideShip();
    await mount(plan(A, W, B));
    await waitFor(() => expect(chip()).toBe("1 min 0 s · 1,937 yd"));
    const panel = routePanel()!;
    expect(factsOf(panel)).toEqual(["Stops: Start → Destination", "Mode: Run", "Total: 1 min 0 s · 1,937 yd"]);
    expect(rows()).toEqual([
      [
        "Show leg 1 on the map: Start to Waypoint 1, 50 s",
        expect.stringMatching(/^Ship · [\d,]+ yd$/),
        ["Run to the ship10 s", "Ship to Southshore HarborVaries: 10 s to 1 min 0 s30 s", "Run to waypoint 110 s"],
      ],
      ["Show leg 2 on the map: Waypoint 1 to Destination, 10 s", "1,122 yd"],
    ]);
    expect([...panel.querySelectorAll(".route-leg-pins")].map((pins) => pins.textContent)).toEqual(["A1", "1B"]);
    expect(within(panel).getByRole("button", { name: "Show step 2 of leg 1 on the map: Ship to Southshore Harbor, 30 s" })).toBeTruthy();
    expect(within(panel).queryByRole("checkbox")).toBeNull();
  });

  it("makes each step at least 24px tall in the summary and the leg, so no step's hit area reaches into the next", async () => {
    rideShip();
    const user = await mount(plan(A, W, B));
    await waitFor(() => expect(chip()).toBe("1 min 0 s · 1,937 yd"));
    const floors = (card: HTMLElement) =>
      within(card)
        .getAllByRole("button", { name: /^Show step / })
        .map((step) => cascade(step, "min-height")?.value);
    const summary = floors(routePanel()!);
    await selectLeg(user, 1);
    const small = "var(--control-small)";
    expect([summary, floors(popover()!)]).toEqual([
      [small, small, small],
      [small, small, small],
    ]);
  });

  it("shows a leg or a step on the map without a new search, and stops on a second click, Escape, or a click on the empty map", async () => {
    rideShip();
    const user = await mount(plan(A, W, B));
    await waitFor(() => expect(chip()).toBe("1 min 0 s · 1,937 yd"));
    const searches = route.mock.calls.length;
    const row = (n: number) => within(routePanel()!).getByRole("button", { name: new RegExp(`^Show leg ${n} `) });
    const step = (card: HTMLElement, n: number) => within(card).getByRole("button", { name: new RegExp(`^Show step ${n} of leg 1 `) });
    const band = () => document.querySelector(".route-focus polyline")?.getAttribute("points");
    const transform = stageView;
    expect(band()).toBeUndefined();

    await user.click(row(2));
    expect(row(2).getAttribute("aria-pressed")).toBe("true");
    expect(band()).toBe(legLine(2).points);
    const shown = frameAround([proj.toView(W, 0)!, proj.toView(B, 0)!], 1)!;
    const { s, tx, ty } = zoomTo(
      { ...shown, inset: { top: 12, right: 60, bottom: 84, left: 12 } },
      { vw: 1000, vh: 1000, w: 1000, h: 1000 },
      40,
    );
    expect(transform()).toBe(`translate(${tx}px, ${ty}px) scale(${s})`);

    await user.click(step(routePanel()!, 2));
    expect([row(2).getAttribute("aria-pressed"), step(routePanel()!, 2).getAttribute("aria-pressed")]).toEqual(["false", "true"]);
    expect(band()).toBe(`${viewAt(dock)} ${viewAt(harbor)}`);
    await user.click(step(routePanel()!, 1));
    expect(band()).toBe(`${viewAt(A)} ${viewAt(dock)}`);
    await user.click(step(routePanel()!, 1));
    expect([band(), step(routePanel()!, 1).getAttribute("aria-pressed")]).toEqual([undefined, "false"]);

    row(1).focus();
    await user.keyboard("{Enter}");
    expect(band()).toBe(legLine(1).points);
    await user.keyboard("{Escape}");
    expect([band(), row(1).getAttribute("aria-pressed")]).toEqual([undefined, "false"]);
    await user.keyboard("{Escape}");
    expect(routePanel()).toBeNull();
    await user.click(summaryButton());

    await user.click(row(1));
    await user.pointer({ keys: "[MouseLeft]", target: mapArea(), coords: client([3000, 2000]) });
    expect(band()).toBeUndefined();
    expect(routePanel()).not.toBeNull();

    await user.click(within(routePanel()!).getByRole("button", { name: "Open leg 1" }));
    expect(screen.getByRole("region", { name: "Leg 1 of 2" })).toBe(popover());
    await user.click(step(popover()!, 2));
    expect(band()).toBe(`${viewAt(dock)} ${viewAt(harbor)}`);
    expect(route.mock.calls.length).toBe(searches);
  });

  it("stops the leg focus when the selection changes, so closing a stop's popover does not show the leg again", async () => {
    const user = await mount(plan(A, W, B));
    await waitFor(() => expect(chip()).toBe("20 s · 2,244 yd"));
    const row = () => within(routePanel()!).getByRole("button", { name: /^Show leg 1 / });
    const band = () => document.querySelector(".route-focus polyline")?.getAttribute("points");
    await user.click(row());
    expect([row().getAttribute("aria-pressed"), band()]).toEqual(["true", legLine(1).points]);

    stop("Start").focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "Start" })).toBe(popover());
    await user.click(within(popover()!).getByRole("button", { name: "Close" }));
    expect([row().getAttribute("aria-pressed"), band()]).toEqual(["false", undefined]);
  });

  it("fits a leg above the strip, and stops an upward pan at the middle above it, when the map runs behind the strip's row", async () => {
    const [vw, vh, strip] = [418, 1120, 388];
    document.body.style.setProperty("--panel-cover", `${strip}px`);
    onTestFinished(() => void document.body.style.removeProperty("--panel-cover"));
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      if (this.matches(".map-viewport")) return DOMRect.fromRect({ width: vw, height: vh });
      if (this.matches(".map-popover")) return DOMRect.fromRect({ x: 12, y: vh - strip + 12, width: vw - 24, height: 300 });
      return this.matches(".route-corner, .coord-readout") ? DOMRect.fromRect({ y: vh - 84, width: vw, height: 72 }) : rectOf(this);
    });
    rideShip();
    const user = await mount(plan(A, W, B));
    await waitFor(() => expect(chip()).toBe("1 min 0 s · 1,937 yd"));

    await user.click(within(routePanel()!).getByRole("button", { name: /^Show leg 1 / }));
    const view = () =>
      stageView()
        .match(/translate\((.+)px, (.+)px\) scale\((.+)\)/)!
        .slice(1)
        .map(Number);
    const [tx, ty, s] = view();
    const onScreen = [A, W].map((p) => {
      const { x, y } = proj.toView(p, 0)!;
      return [tx! + (x / 100) * vw * s!, ty! + (y / 100) * vw * s!];
    });
    const clear = { left: 12, top: 12, right: vw - 60, bottom: vh - strip - 12 };
    expect(onScreen.every(([x, y]) => x! >= clear.left && x! <= clear.right && y! >= clear.top && y! <= clear.bottom)).toBe(true);
    expect(s).toBeGreaterThan(1);

    const viewport = document.querySelector(".map-viewport")!;
    fireEvent.pointerDown(viewport, { button: 0, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(viewport, { clientX: 200, clientY: 100 - 10 * vh });
    fireEvent.pointerUp(viewport, { clientX: 200, clientY: 100 - 10 * vh });
    expect(view()[1]! + vw * view()[2]!).toBeCloseTo(366);
  });

  it("keeps the strip's height on the route map as the strip resizes, so a narrow map's cover follows the strip", async () => {
    const observed = new Map<Element, (() => void)[]>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        callback: () => void;
        constructor(callback: () => void) {
          this.callback = callback;
        }
        observe(target: Element) {
          observed.set(target, [...(observed.get(target) ?? []), this.callback]);
        }
        disconnect() {}
      },
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    let height = 57;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      return this.matches(".route-strip") ? DOMRect.fromRect({ width: 400, height }) : rectOf(this);
    });
    await mount(plan(A, W, B));
    const strip = document.querySelector(".route-strip")!;
    const map = () => document.querySelector<HTMLElement>(".route-map")!.style.getPropertyValue("--strip-h");
    expect(map()).toBe("57px");

    height = 80;
    act(() => observed.get(strip)?.forEach((resized) => resized()));
    expect(map()).toBe("80px");
  });

  it("grows a clipped Route card back when the strip's bound grows, though the strip's own box keeps its height", async () => {
    const observed = new Map<Element, (() => void)[]>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        callback: () => void;
        constructor(callback: () => void) {
          this.callback = callback;
        }
        observe(target: Element) {
          observed.set(target, [...(observed.get(target) ?? []), this.callback]);
        }
        disconnect() {}
      },
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    let room = 90;
    const height = (body: HTMLElement) => (body.style.maxHeight ? parseFloat(body.style.maxHeight) : room);
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
      return this.matches(".map-popover-body") ? 300 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.matches(".map-popover-body") ? height(this) : 0;
    });
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      if (this.matches(".map-popover-body")) return DOMRect.fromRect({ width: 300, height: height(this) });
      if (this.matches(".map-popover-body :is(dd, li)")) return DOMRect.fromRect({ y: 10, width: 300, height: 30 });
      return rectOf(this);
    });
    await mount(plan(A, W, B));
    const body = await waitFor(() => routePanel()!.querySelector<HTMLElement>(".map-popover-body")!);
    const clipped = () => [body.style.maxHeight, body.hasAttribute("data-clipped")];
    expect(clipped()).toEqual(["40px", true]);

    room = 500;
    const bound = document.querySelector(".route-strip > .map-top-bound");
    act(() => observed.get(bound!)?.forEach((fit) => fit()));
    expect(clipped()).toEqual(["", false]);
  });

  it("keeps the focus on a leg row while the map narrows past 1000 px and widens again", async () => {
    const resized: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    let width = 1300;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      return this.matches(".route-map, .map-viewport") ? DOMRect.fromRect({ width, height: 770 }) : rectOf(this);
    });
    const resize = (to: number) => {
      width = to;
      act(() => resized.forEach((callback) => callback()));
    };
    await mount(plan(A, W, B));
    await waitFor(() => expect(chip()).toBe("20 s · 2,244 yd"));
    const row = within(routePanel()!).getByRole("button", { name: /^Show leg 2 / });
    row.focus();

    resize(490);
    expect(document.activeElement).toBe(row);
    resize(1300);
    expect(document.activeElement).toBe(row);
  });

  it("fits a saved route once to its stops, then keeps the view as its route arrives, its panel grows, and the map resizes", async () => {
    const resized: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    let [tall, height] = [250, 1000];
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("map-popover"))
        return DOMRect.fromRect({ width: 1000, height: this.textContent.includes("Total") ? tall : 100 });
      return this.classList.contains("map-viewport") ? DOMRect.fromRect({ width: 1000, height }) : rectOf(this);
    });
    outcome = (from, to) => terrainRoute([from, [3000, 4200], to]);
    let release = () => {};
    routeGate = new Promise((resolve) => (release = resolve));
    await mount(plan(A, B));
    await waitFor(() => expect(routePanel()).not.toBeNull());
    expect(shownView()).toEqual({ center: [3072, 2956], zoom: 12.05 });

    tall = 400;
    release();
    await waitFor(() => expect(chip()).toBe("10 s · 3,254 yd"));
    expect(shownView()).toEqual({ center: [3072, 2956], zoom: 12.05 });

    height = 1200;
    act(() => resized.forEach((callback) => callback()));
    expect(shownView(1200)).toEqual({ center: [3072, 2956], zoom: 12.05 });
  });

  it.each(["Clear route", "New route"])(
    "keeps the whole map's size and center on screen at the minimum zoom when %s closes the panel and the map grows",
    async (item) => {
      const resized: (() => void)[] = [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: () => void) {
            resized.push(callback);
          }
          observe() {}
          disconnect() {}
        },
      );
      onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("map-viewport")
          ? DOMRect.fromRect({ width: 1000, height: routePanel() ? 600 : 1000 })
          : rectOf(this);
      });
      const user = await mount(plan(A, B));
      await waitFor(() => expect(chip()).toBe("10 s · 2,083 yd"));
      act(() => resized.forEach((callback) => callback()));
      await user.click(screen.getByRole("button", { name: "Reset zoom" }));
      expect(stageView()).toBe("translate(0px, 0px) scale(1)");

      await fromMenu(user, item);
      expect(routePanel()).toBeNull();
      act(() => resized.forEach((callback) => callback()));
      expect(stageView()).toBe("translate(0px, 200px) scale(0.6)");
    },
  );

  it("keeps the route clear of the chip and the coordinate readout at their measured height", async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("map-popover") ? DOMRect.fromRect({ width: 1000, height: 100 }) : rectOf(this, 137);
    });
    await mount(plan(A, B));
    await waitFor(() => expect(chip()).toBe("10 s · 2,083 yd"));
    const { s, tx, ty } = zoomTo(
      { ...frameAround([proj.toView(A, 0)!, proj.toView(B, 0)!], 1)!, inset: { top: 112, right: 60, bottom: 149, left: 12 } },
      { vw: 1000, vh: 1000, w: 1000, h: 1000 },
      40,
    );
    expect(stageView()).toBe(`translate(${tx}px, ${ty}px) scale(${s})`);
  });

  it("moves between legs with Previous leg and Next leg, which keep focus at the first and last leg", async () => {
    const user = await mount(plan(A, W, B));
    await waitFor(() => expect(chip()).toBe("20 s · 2,244 yd"));
    await selectLeg(user, 1);
    const move = (name: string) => within(popover()!).getByRole("button", { name });
    expect(screen.getByRole("region", { name: "Leg 1 of 2" })).toBe(popover());
    expect(move("Previous leg").getAttribute("aria-disabled")).toBe("true");
    await user.click(move("Previous leg"));
    expect(screen.getByRole("region", { name: "Leg 1 of 2" })).toBe(popover());

    move("Next leg").focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "Leg 2 of 2" })).toBe(popover());
    expect(facts()[0]).toBe("Stops: Waypoint 1 → Destination");
    expect(leg(2).getAttribute("aria-pressed")).toBe("true");
    expect(move("Next leg").getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "Leg 2 of 2" })).toBe(popover());
    expect(document.activeElement).toBe(move("Next leg"));
    await user.click(move("Previous leg"));
    expect(screen.getByRole("region", { name: "Leg 1 of 2" })).toBe(popover());
  });

  it("shows a flight over several flight points as one step, the same as the leg panel", async () => {
    const at = (id: string, point: Point, air?: true) => ({ id, name: id, map: 0, point, ...(air && { air }) });
    const [booty, mid, city] = [at("Booty Bay", [2500, 3000]), at("Sentinel Hill", [2600, 3100]), at("Stormwind", [2800, 3200])];
    const link = (from: ReturnType<typeof at>, to: ReturnType<typeof at>, seconds: number, estimate?: true) => ({
      service: `${from.id} > ${to.id}`,
      mode: "flight",
      from,
      to,
      requires: { faction: "Alliance" },
      seconds: { min: seconds, average: seconds, max: seconds },
      ...(estimate && { estimate }),
    });
    const [bootyAir, midAir, cityAir] = [
      at("Booty Bay", booty.point, true),
      at("Sentinel Hill", mid.point, true),
      at("Stormwind", city.point, true),
    ];
    const flight = [link(booty, bootyAir, 3), link(bootyAir, midAir, 30, true), link(midAir, cityAir, 30, true), link(cityAir, city, 0)];
    const ground = (from: Point, to: Point) => ({ kind: "ground", map: 0, from, to, result: terrainRoute([from, to]) });
    outcome = (from, to) =>
      ({
        kind: "transport",
        parts: [ground(from, booty.point), ...flight.map((l) => ({ kind: "ride", link: l })), ground(city.point, to)],
        seconds: 83,
      }) as unknown as LegResult;
    const user = await mount(plan(A, B));
    await waitFor(() => expect(chip()).not.toBe("Finding walking paths…"));
    const steps = [
      "Run to the flight master10 s",
      "Fly to StormwindEstimate from the flight length1 min 3 s",
      "Run to the destination10 s",
    ];
    expect(stepLists(routePanel()!)[1]).toEqual(["Steps of leg 1", steps]);
    expect(routePanel()!.querySelector(".route-ride")!.closest("li")!.getAttribute("data-mode")).toBe("flight");

    await selectLeg(user, 1);
    expect(stepLists(popover()!)).toEqual([["Steps", steps]]);
  });

  it("says when a leg is calculating or has no path, in place of a total", async () => {
    let release = () => {};
    routeGate = new Promise((resolve) => (release = resolve));
    outcome = (from, to, _leg, i) => (i === 0 ? { kind: "no-path", endpoint: "end" } : terrainRoute([from, to]));
    await mount(plan(A, W, B));
    expect(factsOf(routePanel()!).slice(1)).toEqual(["Mode: Run", "Result: Finding walking paths…"]);
    expect(rows().map(([, line]) => line)).toEqual(["Finding walking paths…", "Finding walking paths…"]);
    release();
    await waitFor(() => expect(chip()).toBe("no route · no path on leg 1"));
    expect(factsOf(routePanel()!).slice(1)).toEqual(["Mode: Run", "Result: No route · no path on leg 1", "Total: unknown"]);
    expect(rows()).toEqual([
      ["Show leg 1 on the map: Start to Waypoint 1", "No path: the end is blocked, too steep, or in water"],
      ["Show leg 2 on the map: Waypoint 1 to Destination, 10 s", "1,122 yd"],
    ]);
  });

  it("names a stop without terrain apart from a leg without a path", async () => {
    outcome = (_from, _to, _leg, i) => (i === 0 ? { kind: "no-terrain", endpoint: "start" } : { kind: "no-path", endpoint: "end" });
    await mount(plan(A, W, B));
    await waitFor(() => expect(chip()).toBe("no route · no terrain at the start of leg 1 · no path on leg 2"));
    expect(factsOf(routePanel()!).slice(1)).toEqual([
      "Mode: Run",
      "Result: No route · no terrain at the start of leg 1 · no path on leg 2",
      "Total: unknown",
    ]);
    expect(rows().map(([, line]) => line)).toEqual(["No terrain at the start", "No path: the end is blocked, too steep, or in water"]);
  });

  it("gives way to a selection, and stays closed until Summary opens it or the route changes", async () => {
    const user = await mount(plan(A, B));
    await waitFor(() => expect(chip()).toBe("10 s · 2,083 yd"));
    expect(rows()).toEqual([["Show leg 1 on the map: Start to Destination, 10 s", "2,083 yd"]]);
    expect(summaryButton().getAttribute("aria-pressed")).toBe("true");

    await selectLeg(user, 1);
    expect(routePanel()).toBeNull();
    expect(summaryButton().getAttribute("aria-pressed")).toBe("false");
    await user.keyboard("{Escape}");
    expect(routePanel()).not.toBeNull();

    await user.click(within(routePanel()!).getByRole("button", { name: "Close" }));
    expect(routePanel()).toBeNull();
    expect(document.activeElement).toBe(summaryButton());
    await selectLeg(user, 1);
    await user.keyboard("{Escape}");
    expect(routePanel()).toBeNull();

    await selectLeg(user, 1);
    await user.click(summaryButton());
    expect(popover()).toBeNull();
    expect(routePanel()).not.toBeNull();
    expect(leg(1).getAttribute("aria-pressed")).toBe("false");
    await user.click(summaryButton());
    expect(routePanel()).toBeNull();

    await selectLeg(user, 1);
    await user.click(screen.getByRole("checkbox", { name: "Downhill shortcuts" }));
    await user.click(within(popover()!).getByRole("button", { name: "Close" }));
    expect(routePanel()).not.toBeNull();
  });
});
