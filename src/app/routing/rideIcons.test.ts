import { describe, expect, it } from "vitest";
import { rideIcon } from "./rideIcons.ts";

describe("ride icons", () => {
  it("gives each ride mode its icon, and a portal's icon to a transition, which reads as a portal", () => {
    const modes = ["ship", "zeppelin", "tram", "portal", "transition", "access", "druid-flight", "elevator", "flight"];
    expect(Object.fromEntries(modes.map((mode) => [mode, rideIcon(mode)]))).toEqual({
      ship: "ship",
      zeppelin: "zeppelin",
      tram: "tram",
      portal: "portal",
      transition: "portal",
      access: "door",
      "druid-flight": "bird",
      elevator: "elevator",
      flight: "flight",
    });
  });

  it("shows the route icon for a mode without one", () => {
    expect(rideIcon("hearthstone")).toBe("route");
    expect(rideIcon("toString")).toBe("route");
  });
});
