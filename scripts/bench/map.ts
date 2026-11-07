/**
 * Measures how the map feels in a production build: startup, a map switch, wheel zoom and drag pan over terrain, a city
 * interior, dense markers, and route lines, and Playback that follows the character.
 *
 *   pnpm exec playwright-core install chromium    # once
 *   pnpm bench:map --runs 5 > map.jsonl
 *
 * It writes `scripts/bench/results.ts` records to stdout and a summary to stderr. Use an external timeout.
 * Options:
 *   --runs N         timed runs per scenario, after one untimed warm-up run (default 5)
 *   --scenario NAME  run only this scenario; repeat it for more
 *   --no-build       serve the existing dist/ instead of running `pnpm build`
 *   --evidence DIR   save a screenshot of each scenario's end state
 *   --trace DIR      save one Chrome trace per scenario in place of the timed runs; no samples
 *   --headless       run headless even when a display is set
 *   --software       allow a software WebGL renderer
 *
 * A software renderer gives numbers that do not match a player's machine, so the script refuses SwiftShader and
 * llvmpipe. Headless Chromium uses SwiftShader, so run headed on a display. Under WSL, Mesa reaches the GPU only through
 * its d3d12 driver, so the script sets GALLIUM_DRIVER=d3d12 when /dev/dxg exists and the variable is not set.
 *
 * Each run uses a new browser context at 1920x1080 and device pixel ratio 1. A run with a console error, a page error,
 * a failed request, or a failed check writes no sample, and the script exits nonzero. Times from navigation include
 * the clicks that open the guide. A settle time includes the driver's round trips and three stable frames.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser, type CDPSession, type Page, type Request } from "playwright-core";
import { frameStats } from "./frames.ts";
import { benchMeta, emit, spread, type BenchSample } from "./results.ts";

declare global {
  interface Window {
    benchFrames?: number[];
    benchChange?: number;
  }
}

interface RouteStop {
  x: number;
  y: number;
  height: number | null;
}

type Measure =
  | { kind: "startup" }
  | { kind: "map-switch"; to: string }
  | { kind: "gestures" }
  | { kind: "playback"; seconds: number; speed: string };

interface Scenario {
  name: string;
  guide: string;
  /** In Playback, the start of the name of a button in the region `Steps`. */
  step?: string;
  map?: string;
  /** Zooms in until the interior box shows, with `Inside map` on. */
  interior?: boolean;
  legend: "default" | "all";
  /** World yards on instance 0, imported into the Routes map. */
  route?: [RouteStop, RouteStop];
  measure: Measure;
}

const SCENARIOS: Scenario[] = [
  { name: "startup", guide: "1-6 Northshire", legend: "default", measure: { kind: "startup" } },
  { name: "map-switch", guide: "1-6 Northshire", legend: "default", measure: { kind: "map-switch", to: "Ironforge" } },
  { name: "terrain", guide: "1-6 Northshire", map: "Elwynn Forest", legend: "default", measure: { kind: "gestures" } },
  {
    name: "city-interior",
    guide: "1-6 Northshire",
    map: "Stormwind City",
    interior: true,
    legend: "default",
    measure: { kind: "gestures" },
  },
  { name: "dense-markers", guide: "1-6 Northshire", map: "Ironforge", legend: "all", measure: { kind: "gestures" } },
  {
    name: "routes",
    guide: "1-6 Northshire",
    legend: "default",
    // From the Cathedral of Light to the Slaughtered Lamb, across Stormwind City.
    route: [
      { x: 798.51, y: -8526.22, height: 81.6 },
      { x: 1015.33, y: -8978.9, height: null },
    ],
    measure: { kind: "gestures" },
  },
  {
    name: "playback-follow-terrain",
    guide: "1-6 Northshire",
    step: "Step 11 ",
    legend: "default",
    measure: { kind: "playback", seconds: 4, speed: "16x" },
  },
  {
    name: "playback-follow-city",
    guide: "6-11 Elwynn Forest",
    step: "Step 264 ",
    legend: "default",
    measure: { kind: "playback", seconds: 4, speed: "16x" },
  },
];

