import { describe, expect, it } from "vitest";
import { dungeonTag } from "./profile.ts";

describe("dungeonTag", () => {
  it("finds the tag for a tag, an alternate name, or an area ID, in any case, as RXP's GetDungeonName does", () => {
    expect(["HOT", "bmh", "Sh", "DC", "ESW", "AI", "SHT", "16985", "153", "DMW", "XYZ"].map(dungeonTag)).toEqual([
      "HOT",
      "BH",
      "TDC",
      "TDC",
      "ES",
      "AP",
      "TST",
      "TST",
      "ROL",
      "DME",
      undefined,
    ]);
  });
});
