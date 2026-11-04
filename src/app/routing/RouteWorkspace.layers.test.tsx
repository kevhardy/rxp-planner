// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_SLOPE, insertWaypoint } from "../../routing/plan.ts";
import type { ZoneGrid } from "../../routing/zones.ts";
import { layerKey, type LayerPainter } from "./layerPainter.ts";
import { DEFAULT_LAYERS, saveLayerChoices } from "./MapLayers.tsx";
import {
  A,
  W,
  B,
  world,
  pixelsOf,
  heightsOf,
  route,
  engine,
  manifest,
  lastRouted,
  mount,
  plan,
  stageView,
  stop,
  stops,
  popover,
  leg,
  interiorWorkspace,
  startPin,
  savedStores,
  proj,
} from "./routeWorkspaceFixture.tsx";

// jsdom has no Worker to trace an outline in.
vi.mock("../map/outline.ts", () => ({
  outline: async () => ({ width: 1, height: 1, path: "M0,0L1,0L1,1L0,1Z", masks: { two: "", twoEdge: "", more: "", moreEdge: "" } }),
}));

describe("map layers", () => {
  const painter = () => ({
    image: (key: string) => `data:image/png;base64,${btoa(key)}`,
    want: vi.fn<LayerPainter["want"]>(),
    subscribe: () => () => {},
    version: () => 0,
    release: () => {},
  });
  const layered = (layers: LayerPainter) => () => Promise.resolve({ ok: true as const, engine: { ...engine, layers }, missing: [] });
  const box = (name: string) => screen.getByRole<HTMLInputElement>("checkbox", { name });
  const drawn = () =>
    [...document.querySelectorAll<HTMLImageElement>(".map-stage img.router-layer")].map((img) => atob(img.src.split(",")[1]!));

  beforeEach(() => saveLayerChoices(DEFAULT_LAYERS));

  it("switches the inside map to floor plans from the Inside map box, as one setting with the Layers menu item", async () => {
    const floors = await interiorWorkspace(true);
    const user = await mount(plan([W[0] - 10, W[1]], [W[0] + 10, W[1]]), undefined, undefined, null, floors.map);
    const plans = within(await screen.findByRole("group", { name: "The Deadmines" })).getByRole<HTMLInputElement>("checkbox", {
      name: "Floor plans",
    });
    const inside = () => document.querySelector(".map-stage image.interior-layer")?.getAttribute("href");
    await waitFor(() => expect(inside()).toBe("blob:interiors/the-deadmines-35530/ground-minimap.webp"));
    await user.click(plans);
    await waitFor(() => expect(inside()).toBe("blob:interiors/the-deadmines-35530/ground-plan.webp"));
    await user.click(screen.getByRole("button", { name: "Layers" }));
    expect(box("Floor plans inside").checked).toBe(true);
    await user.click(box("Floor plans inside"));
    await waitFor(() => expect(inside()).toBe("blob:interiors/the-deadmines-35530/ground-minimap.webp"));
    expect(plans.checked).toBe(false);
  });

  it("hides the inside map with Inside map unchecked, gives a new stop no level then, and shows it again for a selected stop with a level", async () => {
    const floors = await interiorWorkspace(true);
    const route = insertWaypoint(plan([W[0] - 10, W[1]], [W[0] + 10, W[1]]), 0, world(W, 37));
    const user = await mount(route, undefined, undefined, null, floors.map);
    const inside = within(await screen.findByRole("group", { name: "The Deadmines" })).getByRole<HTMLInputElement>("checkbox", {
      name: "Inside map",
    });
    const art = () => document.querySelector(".map-stage image.interior-layer")?.getAttribute("href");
    await waitFor(() => expect([inside.checked, art()]).toEqual([true, "blob:interiors/the-deadmines-35530/ground-minimap.webp"]));
    await user.click(inside);
    expect([inside.checked, art(), document.querySelector(".map-stage svg.interior-outline")]).toEqual([false, undefined, null]);

    await user.click(startPin());
    await user.click(within(popover()!).getByRole("button", { name: "Add stop after the start…" }));
    await user.clear(screen.getByRole("textbox", { name: "World yards (x, y)" }));
    await user.type(screen.getByRole("textbox", { name: "World yards (x, y)" }), W.join(","));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(heightsOf(lastRouted())).toEqual([null, null, 37, null]));
    expect(inside.checked).toBe(false);
    await user.click(stop("Waypoint 2 on The Deadmines, level 2 of 2,"));
    await waitFor(() => expect([inside.checked, art()]).toEqual([true, "blob:interiors/the-deadmines-35530/ground-minimap.webp"]));
  });

  it("shows the inside map in view once routing is ready", async () => {
    const floors = await interiorWorkspace(true);
    let ready = () => {};
    const loaded = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const at = proj.toView(W, 0)!;
    const closed = { current: { plan: null, frame: { left: at.x - 0.5, top: at.y - 0.5, width: 1, height: 1 }, hadFit: true } };
    await mount(undefined, () => loaded.then(() => ({ ok: true, engine, missing: [] })), undefined, null, floors.map, false, closed);
    await screen.findByText("Loading routing…");
    expect(screen.queryByRole("group", { name: "The Deadmines" })).toBeNull();
    ready();
    await screen.findByRole("group", { name: "The Deadmines" });
  });

  it("draws each chosen layer of the tiles in view, and hides the map image", async () => {
    const layers = painter();
    const user = await mount(plan(A, B), layered(layers));
    await user.click(await screen.findByRole("button", { name: "Layers" }));
    expect(["Map image", "Terrain shading", "Too steep", "Floors"].map((name) => box(name).checked)).toEqual([true, false, false, false]);
    await waitFor(() => expect(document.querySelector(".map-stage img.tile")).not.toBeNull());
    await user.click(box("Floors"));
    await user.click(box("Too steep"));
    await user.click(box("Map image"));
    expect(drawn()).toEqual(["0/3,5/steep/" + DEFAULT_MAX_SLOPE, "0/3,5/floors"]);
    expect(layers.want).toHaveBeenLastCalledWith([
      expect.objectContaining({ map: 0, tile: [3, 5], layer: "steep", maxSlope: DEFAULT_MAX_SLOPE }),
      expect.objectContaining({ map: 0, tile: [3, 5], layer: "floors" }),
    ]);
    expect(document.querySelector(".map-stage img.tile")).toBeNull();
    expect(screen.getByText("descent")).toBeTruthy();
  });

  it("draws a shading tile one cell wider and taller, so it covers the edges it shares with the next tiles", async () => {
    const user = await mount(plan(A, B), layered(painter()));
    await user.click(await screen.findByRole("button", { name: "Layers" }));
    await user.click(box("Terrain shading"));
    await user.click(box("Too steep"));
    const [shading, steep] = [...document.querySelectorAll<HTMLImageElement>(".map-stage img.router-layer")];
    expect([shading!.style.getPropertyValue("--at-x"), shading!.style.getPropertyValue("--at-y")]).toEqual([
      steep!.style.getPropertyValue("--at-x"),
      steep!.style.getPropertyValue("--at-y"),
    ]);
    const size = (img: HTMLImageElement) => [
      parseFloat(img.style.getPropertyValue("--size-w")),
      parseFloat(img.style.getPropertyValue("--size-h")),
    ];
    expect(size(shading!).map((v, i) => (v / size(steep!)[i]!) * 128)).toEqual([129, 129]);
  });

  it("keeps the choices in this browser", async () => {
    let user = await mount(plan(A, B), layered(painter()));
    await user.click(await screen.findByRole("button", { name: "Layers" }));
    await user.click(box("Water and hazards"));
    await user.click(box("Map image"));
    cleanup();
    user = await mount(plan(A, B), undefined, await savedStores(layered(painter())));
    await user.click(await screen.findByRole("button", { name: "Layers" }));
    expect(["Map image", "Water and hazards", "Floors"].map((name) => box(name).checked)).toEqual([false, true, false]);
  });

  it("draws the search layers of the selected stop and the open leg", async () => {
    const layers = painter();
    const user = await mount(plan(A, B), layered(layers));
    await user.click(await screen.findByRole("button", { name: "Layers" }));
    await user.click(box("Reachable from here"));
    await user.click(box("Explored cells"));
    expect([screen.getByText("Select a stop."), screen.getByText("Open a leg.")]).toHaveLength(2);
    expect(screen.queryByText(/has no mark/)).toBeNull();
    expect(drawn()).toEqual([]);
    const searches = () =>
      layers.want.mock.lastCall![0].map(({ layer, tile, search }) => [
        layer,
        tile,
        search?.mode,
        search?.leg,
        search?.stop,
        search && pixelsOf(search.plan),
      ]);
    await user.click(stop("Destination"));
    expect(searches()).toEqual([["reachable", [3, 5], "Run", 0, 1, [A, B]]]);
    await user.click(leg(1));
    expect(searches()).toEqual([["explored", [3, 5], "Run", 0, 0, [A, B]]]);
    expect(screen.getByText(/^The end of the leg has no mark\./)).toBeTruthy();
    expect(drawn()).toEqual([layerKey(layers.want.mock.lastCall![0][0]!)]);
    expect(drawn()[0]).toMatch(/^0\/3,5\/explored\/\d+\/[0-9a-z]+$/);
  });

  it("draws nothing while the tiles are small on screen", async () => {
    const layers = painter();
    const user = await mount(plan([0, 0], [11000, 21000]), layered(layers));
    await user.click(await screen.findByRole("button", { name: "Layers" }));
    await user.click(box("Floors"));
    expect(drawn()).toEqual([]);
    expect(layers.want).toHaveBeenLastCalledWith([]);
  });

  it("offers Zone borders only with a zone grid, and draws the zone edges while it is pressed", async () => {
    await mount(plan(A, B));
    expect(screen.queryByRole("button", { name: "Zone borders" })).toBeNull();
    cleanup();

    const grid: ZoneGrid = { scope: manifest.scope, frame: manifest.frame, zones: [0], tiles: [] };
    const user = await mount(plan(A, B), () =>
      Promise.resolve({ ok: true, engine: { ...engine, maps: [{ manifest, zones: grid }] }, missing: [] }),
    );
    const borders = await screen.findByRole("button", { name: "Zone borders" });
    expect([borders.getAttribute("aria-pressed"), document.querySelector(".zone-borders")]).toEqual(["false", null]);
    await user.click(borders);
    expect(borders.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".zone-borders")).not.toBeNull();
    await user.click(borders);
    expect(document.querySelector(".zone-borders")).toBeNull();
  });
});