type GestureName = "zoomIn" | "pan" | "zoomOut";
const GESTURES: GestureName[] = ["zoomIn", "pan", "zoomOut"];
const WHEEL_STEPS = 3;
const PAN = { dx: -320, dy: -160, moves: 24 };
const GPU_ARGS = ["--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"];
const SOFTWARE = /SwiftShader|llvmpipe|softpipe/i;
const TIMEOUT = 60_000;

const { values } = parseArgs({
  allowNegative: true,
  options: {
    runs: { type: "string", default: "5" },
    scenario: { type: "string", multiple: true },
    build: { type: "boolean", default: true },
    evidence: { type: "string" },
    trace: { type: "string" },
    headless: { type: "boolean", default: !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY },
    software: { type: "boolean", default: false },
  },
});
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
const unknown = values.scenario?.filter((name) => !SCENARIOS.some((s) => s.name === name)) ?? [];
if (unknown.length) throw new Error(`Unknown scenario ${unknown.join(", ")}. Scenarios: ${SCENARIOS.map((s) => s.name).join(", ")}`);
const scenarios = SCENARIOS.filter((s) => !values.scenario || values.scenario.includes(s.name));
for (const dir of [values.evidence, values.trace]) if (dir) mkdirSync(dir, { recursive: true });

const log = (text: string) => process.stderr.write(`${text}\n`);
const root = resolve(import.meta.dirname, "../..");
let server: ReturnType<typeof spawn> | undefined;
let browser: Browser | undefined;
const stopServer = () => server?.kill();
// Playwright kills its browser on exit too.
process.on("exit", stopServer);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => process.exit(130));

function round(value: number) {
  return Math.round(value * 10) / 10;
}

async function startPreview(): Promise<URL> {
  const port = await new Promise<number>((done, fail) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
    probe.on("error", fail);
  });
  const vite = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin/vite.js");
  server = spawn(process.execPath, [vite, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const base = new URL(`http://127.0.0.1:${port}/`);
  for (const began = Date.now(); Date.now() - began < 30_000; await new Promise((r) => setTimeout(r, 200))) {
    if (server.exitCode !== null) throw new Error(`vite preview exited with ${server.exitCode}`);
    if (
      await fetch(base).then(
        (r) => r.ok,
        () => false,
      )
    )
      return base;
  }
  throw new Error("vite preview did not start in 30 s.");
}

async function readRenderer(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "no WebGL";
    });
  } finally {
    await page.close();
  }
}

type Metrics = Record<string, Pick<BenchSample, "unit" | "value">>;
const ms = (value: number) => ({ unit: "ms" as const, value });
const count = (value: number) => ({ unit: "count" as const, value });

async function runScenario(
  browser: Browser,
  base: URL,
  scenario: Scenario,
  out: { trace?: string | undefined; evidence?: string | undefined },
) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    const problems: string[] = [];
    const pending = new Set<Request>();
    page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ""}`));
    page.on("response", (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`));
    page.on("request", (r) => r.url().includes("/dataset/") && pending.add(r));
    page.on("requestfinished", (r) => pending.delete(r));
    page.on("requestfailed", (r) => pending.delete(r));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    if (out.trace) await browser.startTracing(page, { path: out.trace, screenshots: false });
    const map = new MapProbe(page, cdp, pending);
    const metrics = await measure(map, base, scenario);
    if (out.trace) await browser.stopTracing();
    if (out.evidence) {
      await page.mouse.move(0, 0);
      await page.screenshot({ path: out.evidence });
    }
    if (problems.length) throw new Error(problems.join("\n"));
    return metrics;
  } finally {
    await context.close();
  }
}

