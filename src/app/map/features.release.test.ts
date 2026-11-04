import { describe, expect, it } from "vitest";
import { releaseData, releaseTerrain } from "../../data/releaseInputs.ts";
import { indexFeatures, searchFeatures } from "./features.ts";

describe("searchFeatures", () => {
  it("searches the complete innkeeper index", () => {
    const results = searchFeatures(indexFeatures(releaseData(), releaseTerrain), "innkeeper");
    expect(results).toHaveLength(44);
    expect(results.slice(0, 3).every((f) => f.name.startsWith("Innkeeper"))).toBe(true);
  });
});
