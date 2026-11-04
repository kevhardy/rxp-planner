// @vitest-environment jsdom
import { nativeStop, type Point } from "../../routing/frame.ts";
import "fake-indexeddb/auto";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { plannerData } from "../../data/plannerFixture.ts";
import { at, testFrame } from "../../routing/fixtures/region.ts";
import { syntheticScope } from "../../routing/fixtures/synthetic.ts";
import { createPlan } from "../../routing/plan.ts";
import { deletePlan, loadPlans, savePlan } from "../../storage/routing.ts";
import { saveSetting } from "../../storage/index.ts";
import { DEFAULT_LAYOUT } from "../layout.ts";
import { DEFAULT_SETTINGS } from "../preview/settings.ts";
import type { RoutingEngine } from "../routing/engine.ts";
import { DEFAULT_MAP_SETTINGS } from "./mapSettings.ts";
import { renderMap } from "./renderMap.tsx";

const manifest: RoutingEngine["manifest"] = {
  id: "routing-test",
  scope: syntheticScope(),
  frame: { origin: [23, 20], size: [23, 42], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
  tiles: [{ tile: [3, 5], state: "present" }],
};
const engine: RoutingEngine = {
  manifest,
  maps: [{ manifest }],
  release: () => {},
  route: async (plan) => ({
    journeys: [
      {
        mode: { name: "walk" } as never,
        legs: plan.legs.map((_, i) => ({
          kind: "straight" as const,
          points: [nativeStop(manifest, plan.stops[i]!).point, nativeStop(manifest, plan.stops[i + 1]!).point],
          distance: 100,
          activation: 0,
          seconds: 10,
        })),
      },
    ],
  }),
};
vi.mock("../routing/engine.ts", async (original) => ({
  ...(await original<typeof import("../routing/engine.ts")>()),
  loadRouting: () => Promise.resolve({ ok: true, engine, missing: [] }),
}));
// jsdom has no Worker to trace an outline in.
vi.mock("./outline.ts", () => ({
  outline: async () => ({ width: 1, height: 1, path: "M0,0L1,0L1,1L0,1Z", masks: { two: "", twoEdge: "", more: "", moreEdge: "" } }),
}));

const plan = (id: string, a: Point, b: Point) => ({
  ...createPlan(at(a, null, manifest), at(b, null, manifest), "2026-10-03T00:00:00.000Z"),
  id,
});
const ROUTE_A = plan("a", [2000, 3000], [4000, 3000]);
const ROUTE_B = plan("b", [2000, 2000], [2400, 2200]);
const MISSING_MAP = 7;
const offMap = (id: string) => ({
  ...createPlan(at([2000, 3000], null, testFrame(MISSING_MAP)), at([4000, 3000], null, testFrame(MISSING_MAP))),
  id,
});
const OFF_MAP = offMap("0");

beforeEach(async () => {
  // jsdom does no layout.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return DOMRect.fromRect(
      this.matches(".route-corner, .coord-readout") ? { y: 928, width: 1000, height: 72 } : { width: 1000, height: 1000 },
    );
  });
  await saveSetting("preview", DEFAULT_SETTINGS);
  await saveSetting("map", DEFAULT_MAP_SETTINGS);
  await saveSetting("layout", DEFAULT_LAYOUT);
  for (const saved of await loadPlans()) await deletePlan(saved.id);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mount() {
  const { user } = await renderMap({ data: plannerData() });
  return user;
}

const routes = () => screen.getByRole("button", { name: "Routes" });
const roundedView = () =>
  `${document.querySelector<HTMLElement>(".route-map .map-stage")!.style.getPropertyValue("--pan")} ${document
    .querySelector<HTMLElement>(".route-map .map-viewport")!
    .style.getPropertyValue("--zoom")}`
    .match(/-?[\d.]+/g)!
    .map((n) => Math.round(Number(n) * 1000) / 1000)
    .join(" ");
const openRoutes = async (user: ReturnType<typeof userEvent.setup>, plan: string) => {
  await user.click(routes());
  await waitFor(() => expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Route plan" }).value).toBe(plan));
  return roundedView();
};
const zoomIn = () => fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

it("shows the frame the user left when Routes opens again on the same route", async () => {
  await savePlan(ROUTE_A);
  const user = await mount();
  const fit = await openRoutes(user, "a");
  zoomIn();
  const left = roundedView();
  await user.click(routes());

  expect(left).not.toBe(fit);
  expect(await openRoutes(user, "a")).toBe(left);
});

it("shows the other route and the frame the user left when Routes opens again after the user moved to it", async () => {
  await savePlan(ROUTE_A);
  await savePlan(ROUTE_B);
  const user = await mount();
  await openRoutes(user, "a");
  await user.selectOptions(screen.getByRole("combobox", { name: "Route plan" }), "b");
  const other = roundedView();
  zoomIn();
  const left = roundedView();
  await user.click(routes());

  expect(left).not.toBe(other);
  expect(await openRoutes(user, "b")).toBe(left);
});

it.each([ROUTE_A, OFF_MAP])("fits route $id when Routes opens again after the route it left was deleted", async (fallback) => {
  await savePlan(fallback);
  await savePlan(ROUTE_B);
  const user = await mount();
  const fit = await openRoutes(user, fallback.id);
  await user.selectOptions(screen.getByRole("combobox", { name: "Route plan" }), "b");
  zoomIn();
  const left = roundedView();
  await user.click(routes());
  await deletePlan("b");

  expect(left).not.toBe(fit);
  expect(await openRoutes(user, fallback.id)).toBe(fit);
});

it("shows the whole map for a route with no stop on the map, unless Routes opens again on it", async () => {
  await savePlan(ROUTE_A);
  await savePlan(OFF_MAP);
  const user = await mount();
  const plans = () => screen.getByRole("combobox", { name: "Route plan" });
  const whole = await openRoutes(user, "0");
  await user.selectOptions(plans(), "a");
  zoomIn();
  await user.selectOptions(plans(), "0");
  const after = roundedView();
  zoomIn();
  const left = roundedView();
  await user.click(routes());
  const reopened = await openRoutes(user, "0");

  expect([whole, after, reopened]).toEqual(["0 0 1", "0 0 1", left]);
});

it("keeps the map view between routes with no stop on the map after Routes opens again", async () => {
  await savePlan(OFF_MAP);
  await savePlan(offMap("1"));
  const user = await mount();
  await openRoutes(user, "0");
  zoomIn();
  const left = roundedView();
  await user.click(routes());
  await openRoutes(user, "0");
  await user.selectOptions(screen.getByRole("combobox", { name: "Route plan" }), "1");

  expect(roundedView()).toBe(left);
});
