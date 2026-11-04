import { describe, expect, it } from "vitest";
import { releaseNames } from "./releaseInputs.ts";
import { EntityIndex } from "./entities.ts";

describe("EntityIndex", () => {
  it("reads finished release names, spell ranks, search order and repeated names", () => {
    const index = new EntityIndex(releaseNames());
    for (const [type, id, name] of [
      ["item", 723, "Goretusk Liver"],
      ["npc", 196, "Eagan Peltskinner"],
      ["quest", 33, "Wolves Across the Border"],
      ["spell", 133, "Fireball"],
      ["object", 1731, "Copper Vein"],
    ] as const) {
      expect(index.lookup(type, id)?.name).toBe(name);
      expect(index.search(type, String(id), 1)[0]?.id).toBe(id);
      expect(index.search(type, name).some((e) => e.id === id)).toBe(true);
    }
    expect(index.lookup("spell", 133)?.subtext).toBe("Rank 1");
    expect(index.search("item", "red linen", 10).map((e) => e.name)).toContain("Red Linen Bandana");
    expect(index.search("item", "Refreshing Spring Water").filter((e) => e.name === "Refreshing Spring Water").length).toBeGreaterThan(1);
  });
});
