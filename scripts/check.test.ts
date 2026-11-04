import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const script = fileURLToPath(new URL("./check.ts", import.meta.url));

it.each(["success", "verbose", "failure", "verbose-failure", "signal", "missing"])(
  "reports %s without losing failures or running later steps",
  (mode) => {
    const directory = mkdtempSync(join(tmpdir(), "check-test-"));
    try {
      const executable = join(directory, "pnpm");
      const calls = join(directory, "calls");
      writeFileSync(
        executable,
        `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2).join(' ');
appendFileSync(${JSON.stringify(calls)}, args + '\\n');
console.log('routine output');
if (args.includes('lint')) {
  if (${JSON.stringify(mode)}.includes('failure')) {
    console.error('diagnostic detail');
    process.exit(7);
  }
  if (${JSON.stringify(mode)} === 'signal') process.kill(process.pid, 'SIGTERM');
}
if (args.includes('vitest')) console.log(' Test Files  2 passed (2)\\n Tests  3 passed | 1 skipped (4)');
`,
      );
      chmodSync(executable, 0o755);
      const verbose = mode.startsWith("verbose");
      const result = spawnSync(process.execPath, [script, ...(verbose ? ["--verbose"] : [])], {
        encoding: "utf8",
        env: { ...process.env, PATH: mode === "missing" ? join(directory, "missing") : directory },
      });
      if (mode === "success" || mode === "verbose") {
        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain("Check succeeded: data, format, links, lint, unused, types, tests, build");
        expect(result.stdout).toContain("3 passed | 1 skipped");
        expect(result.stdout.includes("routine output")).toBe(verbose);
        expect(readFileSync(calls, "utf8").includes("--reporter=verbose")).toBe(verbose);
        expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(8);
      } else {
        expect(result.status).toBe(mode.includes("failure") ? 7 : 1);
        expect(result.stdout).not.toContain("Check succeeded");
        expect(result.stderr).toContain("Skipped:");
        if (mode === "missing") {
          expect(result.stderr).toContain("ENOENT");
        } else {
          expect(result.stderr).toContain("Check failed: lint");
          expect(result.stderr).toContain(mode.includes("failure") ? "diagnostic detail" : "SIGTERM");
          expect(verbose ? result.stdout : result.stderr).toContain("routine output");
          expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(4);
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
