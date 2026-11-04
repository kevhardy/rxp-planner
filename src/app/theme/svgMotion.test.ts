import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ROOT, sourceFiles } from "./testing.ts";

// The elements are those of SVG 2's Animation chapter. XML names are case-sensitive.
const MOTION = [
  /<(?:animate|animateMotion|animateTransform|discard|set)(?=[\s/>])/g,
  /@keyframes\b/gi,
  /(?<![\w-])(?:animation|transition)(?:-[a-z-]+)?\s*:/gi,
];

function svgMotion(text: string): string[] {
  return MOTION.flatMap((form) => text.match(form) ?? []);
}

it("finds no motion in the SVG files that the build can read", () => {
  const found = sourceFiles()
    .filter((file) => /\.svg$/i.test(file))
    .flatMap((file) => svgMotion(readFileSync(join(ROOT, file), "utf8")).map((form) => `${file}: ${form}`));
  expect(
    found,
    "An SVG image is its own document, so the motion tokens, which reduced motion sets to 0ms, do not reach it. Draw the image still, and animate its element in the app's CSS with the motion tokens.",
  ).toEqual([]);
});

it.each([
  ['<circle r="4"><animate attributeName="r" values="4;8;4" dur="1s" /></circle>', ["<animate"]],
  ['<path d="M0 0h8"><animateMotion dur="2s" path="M0 0h8" /></path>', ["<animateMotion"]],
  ['<rect><animateTransform attributeName="transform" type="rotate" to="90" dur="1s"/></rect>', ["<animateTransform"]],
  ['<rect><set attributeName="x" to="8" begin="1s"/><discard begin="2s"/></rect>', ["<set", "<discard"]],
  ["<style>@keyframes spin { to { rotate: 1turn; } } path { animation: spin 1s; }</style>", ["@keyframes", "animation:"]],
  ['<path style="fill: red;transition-duration: 1s" />', ["transition-duration:"]],
  ['<path style="ANIMATION-NAME:spin" />', ["ANIMATION-NAME:"]],
])("finds the motion in %s", (text, forms) => {
  expect(svgMotion(text)).toEqual(forms);
});

it("finds no motion in a still SVG", () => {
  const still = `<svg viewBox="0 0 16 16"><settings/><path d="M0 0h16" style="--animation: none; fill: currentColor" data-transition="none"/></svg>`;
  expect(svgMotion(still)).toEqual([]);
});
