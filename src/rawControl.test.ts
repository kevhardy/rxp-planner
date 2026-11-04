import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, it } from "vitest";

const CASES: Array<[file: string, rejected: boolean]> = [
  ["src/app/Toolbar.tsx", true],
  ["src/app/map/Pin.tsx", true],
  ["src/main.tsx", true],
  ["src/app/ui/Button.tsx", false],
  ["src/app/ui/Pill.tsx", false],
  ["src/app/Toolbar.test.tsx", false],
];

const repo = join(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "raw-control-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const RULE = "rxpplanner/no-raw-control";
interface Override {
  files: string[];
  rules: Record<string, unknown>;
}
// JSON.parse refuses comments. Strings match first, so the `/*` in a glob stays.
const text = readFileSync(join(repo, ".oxlintrc.json"), "utf8").replace(/("(?:\\.|[^"\\])*")|\/\/.*|\/\*[\s\S]*?\*\//g, "$1");
const config = JSON.parse(text) as { rules: Record<string, unknown>; overrides: Override[] };
writeFileSync(
  join(root, ".oxlintrc.json"),
  JSON.stringify({
    jsPlugins: [join(repo, "packages/oxlint-plugin-rxpplanner/src/index.ts")],
    categories: { correctness: "off" },
    rules: RULE in config.rules ? { [RULE]: config.rules[RULE] } : {},
    overrides: config.overrides.flatMap((o) => (RULE in o.rules ? [{ files: o.files, rules: { [RULE]: o.rules[RULE] } }] : [])),
  }),
);
for (const [file] of CASES) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), `export const Go = () => <button type="button">Go</button>;\n`);
}

const lint = spawnSync(join(repo, "node_modules/.bin/oxlint"), ["-c", ".oxlintrc.json", "--format", "json", "."], {
  cwd: root,
  encoding: "utf8",
});
const reported = new Set(
  (JSON.parse(lint.stdout) as { diagnostics: { filename: string; code: string }[] }).diagnostics.flatMap((d) =>
    d.code.includes("no-raw-control") ? [d.filename] : [],
  ),
);

it.each(CASES)("%s: rejected %s", (file, rejected) => {
  expect(reported.has(file)).toBe(rejected);
});
