import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type Declaration } from "postcss";
import { expect, it } from "vitest";
import { ROOT, sourceFiles } from "./testing.ts";

const ALLOWED: Record<string, string> = {};

const MARKS: Record<string, string> = {
  "src/app/styles.css .sim-mark.killsLater": "The kills-later mark on the XP ring is 10px and holds a !.",
  "src/app/routing/routing.css .route-pin": "A route pin is 15px and holds the step number.",
  "src/app/routing/routing.css .map-overlay .ride-faction": "The faction badge on a ride's 12px icon holds one letter.",
};

const files = sourceFiles().filter((file) => file.endsWith(".css") && file !== "src/app/theme/tokens.css");

function unpaired(css: string): string[] {
  const found: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    const step = (prop: string) => {
      const decls = rule.nodes.filter((node): node is Declaration => node.type === "decl" && node.prop.toLowerCase() === prop);
      const value = (decls.findLast((decl) => decl.important) ?? decls.at(-1))?.value;
      return value && (/^var\(--(?:font-size|line-height)-([\w-]+)\)$/.exec(value)?.[1] ?? value);
    };
    const [size, height] = [step("font-size"), step("line-height")];
    if (size !== height) found.push(`${rule.selector.replace(/\s+/g, " ")} ${size ?? "-"}/${height ?? "-"}`);
  });
  return found;
}

it("flags a size without its line height, a line height without its size, and two steps", () => {
  const css = `
    .size { font-size: var(--font-size-small); }
    .height { line-height: var(--line-height-mark); }
    .steps { font-size: var(--font-size-micro); line-height: var(--line-height-mark); }
    .pair { font-size: var(--font-size-title); line-height: var(--line-height-title); }
    .neither { color: var(--text); }
  `;
  expect(unpaired(css)).toEqual([".size small/-", ".height -/mark", ".steps micro/mark"]);
});

it("reads a property name in any case", () => {
  expect(unpaired(".upper { FONT-SIZE: var(--font-size-body); }")).toEqual([".upper body/-"]);
});

it("judges the line height that applies, the last one in the rule", () => {
  const css = `.later {
    font-size: var(--font-size-body);
    line-height: var(--line-height-body);
    line-height: var(--line-height-small);
  }`;
  expect(unpaired(css)).toEqual([".later body/small"]);
});

it("judges an !important line height over a later normal one", () => {
  const css = `.p {
    font-size: var(--font-size-body);
    line-height: var(--line-height-small) !important;
    line-height: var(--line-height-body);
  }`;
  expect(unpaired(css)).toEqual([".p body/small"]);
});

it("pairs each font size with its line height in the app's CSS", () => {
  const found = files.flatMap((file) => unpaired(readFileSync(join(ROOT, file), "utf8")).map((rule) => `${file} ${rule}`));
  expect(found).toEqual(Object.keys(ALLOWED));
});

it("uses the mark size only in the listed marks", () => {
  const found = files.flatMap((file) => {
    const rules: string[] = [];
    postcss.parse(readFileSync(join(ROOT, file), "utf8")).walkRules((rule) => {
      if (rule.some((node) => node.type === "decl" && node.value.includes("var(--font-size-mark)"))) {
        rules.push(`${file} ${rule.selector.replace(/\s+/g, " ")}`);
      }
    });
    return rules;
  });
  expect(new Set(found)).toEqual(new Set(Object.keys(MARKS)));
});
