// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { createRef } from "react";
import { expect, it } from "vitest";
import { MapViewContext, MapView } from "../map/view.ts";
import { RouteLayer } from "./RouteLayer.tsx";

// SVG paints in document order and Chromium ignores z-index in SVG, so the
// chosen look must come before every leg for a focused leg's ring to show over it.
it("draws the chosen leg's look under every leg", () => {
  const { container } = render(
    <MapViewContext.Provider value={new MapView()}>
      <RouteLayer
        layer={createRef()}
        lines={[
          {
            look: "route",
            view: [
              { x: 10, y: 50 },
              { x: 90, y: 50 },
            ],
          },
          {
            look: "route",
            view: [
              { x: 50, y: 10 },
              { x: 50, y: 90 },
            ],
          },
        ]}
        names={["Leg 1", "Leg 2"]}
        selected={1}
        onSelect={() => {}}
        pxPerPercent={1}
        aspect={1}
      />
    </MapViewContext.Provider>,
  );
  const layers = [...container.querySelector(".route-lines")!.children].map((child) => [
    child.getAttribute("class"),
    child.querySelector("polyline")?.getAttribute("points"),
  ]);
  expect(layers).toEqual([
    ["leg-chosen", "50,10 50,90"],
    ["route-leg leg-route", "10,50 90,50"],
    ["route-leg leg-route chosen", "50,10 50,90"],
  ]);
});
