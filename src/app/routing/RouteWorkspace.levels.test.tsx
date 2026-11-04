// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Point } from "../../routing/frame.ts";
import { createPlan, insertWaypoint } from "../../routing/plan.ts";
import {
  world,
  heightsOf,
  lastRouted,
  mount,
  shownView,
  stop,
  saved,
  menuItems,
  popover,
  undoText,
  ironforgeMap,
  startPin,
} from "./routeWorkspaceFixture.tsx";

// jsdom has no Worker to trace an outline in.
vi.mock("../map/outline.ts", () => ({
  outline: async () => ({ width: 1, height: 1, path: "M0,0L1,0L1,1L0,1Z", masks: { two: "", twoEdge: "", more: "", moreEdge: "" } }),
}));

describe("levels", () => {
  const ironforge = async (stops: [Point, number | null][]) => {
    const [first, ...rest] = stops.map(([point, height]) => world(point, height));
    let route = createPlan(first!, rest.at(-1)!, "2026-10-03T00:00:00.000Z");
    for (const [i, at] of rest.slice(0, -1).entries()) route = insertWaypoint(route, i, at);
    return mount(route, undefined, undefined, null, ironforgeMap());
  };
  const START: Point = [5642, 10794];
  const STACKED: Point = [5651, 10819];
  const END: Point = [5662, 10814];

  it("puts a stop on another level from the radios of its popover, as one undoable edit that keeps the view", async () => {
    const user = await ironforge([
      [START, 496.125],
      [STACKED, 502.25],
      [END, null],
    ]);
    await user.click(await screen.findByRole("button", { name: /^Waypoint 1 on Ironforge, level 2 of 2, at/ }));
    const levels = within(screen.getByRole("group", { name: "Level at waypoint 1" }));
    const radios = () =>
      levels
        .getAllByRole<HTMLInputElement>("radio")
        .map((radio) => [radio.getAttribute("aria-label") ?? radio.labels![0]!.textContent, radio.checked]);
    expect([radios(), levels.getAllByRole<HTMLInputElement>("radio").map((radio) => radio.labels![0]!.textContent)]).toEqual([
      [
        ["Ironforge, 502 yards", true],
        ["Ironforge, 474 yards, 28 yards below", false],
        ["World map", false],
      ],
      ["Ironforge · 502 yd", "Ironforge · 474 yd · 28 yd below", "World map"],
    ]);
    expect(document.querySelector(".pin-chip")!.textContent).toBe("Ironforge · level 2 of 2");
    const view = shownView();

    await user.click(levels.getByRole("radio", { name: "Ironforge, 474 yards, 28 yards below" }));
    await waitFor(() => expect(heightsOf(lastRouted())).toEqual([496.125, 474.125, null]));
    expect([
      stop("Waypoint 1 on Ironforge, level 1 of 2,").getAttribute("aria-label"),
      radios(),
      document.querySelector(".pin-chip")!.textContent,
      shownView(),
      undoText(),
    ]).toEqual([
      "Waypoint 1 on Ironforge, level 1 of 2, at world yards -1086.46, -4869.79",
      [
        ["Ironforge, 502 yards, 28 yards above", false],
        ["Ironforge, 474 yards", true],
        ["World map", false],
      ],
      "Ironforge · level 1 of 2",
      view,
      "Undo put waypoint 1 on level 1",
    ]);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect(heightsOf(await saved())).toEqual([496.125, 502.25, null]));

    await user.click(stop("Waypoint 1 on Ironforge, level 2 of 2,"));
    await user.click(screen.getByRole("radio", { name: "Ironforge, 502 yards" }));
    await user.keyboard("{ArrowDown}");
    await waitFor(async () => expect(heightsOf(await saved())).toEqual([496.125, 474.125, null]));
    await user.keyboard("{ArrowDown}");
    await waitFor(async () => expect(heightsOf(await saved())).toEqual([496.125, null, null]));
    expect([stop("Waypoint 1 on the world map").getAttribute("aria-label"), shownView(), undoText()]).toEqual([
      "Waypoint 1 on the world map at world yards -1086.46, -4869.79",
      view,
      "Undo put waypoint 1 on the world map",
    ]);
  });

  it("lists the levels of a stacked spot as menu radios, top first, and World map", async () => {
    const user = await ironforge([
      [START, 496.125],
      [STACKED, 502.25],
      [END, null],
    ]);
    await user.pointer({
      keys: "[MouseRight]",
      target: await screen.findByRole("button", { name: /^Waypoint 1 on Ironforge, level 2 of 2, at/ }),
    });
    const menu = within(screen.getByRole("menu", { name: "Waypoint 1 on Ironforge, level 2 of 2 · world yards -1086.46, -4869.79" }));
    expect(menu.getAllByRole("menuitemradio").map((item) => [item.textContent, item.getAttribute("aria-checked")])).toEqual([
      ["Ironforge · 502 yd", "true"],
      ["Ironforge · 474 yd · 28 yd below", "false"],
      ["World map", "false"],
    ]);
    await user.click(screen.getByRole("menuitemradio", { name: "Ironforge · 502 yd" }));
    expect([screen.queryByRole("menu"), screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")]).toEqual([null, true]);
    await user.pointer({ keys: "[MouseRight]", target: stop("Waypoint 1 on Ironforge, level 2 of 2,") });
    await user.click(screen.getByRole("menuitemradio", { name: "World map" }));
    await waitFor(() => expect(heightsOf(lastRouted())).toEqual([496.125, null, null]));
    expect(undoText()).toBe("Undo put waypoint 1 on the world map");
    await user.pointer({ keys: "[MouseRight]", target: stop("Waypoint 1 on the world map") });
    await user.click(screen.getByRole("menuitemradio", { name: "Ironforge · 474 yd" }));
    await waitFor(() => expect(heightsOf(lastRouted())).toEqual([496.125, 474.125, null]));
    expect(undoText()).toBe("Undo put waypoint 1 on level 1");
  });

  it("shows the one level of single-surface ground, and a World map toggle in the popover and the menu", async () => {
    const user = await ironforge([
      [START, 496.125],
      [END, null],
    ]);
    await user.click(await screen.findByRole("button", { name: "Start on Ironforge at world yards -1077.08, -4843.75" }));
    const world = () => within(popover()!).getByRole("button", { name: "World map" });
    expect([popover()!.querySelector(".stop-levels p")!.textContent, world().getAttribute("aria-pressed")]).toEqual([
      "Only one level here, at 496 yd.",
      "false",
    ]);
    await user.click(world());
    await waitFor(() => expect(heightsOf(lastRouted())).toEqual([null, null]));
    expect([startPin().getAttribute("aria-label"), world().getAttribute("aria-pressed"), undoText()]).toEqual([
      "Start on the world map at world yards -1077.08, -4843.75",
      "true",
      "Undo put the start on the world map",
    ]);
    await user.pointer({ keys: "[MouseRight]", target: startPin() });
    expect([menuItems(), screen.getByRole("menuitemcheckbox", { name: "World map" }).getAttribute("aria-checked")]).toEqual([
      ["Swap to destination", "World map"],
      "true",
    ]);
    await user.click(screen.getByRole("menuitemcheckbox", { name: "World map" }));
    await waitFor(() => expect(heightsOf(lastRouted())).toEqual([496.125, null]));
    expect(undoText()).toBe("Undo put the start on Ironforge");
  });
});
