import { describe, expect, it } from "vitest";
import { releaseData } from "./releaseInputs.ts";

describe("release inputs", () => {
  it("read the dataset that pnpm data:install installed", () => {
    expect(releaseData().quest(783)?.id).toBe(783);
  });
});
