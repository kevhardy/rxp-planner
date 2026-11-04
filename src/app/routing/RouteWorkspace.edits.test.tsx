// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import type { RideRequirements } from "../../../packages/data-contract/transports.ts";
import type { Point } from "../../routing/frame.ts";
import { DEFAULT_LEG, insertWaypoint } from "../../routing/plan.ts";
import type { LegResult } from "../../routing/search.ts";
import { saveNewLegs } from "./newLegs.tsx";
import {
  A,
  W,
  B,
  world,
  pixelsOf,
  heightsOf,
  typed,
  terrainRoute,
  type Outcome,
  defaultOutcome,
  controlRoute,
  route,
  lastRouted,
  mount,
  plan,
  client,
  stop,
  stops,
  looks,
  saved,
  menuItems,
  type User,
  rightClick,
  choose,
  labels,
  popover,
  facts,
  chip,
  undoText,
  fromMenu,
  selectLeg,
  caveWith,
  interiorWorkspace,
  namedCave,
  savedStores,
  mapArea,
  shownView,
} from "./routeWorkspaceFixture.tsx";

let outcome: Outcome;
let routeGate: Promise<void>;
beforeEach(() => {
  outcome = defaultOutcome;
  routeGate = Promise.resolve();
});
controlRoute({ outcome: () => outcome, routeGate: () => routeGate });

