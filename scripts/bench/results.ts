/**
 * The JSON Lines records that every benchmark writes to stdout and that `scripts/bench/compare.ts` reads.
 * A benchmark may write other events too. Compare reads only `meta` and `sample`.
 * Every metric is lower-is-better.
 */
import { execFileSync } from "node:child_process";
import { availableParallelism, loadavg } from "node:os";

export type BenchArea = "routing" | "playback" | "map";

export interface BenchMeta {
  event: "meta";
  area: BenchArea;
  commit: string;
  dirty: boolean;
  /** SHA-256 of the dataset `manifest.json` that the run read. */
  dataset: string;
  node: string;
  cpus: number;
  loadavg: number[];
  /** The WebGL renderer string. Only the map benchmark sets it, because a software renderer gives other numbers. */
  renderer?: string;
  options: Record<string, unknown>;
}

export interface BenchSample {
  event: "sample";
  scenario: string;
  metric: string;
  unit: "ms" | "count";
  /** Starts at 1. A run that only warms up or checks output writes no sample. */
  run: number;
  value: number;
  /** A hash of the scenario's output. Each run of one scenario on one checkout must give the same hash. */
  signature?: string;
}

export function benchMeta(area: BenchArea, dataset: string, options: Record<string, unknown>, renderer?: string): BenchMeta {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  return {
    event: "meta",
    area,
    commit: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain") !== "",
    dataset,
    node: process.version,
    cpus: availableParallelism(),
    loadavg: loadavg(),
    ...(renderer !== undefined && { renderer }),
    options,
  };
}

export function emit(record: BenchMeta | BenchSample | ({ event: string } & Record<string, unknown>)) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export interface Spread {
  median: number;
  min: number;
  max: number;
  count: number;
}

/** The median of an even count is the mean of the two middle values. */
export function spread(values: readonly number[]): Spread {
  if (!values.length) throw new Error("spread needs at least one value");
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return { median, min: sorted[0]!, max: sorted.at(-1)!, count: sorted.length };
}
