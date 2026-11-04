import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, type RefObject } from "react";
import { afterEach, beforeEach, expect, onTestFinished, vi } from "vitest";
import { decodeInteriorsFile, type Interior } from "../../../packages/data-contract/interiors.ts";
import { decodeTransportsFile } from "../../../packages/data-contract/transports.ts";
import * as datasetLoader from "../../data/dataset.ts";
import { fromSurfaces } from "../../data/surfaces.ts";
import type { GameData, LoadedWorldMap } from "../../data/index.ts";
import { groundSurfaces, interiorsFixture } from "../../data/manifestFixture.ts";
import { zoneData } from "../../data/plannerFixture.ts";
import { worldMap } from "../../data/terrainFixture.ts";
import { at } from "../../routing/fixtures/region.ts";
import { syntheticScope } from "../../routing/fixtures/synthetic.ts";
import { nativeStop, nativeToWorld, worldToNative, type Point } from "../../routing/frame.ts";
import type { Journey, JourneyLeg, Journeys } from "../../routing/journey.ts";
import { createPlan, DEFAULT_MODES, insertWaypoint, type Leg, type RoutePlan, type WorldStop } from "../../routing/plan.ts";
import type { LegResult, TerrainRoute } from "../../routing/search.ts";
import { deletePlan, loadPlans, savePlan } from "../../storage/routing.ts";
import { GameDataContext, StoresContext, type Stores } from "../context.ts";
import { fixtureArtifact, unrelatedEntities } from "../renderPlanner.tsx";
import { createStores, loadSettings } from "../stores.ts";
import type { RoutingEngine, RoutingLoad } from "./engine.ts";
import { projection } from "./lines.ts";
import ironforgeSurfaces from "./fixtures/ironforge-surfaces.json" with { type: "json" };
import ridesJson from "./fixtures/rides.json" with { type: "json" };
import { RouteWorkspace } from "./RouteWorkspace.tsx";
import type { ClosedRoute } from "./useRouteFit.ts";

export const manifest: RoutingEngine["manifest"] = {
  id: "routing-test-m0",
  scope: syntheticScope(),
  frame: { origin: [23, 20], size: [23, 42], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
  tiles: [{ tile: [3, 5], state: "present" }],
};
export const proj = projection(worldMap, [manifest]);
export const transports = decodeTransportsFile(ridesJson);
export const A: Point = [2000, 3000];
export const W: Point = [3000, 3400];
export const B: Point = [4000, 3000];
export const world = (p: Point, height: number | null = null) => at(p, height, manifest);
export const pixel = (stop: WorldStop): Point => nativeStop(manifest, stop).point;
export const pixelsOf = (p: RoutePlan) => p.stops.map(pixel);
export const heightsOf = (p: RoutePlan) => p.stops.map((stop) => stop.height);
export const withHeights = (p: RoutePlan, heights: (number | null)[]): RoutePlan => ({
  ...p,
  stops: p.stops.map((stop, i) => ({ ...stop, height: heights[i]! })),
});
export const typed = (p: Point) => {
  const { x, y } = nativeToWorld(manifest, p);
  return `${x.toFixed(2)}, ${y.toFixed(2)}`;
};

export const terrainRoute = (points: Point[]): TerrainRoute => ({
  kind: "route",
  points,
  descents: [],
  descentDrop: 0,
  falls: [],
  swims: [],
  swimDistance: 0,
  swimSeconds: 0,
  swimRemounts: [],
  distance: 100,
  terrainSeconds: 10,
  activation: 0,
  seconds: 10,
});
export type Outcome = (from: Point, to: Point, leg: Leg, i: number) => LegResult;
export const defaultOutcome: Outcome = (from, to, leg) =>
  leg.followTerrain ? terrainRoute([from, to]) : { kind: "straight", points: [from, to], distance: 100, activation: 0, seconds: 10 };
let control = { outcome: () => defaultOutcome, routeGate: () => Promise.resolve() };
export function controlRoute(getters: Partial<typeof control>) {
  control = { ...control, ...getters };
}
export const route = vi.fn<RoutingEngine["route"]>(async (plan, _slope, _signal, _onLegs, _rides, mode): Promise<Journeys> => {
  await control.routeGate();
  const legs = plan.legs.map((leg, i): JourneyLeg =>
    plan.stops[i]!.instance === plan.stops[i + 1]!.instance
      ? control.outcome()(pixel(plan.stops[i]!), pixel(plan.stops[i + 1]!), leg, i)
      : { kind: "crossing" },
  );
  const complete = legs.every((l) => l.kind === "route" || l.kind === "straight" || l.kind === "crossing");
  const journey: Journey = {
    mode: DEFAULT_MODES.find((m) => m.name === mode) ?? DEFAULT_MODES[0]!,
    legs,
    ...(complete && { seconds: legs.reduce((s, l) => s + ("seconds" in l ? l.seconds : 0), 0) }),
  };
  return { journeys: [journey], ...(complete && { fastest: journey }) };
});
export const engine: RoutingEngine = { manifest, route, maps: [{ manifest }], release: () => {} };
export const lastRouted = () => route.mock.calls.at(-1)![0];
export const lastSlope = () => route.mock.calls.at(-1)![1];
export const slopeField = () => screen.getByRole<HTMLInputElement>("spinbutton", { name: "Max slope in degrees" });

// jsdom does no layout: every element is a 1000px square at the origin, so
// client pixels are tenths of stage percentages.
export const rectOf = (element: HTMLElement, bar = 72) =>
  DOMRect.fromRect(
    element.matches(".route-corner, .coord-readout") ? { y: 1000 - bar, width: 1000, height: bar } : { width: 1000, height: 1000 },
  );
beforeEach(async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return rectOf(this);
  });
  route.mockClear();
  for (const plan of await loadPlans()) await deletePlan(plan.id);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const loaded = (): Promise<RoutingLoad> => Promise.resolve({ ok: true, engine, missing: [] });

