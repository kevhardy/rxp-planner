import { describe, expect, it } from "vitest";
import { frameStats } from "./frames.ts";

describe("frameStats", () => {
  it("measures the gap from the start to the first frame", () => {
    expect(frameStats([100, 180, 196])).toEqual({ longestFrameMs: 80, longFrames: 1, frames: 2 });
  });

  it("counts only gaps over 50 ms as long frames", () => {
    expect(frameStats([0, 50, 100.5, 117, 300])).toEqual({ longestFrameMs: 183, longFrames: 2, frames: 4 });
  });

  it("gives zero for a span with no frame", () => {
    expect(frameStats([42])).toEqual({ longestFrameMs: 0, longFrames: 0, frames: 0 });
  });
});