it("retries a failed terrain image locally and keeps the route and map view", async () => {
  const user = await mount(plan(A, B));
  await waitFor(() => expect(document.querySelector("img.tile")).not.toBeNull());
  const image = document.querySelector<HTMLImageElement>("img.tile")!;
  const source = image.src;
  const before = stageView();
  const routeBefore = stops();
  const searches = route.mock.calls.length;
  fireEvent.error(image);
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("Some terrain tiles did not load.");
  expect(document.contains(image)).toBe(false);
  await user.click(within(alert).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(document.querySelector<HTMLImageElement>("img.tile")?.src).toBe(source));
  expect(stageView()).toBe(before);
  expect(stops()).toEqual(routeBefore);
  expect(route).toHaveBeenCalledTimes(searches);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps the tile alert while the map image is hidden, and shows the tile again when the map image returns", async () => {
  const user = await mount(plan(A, B));
  const image = await waitFor(() => {
    const tile = document.querySelector<HTMLImageElement>("img.tile");
    expect(tile).not.toBeNull();
    return tile!;
  });
  const source = image.getAttribute("src");
  const mapImage = () => screen.getByRole<HTMLInputElement>("checkbox", { name: "Map image" });
  const shown = () => [...document.querySelectorAll<HTMLImageElement>("img.tile")].map((tile) => tile.getAttribute("src"));
  fireEvent.error(image);
  await user.click(screen.getByRole("button", { name: "Layers" }));
  await user.click(mapImage());
  expect([document.querySelector("img.tile"), screen.getByRole("alert").textContent]).toEqual([
    null,
    "Some terrain tiles did not load. Retry",
  ]);
  await user.click(mapImage());
  await waitFor(() => expect(shown()).toContain(source));
  expect(screen.getByRole("alert").textContent).toBe("Some terrain tiles did not load. Retry");
  await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
  expect(screen.queryByRole("alert")).toBeNull();
});