export const savedStores = async (load = loaded) => createStores(undefined, undefined, await loadSettings(), { loadRouting: load });

async function selectTransports(stores: Stores, map: LoadedWorldMap) {
  const artifact = fixtureArtifact(zoneData([]), unrelatedEntities, map);
  vi.spyOn(datasetLoader, "fetchDatasetArtifact").mockResolvedValue({ ...artifact, data: { ...artifact.data, transports } });
  stores.dataset.select({ manifest: "/fixture/manifest.json", base: "/fixture/" });
  await waitFor(() => expect(stores.dataset.getState().data?.transports).toBe(transports));
}

export async function mount(
  plan?: RoutePlan,
  load = loaded,
  stores = createStores(undefined, undefined, undefined, { loadRouting: load }),
  data: GameData | null = null,
  map: LoadedWorldMap = worldMap,
  strict = false,
  closed?: RefObject<ClosedRoute | null>,
) {
  if (plan) await savePlan(plan);
  await selectTransports(stores, map);
  const user = userEvent.setup();
  const workspace = (
    <StoresContext.Provider value={stores}>
      <GameDataContext.Provider value={data}>
        <RouteWorkspace map={map} surface={{ aspect: 1, maxZoom: () => 40 }} closed={closed} />
      </GameDataContext.Provider>
    </StoresContext.Provider>
  );
  render(strict ? <StrictMode>{workspace}</StrictMode> : workspace);
  if (plan) await waitFor(() => expect(route).toHaveBeenCalled());
  return user;
}
export async function mountRoutes(closed: RefObject<ClosedRoute | null>) {
  const stores = createStores(undefined, undefined, undefined, { loadRouting: loaded });
  await selectTransports(stores, worldMap);
  render(
    <StrictMode>
      <StoresContext.Provider value={stores}>
        <RouteWorkspace map={worldMap} surface={{ aspect: 1, maxZoom: () => 40 }} closed={closed} />
      </StoresContext.Provider>
    </StrictMode>,
  );
  return userEvent.setup();
}

export const plan = (...stops: Point[]) => {
  let p = createPlan(world(stops[0]!), world(stops.at(-1)!), "2026-10-03T00:00:00.000Z");
  for (const [i, stop] of stops.slice(1, -1).entries()) p = insertWaypoint(p, i, world(stop));
  return p;
};
export const client = (p: Point) => {
  const at = proj.toView(p, 0)!;
  return { clientX: at.x * 10, clientY: at.y * 10 };
};
export const mapArea = () => screen.getByRole("group", { name: /^Route map/ });
export const stageView = () =>
  `${document.querySelector<HTMLElement>(".map-stage")!.style.getPropertyValue("--pan")} scale(${document.querySelector<HTMLElement>(".map-viewport")!.style.getPropertyValue("--zoom")})`;
