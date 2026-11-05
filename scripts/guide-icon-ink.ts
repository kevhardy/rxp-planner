/**
 * Measures how large and heavy each guide icon in `src/app/guideIcons/` draws
 * at 16 px, and with `--write` scales each icon to one optical size and gives
 * its dark outline one width. A second `--write` changes nothing.
 *
 * Run with `RXP_URL=<dev server> node scripts/guide-icon-ink.ts [--write]`.
 * The dev server serves the app's CSS for the theme columns. The script drives
 * Chromium through `playwright-core`, which the repository does not install.
 * Set `PLAYWRIGHT_CORE` to an installed copy of the package when the current
 * directory cannot resolve it.
 *
 * Columns:
 * - `box`: width × height of the pixels above 10% alpha, in px of the icon
 *   drawn at 16 px.
 * - `off`: the box center's offset in px from the center of the 16 px square.
 * - `cover`: the summed alpha, as a share of the 16 px square.
 * - `size`: the optical size, the geometric mean of the box's longer side and
 *   the side of a square with the same ink. A round shape covers about π/4 of
 *   its box, so at one size it takes a larger box than a square shape.
 * - `outline`: each width in px of the dark outline. A fill's outline counts its
 *   whole stroke, and a stroked line counts its dark stroke less the colored
 *   stroke on it, so both show half the width on each side.
 * - `light`, `dark`: the mean CIELAB lightness difference from `--surface`
 *   over a 16 px step mark, in percent, drawn with the app's CSS.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

type Page = {
  goto(url: string): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  screenshot(options: { clip: { x: number; y: number; width: number; height: number } }): Promise<Buffer>;
};
type Browser = {
  newPage(options: { deviceScaleFactor: number; viewport: { width: number; height: number } }): Promise<Page>;
  close(): Promise<void>;
};
type PlaywrightCore = { chromium: { launch(): Promise<Browser> } };

const { values } = parseArgs({ options: { write: { type: "boolean", default: false } } });
const url = process.env.RXP_URL;
if (!url) throw new Error("Set RXP_URL to the dev server, such as the URL that launch.sh prints.");
const require = createRequire(join(process.cwd(), "noop.js"));
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "playwright-core") as PlaywrightCore;

// The speech bubbles' size. At 14/16 of their former view box, the icons
// match the weight of a 1em sprite beside 14 px text.
const SIZE = 10.9;
// An SVG image clips at its view box, so a box keeps a margin for its edge.
const MAX_BOX = 15.5;
const OUTLINE = 1.05;
// Below this width in px, a dark stroke outlines a detail inside the shape.
const DETAIL = 0.8;
const SCALE = 8;
const CELL = 24;
const DARK_STROKE = /<[^>]*stroke="#1d1408"[^>]*>/g;

const dir = join(import.meta.dirname, "../src/app/guideIcons");
const icons = readdirSync(dir)
  .filter((file) => file.endsWith(".svg"))
  .map((file) => ({ name: basename(file, ".svg"), file: join(dir, file), svg: readFileSync(join(dir, file), "utf8") }));
// The tones key the icons by their import names, which are the file names.
const tones = new Map(
  [...readFileSync(join(import.meta.dirname, "../src/app/guideIcon.ts"), "utf8").matchAll(/\[(\w+), "(pale|vivid|deep)"\]/g)].map(
    ([, name, tone]) => [name!, tone!],
  ),
);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: SCALE, viewport: { width: CELL * icons.length, height: 200 } });
  await page.goto(url);
  let art = await measureArt(page);

  // A new outline width changes the ink, so each pass measures again until
  // no file changes.
  for (let pass = 0; values.write && pass < 8; pass++) {
    let changed = false;
    for (const [n, icon] of art.entries()) {
      const { file } = icons[n]!;
      const svg = readFileSync(file, "utf8");
      const scale = Math.min(SIZE / icon.size, MAX_BOX / Math.max(...icon.box));
      const moved = Math.abs(scale - 1) > 0.02 || Math.hypot(...icon.off) > 0.15;
      const [x, y, side] = icon.viewBox;
      const shift = (offset: number) => (offset * side) / 16 + (side * (1 - 1 / scale)) / 2;
      const next = moved ? [x + shift(icon.off[0]), y + shift(icon.off[1]), side / scale] : [x, y, side];
      const units = 16 / next[2]!;
      let index = 0;
      const text = svg
        .replace(/viewBox="[^"]*"/, `viewBox="${[next[0], next[1], next[2], next[2]].map((v) => round(v!)).join(" ")}"`)
        .replace(DARK_STROKE, (tag) => {
          const stroke = icon.strokes[index++]!;
          if (!stroke.outline) return tag;
          const width = stroke.inner + OUTLINE / (stroke.scale * units);
          return tag.replace(/stroke-width="[^"]*"/, `stroke-width="${round(width)}"`);
        });
      if (text !== svg) {
        writeFileSync(file, text);
        changed = true;
      }
    }
    if (!changed) break;
    art = await measureArt(page);
  }

  const weight: Record<string, number[]> = {};
  for (const theme of ["light", "dark"]) weight[theme] = await measureTheme(page, theme);

  const rows = art.map((icon, n) => [
    icon.name,
    tones.get(icon.name) ?? "",
    `${icon.box[0].toFixed(2)}×${icon.box[1].toFixed(2)}`,
    `${icon.off[0].toFixed(2)},${icon.off[1].toFixed(2)}`,
    `${(icon.cover * 100).toFixed(1)}%`,
    icon.size.toFixed(2),
    [...new Set(icon.strokes.filter((s) => s.outline).map((s) => s.outline.toFixed(2)))].sort().join(" "),
    weight.light![n]!.toFixed(1),
    weight.dark![n]!.toFixed(1),
  ]);
  const head = ["icon", "tone", "box", "off", "cover", "size", "outline", "light", "dark"];
  const widths = head.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column]!.length)));
  for (const row of [head, ...rows]) console.log(row.map((cell, column) => cell.padEnd(widths[column]!)).join("  "));
} finally {
  await browser.close();
}

function round(value: number) {
  return String(Number(value.toFixed(3)));
}

/** Measures each icon drawn at 16 px, with the ink that falls outside it. */
async function measureArt(page: Page) {
  const svgs = icons.map(({ name, file }) => ({ name, svg: readFileSync(file, "utf8") }));
  return page.evaluate(
    async ({ svgs, SCALE, DETAIL }) => {
      const side = 24 * SCALE;
      const canvas = Object.assign(document.createElement("canvas"), { width: side, height: side });
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:0;top:0;visibility:hidden";
      document.body.append(host);
      const results = [];
      for (const { name, svg } of svgs) {
        host.innerHTML = svg;
        const root = host.querySelector("svg")!;
        const viewBox = root.getAttribute("viewBox")!.split(/\s+/).map(Number) as [number, number, number, number];
        const units = viewBox[2] / 16;
        const wide = [viewBox[0] - 4 * units, viewBox[1] - 4 * units, 24 * units, 24 * units].join(" ");

        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/viewBox="[^"]*"/, `viewBox="${wide}"`))}`;
        await image.decode();
        context.clearRect(0, 0, side, side);
        context.drawImage(image, 0, 0, side, side);
        const { data } = context.getImageData(0, 0, side, side);
        let sum = 0;
        let [x0, y0, x1, y1] = [side, side, -1, -1];
        for (let y = 0; y < side; y++)
          for (let x = 0; x < side; x++) {
            const alpha = data[(y * side + x) * 4 + 3]! / 255;
            sum += alpha;
            if (alpha > 0.1) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
          }
        const box: [number, number] = [(x1 - x0 + 1) / SCALE, (y1 - y0 + 1) / SCALE];
        const off: [number, number] = [(x0 + x1 + 1) / 2 / SCALE - 12, (y0 + y1 + 1) / 2 / SCALE - 12];
        const cover = sum / (16 * SCALE) ** 2;

        root.removeAttribute("viewBox");
        const scale = (element: SVGGraphicsElement) => {
          const { a, b, c, d } = element.getCTM()!;
          return Math.sqrt(Math.abs(a * d - b * c));
        };
        const strokes = [...root.querySelectorAll<SVGGraphicsElement>('[stroke="#1d1408"]')].map((element) => {
          const width = Number(element.getAttribute("stroke-width"));
          const path = element.getAttribute("d");
          const top = element.nextElementSibling;
          const inner = path && top?.getAttribute("d") === path ? Number(top.getAttribute("stroke-width")) : 0;
          // A colored line under 2 units is a detail, such as a bag's tie.
          const dark = element.getAttribute("fill") === "none" ? (inner >= 2 ? width - inner : 0) : width;
          const outline = (dark * scale(element)) / units;
          return { scale: scale(element), inner, outline: outline >= DETAIL ? outline : 0 };
        });
        results.push({ name, viewBox, box, off, cover, size: Math.sqrt(Math.max(...box) * Math.sqrt(cover) * 16), strokes });
      }
      host.remove();
      return results;
    },
    { svgs, SCALE, DETAIL },
  );
}

