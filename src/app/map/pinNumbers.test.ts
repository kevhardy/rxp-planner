// @vitest-environment jsdom
import { expect, it } from "vitest";
import { plannerData } from "../../data/plannerFixture.ts";
import { worldMap } from "../../data/terrainFixture.ts";
import { parseGuide } from "../../guide/index.ts";
import { guideLayout } from "./guideLayout.ts";
import { crowdedNumbers } from "./pinNumbers.ts";
import { terrainSurface } from "./surfaces.ts";

it("prints only the number of the pin nearest the selected step where numbered pins overlap, and every number of the selected step", () => {
  const data = plannerData();
  const goto = (at: string) => `.goto Elwynn Forest,${at}\n`;
  const text = [goto("40,40"), goto("40.2,40"), goto("40,40.2") + goto("40.1,40.2"), goto("40.2,40.2"), goto("50,50")].map(
    (g) => `step\n${g}`,
  );
  const laid = guideLayout(terrainSurface(data, worldMap, new WeakMap()), {
    data,
    doc: parseGuide(`#group T\n#name One\n${text.join("")}`),
    selection: { step: 2, line: null },
    spots: [],
    areas: [],
    highlight: null,
    showGuide: true,
    previousSteps: "dimmed",
    upcomingSteps: "dimmed",
  });
  // At 400 px a percent, a 0.2 zone percent step is about 7 px, under a pin's 16 px; at 4000 px it is about 70 px.
  expect([...crowdedNumbers(laid.pins, 400, 1)].sort()).toEqual(["p0:0", "p1:0", "p3:0"]);
  expect([...crowdedNumbers(laid.pins, 4000, 1)]).toEqual([]);
});