async function measure(map: MapProbe, base: URL, scenario: Scenario): Promise<Metrics> {
  const { page } = map;
  await page.goto(base.href, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".search-panel .search-results"), null, { polling: "raf", timeout: TIMEOUT });
  const dataReadyMs = await map.now();
  await openGuide(page, scenario.guide);
  const guideOpenMs = await map.now();
  const { measure } = scenario;
  if (measure.kind === "startup") {
    const detailTilesMs = await map.detailTiles(false);
    return { dataReadyMs: ms(dataReadyMs), guideOpenMs: ms(guideOpenMs), detailTilesMs: ms(detailTilesMs) };
  }
  if (measure.kind === "map-switch") {
    await map.detailTiles(false);
    await map.settled();
    await map.markTiles();
    await page.evaluate(() => {
      document.addEventListener("change", () => (window.benchChange ??= performance.now()), { capture: true, once: true });
    });
    await page.getByRole("combobox", { name: "Map shown" }).selectOption({ label: measure.to });
    const shown = await map.detailTiles(true);
    const changed = await page.evaluate(() => window.benchChange!);
    return { detailTilesMs: ms(shown - changed) };
  }
  if (measure.kind === "playback") return await playback(map, scenario, measure);

  if (scenario.route) await importRoute(page, scenario.route);
  if (scenario.map) await page.getByRole("combobox", { name: "Map shown" }).selectOption({ label: scenario.map });
  if (scenario.interior) await enterInterior(page);
  if (scenario.legend === "all") await showEveryMarker(page);
  await map.settled();
  const metrics: Metrics = {};
  for (const gesture of GESTURES) Object.assign(metrics, await map.gesture(gesture));
  if (scenario.interior) await checkInterior(page);
  return metrics;
}

