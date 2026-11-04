import { describe, expect, it } from "vitest";
import { keyOptions, skipRuns } from "./stepRuns.ts";

const skipped = (steps: number[]) => (step: number) => steps.includes(step);

describe("skipRuns", () => {
  it("folds two or more skipped steps in a row, and leaves a single skipped step alone", () => {
    expect(skipRuns(9, skipped([1, 2, 3, 5, 7, 8]), null, new Set())).toEqual(
      new Map([
        [1, { last: 3, folded: true }],
        [7, { last: 8, folded: true }],
      ]),
    );
  });

  it("opens a run by its first step, or while the selection is inside it past its first step", () => {
    const runs = (selected: number | null, open: number[]) =>
      [...skipRuns(9, skipped([1, 2, 3, 7, 8]), selected, new Set(open))].map(([first, run]) => [first, run.folded]);
    expect(runs(null, [7])).toEqual([
      [1, true],
      [7, false],
    ]);
    expect(runs(2, [])).toEqual([
      [1, false],
      [7, true],
    ]);
    expect(runs(1, [])).toEqual([
      [1, true],
      [7, true],
    ]);
  });
});

describe("keyOptions", () => {
  it("counts a folded run as its first step and an open run as each of its steps", () => {
    const runs = new Map([
      [1, { last: 3, folded: true }],
      [7, { last: 8, folded: false }],
    ]);
    expect(keyOptions(9, runs)).toEqual([0, 1, 4, 5, 6, 7, 8]);
  });
});
