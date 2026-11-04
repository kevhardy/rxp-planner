import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, stripVTControlCharacters } from "node:util";

const { values } = parseArgs({ options: { verbose: { type: "boolean", default: false } } });
const verbose = values.verbose;

const steps = [
  ["data", ["--silent", "data:validate"]],
  ["format", ["--silent", "format:check"]],
  ["links", ["--silent", "links:check"]],
  ["lint", ["--silent", "lint"]],
  ["unused", ["--silent", "unused"]],
  ["types", ["--silent", "typecheck"]],
  ["tests", ["exec", "vitest", "run"]],
  ["build", ["exec", "vite", "build"]],
] as const;
const started = performance.now();
const directory = mkdtempSync(join(tmpdir(), "rxp-planner-check-"));
const log = join(directory, "output.log");
const passed: string[] = [];
let testSummary = "";

try {
  for (const [index, [name, args]] of steps.entries()) {
    // A file keeps large diagnostics intact without a subprocess buffer limit.
    const fd = openSync(log, "w");
    let result;
    try {
      if (verbose) console.log(`Checking ${name}...`);
      const command = name === "tests" && verbose ? [...args, "--reporter=verbose"] : args;
      result = spawnSync("pnpm", command, { stdio: verbose ? "inherit" : ["ignore", fd, fd] });
    } finally {
      closeSync(fd);
    }
    const output = readFileSync(log, "utf8");
    if (result.error || result.signal || result.status !== 0) {
      console.error(`Check failed: ${name} (${result.signal ?? result.error?.message ?? `exit ${result.status}`}).`);
      process.stderr.write(output);
      if (passed.length) console.error(`Succeeded: ${passed.join(", ")}.`);
      const skipped = steps.slice(index + 1).map(([label]) => label);
      if (skipped.length) console.error(`Skipped: ${skipped.join(", ")} (previous step failed).`);
      process.exitCode = result.status || 1;
      break;
    }
    passed.push(name);
    if (name === "tests" && !verbose) {
      testSummary = stripVTControlCharacters(output)
        .split("\n")
        .filter((line) => /^\s*(Test Files|Tests)\s/.test(line))
        .map((line) => line.trim())
        .join("\n");
    }
  }
  if (testSummary) console.log(testSummary);
  if (!process.exitCode) {
    console.log(`Check succeeded: ${passed.join(", ")} (${((performance.now() - started) / 1000).toFixed(1)}s).`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
