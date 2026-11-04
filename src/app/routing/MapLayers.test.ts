// @vitest-environment jsdom
import type { Point } from "../../routing/frame.ts";
import { describe, expect, it } from "vitest";
import { at } from "../../routing/fixtures/region.ts";
import { createPlan } from "../../routing/plan.ts";
import { layerSearches } from "./MapLayers.tsx";

describe("layerSearches", () => {
  it("gives each search its own id, and the same search the same id", () => {
    const id = (start: Point) => layerSearches(createPlan(at(start), at([100, 100]), "p"), "Run", { leg: 0 }).explored?.search.id;
    const [a, b] = [id([68, 18]), id([9813, 4])];
    expect(a).not.toBe(b);
    expect(id([68, 18])).toBe(a);
  });

  it("gives a new search when only a stop's height changes", () => {
    const plan = createPlan(at([4241, 12400]), at([4264, 12420]), "p");
    const ids = (heights: (number | null)[], selected: { stop: number } | { leg: number }) => {
      const searches = layerSearches({ ...plan, stops: plan.stops.map((stop, i) => ({ ...stop, height: heights[i]! })) }, "Run", selected);
      return (searches.explored ?? searches.reachable)?.search.id;
    };
    expect(ids([384.125, 371], { leg: 0 })).not.toBe(ids([384.125, 385], { leg: 0 }));
    expect(ids([384.125, 371], { stop: 0 })).not.toBe(ids([367, 371], { stop: 0 }));
    expect(ids([384.125, 371], { stop: 0 })).toBe(ids([384.125, 371], { stop: 0 }));
  });
});
