/**
 * Compares the benchmark records of a base checkout with those of a head checkout:
 *   pnpm bench:compare --base base-1.jsonl base-2.jsonl --head head-1.jsonl head-2.jsonl [--fail-on-slower]
 * A verdict needs the ranges to separate: `slower` when every head sample is above every base sample, `faster`
 * when every head sample is below every base sample. Medians alone move with noise, so they give no verdict.
 */
import { readFile } from "node:fs/promises";
import { spread, type BenchMeta, type BenchSample, type Spread } from "./results.ts";

export type BenchRecords = readonly (BenchMeta | BenchSample)[];

export type Verdict = "faster" | "slower" | "no measurable difference";

/** Fewer samples than this on a side make a range too likely to overlap or separate by chance. */
export const MIN_SAMPLES = 5;

export type CompareRow = { scenario: string; metric: string; unit: BenchSample["unit"] } & (
  | {
      verdict: Verdict;
      base: Spread;
      head: Spread;
      /** The change from the base median to the head median, in percent of the base median. `undefined` when the base median is 0. */
      changePercent: number | undefined;
      /** The sides give different signatures, so the head computes another output. */
      outputChanged: boolean;
      fewSamples: boolean;
    }
  | { verdict: "only in base" | "only in head"; samples: Spread }
);

const MATCHED = ["area", "dataset", "renderer"] as const;

export function compare(base: BenchRecords, head: BenchRecords): CompareRow[] {
  const metas = [base, head].map((records, side) => {
    const found = records.filter((r) => r.event === "meta");
    if (!found.length) throw new Error(`The ${side ? "head" : "base"} records have no meta record`);
    return found;
  });
  for (const field of MATCHED) {
    const values = new Set(metas.flat().map((m) => m[field]));
    if (values.size > 1) throw new Error(`Refusing to compare runs with different ${field}: ${[...values].join(", ")}`);
  }
  const groups = new Map<
    string,
    { scenario: string; metric: string; unit: BenchSample["unit"]; base: BenchSample[]; head: BenchSample[] }
  >();
  for (const [side, records] of [
    ["base", base],
    ["head", head],
  ] as const)
    for (const record of records) {
      if (record.event !== "sample") continue;
      const key = JSON.stringify([record.scenario, record.metric]);
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { scenario: record.scenario, metric: record.metric, unit: record.unit, base: [], head: [] }));
      group[side].push(record);
    }
  return [...groups.values()].map(({ base, head, ...name }): CompareRow => {
    if (!head.length) return { ...name, verdict: "only in base", samples: spread(base.map((s) => s.value)) };
    if (!base.length) return { ...name, verdict: "only in head", samples: spread(head.map((s) => s.value)) };
    const b = spread(base.map((s) => s.value));
    const h = spread(head.map((s) => s.value));
    return {
      ...name,
      verdict: h.min > b.max ? "slower" : h.max < b.min ? "faster" : "no measurable difference",
      base: b,
      head: h,
      changePercent: b.median ? ((h.median - b.median) / b.median) * 100 : undefined,
      outputChanged: signatures(base) !== signatures(head),
      fewSamples: b.count < MIN_SAMPLES || h.count < MIN_SAMPLES,
    };
  });
}

const signatures = (samples: readonly BenchSample[]) =>
  JSON.stringify([...new Set(samples.map((s) => s.signature ?? ""))].toSorted((a, b) => a.localeCompare(b)));

export async function readRecords(paths: readonly string[]): Promise<(BenchMeta | BenchSample)[]> {
  const records: (BenchMeta | BenchSample)[] = [];
  for (const path of paths)
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as { event: unknown };
      if (record.event === "meta" || record.event === "sample") records.push(record as BenchMeta | BenchSample);
    }
  return records;
}

export function formatTable(rows: readonly CompareRow[]): string {
  const number = (value: number) => (Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2));
  const side = (s: Spread) => `${number(s.median)} (${number(s.min)}..${number(s.max)}, n=${s.count})`;
  const lines = rows.map((row) => {
    const name = [row.scenario, `${row.metric} (${row.unit})`];
    if (!("base" in row)) {
      const samples = side(row.samples);
      return [...name, row.verdict === "only in base" ? samples : "", row.verdict === "only in head" ? samples : "", "", row.verdict, ""];
    }
    const notes = [row.outputChanged && "output changed", row.fewSamples && `fewer than ${MIN_SAMPLES} samples`].filter(Boolean);
    const change = row.changePercent === undefined ? "n/a" : `${row.changePercent > 0 ? "+" : ""}${row.changePercent.toFixed(1)}%`;
    return [...name, side(row.base), side(row.head), change, row.verdict, notes.join(", ")];
  });
  const table = [["scenario", "metric", "base median (min..max)", "head median (min..max)", "change", "verdict", "notes"], ...lines];
  const widths = table[0]!.map((_, column) => Math.max(...table.map((line) => line[column]!.length)));
  return table
    .map((line) =>
      line
        .map((cell, column) => cell.padEnd(widths[column]!))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

const USAGE = "Usage: pnpm bench:compare --base FILE... --head FILE... [--fail-on-slower]";

if (import.meta.main) {
  try {
    const files = { base: [] as string[], head: [] as string[] };
    let side: keyof typeof files | undefined;
    let failOnSlower = false;
    for (const arg of process.argv.slice(2)) {
      if (arg === "--base" || arg === "--head") side = arg === "--base" ? "base" : "head";
      else if (arg === "--fail-on-slower") failOnSlower = true;
      else if (side && !arg.startsWith("--")) files[side].push(arg);
      else throw new Error(USAGE);
    }
    if (!files.base.length || !files.head.length) throw new Error(USAGE);
    const rows = compare(await readRecords(files.base), await readRecords(files.head));
    console.log(formatTable(rows));
    if (failOnSlower && rows.some((row) => row.verdict === "slower")) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