/** The mean lightness difference of each icon from the page in `theme`. */
async function measureTheme(page: Page, theme: string) {
  await page.evaluate(
    ({ theme, marks, CELL }) => {
      document.documentElement.dataset.theme = theme;
      document.getElementById("guide-icon-ink")?.remove();
      const strip = document.createElement("div");
      strip.id = "guide-icon-ink";
      strip.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;display:flex;background:var(--surface)";
      for (const { name, tone } of marks) {
        const cell = document.createElement("div");
        cell.style.cssText = `width:${CELL}px;height:${CELL}px;display:grid;place-items:center`;
        cell.innerHTML = `<span class="mk tex" style="translate:none"><span class="guide-icon vector ${tone}" style="--icon-w:16px;--icon-h:16px;--icon-url:url(/src/app/guideIcons/${name}.svg?${Date.now()})"></span></span>`;
        strip.append(cell);
      }
      document.body.append(strip);
    },
    { theme, marks: icons.map(({ name }) => ({ name, tone: tones.get(name) ?? "" })), CELL },
  );
  await page.evaluate(() => new Promise((done) => setTimeout(done, 500)), null);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: CELL * icons.length, height: CELL } });
  return page.evaluate(
    async ({ png, count, CELL, SCALE }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const canvas = Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      const { data, width } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const lightness = (i: number) => {
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!].map((v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        const y = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
      };
      const surface = lightness(0);
      const side = 16 * SCALE;
      const inset = ((CELL - 16) / 2) * SCALE;
      return Array.from({ length: count }, (_, n) => {
        let sum = 0;
        for (let y = inset; y < inset + side; y++)
          for (let x = n * CELL * SCALE + inset; x < n * CELL * SCALE + inset + side; x++)
            sum += Math.abs(lightness((y * width + x) * 4) - surface);
        return sum / (side * side);
      });
    },
    { png: png.toString("base64"), count: icons.length, CELL, SCALE },
  );
}
