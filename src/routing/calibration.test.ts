import type { Point } from "./frame.ts";
import { describe, expect, it } from "vitest";
import {
  calibrate,
  calibrationBytes,
  calibrationMarkdown,
  parseObservations,
  TOLERANCE,
  type Observation,
  type RoutedCorridor,
} from "./calibration.ts";
import type { ArtifactScope } from "./artifact.ts";

const SCOPE: ArtifactScope = { variant: "forever", build: "1.2.3.4", map: 0 };

const observation = (id: string, change: Partial<Observation> = {}): Observation => ({
  id,
  scope: SCOPE,
  from: [100, 100],
  to: [400, 100],
  mode: "run",
  conditions: "Level 12, no speed effects.",
  seconds: 40,
  source: "test: timed by hand",
  ...change,
});

const corridor = (runs: RoutedCorridor["runs"], from: Point = [100, 100], to: Point = [400, 100]): RoutedCorridor => ({
  name: "Road",
  from,
  to,
  runs,
});

const report = (corridors: RoutedCorridor[], observations: Observation[]) =>
  calibrate({ artifact: "routing-test", scope: SCOPE, settings: {}, corridors, observations });

describe("calibrate", () => {
  it("gives the error of a terrain route in seconds and in percent of the observed time", () => {
    const nearby = observation("a", { from: [100 + TOLERANCE, 100], seconds: 40 });
    const { entries, counts } = report([corridor([{ mode: "run", estimate: { kind: "route", seconds: 45, distance: 300 } }])], [nearby]);
    expect(entries[0]).toMatchObject({ status: "calibrated", observations: [{ id: "a", error: { seconds: 5, percent: 12.5 } }] });
    expect(counts).toMatchObject({ calibrated: 1, uncalibrated: 0, unmatched: 0 });
  });

  it("gives uncalibrated for a run without a matching observation", () => {
    const far = observation("far", { to: [400 + TOLERANCE + 1, 100] });
    const reverse = observation("reverse", { from: [400, 100], to: [100, 100] });
    const { entries, unmatched } = report([corridor([{ mode: "run", estimate: { kind: "route", seconds: 45 } }])], [far, reverse]);
    expect(entries[0]).toMatchObject({ status: "uncalibrated", observations: [] });
    expect(unmatched).toEqual(["far", "reverse"]);
  });

  it("matches no observation of a corridor too short to give a direction", () => {
    const from: Point = [100, 100],
      to: Point = [108, 100];
    const reverse = observation("reverse", { from: to, to: from });
    const same = observation("same", { from, to });
    const result = report([corridor([{ mode: "run", estimate: { kind: "route", seconds: 1 } }], from, to)], [reverse, same]);
    expect(result.entries[0]).toMatchObject({ status: "uncalibrated", short: true, observations: [] });
    expect(result.unmatched).toEqual(["reverse", "same"]);
    expect(calibrationMarkdown(result)).toContain("| uncalibrated (corridor too short) |");
  });

  it("does not match another mode", () => {
    const mounted = observation("mounted", { mode: "mount" });
    const result = report([corridor([{ mode: "run", estimate: { kind: "route", seconds: 45 } }])], [mounted]);
    expect(result.entries[0]!.status).toBe("uncalibrated");
    expect(result.unmatched).toEqual(["mounted"]);
  });

  it("reports an observation of another build or variant as out of scope and never matches it", () => {
    const build = observation("build", { scope: { ...SCOPE, build: "1.2.3.5" } });
    const variant = observation("variant", { scope: { ...SCOPE, variant: "classic" } });
    const result = report([corridor([{ mode: "run", estimate: { kind: "route", seconds: 45 } }])], [build, variant]);
    expect(result.entries[0]!.status).toBe("uncalibrated");
    expect(result.outOfScope.map((o) => o.id)).toEqual(["build", "variant"]);
    expect(result.counts).toMatchObject({ observations: 2, outOfScope: 2, unmatched: 0 });
    expect(calibrationMarkdown(result)).toContain("- build: forever 1.2.3.5 map 0, run, 40.00 s");
  });

  it("keeps the kind of a failed or provisional estimate and gives it no error", () => {
    const result = report(
      [
        corridor([
          { mode: "run", estimate: { kind: "missing-coverage", provisional: true, seconds: 45, distance: 300 } },
          { mode: "mount", estimate: { kind: "no-path" } },
        ]),
      ],
      [observation("a"), observation("b", { mode: "mount" })],
    );
    expect(result.entries.map((e) => e.status)).toEqual(["not-comparable", "not-comparable"]);
    expect(result.entries.flatMap((e) => e.observations).some((o) => "error" in o)).toBe(false);
    expect(calibrationMarkdown(result)).toContain(
      "| Road | run | missing-coverage (provisional 45.00 s) | a: 40.00 s |  | not-comparable |",
    );
  });

  it("renders one report as fixed JSON bytes and Markdown", () => {
    const result = report([corridor([{ mode: "run", estimate: { kind: "route", seconds: 41.37 } }])], [observation("a")]);
    const bytes = calibrationBytes(result);
    expect(bytes.split("\n").slice(0, 4)).toEqual([
      "{",
      '  "schema": "restedxp-routing-calibration",',
      '  "version": 1,',
      '  "artifact": "routing-test",',
    ]);
    expect(bytes).toContain(
      '      "estimate": {\n        "kind": "route",\n        "seconds": 41.37\n      },\n      "status": "calibrated",',
    );
    expect(bytes).toContain('          "error": {\n            "seconds": 1.37,\n            "percent": 3.4\n          }');
    expect(bytes.split("\n").slice(-4)).toEqual(['  "unmatched": [],', '  "outOfScope": []', "}", ""]);
    expect(calibrationMarkdown(result)).toBe(
      [
        "# Routing calibration",
        "",
        "Artifact `routing-test`, forever 1.2.3.4 map 0. Endpoint tolerance: 8 native pixels.",
        "",
        "Runs: 1 calibrated, 0 uncalibrated, 0 not comparable. Observations: 1, 0 unmatched, 0 out of scope.",
        "",
        "| Corridor | Mode | Estimate | Observed | Error | Status |",
        "| --- | --- | --- | --- | --- | --- |",
        "| Road | run | 41.37 s | a: 40.00 s | +1.37 s (+3.4%) | calibrated |",
        "",
      ].join("\n"),
    );
  });
});

describe("parseObservations", () => {
  const file = (observations: Observation[], scope = SCOPE) => ({
    schema: "restedxp-routing-observations",
    version: 1,
    scope,
    observations,
  });

  it("keeps an observation of another build for the report", () => {
    const other = observation("b", { scope: { ...SCOPE, build: "1.2.3.5" } });
    expect(parseObservations(file([observation("a"), other]), SCOPE)).toEqual([observation("a"), other]);
  });

  it("refuses a file of another scope and observations out of ID order", () => {
    expect(() => parseObservations(file([], { ...SCOPE, map: 1 }), SCOPE)).toThrow(/^observations\.scope:/);
    expect(() => parseObservations(file([observation("b"), observation("a")]), SCOPE)).toThrow(
      "observations.observations[1].id: expected ascending, distinct IDs",
    );
  });
});
