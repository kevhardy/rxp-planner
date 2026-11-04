import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ROOT, sourceFiles } from "./testing.ts";

function read(pattern: RegExp): Array<{ file: string; text: string }> {
  return sourceFiles()
    .filter((file) => pattern.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8") }));
}

const names = (text: string, pattern: RegExp): string[] => [...text.matchAll(pattern)].map((match) => match[1] ?? "");

it("defines every custom property that the app reads", () => {
  const css = read(/\.css$/);
  const code = read(/\.[cm]?[jt]sx?$/);
  const defined = [
    ...css.flatMap(({ text }) => names(text, /(--[\w-]+)\s*:/g)),
    ...code.flatMap(({ text }) => names(text, /["'`](--[\w-]+)["'`]/g)),
  ];
  const missing = [...css, ...code].flatMap(({ file, text }) =>
    [...text.matchAll(/var\((--[\w-]+)(\$\{)?/g)].flatMap(([, name = "", template]) =>
      (template ? defined.some((known) => known.startsWith(name)) : defined.includes(name)) ? [] : [`${file} ${name}`],
    ),
  );
  expect([...new Set(missing)]).toEqual([]);
});
