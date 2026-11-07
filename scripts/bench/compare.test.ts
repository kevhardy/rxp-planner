import { describe, expect, it } from "vitest";
import { compare } from "./compare.ts";
import type { BenchMeta, BenchSample } from "./results.ts";

const meta = (dataset = "sha256:a"): BenchMeta => ({
  event: "meta",
  area: "routing",
  commit: "c0ffee",
  dirty: false,
  dataset,
  node: "v24.0.0",
  cpus: 8,
  loadavg: [0, 0, 0],
  options: {},
});

const samples = (values: number[], signature = "s1"): BenchSample[] =>
  values.map((value, i) => ({ event: "sample", scenario: "boat", metric: "routeMs", unit: "ms", run: i + 1, value, signature }));

const side = (values: number[], signature?: string) => [meta(), ...samples(values, signature)];

describe("compare", () => {
  it("calls head faster when its range is below the base range", () => {
    expect(compare(side([8, 9, 10, 11, 12]), side([3, 4, 5, 6, 7]))).toEqual([
      {
        scenario: "boat",
        metric: "routeMs",
        unit: "ms",
        verdict: "faster",
        base: { median: 10, min: 8, max: 12, count: 5 },
        head: { median: 5, min: 3, max: 7, count: 5 },
        changePercent: -50,
        outputChanged: false,
        fewSamples: false,
      },
    ]);
  });

  it("calls head slower when its range is above the base range", () => {
    expect(compare(side([8, 9, 10, 11, 12]), side([13, 14, 15, 16, 17]))).toEqual([
      {
        scenario: "boat",
        metric: "routeMs",
        unit: "ms",
        verdict: "slower",
        base: { median: 10, min: 8, max: 12, count: 5 },
        head: { median: 15, min: 13, max: 17, count: 5 },
        changePercent: 50,
        outputChanged: false,
        fewSamples: false,
      },
    ]);
  });

  it("finds no measurable difference when the ranges touch", () => {
    expect(compare(side([8, 9, 10, 11, 12]), side([12, 13, 14, 15, 16]))).toEqual([
      {
        scenario: "boat",
        metric: "routeMs",
        unit: "ms",
        verdict: "no measurable difference",
        base: { median: 10, min: 8, max: 12, count: 5 },
        head: { median: 14, min: 12, max: 16, count: 5 },
        changePercent: 40,
        outputChanged: false,
        fewSamples: false,
      },
    ]);
  });

  it("takes the mean of the middle two as the median of an even count, and marks few samples", () => {
    expect(compare(side([4, 1, 3, 2]), side([2, 3, 4, 5, 6, 7]))).toEqual([
      {
        scenario: "boat",
        metric: "routeMs",
        unit: "ms",
        verdict: "no measurable difference",
        base: { median: 2.5, min: 1, max: 4, count: 4 },
        head: { median: 4.5, min: 2, max: 7, count: 6 },
        changePercent: 80,
        outputChanged: false,
        fewSamples: true,
      },
    ]);
  });

  it("marks a row whose sides give different signatures", () => {
    expect(compare(side([8, 9, 10, 11, 12], "s1"), side([8, 9, 10, 11, 12], "s2"))).toEqual([
      {
        scenario: "boat",
        metric: "routeMs",
        unit: "ms",
        verdict: "no measurable difference",
        base: { median: 10, min: 8, max: 12, count: 5 },
        head: { median: 10, min: 8, max: 12, count: 5 },
        changePercent: 0,
        outputChanged: true,
        fewSamples: false,
      },
    ]);
  });

  it("gives no change percent when the base median is 0", () => {
    expect(compare(side([0, 0, 0, 0, 0]), side([1, 1, 1, 1, 1]))).toEqual([
      {
        scenario: "boat",
        metric: "routeMs",
        unit: "ms",
        verdict: "slower",
        base: { median: 0, min: 0, max: 0, count: 5 },
        head: { median: 1, min: 1, max: 1, count: 5 },
        changePercent: undefined,
        outputChanged: false,
        fewSamples: false,
      },
    ]);
  });

  it("refuses to compare runs on different datasets", () => {
    expect(() => compare([meta("sha256:a"), ...samples([1])], [meta("sha256:b"), ...samples([1])])).toThrow(
      "Refusing to compare runs with different dataset: sha256:a, sha256:b",
    );
  });
});
