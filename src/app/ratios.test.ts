import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ROOT, sourceFiles } from "./theme/testing.ts";

// The game writes a quest objective's count as `3/8`, with no spaces.
const ALLOWED: Record<string, string> = {
  "src/app/ExportDialog.tsx {guideMeta(a).group} / {guideMeta(a).name}": "A guide's group and name read as a path, not a count.",
  "src/app/theme/colors.ts export const rgbaColor = ([r, g, b, a]: Rgba): string => `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(2)})`;":
    "CSS color syntax puts the alpha after a spaced slash.",
};

// JSX drops a line break beside an expression, so a string child, such as
// the `{" "}` that the formatter writes where it wraps a line, joins the lines around it.
function spacedRatios(text: string): string[] {
  return text
    .replace(/(?:\n\s*)?\{"([^"\n]*)"\}(?:\n\s*)?/g, "$1")
    .split("\n")
    .filter((line) => /\} \/ (?:\{|\d)| \/ \$\{/.test(line))
    .map((line) => line.trim());
}

const files = sourceFiles().filter((file) => /^src\/(?:app|rules)\/.*\.tsx?$/.test(file) && !/\.(?:test\.tsx?|d\.ts)$/.test(file));

it("flags a spaced slash between two interpolations, and passes an unspaced one", () => {
  const text = [
    "<span>{a} / {b}</span>",
    "`${a} / ${b} xp`",
    "`${a} / 40`",
    "<span>{a}/{b}</span>",
    "`${a}/${b}`",
    "const half = a / 2;",
  ].join("\n");
  expect(spacedRatios(text)).toEqual(["<span>{a} / {b}</span>", "`${a} / ${b} xp`", "`${a} / 40`"]);
});

it("flags a spaced slash that the formatter wraps, and one written as a string child", () => {
  const text = ['{a} /{" "}', "  {b}", "{c}", '{" / "}', "{d}"].join("\n");
  expect(spacedRatios(text)).toEqual(["{a} / {b}", "{c} / {d}"]);
});

it("writes each count of a total in src/app and src/rules with no spaces around the slash", () => {
  const found = files.flatMap((file) => spacedRatios(readFileSync(join(ROOT, file), "utf8")).map((line) => `${file} ${line}`));
  expect(found).toEqual(Object.keys(ALLOWED));
});
