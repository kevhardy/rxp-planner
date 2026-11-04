import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { expect, it } from "vitest";
import { ROOT, sourceFiles } from "./testing.ts";

const KNOWN: Record<string, string> = {
  "src/app/playback/playback.css .playback-guide": "position: static while its own step has focus, through :has()",
  "src/app/styles.css .import-table th": "the head row's height in the scroller's scroll-padding-top (.import-table-wrap)",
  "src/app/styles.css .level-band": "scroll-padding-top of the band's height on the scroller (.step-list.simulated)",
  "src/app/styles.css .narrow-notice": "sticks only to the left edge, in a row of its own above the banner, so it lies over nothing",
};

function stickyRules(files: readonly string[], read: (file: string) => string): string[] {
  const rules: string[] = [];
  for (const file of files) {
    postcss.parse(read(file)).walkRules((rule) => {
      const sticky = rule.nodes.some(
        (node) => node.type === "decl" && /^position$/i.test(node.prop) && /^(?:-webkit-)?sticky$/i.test(node.value),
      );
      if (sticky) rules.push(`${file} ${rule.selector}`);
    });
  }
  return rules;
}

it("keeps sticky elements to the sites whose fix keeps focus in view", () => {
  const files = sourceFiles().filter((file) => file.endsWith(".css"));
  const fixes = Object.entries(KNOWN).map(([site, fix]) => `${site}: ${fix}`);
  expect(
    stickyRules(files, (file) => readFileSync(join(ROOT, file), "utf8")).sort(),
    `A sticky element can cover a focused element under it. Give a new one the fix of a site below, then list it here.\n${fixes.join("\n")}`,
  ).toEqual(Object.keys(KNOWN).sort());
});

it("finds each rule that makes an element sticky", () => {
  const sheets: Record<string, string> = {
    "a.css": ".head { position: sticky; top: 0; } .row { position: relative; }",
    "b.css": "@media (width > 40em) { .band { POSITION: STICKY !important; } } .old { position: -webkit-sticky; }",
    "c.css": ".band:focus-within { position: static; }",
  };
  expect(stickyRules(Object.keys(sheets), (file) => sheets[file] ?? "")).toEqual(["a.css .head", "b.css .band", "b.css .old"]);
});
