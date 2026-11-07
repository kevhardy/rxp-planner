/**
 * Runs one package script on a base and a head checkout and compares their records:
 *   pnpm bench:ab --base ../base --head . --runs 5 --out /tmp/ab -- bench:routing --case boat --runs 1
 * Each side first runs once untimed and its output is discarded, so that neither side pays alone for a cold OS
 * file cache. Then the sides alternate, so that a change in machine load during the run reaches both sides.
 * Each run's stdout goes to `--out` as base-N.jsonl or head-N.jsonl. A run that exits nonzero fails the A/B run.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compare, formatTable, readRecords } from "./compare.ts";

const USAGE = "Usage: pnpm bench:ab --base DIR --head DIR --runs N --out DIR -- <package script> [args]";
const { values, positionals } = parseArgs({
  options: { base: { type: "string" }, head: { type: "string" }, runs: { type: "string", default: "5" }, out: { type: "string" } },
  allowPositionals: true,
});
const [script, ...args] = positionals;
assert(values.base && values.head && values.out && script, USAGE);
const runs = Number(values.runs);
assert(Number.isInteger(runs) && runs > 0, "--runs must be a positive integer");
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const sides = { base: resolve(values.base), head: resolve(values.head) };

function run(side: keyof typeof sides, file?: string) {
  const stdout = file === undefined ? "ignore" : openSync(file, "w");
  try {
    const result = spawnSync("pnpm", ["--dir", sides[side], "--silent", script!, ...args], { stdio: ["ignore", stdout, "inherit"] });
    assert.equal(result.status, 0, `The ${side} run of ${script} in ${sides[side]} failed`);
  } finally {
    if (typeof stdout === "number") closeSync(stdout);
  }
}

const files = { base: [] as string[], head: [] as string[] };
for (const side of ["base", "head"] as const) {
  console.error(`${side}: untimed run`);
  run(side);
}
for (let i = 1; i <= runs; i++)
  for (const side of ["base", "head"] as const) {
    console.error(`${side}: run ${i} of ${runs}`);
    const file = join(out, `${side}-${i}.jsonl`);
    run(side, file);
    files[side].push(file);
  }
console.log(formatTable(compare(await readRecords(files.base), await readRecords(files.head))));
