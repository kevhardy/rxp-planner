// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLeg } from "../../routing/plan.ts";
import { placeTransports } from "../../routing/transport.ts";
import { DEFAULT_LAYERS, saveLayerChoices } from "./MapLayers.tsx";
import {
  manifest,
  proj,
  transports,
  A,
  B,
  route,
  mount,
  plan,
  client,
  mapArea,
  stop,
  type User,
  popover,
  routePanel,
  facts,
  stepLists,
  chip,
  savedStores,
} from "./routeWorkspaceFixture.tsx";

describe("rides layer", () => {
  const ride = (name: string) => screen.getByRole("button", { name });
  const rideIcons = () => within(screen.getByRole("group", { name: "Rides" })).getAllByRole("button");
  const rideNames = (icons: HTMLElement[]) => icons.map((b) => b.getAttribute("aria-label"));
  const previewLines = () => document.querySelectorAll(".ride-preview g").length;
  const SHIP = "Ship: Menethil Harbor to Southshore Harbor";
  const IRONFORGE = "Flight master: Ironforge, 7 flights";
  const MENETHIL = "Flight master: Menethil Harbor, 1 flight";
  const BOOTY_BAY = "Flight master: Booty Bay, 1 flight, Horde ride";
  const ironforgeToMenethil = () => plan([5000, 9500], [6000, 11000]);

  beforeEach(() => saveLayerChoices(DEFAULT_LAYERS));

  it("marks the character's ride stops, and previews a boat's ride and times in place of the Route panel without a new search", async () => {
    const user = await mount(plan(A, B));
    await waitFor(() => expect(chip()).toBe("10 s · 2,083 yd"));
    expect(rideNames(rideIcons())).toEqual([
      "Deeprun Tram: Ironforge to Stormwind City",
      "Deeprun Tram: Stormwind City to Ironforge",
      IRONFORGE,
      MENETHIL,
      "Portal: Wizard's Sanctum to Dalaran",
      SHIP,
      "Ship: Southshore Harbor to Menethil Harbor",
    ]);
    const searches = route.mock.calls.length;

    await user.click(ride(SHIP));
    expect(screen.getByRole("region", { name: "Ship: Menethil Harbor" })).toBe(popover());
    expect(facts()).toEqual(["Who can ride: Alliance only"]);
    expect(stepLists(popover()!)).toEqual([["Rides", ["Ship to Southshore HarborVaries: 4 min 0 s to 7 min 0 s5 min 0 s"]]]);
    expect(ride(SHIP).getAttribute("aria-pressed")).toBe("true");
    expect(rideNames(rideIcons().filter((b) => b.classList.contains("ride-end")))).toEqual(["Ship: Southshore Harbor to Menethil Harbor"]);
    expect(previewLines()).toBe(1);
    expect(routePanel()).toBeNull();

    await user.keyboard("{Escape}");
    expect([popover(), previewLines(), document.activeElement]).toEqual([null, 0, ride(SHIP)]);
    expect(routePanel()).not.toBeNull();

    await user.keyboard("{Enter}");
    expect(popover()!.querySelector("h3")!.textContent).toBe("Ship: Menethil Harbor");
    await user.pointer({ keys: "[MouseLeft]", target: mapArea(), coords: client([2000, 6000]) });
    expect([popover(), routePanel() === null]).toEqual([null, false]);
    expect(route).toHaveBeenCalledTimes(searches);
  });

  it("gives the flight list no focus stop of its own when the card's body clips, since the body then scrolls the whole list", async () => {
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
      return this.matches(".map-popover-body") ? 400 : 0;
    });
    const user = await mount(ironforgeToMenethil());
    await user.click(ride(IRONFORGE));
    expect(within(popover()!).getByRole("group", { name: "Direct flights" }).hasAttribute("tabindex")).toBe(false);
  });

  it("lists a flight master's direct flights with their estimates in a list that scrolls, and returns focus to its icon on Close", async () => {
    const user = await mount(ironforgeToMenethil());
    await user.click(ride(IRONFORGE));
    const flights = [
      ["Aerie Peak", "4 min 0 s"],
      ["Menethil Harbor", "3 min 0 s"],
      ["Refuge Pointe", "5 min 30 s"],
      ["Southshore", "6 min 0 s"],
      ["Stormwind", "2 min 30 s"],
      ["Thelsamar", "1 min 0 s"],
      ["Thorium Point", "2 min 0 s"],
    ];
    expect(facts()).toEqual(["Who can ride: Alliance only"]);
    expect(stepLists(popover()!)).toEqual([
      ["Direct flights", flights.map(([to, time]) => `Fly to ${to}Estimate from the flight length${time}`)],
    ]);
    expect(within(popover()!).getByRole("group", { name: "Direct flights" }).tabIndex).toBe(0);
    expect(previewLines()).toBe(7);
    expect(rideNames(rideIcons().filter((b) => b.classList.contains("ride-end")))).toEqual([MENETHIL]);

    await user.click(within(popover()!).getByRole("button", { name: "Close" }));
    expect([popover(), document.activeElement]).toEqual([null, ride(IRONFORGE)]);

    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(ride(MENETHIL));
    await user.click(within(popover()!).getByRole("button", { name: "Close" }));
    expect([popover(), document.activeElement]).toEqual([null, ride(IRONFORGE)]);
  });

  describe("icons that overlap", () => {
    const links = placeTransports(transports, [manifest]);
    const stops = new Map(links.map((l) => [l.from.id, l.from]));
    const zoomOut = () => screen.getByRole<HTMLButtonElement>("button", { name: "Zoom out" });
    const zoomOutFully = async (user: User) => {
      while (!zoomOut().disabled) await user.click(zoomOut());
    };
    const moved = () => {
      const px = 10 * Number(document.querySelector<HTMLElement>(".map-viewport")!.style.getPropertyValue("--zoom"));
      return rideIcons().flatMap((b) => {
        const home = stops.get(b.dataset.stop!)!;
        const at = proj.toView(home.point, home.map)!;
        const by = [parseFloat(b.style.getPropertyValue("--at-x")) - at.x, parseFloat(b.style.getPropertyValue("--at-y")) - at.y].map((d) =>
          Math.round(d * px),
        );
        return by.some((d) => d !== 0) ? [`${b.getAttribute("aria-label")} by ${by.join(", ")}`] : [];
      });
    };

    it("moves each icon that would cover an earlier icon to the nearest free place, and keeps the icons at their stops where none overlap", async () => {
      const user = await mount(plan(A, B));
      expect(moved()).toEqual([]);
      await zoomOutFully(user);
      expect(moved()).toEqual([`${IRONFORGE} by -20, 0`, "Portal: Wizard's Sanctum to Dalaran by 0, 10", `${SHIP} by -20, 0`]);
    });

    it("moves an icon off a route stop at its dock, and keeps the stop in place", async () => {
      const ship = links.find((l) => l.mode === "ship" && l.from.name === "Menethil Harbor")!.from.point;
      await mount(plan(ship, B));
      const start = proj.toView(ship, 0)!;
      expect([stop("Start").style.getPropertyValue("--at-x"), stop("Start").style.getPropertyValue("--at-y")]).toEqual([
        `${start.x}%`,
        `${start.y}%`,
      ]);
      expect(moved()).toEqual([`${IRONFORGE} by -10, 0`, `${MENETHIL} by 10, 0`, `${SHIP} by -20, 0`]);
    });
  });

  it("gives the icons in view one Tab stop, and moves between them with the arrow keys, Home, and End", async () => {
    const user = await mount(ironforgeToMenethil());
    const tabStops = () => rideNames(rideIcons().filter((b) => b.tabIndex === 0));
    const TRAM = "Deeprun Tram: Ironforge to Stormwind City";
    expect(tabStops()).toEqual([TRAM]);
    ride(TRAM).focus();
    const walk = [];
    for (const key of ["{ArrowRight}", "{ArrowDown}", "{ArrowRight}", "{ArrowRight}", "{ArrowUp}", "{Home}", "{ArrowLeft}", "{End}"]) {
      await user.keyboard(key);
      walk.push(document.activeElement!.getAttribute("aria-label"));
    }
    expect(walk).toEqual([IRONFORGE, MENETHIL, SHIP, SHIP, MENETHIL, TRAM, TRAM, SHIP]);
    expect(tabStops()).toEqual([SHIP]);
  });

  it("hides the icons and the preview with the Rides layer off, clears the selected ride, and keeps the choice in this browser", async () => {
    let user = await mount(plan(A, B));
    await user.click(ride(SHIP));
    await user.click(screen.getByRole("button", { name: "Layers" }));
    await user.click(screen.getByRole("checkbox", { name: "Rides" }));
    expect([screen.queryByRole("group", { name: "Rides" }), popover()]).toEqual([null, null]);
    await user.click(screen.getByRole("checkbox", { name: "Rides" }));
    expect([popover(), previewLines(), ride(SHIP).getAttribute("aria-pressed")]).toEqual([null, 0, "false"]);
    await user.click(screen.getByRole("checkbox", { name: "Rides" }));
    cleanup();
    user = await mount(plan(A, B), undefined, await savedStores());
    await screen.findByRole("button", { name: "Layers" });
    expect(screen.queryByRole("group", { name: "Rides" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Layers" }));
    await user.click(screen.getByRole("checkbox", { name: "Rides" }));
    expect(rideIcons()).toHaveLength(7);
  });

  it("shows the other faction's ride stops, dimmed and lettered, only while a leg takes the other faction's rides", async () => {
    const user = await mount(setLeg(plan(A, B), 0, { otherFaction: true }));
    const other = rideIcons().filter((b) => b.classList.contains("ride-other"));
    expect(rideNames(other)).toEqual([BOOTY_BAY, "Zeppelin: Grom'gol to Tirisfal Glades, Horde ride"]);
    expect(other.every((b) => b.textContent === "H")).toBe(true);
    await user.click(ride(BOOTY_BAY));
    expect(facts()).toEqual(["Who can ride: Horde only"]);
    expect(popover()!.querySelector("p.muted")!.textContent).toBe(
      "The other faction's ride. A leg takes it only with Other faction's rides on.",
    );

    cleanup();
    await mount(plan(A, B));
    await screen.findByRole("group", { name: "Rides" });
    expect(screen.queryByRole("button", { name: BOOTY_BAY })).toBeNull();
    expect(rideIcons().some((b) => b.classList.contains("ride-other"))).toBe(false);
  });

  it("searches with the preview character's rides, and searches again when its race changes", async () => {
    const stores = await savedStores();
    await mount(plan(A, B), undefined, stores);
    const faction = () => route.mock.calls.at(-1)![4]!.faction;
    expect(faction()).toBe("Alliance");
    act(() => stores.preview.update({ race: "Orc" }));
    await waitFor(() => expect(faction()).toBe("Horde"));
  });
});