async function openGuide(page: Page, guide: string) {
  await page.getByRole("button", { name: "Library", exact: true }).click();
  for (const name of [/^RestedXP Guides/, /^RestedXP Forever Guide \(A\)/, /^Speedrun Guide 1-20/])
    await page.getByRole("button", { name }).click();
  await page.getByRole("button", { name: guide, exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("listbox", { name: `Steps of ${guide}` }).waitFor({ timeout: TIMEOUT });
}

async function importRoute(page: Page, [start, end]: [RouteStop, RouteStop]) {
  const leg = {
    followTerrain: true,
    downhill: true,
    damagingFalls: true,
    fatalFalls: false,
    hazards: false,
    otherFaction: false,
    flightPaths: true,
    shipPaths: true,
  };
  const modes = [
    { name: "Run", speed: 7, activation: 0 },
    { name: "Mount", speed: 11.2, activation: 3 },
    { name: "Epic mount", speed: 14, activation: 3 },
    { name: "Ghost Wolf", speed: 9.8, activation: 3 },
    { name: "Travel Form", speed: 9.8, activation: 0 },
  ];
  const text = JSON.stringify({
    format: "restedxp-route",
    version: 3,
    stops: [start, end].map((stop) => ({ instance: 0, ...stop })),
    legs: [leg],
    settings: { swimming: { enabled: true, speed: 4.7 }, modes },
  });
  await page.getByRole("button", { name: "Routes", exact: true }).click();
  await page.getByRole("region", { name: "Route tools" }).getByRole("button", { name: "Route", exact: true }).click();
  await page.getByRole("button", { name: "Import route text…" }).click();
  await page.getByRole("textbox", { name: "Route text" }).fill(text);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .getByText(/^\d+ min \d+ s · [\d,]+ yd$/)
    .first()
    .waitFor({ timeout: TIMEOUT });
  const lines = await page.locator(".map-overlay polyline").count();
  if (!lines) throw new Error("The route draws no line.");
}

async function enterInterior(page: Page) {
  const inside = page.getByRole("checkbox", { name: "Inside map" });
  for (let i = 0; !(await inside.isVisible()); i++) {
    if (i === 6) throw new Error("Zoom in never showed the interior box.");
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(300);
  }
  if (!(await inside.isChecked())) await inside.check();
  await checkInterior(page);
}

async function checkInterior(page: Page) {
  if (!(await page.getByRole("checkbox", { name: "Inside map" }).isChecked())) throw new Error("Inside map is off.");
  const layer = page.locator(".map-viewport image.interior-layer");
  await layer.first().waitFor({ state: "attached", timeout: TIMEOUT });
  await layer.evaluateAll((images) =>
    Promise.all(
      images.map((image) => {
        const decoded = new Image();
        decoded.src = image.getAttribute("href")!;
        return decoded.decode();
      }),
    ),
  );
}

async function showEveryMarker(page: Page) {
  const legend = page.locator("details.map-legend");
  if (!(await legend.evaluate((el) => (el as HTMLDetailsElement).open))) await legend.locator("> summary").click();
  const off = legend.locator("button[aria-pressed=false]:not(:disabled):not(.ui-segment)");
  for (let pass = 0; (await off.count()) > 0; pass++) {
    if (pass === 50) throw new Error("A legend button stays off.");
    await off.first().click();
  }
  const mixed = await legend.locator("button[aria-pressed=mixed]").count();
  if (mixed) throw new Error("A legend group is only partly on.");
}

async function playback(map: MapProbe, scenario: Scenario, measure: Extract<Measure, { kind: "playback" }>): Promise<Metrics> {
  const { page } = map;
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Playback" }).click();
  if (scenario.step) {
    await page
      .getByRole("region", { name: "Steps" })
      .getByRole("button", { name: new RegExp(`^${scenario.step}`) })
      .click();
  }
  const timeline = page.getByRole("group", { name: "Timeline" });
  await timeline.getByRole("combobox", { name: "Speed" }).selectOption({ label: measure.speed });
  await page.waitForFunction(
    () => {
      const status = document.querySelector('[aria-label="Timeline"] [role=status]')?.textContent ?? "";
      return !/^(Routing|Calculating|Updating)/.test(status);
    },
    null,
    { timeout: TIMEOUT },
  );
  const follow = page.getByRole("button", { name: "Follow character" });
  await follow.and(page.locator("[aria-pressed=true]")).waitFor({ timeout: TIMEOUT });
  await map.settled();
  const playhead = timeline.getByRole("slider", { name: "Playhead" });
  const before = { at: Number(await playhead.inputValue()), view: await map.fingerprint() };
  const task = await map.taskMs();
  await map.startFrames();
  await timeline.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(measure.seconds * 1000);
  await timeline.getByRole("button", { name: "Pause" }).click();
  const frames = frameStats(await map.stopFrames());
  const mainThread = (await map.taskMs()) - task;
  const after = { at: Number(await playhead.inputValue()), view: await map.fingerprint() };
  if (!(after.at > before.at)) throw new Error("The playhead did not move.");
  if (after.view.pan === before.view.pan) throw new Error("The camera did not follow the character.");
  if ((await follow.getAttribute("aria-pressed")) !== "true") throw new Error("Follow character turned off.");
  await map.settled();
  return {
    "playback.longestFrameMs": ms(frames.longestFrameMs),
    "playback.longFrames": count(frames.longFrames),
    "playback.mainThreadPerFrameMs": ms(mainThread / frames.frames),
  };
}

/** Reads and drives the map viewport of one page. */
class MapProbe {
  readonly page: Page;
  readonly #cdp: CDPSession;
  readonly #pending: Set<Request>;

  constructor(page: Page, cdp: CDPSession, pending: Set<Request>) {
    this.page = page;
    this.#cdp = cdp;
    this.#pending = pending;
  }

  now(): Promise<number> {
    return this.page.evaluate(() => performance.now());
  }

  async taskMs(): Promise<number> {
    const { metrics } = await this.#cdp.send("Performance.getMetrics");
    return 1000 * metrics.find((m) => m.name === "TaskDuration")!.value;
  }

  startFrames(): Promise<number> {
    return this.page.evaluate(() => {
      const frames = (window.benchFrames = [performance.now()]);
      const tick = (time: number) => {
        if (window.benchFrames !== frames) return;
        frames.push(time);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return frames[0]!;
    });
  }

  stopFrames(): Promise<number[]> {
    return this.page.evaluate(() => {
      const frames = window.benchFrames ?? [];
      delete window.benchFrames;
      return frames;
    });
  }

  /** Resolves with the page time when the view, the overlay, and the tile images stay the same for three frames and no dataset request is pending. */
  async settled(): Promise<number> {
    for (const began = Date.now(); Date.now() - began < TIMEOUT;) {
      const at = await this.page.evaluate(
        () =>
          new Promise<number>((done, fail) => {
            const el = document.querySelector<HTMLElement>(".map-viewport");
            if (!el) return fail(new Error("No map viewport."));
            let previous = "";
            let stable = 0;
            const began = performance.now();
            const frame = () => {
              const stage = el.querySelector<HTMLElement>(".map-stage")!;
              const images = [...el.querySelectorAll("img")];
              const loading = images.filter((image) => !image.complete || !image.naturalWidth).length;
              const signature = `${el.style.getPropertyValue("--zoom")}|${stage.style.getPropertyValue("--pan")}|${el.querySelector(".map-overlay")!.childElementCount}|${images.length}|${loading}`;
              stable = signature === previous && !loading ? stable + 1 : 0;
              previous = signature;
              if (stable >= 3) done(performance.now());
              else if (performance.now() - began > 20_000) fail(new Error(`The map did not settle: ${signature}`));
              else requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          }),
      );
      if (!this.#pending.size) return at;
      await this.page.waitForTimeout(50);
    }
    throw new Error(
      `Dataset requests still pending: ${[...this.#pending]
        .slice(0, 3)
        .map((r) => r.url())
        .join(", ")}`,
    );
  }

  /** Marks the tiles in the map now, so that `detailTiles(true)` waits for tiles of the next view. */
  markTiles() {
    return this.page.evaluate(() =>
      document.querySelectorAll(".map-viewport img.tile").forEach((image) => image.setAttribute("data-bench-old", "")),
    );
  }

  /** The page time when every visible detail tile, finer than the map's base tiles, has decoded. */
  async detailTiles(onlyNew: boolean): Promise<number> {
    const visible = await this.page.waitForFunction(
      (onlyNew) => {
        const el = document.querySelector(".map-viewport");
        if (!el) return false;
        const bounds = el.getBoundingClientRect();
        const tiles = [...el.querySelectorAll<HTMLImageElement>("img.tile")];
        const width = (image: HTMLImageElement) => parseFloat(image.style.getPropertyValue("--size-w"));
        const base = Math.max(...tiles.map(width));
        const detail = tiles.filter((image) => {
          if (onlyNew && image.hasAttribute("data-bench-old")) return false;
          const box = image.getBoundingClientRect();
          return (
            width(image) < base && box.right > bounds.left && box.left < bounds.right && box.bottom > bounds.top && box.top < bounds.bottom
          );
        });
        return detail.length > 0 && detail.every((image) => image.complete && image.naturalWidth > 0) && detail.length;
      },
      onlyNew,
      { polling: "raf", timeout: TIMEOUT },
    );
    await visible.dispose();
    return await this.page.evaluate(async (onlyNew) => {
      const tiles = [...document.querySelectorAll<HTMLImageElement>(`.map-viewport img.tile${onlyNew ? ":not([data-bench-old])" : ""}`)];
      await Promise.all(tiles.map((image) => image.decode()));
      return performance.now();
    }, onlyNew);
  }

  fingerprint() {
    return this.page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".map-viewport")!;
      return {
        zoom: Number(el.style.getPropertyValue("--zoom")),
        pan: el.querySelector<HTMLElement>(".map-stage")!.style.getPropertyValue("--pan"),
        rendered: JSON.stringify([
          [...el.querySelectorAll(".map-overlay button")].map((b) => {
            const r = b.getBoundingClientRect();
            return [Math.round(r.x), Math.round(r.y)];
          }),
          [...el.querySelectorAll<HTMLImageElement>("img.tile")].map((image) => image.currentSrc),
        ]),
      };
    });
  }

  /** A point on bare map, so that a wheel or a drag reaches the map and not a marker or a control. */
  clearPoint(drag: { dx: number; dy: number }) {
    return this.page.evaluate((drag) => {
      const el = document.querySelector(".map-viewport")!;
      const bounds = el.getBoundingClientRect();
      const blocking =
        "button, a, input, select, textarea, label, summary, details, [role=menu], [role=dialog], .ui-card, .map-zoom, .pin-chip";
      const clear = (x: number, y: number) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && el.contains(hit) && !hit.closest(blocking);
      };
      for (const fy of [0.45, 0.35, 0.55, 0.25, 0.65, 0.15]) {
        for (const fx of [0.6, 0.5, 0.7, 0.4, 0.8, 0.3]) {
          const x = bounds.x + bounds.width * fx;
          const y = bounds.y + bounds.height * fy;
          if (clear(x, y) && clear(x + drag.dx, y + drag.dy)) return { x, y };
        }
      }
      throw new Error("No bare map point for input.");
    }, drag);
  }

  async gesture(name: GestureName): Promise<Metrics> {
    const { page } = this;
    const point = await this.clearPoint(name === "pan" ? PAN : { dx: 0, dy: 0 });
    await page.mouse.move(point.x, point.y);
    await this.settled();
    const before = await this.fingerprint();
    const task = await this.taskMs();
    const began = await this.startFrames();
    if (name === "pan") {
      await page.mouse.down();
      await page.mouse.move(point.x + PAN.dx, point.y + PAN.dy, { steps: PAN.moves });
      await page.mouse.up();
    } else {
      for (let i = 0; i < WHEEL_STEPS; i++) await page.mouse.wheel(0, name === "zoomIn" ? -120 : 120);
    }
    const settledAt = await this.settled();
    const frames = frameStats(await this.stopFrames());
    const mainThread = (await this.taskMs()) - task;
    const after = await this.fingerprint();
    if (name === "zoomIn" && !(after.zoom > before.zoom)) throw new Error(`zoomIn left the zoom at ${after.zoom}.`);
    if (name === "zoomOut" && !(after.zoom < before.zoom)) throw new Error(`zoomOut left the zoom at ${after.zoom}.`);
    if (name === "pan" && after.pan === before.pan) throw new Error("pan did not move the map.");
    if (after.rendered === before.rendered) throw new Error(`${name} changed no rendered marker or tile.`);
    return {
      [`${name}.mainThreadMs`]: ms(mainThread),
      [`${name}.longestFrameMs`]: ms(frames.longestFrameMs),
      [`${name}.longFrames`]: count(frames.longFrames),
      [`${name}.settleMs`]: ms(settledAt - began),
    };
  }
}

try {
  if (values.build) execFileSync("pnpm", ["build"], { cwd: root, stdio: ["ignore", process.stderr, process.stderr] });
  const base = await startPreview();
  const servedIndex = await (await fetch(base)).text();
  if (servedIndex !== readFileSync(join(root, "dist/index.html"), "utf8"))
    throw new Error("The preview does not serve this checkout's dist/index.html.");
  const manifest = await fetch(new URL("dataset/manifest.json", base));
  if (!manifest.ok) throw new Error(`dataset/manifest.json: HTTP ${manifest.status}`);
  const dataset = `sha256:${createHash("sha256")
    .update(Buffer.from(await manifest.arrayBuffer()))
    .digest("hex")}`;

  const env = { ...process.env };
  if (existsSync("/dev/dxg") && !env.GALLIUM_DRIVER) env.GALLIUM_DRIVER = "d3d12";
  browser = await chromium.launch({ headless: values.headless, env, args: GPU_ARGS });
  const renderer = await readRenderer(browser);
  log(`renderer: ${renderer}`);
  if (SOFTWARE.test(renderer) && !values.software)
    throw new Error(`${renderer} is a software renderer. Run headed on a GPU, or pass --software.`);
  emit(
    benchMeta(
      "map",
      dataset,
      { runs, scenarios: scenarios.map((s) => s.name), headless: values.headless, trace: !!values.trace },
      renderer,
    ),
  );

  const results = new Map<string, number[]>();
  let failed = 0;
  for (const scenario of scenarios) {
    const timed = values.trace ? 1 : runs;
    for (let run = 0; run <= timed; run++) {
      const label = `${scenario.name} ${run ? `run ${run}` : "warm-up"}`;
      const trace = values.trace && run ? join(values.trace, `${scenario.name}.trace.json`) : undefined;
      const evidence = values.evidence && run === timed ? join(values.evidence, `${scenario.name}.png`) : undefined;
      try {
        const metrics = await runScenario(browser, base, scenario, { trace, evidence });
        log(
          `${label}: ${Object.entries(metrics)
            .map(([name, m]) => `${name}=${round(m.value)}`)
            .join(" ")}`,
        );
        if (!run || trace) continue;
        for (const [metric, { unit, value }] of Object.entries(metrics)) {
          emit({ event: "sample", scenario: scenario.name, metric, unit, run, value } satisfies BenchSample);
          const key = `${scenario.name} ${metric}`;
          results.set(key, [...(results.get(key) ?? []), value]);
        }
      } catch (error) {
        failed++;
        log(`${label} FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  for (const [key, list] of results) {
    const s = spread(list);
    log(`${key}: median ${round(s.median)} (${round(s.min)}–${round(s.max)}, n=${s.count})`);
  }
  if (failed) {
    log(`${failed} runs failed.`);
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  stopServer();
}
