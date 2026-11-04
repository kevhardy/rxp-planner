import { describe, expect, it } from "vitest";
import { releaseTerrain } from "../../data/releaseInputs.ts";
import { iconOf, layerOf } from "./terrain.ts";

describe("terrain tiles", () => {
  it("gives every bundled marker category a toggle on a layer, and each that draws markers an icon", async () => {
    const map = releaseTerrain;
    for (const category of map.categories) expect(layerOf(category), category.key).toBeDefined();
    const drawn = new Set(map.pois.map((p) => p.category));
    for (const category of map.categories) expect(!!iconOf(category, map.icons), category.key).toBe(drawn.has(category.key));
    expect(map.categories.filter((c) => !drawn.has(c.key)).map((c) => c.key)).toEqual(["routes"]);
    expect(
      iconOf(
        map.categories.find((c) => c.key === "dungeon-quest-giver")!,
        map.icons,
      ),
    ).toBe("quest-giver");
    expect(layerOf(map.categories.find((c) => c.key === "dungeon-quest-giver")!)).toBe("questGivers");
    expect(layerOf(map.categories.find((c) => c.key === "dungeon")!)).toBe("instances");
  });
});
