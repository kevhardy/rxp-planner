import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { BenchSample } from "./results.ts";

/**
 * Runs a benchmark script in a fresh Node process and copies its stdout records to this stdout, except its `meta`,
 * so that the parent's stdout stays one stream with one `meta`. Returns the child's samples.
 * A child that exits nonzero throws, so its records never count as a result.
 */
export async function forkBench(script: string, args: readonly string[]): Promise<BenchSample[]> {
  const child = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "inherit"] });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const samples: BenchSample[] = [];
  for await (const line of createInterface({ input: child.stdout })) {
    const record = JSON.parse(line) as { event: string };
    if (record.event === "meta") continue;
    if (record.event === "sample") samples.push(record as BenchSample);
    process.stdout.write(`${line}\n`);
  }
  const code = await exit;
  assert.equal(code, 0, `${script} ${args.join(" ")} failed`);
  return samples;
}

export function assertOneSignature(scenario: string, samples: readonly BenchSample[]) {
  assert(new Set(samples.map((s) => s.signature)).size <= 1, `${scenario}: the output changed between processes`);
}