export const shownView = (height = 1000) => {
  const [tx, ty, s] = stageView()
    .match(/-?[\d.]+/g)!
    .map(Number) as [number, number, number];
  const middle = proj.toStop({ x: (500 - tx) / (10 * s), y: (height / 2 - ty) / (10 * s) })!;
  return { center: worldToNative(manifest, middle)!.map(Math.round), zoom: Math.round(s * 100) / 100 };
};
export const stop = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name} at world yards`) });
export const stops = () => pixelsOf(lastRouted());
export const looks = () => [...document.querySelectorAll(".route-lines .route-leg")].map((l) => l.getAttribute("class")!.split(" ")[1]);
export const saved = async () => (await loadPlans())[0]!;
export const menuItems = (menu = screen.getByRole("menu")) =>
  [...menu.querySelectorAll("[role^=menuitem]")].map((item) => item.textContent);
export type User = ReturnType<typeof userEvent.setup>;
export const rightClick = (user: User, p: Point) => user.pointer({ keys: "[MouseRight]", target: mapArea(), coords: client(p) });
export const choose = (user: User, item: string) => user.click(screen.getByRole("menuitem", { name: item }));
export const labels = () => [...document.querySelectorAll(".route-label")].map((l) => l.textContent);
export const popover = () => document.querySelector<HTMLElement>(".map-popover:not(.route-summary)");
export const routePanel = () => screen.queryByRole("region", { name: "Route" });
export const factsOf = (card: HTMLElement) =>
  [...card.querySelectorAll("dl > div")].map((row) => `${row.firstChild!.textContent}: ${row.lastChild!.textContent}`);
export const facts = () => factsOf(popover()!);
export const stepLists = (card: HTMLElement) =>
  within(card)
    .getAllByRole("list")
    .map((list) => [
      list.getAttribute("aria-label") ?? document.getElementById(list.getAttribute("aria-labelledby")!)!.textContent,
      [...list.children].map((step) => step.textContent),
    ]);
export const summaryButton = () => screen.getByRole("button", { name: "Summary" });
export const actions = () => [...popover()!.querySelectorAll(".route-popover-actions button")].map((b) => b.textContent);
export const chip = () => document.querySelector(".route-chip [aria-live]")!.textContent;
export const undoText = () =>
  document.getElementById(screen.getByRole("button", { name: "Undo" }).getAttribute("aria-describedby")!)!.textContent;
export const busy = () => !!document.querySelector(".route-chip .route-busy");
export const leg = (n: number) => screen.getByRole("button", { name: new RegExp(`^Leg ${n} \\(`) });
export const fromMenu = async (user: User, item: string) => {
  await user.click(screen.getByRole("button", { name: "Route" }));
  screen.getByRole("button", { name: item }).focus();
  await user.keyboard("{Enter}");
};
const enterPoint = async (user: User, title: string, p: Point) => {
  const field = within(screen.getByRole("dialog", { name: title })).getByRole("textbox", { name: "World yards (x, y)" });
  await user.clear(field);
  await user.type(field, `${typed(p)}{Enter}`, { skipClick: true });
};
export const finishNewRoute = async (user: User, from: Point, to: Point) => {
  await fromMenu(user, "New route");
  await fromMenu(user, "Set start…");
  await enterPoint(user, "Set the start", from);
  await fromMenu(user, "Set destination…");
  await enterPoint(user, "Set the destination", to);
  await waitFor(() => expect(stops()).toEqual([from, to]));
};
export const deleteRoute = async (user: User) => {
  await fromMenu(user, "Delete route…");
  await user.click(within(screen.getByRole("dialog", { name: "Delete this route?" })).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Route plan" })).toHaveProperty("value", ""));
};
export const selectLeg = async (user: User, n: number) => {
  leg(n).focus();
  await user.keyboard("{Enter}");
};
export const viewAt = (p: Point) => {
  const { x, y } = proj.toView(p, 0)!;
  return `${Math.round(x * 1e4) / 1e4},${Math.round(y * 1e4) / 1e4}`;
};
export const legLine = (n: number) => {
  const g = document.querySelector(`.route-lines [data-leg="${n - 1}"]`)!;
  return { look: [...g.classList].find((c) => c.startsWith("leg-")), points: g.querySelector(".leg-line")!.getAttribute("points") };
};
export const outlines = () => [...document.querySelectorAll(".skipped-tiles polygon")].map((p) => p.getAttribute("points"));
export const tiles = (n: number) => Array.from({ length: n }, (_, i) => ({ tile: [i, 0] as [number, number], at: [i * 512, 0] as Point }));

function caveAroundW() {
  const at = nativeToWorld(manifest, W);
  const { interiors } = interiorsFixture();
  return {
    ...interiors.interiors[0]!,
    map: at.instance,
    bounds: { north: at.y + 200, south: at.y - 600, west: at.x + 600, east: at.x - 1000 },
  };
}

export function caveWith(values: Uint16Array): LoadedWorldMap {
  const cave = caveAroundW();
  const surfaces = fromSurfaces(cave, groundSurfaces({ width: 64, height: 32, values }));
  return {
    ...worldMap,
    interiors: {
      list: [cave],
      image: async (path: string) => `blob:${path}`,
      surfaces: async () => surfaces,
      loadedSurfaces: () => surfaces,
    },
  };
}

export async function interiorWorkspace(inMemory = false) {
  const cave = { ...caveAroundW(), places: [] };
  const named = interiorsFixture().surfaces;
  const surfaces = fromSurfaces(cave, { ...named, groundPlace: new Uint8Array(8), upperPlace: new Uint8Array(5) });
  let kept = inMemory ? surfaces : undefined;
  let release = () => {};
  let reject = (_error: Error) => {};
  const gate = new Promise<void>((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  let waiting = !inMemory;
  const read = vi.fn(async (_: Interior) => {
    if (waiting) await gate;
    kept = surfaces;
    return surfaces;
  });
  onTestFinished(() => release());
  return {
    map: {
      ...worldMap,
      interiors: {
        list: [cave],
        image: async (path: string) => `blob:${path}`,
        surfaces: read,
        loadedSurfaces: () => kept,
      },
    },
    read,
    release: async (error?: Error) => {
      if (error) reject(error);
      else release();
      await gate.catch(() => {});
      waiting = false;
    },
  };
}

export function namedCave(): LoadedWorldMap {
  const { interiors, surfaces } = interiorsFixture();
  const cave = { ...interiors.interiors[0]!, map: caveAroundW().map, bounds: caveAroundW().bounds };
  const map = fromSurfaces(cave, surfaces);
  return {
    ...worldMap,
    interiors: {
      list: [cave],
      image: async (path: string) => `blob:${path}`,
      surfaces: async () => map,
      loadedSurfaces: () => map,
    },
  };
}

export function ironforgeMap(): LoadedWorldMap {
  const { interior, width, height, windows } = ironforgeSurfaces;
  const list = decodeInteriorsFile({ version: 2, interiors: [interior] }).interiors;
  const stacks = new Map<number, number[]>();
  for (const w of windows)
    for (const [i, stack] of w.stacks.entries())
      if (stack.length) stacks.set((w.y + Math.floor(i / w.width)) * width + w.x + (i % w.width), stack);
  const stacked = [...stacks.keys()].filter((i) => stacks.get(i)!.length > 1).sort((a, b) => a - b);
  const upper = stacked.map((i) => stacks.get(i)!.slice(1));
  const upperStart = [0];
  for (const heights of upper) upperStart.push(upperStart.at(-1)! + heights.length);
  const groundHeight = new Uint16Array(width * height);
  for (const [i, [ground]] of stacks) groundHeight[i] = ground!;
  const surfaces = fromSurfaces(list[0]!, {
    width,
    height,
    groundHeight,
    groundPlace: new Uint8Array(width * height),
    stacked: Uint32Array.from(stacked),
    upperStart: Uint32Array.from(upperStart),
    upperHeight: Uint16Array.from(upper.flat()),
    upperPlace: new Uint8Array(upper.flat().length),
  });
  return {
    ...worldMap,
    interiors: {
      list,
      image: async (path: string) => `blob:${path}`,
      surfaces: async () => surfaces,
      loadedSurfaces: () => surfaces,
    },
  };
}

export const waypoint = () => screen.getByRole("button", { name: /^Waypoint 1 .*world yards/ });
export const startPin = () => screen.getByRole("button", { name: /^Start .*world yards/ });
type StopEdit = "new stop" | "drag drop" | "Edit coordinates";
export const stopEdits: StopEdit[] = ["new stop", "drag drop", "Edit coordinates"];
export const results = {
  "new stop": {
    stops: [
      [2000, 3000],
      [3000, 3400],
      [3000, 3400],
      [4000, 3000],
    ],
    heights: [null, 20, 37, null],
  },
  "drag drop": {
    stops: [
      [2000, 3000],
      [3300, 3400],
      [4000, 3000],
    ],
    heights: [null, 36.875, null],
  },
  "Edit coordinates": {
    stops: [
      [2000, 3000],
      [3300, 3400],
      [4000, 3000],
    ],
    heights: [null, 36.875, null],
  },
};

export async function prepareStopEdit(user: User, action: StopEdit) {
  if (action === "drag drop") {
    const pin = waypoint();
    fireEvent.pointerDown(pin, { button: 0, ...client(W) });
    fireEvent.pointerMove(pin, client([3300, 3400]));
    return () => fireEvent.pointerUp(pin, client([3300, 3400]));
  }
  if (action === "new stop") {
    await user.click(startPin());
    await user.click(within(popover()!).getByRole("button", { name: "Add stop after the start…" }));
  } else {
    await user.pointer({ keys: "[MouseRight]", target: waypoint() });
    await choose(user, "Edit coordinates…");
  }
  const input = screen.getByRole("textbox", { name: "World yards (x, y)" });
  await user.clear(input);
  await user.type(input, action === "new stop" ? "1675.00, 2858.33" : "1362.50, 2858.33");
  const apply = screen.getByRole("button", { name: "Apply" });
  return () => fireEvent.click(apply);
}
