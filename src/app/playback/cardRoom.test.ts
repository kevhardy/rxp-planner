import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { list } from "postcss";
import { expect, it } from "vitest";
import { ROOT, sourceFiles } from "../theme/testing.ts";

const sheet = (file: string) => postcss.parse(readFileSync(join(import.meta.dirname, file), "utf8"));

const fail = (message: string): never => {
  throw new Error(message);
};

function declared(file: string, selector: string, prop: string): string {
  let value: string | undefined;
  sheet(file).walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(prop, (decl) => {
      value = decl.value;
    });
  });
  return value ?? fail(`${file} gives ${selector} no ${prop}`);
}

function px(value: string, tokens: ReadonlyMap<string, string>, whole = 0): number {
  let text = value;
  for (let before = ""; before !== text;) {
    before = text;
    text = text.replace(/var\((--[\w-]+)\)/g, (_, name: string) => `(${tokens.get(name) ?? fail(`No token ${name}`)})`);
  }
  const parts = text.replace(/calc\(/g, "(").match(/\d*\.?\d+(?:px|%)?|\S/g) ?? [];
  let at = 0;
  const term = (): number => {
    const part = parts[at++] ?? "";
    if (part === "(") {
      const inner = sum();
      if (parts[at++] !== ")") fail(`No closing parenthesis in ${value}`);
      return inner;
    }
    const [, number = "", unit] = /^(\d*\.?\d+)(px|%)?$/.exec(part) ?? fail(`Cannot read "${part}" in ${value}`);
    return unit === "%" ? (Number(number) * whole) / 100 : Number(number);
  };
  const product = (): number => {
    let result = term();
    while (parts[at] === "*" || parts[at] === "/") result = parts[at++] === "*" ? result * term() : result / term();
    return result;
  };
  const sum = (): number => {
    let result = product();
    while (parts[at] === "+" || parts[at] === "-") result = parts[at++] === "+" ? result + product() : result - product();
    return result;
  };
  const result = sum();
  if (at !== parts.length) fail(`Cannot read ${value}`);
  return result;
}

const tokens = new Map<string, string>();
sheet("../theme/tokens.css").walkRules(":root", (rule) =>
  rule.walkDecls(/^--/, (decl) => {
    tokens.set(decl.prop, decl.value);
  }),
);

const MODELED = [
  "src/app/routing/CoordinateReadout.css .coord-readout gap",
  "src/app/routing/CoordinateReadout.css .coord-readout line-height",
  "src/app/routing/CoordinateReadout.css .coord-readout padding",
];

const BLOCK_SIZE = new Set([
  "line-height",
  "font",
  "height",
  "min-height",
  "max-height",
  "block-size",
  "min-block-size",
  "max-block-size",
  "gap",
  "row-gap",
  "grid",
  "grid-template",
  "grid-template-rows",
  "grid-auto-rows",
]);

const sizes = (prop: string) => BLOCK_SIZE.has(prop) || (/^(?:padding|border)(?:-|$)/.test(prop) && !prop.endsWith("-radius"));

function readoutSizing(files: readonly string[], read: (file: string) => string): string[] {
  const found: string[] = [];
  for (const file of files) {
    postcss.parse(read(file)).walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      if (!sizes(prop)) return;
      const selectors: string[] = [];
      for (let node: postcss.Container | postcss.Document | undefined = decl.parent; node; node = node.parent) {
        if (node instanceof postcss.Rule) selectors.unshift(node.selector);
      }
      if (selectors.some((selector) => /\.coord-readout(?![\w-])/.test(selector))) found.push(`${file} ${selectors.join(" ")} ${prop}`);
    });
  }
  return found;
}

it("models each declaration that can change the coordinate readout's height", () => {
  const files = sourceFiles().filter((file) => file.endsWith(".css"));
  expect(
    readoutSizing(files, (file) => readFileSync(join(ROOT, file), "utf8")).sort(),
    "A taller readout can sit under the open Character card. Fit the card's max-height in src/app/playback/playback.css to the readout, then update the height model and this list in src/app/playback/cardRoom.test.ts.",
  ).toEqual([...MODELED].sort());
});

it("finds each declaration that can change the readout's height under any rule that names the readout", () => {
  const sheets: Record<string, string> = {
    "a.css":
      ".coord-readout { padding: 0; border-radius: 3px; color: red; @container readout (width < 1px) { PADDING-TOP: 1px; } } .coord-readout-wide { height: 1px; }",
    "b.css":
      ".coord-readout dd { padding: 4px; } .map-foot :is(.coord-readout, .x) { border-block: 1px solid; } :where(.coord-readout) { row-gap: 2px; }",
  };
  expect(readoutSizing(Object.keys(sheets), (file) => sheets[file] ?? "")).toEqual([
    "a.css .coord-readout padding",
    "a.css .coord-readout padding-top",
    "b.css .coord-readout dd padding",
    "b.css .map-foot :is(.coord-readout, .x) border-block",
    "b.css :where(.coord-readout) row-gap",
  ]);
});

it("leaves room under the open Character card for the coordinate readout and one gap of the map's strip", () => {
  const readoutSheet = "../routing/CoordinateReadout.css";
  const [top = "", , bottom = top] = list.space(declared(readoutSheet, ".coord-readout", "padding"));
  const [rowGap = ""] = list.space(declared(readoutSheet, ".coord-readout", "gap"));
  const lines = 2 * px(declared(readoutSheet, ".coord-readout", "line-height"), tokens) + px(rowGap, tokens);
  const readout = px(top, tokens) + px(bottom, tokens) + lines;
  const strip = 600;
  const room = strip - px(declared("playback.css", ".character-card", "max-height"), tokens, strip);
  const [gap = ""] = list.space(declared("../map/map.css", ".map-top", "gap"));
  expect(room - readout, "The readout sits in the last part of the strip, so the card must end one gap above it").toBe(px(gap, tokens));
});

it("reads a length through var() chains, calc(), and a percentage", () => {
  const fixture = new Map([
    ["--a", "var(--b)"],
    ["--b", "4px"],
    ["--c", "10px"],
  ]);
  expect(px("calc(100% - (2 * var(--a) + var(--c)) - 3px)", fixture, 200)).toBe(179);
});