describe("route workspace", () => {
  it("offers Remove and Edit coordinates for a waypoint, and a swap for each end", async () => {
    const user = await mount(plan(A, W, B));
    await user.pointer({ keys: "[MouseRight]", target: stop("Waypoint 1") });
    expect(menuItems()).toEqual(["Remove", "Edit coordinates…"]);
    await user.keyboard("{Escape}");

    await user.pointer({ keys: "[MouseRight]", target: stop("Start") });
    expect(menuItems()).toEqual(["Swap to destination"]);
    await user.keyboard("{Escape}");
    await user.pointer({ keys: "[MouseRight]", target: stop("Destination") });
    expect(menuItems()).toEqual(["Swap to start"]);
    await choose(user, "Swap to start");
    await waitFor(() => expect(stops()).toEqual([B, W, A]));
    expect(stop("Start").getAttribute("aria-label")).toBe(`Start at world yards ${typed(B)}`);
    expect(stop("Start").classList.contains("selected")).toBe(true);

    await user.pointer({ keys: "[MouseRight]", target: stop("Waypoint 1") });
    await choose(user, "Remove");
    await waitFor(() => expect(stops()).toEqual([B, A]));
  });

  it("names no level and offers none for a stop with no surface within reach of its point", async () => {
    const values = new Uint16Array(64 * 32);
    values[0] = 313;
    const user = await mount(insertWaypoint(plan(A, B), 0, world(W, 37)), undefined, undefined, null, caveWith(values));
    await user.pointer({ keys: "[MouseRight]", target: stop("Waypoint 1") });
    expect([
      stop("Waypoint 1").getAttribute("aria-label"),
      menuItems(screen.getByRole("menu", { name: "Waypoint 1 · world yards 1675.00, 2858.33" })),
    ]).toEqual(["Waypoint 1 at world yards 1675.00, 2858.33", ["Remove", "Edit coordinates…"]]);
  });

  it.each([
    {
      last: [4200, 3400] as Point,
      placed: { stops: [A, [4200, 3400], B], heights: [null, null, null] },
      alert: "That point is outside the routing area, so the stop stays at the last point inside it.",
    },
    {
      last: W,
      placed: { stops: [A, W, B], heights: [null, null, null] },
      alert: "That point is outside the routing area, so the stop stays at the last point inside it.",
    },
  ])("places a stop released outside the routing area at its last point inside it, $last", async ({ last, placed, alert }) => {
    const user = await mount(plan(A, [2436, 3220], B), undefined, undefined, null, caveWith(new Uint16Array(64 * 32).fill(313, 0, 64)));
    await user.pointer({ keys: "[MouseRight]", target: stop("Waypoint 1 on the world map") });
    await user.click(screen.getByRole("menuitemcheckbox", { name: "World map" }));
    await waitFor(() => expect(heightsOf(lastRouted())).toEqual([null, 51, null]));

    const pin = stop("Waypoint 1 on The Deadmines");
    fireEvent.pointerDown(pin, { button: 0, ...client([2436, 3220]) });
    fireEvent.pointerMove(pin, client(last));
    fireEvent.pointerMove(pin, { clientX: -100000, clientY: -100000 });
    fireEvent.pointerUp(pin, { clientX: -100000, clientY: -100000 });

    await waitFor(async () => {
      const after = await saved();
      expect({ stops: pixelsOf(after), heights: heightsOf(after) }).toEqual(placed);
    });
    expect(screen.getByRole("alert").textContent).toBe(alert);
  });

  it("tells how to put a destination with no level and no path on a level, and not once it has a level", async () => {
    const floors = await interiorWorkspace(true);
    outcome = (from, to, _leg, i) => (i === 0 ? { kind: "no-path", endpoint: "end" } : terrainRoute([from, to]));
    const user = await mount(plan(A, W), undefined, undefined, null, floors.map);
    const hint = "The destination has no level in The Deadmines. To route to a level, right-click the destination and choose a level.";
    expect((await screen.findByText(hint)).getAttribute("role")).toBeNull();
    await user.pointer({ keys: "[MouseRight]", target: stop("Destination on the world map") });
    await user.click(screen.getByRole("menuitemradio", { name: "The Deadmines · 20 yd" }));
    await waitFor(() => expect(heightsOf(lastRouted())).toEqual([null, 20]));
    expect(screen.queryByText(hint)).toBeNull();
  });

  it("names the place of each level in the pin, its chip, its popover, and its menu", async () => {
    const user = await mount(insertWaypoint(plan(A, B), 0, world(W, 37)), undefined, undefined, null, namedCave());
    const pin = stop("Waypoint 1 on The Deadmines, level 2 of 2,");
    expect(pin.getAttribute("aria-label")).toBe("Waypoint 1 on The Deadmines, level 2 of 2, at world yards 1675.00, 2858.33");
    await user.click(pin);
    const levels = within(screen.getByRole("group", { name: "Level at waypoint 1" }));
    expect([
      levels.getAllByRole<HTMLInputElement>("radio").map((radio) => [radio.getAttribute("aria-label"), radio.labels![0]!.textContent]),
      document.querySelector(".pin-chip")!.textContent,
    ]).toEqual([
      [
        ["The Deadmines, 37 yards", "The Deadmines · 37 yd"],
        ["Defias Hideout, 20 yards, 17 yards below", "Defias Hideout · 20 yd · 17 yd below"],
        [null, "World map"],
      ],
      "The Deadmines · level 2 of 2",
    ]);
    await user.keyboard("{Escape}");
    await user.pointer({ keys: "[MouseRight]", target: pin });
    expect(
      menuItems(screen.getByRole("menu", { name: "Waypoint 1 on The Deadmines, level 2 of 2 · world yards 1675.00, 2858.33" })),
    ).toEqual(["Remove", "Edit coordinates…", "The Deadmines · 37 yd", "Defias Hideout · 20 yd · 17 yd below", "World map"]);
  });

  it("puts a stop on a level from its menu as one undoable edit, keeps its level through a drag, and gives a new stop a level", async () => {
    const floors = await interiorWorkspace(true);
    const user = await mount(insertWaypoint(plan(A, B), 0, world(W, 37)), undefined, undefined, null, floors.map);
    const upper = "Waypoint 1 on The Deadmines, level 2 of 2,";
    await user.pointer({ keys: "[MouseRight]", target: stop(upper) });
    const menu = screen.getByRole("menu", { name: "Waypoint 1 on The Deadmines, level 2 of 2 · world yards 1675.00, 2858.33" });
    expect([
      menuItems(menu),
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => item.getAttribute("aria-checked")),
    ]).toEqual([
      ["Remove", "Edit coordinates…", "The Deadmines · 37 yd", "The Deadmines · 20 yd · 17 yd below", "World map"],
      ["true", "false", "false"],
    ]);
    await user.click(screen.getByRole("menuitemradio", { name: "The Deadmines · 20 yd · 17 yd below" }));
    await waitFor(() => expect(heightsOf(lastRouted())).toEqual([null, 20, null]));
    expect(stop("Waypoint 1 on The Deadmines, level 1 of 2,").getAttribute("aria-label")).toBe(
      "Waypoint 1 on The Deadmines, level 1 of 2, at world yards 1675.00, 2858.33",
    );
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect(heightsOf(await saved())).toEqual([null, 37, null]));

    const pin = stop(upper);
    fireEvent.pointerDown(pin, { button: 0, ...client(W) });
    fireEvent.pointerMove(pin, client([3300, 3400]));
    fireEvent.pointerUp(pin, client([3300, 3400]));
    await waitFor(() =>
      expect([pixelsOf(lastRouted())[1], heightsOf(lastRouted())]).toEqual([
        [3300, 3400],
        [null, 36.875, null],
      ]),
    );
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect([pixelsOf(await saved())[1], heightsOf(await saved())]).toEqual([W, [null, 37, null]]));

    const addAfter = async (name: string, button: string) => {
      await user.click(stop(name));
      await user.click(within(popover()!).getByRole("button", { name: button }));
      await user.clear(screen.getByRole("textbox", { name: "World yards (x, y)" }));
      await user.type(screen.getByRole("textbox", { name: "World yards (x, y)" }), "1675.00, 2858.33");
      await user.click(screen.getByRole("button", { name: "Apply" }));
    };
    await addAfter(upper, "Add stop after waypoint 1…");
    await waitFor(() => expect(heightsOf(lastRouted())).toEqual([null, 37, 37, null]));
    await addAfter("Start", "Add stop after the start…");
    await waitFor(() => expect(heightsOf(lastRouted())).toEqual([null, 20, 37, 37, null]));
  });

  it("edits a waypoint's coordinates with Apply, and keeps them when the dialog closes", async () => {
    const user = await mount(plan(A, W, B));
    await user.pointer({ keys: "[MouseRight]", target: stop("Waypoint 1") });
    await choose(user, "Edit coordinates…");
    const dialog = screen.getByRole("dialog", { name: "Edit coordinates of waypoint 1" });
    const field = within(dialog).getByRole("textbox", { name: "World yards (x, y)" });
    expect(field).toHaveProperty("value", typed(W));
    await user.clear(field);
    await user.type(field, "north");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(within(dialog).getByText("Enter one point as x, y in yards.")).toBeTruthy();

    await user.clear(field);
    await user.type(field, "1570.83, 2754.17");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(stops()).toEqual([A, [3100, 3500], B]));
    expect(screen.queryByRole("dialog")).toBeNull();

    const calls = route.mock.calls.length;
    await user.pointer({ keys: "[MouseRight]", target: stop("Waypoint 1") });
    await choose(user, "Edit coordinates…");
    await user.type(screen.getByRole("textbox", { name: "World yards (x, y)" }), "9");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stop("Waypoint 1").getAttribute("aria-label")).toBe("Waypoint 1 at world yards 1570.83, 2754.17");
    expect(route).toHaveBeenCalledTimes(calls);
  });

  it.each([
    { name: "a number too large", text: `${"9".repeat(309)}, 0`, error: "Enter one point as x, y in yards." },
    { name: "a point off the map", text: "1000000, -1000000", error: "1000000.00, -1000000.00 on map 0 is outside the routing area." },
  ])("keeps Edit coordinates open with an error, and the stop in place, for $name", async ({ text, error }) => {
    const user = await mount(plan(A, W, B));
    const calls = route.mock.calls.length;
    await user.pointer({ keys: "[MouseRight]", target: stop("Waypoint 1") });
    await choose(user, "Edit coordinates…");
    const dialog = screen.getByRole("dialog", { name: "Edit coordinates of waypoint 1" });
    const field = within(dialog).getByRole("textbox", { name: "World yards (x, y)" });
    fireEvent.change(field, { target: { value: text } });
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(within(dialog).getByText(error)).toBeTruthy();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Edit coordinates of waypoint 1" })).toBe(dialog);
    expect(stops()).toEqual([A, W, B]);
    expect(route).toHaveBeenCalledTimes(calls);
  });

  it("adds a new start with the start selected, and appends a destination with the destination selected", async () => {
    const user = await mount(plan(A, B));
    const C: Point = [1000, 2000];
    const D: Point = [5000, 2000];
    await rightClick(user, C);
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(stop("Start"));
    await rightClick(user, C);
    expect(menuItems()).toEqual(["Add point and start here"]);
    await choose(user, "Add point and start here");
    await waitFor(() => expect(stops()).toEqual([C, A, B]));
    expect(stop("Waypoint 1").getAttribute("aria-label")).toBe(`Waypoint 1 at world yards ${typed(A)}`);
    expect([stop("Start").classList.contains("selected"), undoText()]).toEqual([true, "Undo add a start"]);

    await user.click(stop("Destination"));
    await rightClick(user, D);
    await choose(user, "Add destination here");
    await waitFor(() => expect(stops()).toEqual([C, A, B, D]));
    expect(lastRouted().legs).toHaveLength(3);
    expect([stop("Destination").classList.contains("selected"), undoText()]).toEqual([true, "Undo add a destination"]);
  });

  it("offers the middle of the map view as a new start after a wheel zoom moves the view", async () => {
    const user = await mount(plan(A, B));
    expect(shownView()).toEqual({ center: [3072, 3113], zoom: 12.05 });
    fireEvent.wheel(mapArea(), { deltaY: -100, clientX: 200, clientY: 300 });
    expect(shownView()).toEqual({ center: [2891, 2987], zoom: 15.06 });
    await fromMenu(user, "Add point and start there…");
    const field = within(screen.getByRole("dialog", { name: "Add a new start" })).getByRole("textbox", { name: "World yards (x, y)" });
    expect(field).toHaveProperty("value", "1788.15, 3288.10");
  });

  it("gives each new leg the saved settings for new legs, and keeps the settings of each leg that exists", async () => {
    onTestFinished(() => saveNewLegs(DEFAULT_LEG));
    const C: Point = [1000, 2000];
    const D: Point = [5000, 2000];
    const changed = { ...DEFAULT_LEG, otherFaction: true, flightPaths: false };
    let user = await mount(plan(A, B));
    await user.click(screen.getByRole("button", { name: "New legs" }));
    expect(
      within(screen.getByRole("region", { name: "New legs" }))
        .getAllByRole<HTMLInputElement>("checkbox")
        .map((box) => [box.labels![0]!.textContent, box.checked, box.disabled]),
    ).toEqual([
      ["Follow terrain", true, false],
      ["Downhill shortcuts", true, false],
      ["Allow damaging falls", true, false],
      ["Allow fatal falls", false, false],
      ["Allow lava and slime", false, false],
      ["Other faction's rides", false, false],
      ["Allow Flight Paths", true, false],
      ["Allow Ship/Zeppelin Paths", true, false],
    ]);
    await user.click(screen.getByRole("checkbox", { name: "Other faction's rides" }));
    await user.click(screen.getByRole("checkbox", { name: "Allow Flight Paths" }));
    await user.keyboard("{Escape}");

    await user.click(stop("Destination"));
    await rightClick(user, D);
    await choose(user, "Add destination here");
    await waitFor(() => expect(lastRouted().legs).toEqual([DEFAULT_LEG, changed]));
    await user.click(stop("Start"));
    await rightClick(user, C);
    await choose(user, "Add point and start here");
    await waitFor(() => expect(lastRouted().legs).toEqual([changed, DEFAULT_LEG, changed]));

    cleanup();
    user = await mount(undefined, undefined, await savedStores());
    await screen.findByRole("button", { name: "Route" });
    await fromMenu(user, "New route");
    await rightClick(user, A);
    await choose(user, "Start a route here");
    await rightClick(user, B);
    await choose(user, "End the route here");
    await waitFor(() => expect([pixelsOf(lastRouted()), lastRouted().legs]).toEqual([[A, B], [changed]]));
  });

  it("inserts a waypoint into a leg where it is right-clicked, with the new waypoint selected", async () => {
    const user = await mount(plan(A, B));
    const M: Point = [3000, 3000];
    await rightClick(user, M);
    expect(screen.getByRole("menu", { name: "Leg 1 (Start → Destination)" })).toBeTruthy();
    expect(menuItems()).toEqual([
      "Insert waypoint here",
      "Follow terrain",
      "Downhill shortcuts",
      "Allow damaging falls",
      "Allow fatal falls",
      "Allow lava and slime",
      "Other faction's rides",
      "Allow Flight Paths",
      "Allow Ship/Zeppelin Paths",
    ]);
    await choose(user, "Insert waypoint here");
    await waitFor(() => expect(stops()).toEqual([A, M, B]));
    expect([stop("Waypoint 1").classList.contains("selected"), undoText()]).toEqual([true, "Undo insert waypoint 1"]);
  });

  it("makes a leg a labeled straight line with Follow terrain, and enables each leg setting only under the settings it needs", async () => {
    const toggles = ["Downhill shortcuts", "Allow damaging falls", "Allow fatal falls", "Allow lava and slime"];
    const disabled = async (user: User) => {
      const panel = toggles.filter((name) => screen.getByRole<HTMLInputElement>("checkbox", { name }).disabled);
      await rightClick(user, [3000, 3000]);
      const menu = toggles.filter((name) => screen.getByRole<HTMLButtonElement>("menuitemcheckbox", { name }).disabled);
      await user.keyboard("{Escape}");
      return { panel, menu };
    };
    const user = await mount(plan(A, B));
    await rightClick(user, [3000, 3000]);
    expect(screen.getByRole("menuitemcheckbox", { name: "Follow terrain" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Follow terrain" }));
    await waitFor(() => expect(lastRouted().legs).toEqual([{ ...DEFAULT_LEG, followTerrain: false }]));
    await waitFor(() => expect(labels()).toEqual(["straight-line estimate"]));
    expect(undoText()).toBe("Undo use a straight line on leg 1");
    expect(await disabled(user)).toEqual({ panel: toggles, menu: toggles });

    await user.click(screen.getByRole("checkbox", { name: "Follow terrain" }));
    expect(undoText()).toBe("Undo follow terrain on leg 1");
    await user.click(screen.getByRole("checkbox", { name: "Downhill shortcuts" }));
    await waitFor(() => expect(lastRouted().legs).toEqual([{ ...DEFAULT_LEG, downhill: false }]));
    expect(labels()).toEqual([]);
    const falls = ["Allow damaging falls", "Allow fatal falls"];
    expect(await disabled(user)).toEqual({ panel: falls, menu: falls });

    await user.click(screen.getByRole("checkbox", { name: "Downhill shortcuts" }));
    await user.click(screen.getByRole("checkbox", { name: "Allow damaging falls" }));
    await waitFor(() => expect(lastRouted().legs).toEqual([{ ...DEFAULT_LEG, damagingFalls: false }]));
    expect(await disabled(user)).toEqual({ panel: ["Allow fatal falls"], menu: ["Allow fatal falls"] });
  });

  it.each([
    ["Downhill shortcuts", { downhill: false }, "stop downhill shortcuts"],
    ["Allow damaging falls", { damagingFalls: false }, "stop damaging falls"],
    ["Allow fatal falls", { fatalFalls: true }, "allow fatal falls"],
    ["Allow lava and slime", { hazards: true }, "allow lava and slime"],
    ["Other faction's rides", { otherFaction: true }, "allow the other faction's rides"],
    ["Allow Flight Paths", { flightPaths: false }, "stop flight paths"],
    ["Allow Ship/Zeppelin Paths", { shipPaths: false }, "stop ship and zeppelin paths"],
  ])("routes a leg again with %s changed, and keeps the other leg", async (name, change, undo) => {
    const user = await mount(plan(A, W, B));
    await waitFor(() => expect(chip()).toBe("20 s · 2,244 yd"));
    const calls = route.mock.calls.length;
    let release = () => {};
    routeGate = new Promise((resolve) => (release = resolve));
    await selectLeg(user, 2);
    await user.click(screen.getByRole("checkbox", { name }));
    await waitFor(() => expect(route).toHaveBeenCalledTimes(calls + 1));
    expect([lastRouted().legs, looks(), undoText()]).toEqual([
      [DEFAULT_LEG, { ...DEFAULT_LEG, ...change }],
      ["leg-route", "leg-pending"],
      `Undo ${undo} on leg 2`,
    ]);
    release();
  });

  it("routes with the rides of both factions and the character's faction, and has no route bar choice for the other faction's rides", async () => {
    await mount(plan(A, B));
    const rides = route.mock.calls.at(-1)![4]!;
    expect(rides.faction).toBe("Alliance");
    expect(new Set(rides.links.flatMap((link) => link.requires.faction ?? []))).toEqual(new Set(["Alliance", "Horde"]));
    expect(lastRouted().legs[0]!.otherFaction).toBe(false);
    expect(screen.queryByRole("button", { name: "Other faction's rides" })).toBeNull();
  });

  it("shows each ride's icon where the route boards and leaves it, and beside each ride in the leg's parts", async () => {
    const at = (id: string, point: Point) => ({ id, name: id, map: 0, point });
    const link = (service: string, mode: string, from: ReturnType<typeof at>, to: ReturnType<typeof at>, requires: RideRequirements) => ({
      service,
      mode,
      from,
      to,
      requires,
      seconds: { min: 10, average: 10, max: 10 },
    });
    const ship = link("ship-southshore-loop", "ship", at("Menethil Harbor", [2500, 3000]), at("Southshore Harbor", [3000, 3000]), {
      faction: "Alliance",
    });
    const portal = link("portal-stormwind-dalaran", "portal", at("Wizard's Sanctum", [3200, 3000]), at("Dalaran", [3500, 3000]), {
      faction: "Alliance",
      race: "Skyborne",
    });
    const ground = (from: Point, to: Point) => ({ kind: "ground", map: 0, from, to, result: terrainRoute([from, to]) });
    outcome = (from, to) =>
      ({
        kind: "transport",
        parts: [
          ground(from, ship.from.point),
          { kind: "ride", link: ship },
          ground(ship.to.point, portal.from.point),
          { kind: "ride", link: portal },
          ground(portal.to.point, to),
        ],
        seconds: 50,
      }) as unknown as LegResult;
    const user = await mount(plan(A, B));
    const markers = () =>
      [...document.querySelectorAll(".ride-stop")].map(
        (m) => `${m.classList.contains("ride-leave") ? "leave" : "board"} ${m.getAttribute("data-mode")}`,
      );
    await waitFor(() => expect(markers()).toEqual(["board ship", "leave ship", "board portal", "leave portal"]));
    await selectLeg(user, 1);
    expect(facts().map((f) => f.split(":")[0])).toEqual(["Stops", "Time"]);
    const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
    expect(steps.map((step) => [step.getAttribute("data-mode"), !!step.querySelector("svg"), step.textContent])).toEqual([
      ["ground", true, expect.stringMatching(/^Run to the ship\d/)],
      ["ship", true, "Ship to Southshore Harbor10 s"],
      ["ground", true, expect.stringMatching(/^Run to the portal\d/)],
      ["portal", true, "Portal to Dalaran10 s"],
      ["ground", true, expect.stringMatching(/^Run to the destination\d/)],
    ]);
  });

  it("previews a drag with straight lines, routes on release, and undoes the drag as one edit", async () => {
    const user = await mount(plan(A, W, B));
    await selectLeg(user, 2);
    await user.click(screen.getByRole("checkbox", { name: "Downhill shortcuts" }));
    await waitFor(() => expect(lastRouted().legs[1]!.downhill).toBe(false));
    const calls = route.mock.calls.length;

    const pin = stop("Waypoint 1");
    fireEvent.pointerDown(pin, { button: 0, ...client(W) });
    for (const x of [3100, 3200, 3300]) fireEvent.pointerMove(pin, client([x, 3400]));
    expect(document.querySelectorAll(".route-lines .leg-preview")).toHaveLength(2);
    expect(chip()).toBe("Release to place the stop and route again.");
    expect(route).toHaveBeenCalledTimes(calls);
    fireEvent.pointerUp(pin, client([3300, 3400]));
    await waitFor(() => expect(stops()).toEqual([A, [3300, 3400], B]));
    expect(route).toHaveBeenCalledTimes(calls + 1);
    await waitFor(() => expect(document.querySelectorAll(".route-lines .leg-route")).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect([chip() === "Finding walking paths…", route.mock.calls.length]).toEqual([false, calls + 1]);
    await waitFor(async () => expect(pixelsOf(await saved())).toEqual([A, W, B]));
    expect((await saved()).legs[1]!.downhill).toBe(false);

    const destination = stop("Destination");
    fireEvent.pointerDown(destination, { button: 0, ...client(B) });
    fireEvent.pointerMove(destination, client([4200, 3200]));
    expect(looks()).toEqual(["leg-route", "leg-preview"]);
    fireEvent.pointerUp(destination, client([4200, 3200]));
  });
});
