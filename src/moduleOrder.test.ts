import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, it } from "vitest";

type Case = [file: string, code: string, message: string | null];

const BEFORE: Record<string, string[]> = {
  data: [],
  guide: ["data"],
  rules: ["data", "guide"],
  io: ["data", "guide", "rules"],
  routing: ["data", "guide", "rules"],
  agent: ["data", "guide", "rules", "io", "routing"],
  storage: ["data", "guide", "rules", "io", "routing"],
};
const later = (from: string) => `src/${from} imports only the modules before it. AGENTS.md gives the order.`;
const REACT = "Only the app can import React.";
const TEST_SUPPORT = "Production code cannot import test support.";
const TEST_SCOPE = "Test support may import any core module, but not src/storage, src/app, or scripts.";
const APP_SCRIPTS = "The app cannot import scripts.";
const NATIVE_STOP = "Stops are world positions. Pass the frames to src/routing, and it resolves them.";
const APP_JSON = "The app imports no JSON. A color is a token in src/app/theme/tokens.css, and data comes through src/data.";
const RAW_COLOR = "rxpplanner(no-raw-color)";
const CONTRACT = "The data contract imports no file outside its folder.";
const PLUGIN = "Only the lint config loads the lint plugin.";
const MOTION_CODE = "rxpplanner(no-script-motion)";

const DIRECTIONS: Case[] = Object.entries(BEFORE).flatMap(([from, before]): Case[] => [
  ...[...Object.keys(BEFORE), "app"].flatMap((to): Case[] =>
    to === from
      ? []
      : [[`src/${from}/to-${to}.ts`, `import type { X } from "../${to}/index.ts";`, before.includes(to) ? null : later(from)]],
  ),
  [`src/${from}/to-contract.ts`, `import type { X } from "../../packages/data-contract/model.ts";`, null],
  [`src/${from}/to-main.ts`, `import "../main.tsx";`, later(from)],
  [`src/${from}/to-scripts.ts`, `import type { X } from "../../scripts/version.ts";`, later(from)],
  [`src/${from}/react.ts`, `import { useState } from "react";`, REACT],
  [`src/${from}/plugin.ts`, `import plugin from "oxlint-plugin-rxpplanner";`, PLUGIN],
  [`src/${from}/support.ts`, `import { x } from "./testing.ts";`, TEST_SUPPORT],
  [`src/${from}/nested.ts`, `import { x } from "./app/file.ts";`, null],
]);

const FORMS: Case[] = [
  ["src/data/static.ts", `import { simData } from "../rules/index.ts";`, later("data")],
  ["src/data/folder.ts", `import { simData } from "../rules";`, later("data")],
  ["src/guide/reexport.ts", `export { guideMeta } from "../rules/registration.ts";`, later("guide")],
  ["src/rules/exportAll.ts", `export * from "../io/index.ts";`, later("rules")],
  ["src/rules/dynamic.ts", `export const io = import("../io/index.ts");`, later("rules")],
  ["src/data/sub/deep.ts", `import { simData } from "../../rules/index.ts";`, later("data")],
];

const SUPPORT: Case[] = [
  ["src/data/fixture.ts", `import { plannerFile } from "./plannerFixture.ts";`, TEST_SUPPORT],
  ["src/data/fixtureNoExtension.ts", `export { plannerContext } from "./plannerFixture";`, TEST_SUPPORT],
  ["src/routing/fixtureFolder.ts", `import { route } from "./fixtures/route.ts";`, TEST_SUPPORT],
  ["src/rules/testFile.ts", `import { testRules } from "./simulate.test.ts";`, TEST_SUPPORT],
  ["src/rules/typeTest.ts", `import type { X } from "./insertion.test-d.ts";`, TEST_SUPPORT],
  ["src/data/release.ts", `import { manifest } from "./releaseInputs.ts";`, TEST_SUPPORT],
  ["src/data/rules.test.ts", `import { testRules } from "../rules/testing.ts";`, null],
  ["src/rules/insertion.test-d.ts", `import type { Addon } from "../io/index.ts";`, null],
  ["src/data/testing.ts", `export * from "../agent/index.ts";`, null],
  ["src/data/rulesFixture.ts", `import { testRules } from "../rules/testing.ts";`, null],
  ["src/routing/fixtures/route.ts", `import { tools } from "../../agent/index.ts";`, null],
  ["src/data/releaseInputs.ts", `import { simData } from "../rules/index.ts";`, null],
  ["src/rules/storage.test.ts", `import { loadLibrary } from "../storage/index.ts";`, TEST_SCOPE],
  ["src/rules/app.test.ts", `import { EditorStore } from "../app/store.ts";`, TEST_SCOPE],
  ["src/data/main.test.ts", `export const app = import("../main.tsx");`, TEST_SCOPE],
  ["src/routing/fixtures/scripts.ts", `import type { Commit } from "../../../scripts/version.ts";`, TEST_SCOPE],
  ["src/io/react.test.ts", `import { render } from "react-dom";`, REACT],
  ["src/rules/nested.test.ts", `import { x } from "./app/file.ts";`, null],
];

const APP_AND_CONTRACT: Case[] = [
  ["src/app/storage.ts", `import { loadLibrary } from "../storage/index.ts";`, null],
  ["src/app/scripts.ts", `import type { Commit } from "../../scripts/version.ts";`, APP_SCRIPTS],
  ["src/main.tsx", `import type { Commit } from "../scripts/version.ts";`, APP_SCRIPTS],
  ["src/app/scripts.test.ts", `import type { Commit } from "../../scripts/version.ts";`, null],
  ["src/app/nested.ts", `import { x } from "./scripts/file.ts";`, null],
  ["src/app/useData.ts", `import { plannerContext } from "../data/plannerFixture.ts";`, TEST_SUPPORT],
  ["src/app/Shell.tsx", `import { renderPlanner } from "./renderPlanner.tsx";`, TEST_SUPPORT],
  ["src/app/map/MapPanel.tsx", `import { renderMap } from "./renderMap.tsx";`, TEST_SUPPORT],
  ["src/app/Boot.tsx", `import "./testSetup.ts";`, TEST_SUPPORT],
  ["src/app/testing.ts", `import { plannerContext } from "../data/plannerFixture.ts";`, null],
  ["src/app/map/mapFixture.ts", `import { x } from "../testing.ts";`, null],
  ["src/app/routing/fixtures/rides.ts", `import { x } from "../../testing.ts";`, null],
  ["src/app/renderPlanner.tsx", `import { worldMap } from "../data/terrainFixture.ts";`, null],
  ["src/app/map/renderMap.tsx", `import { worldMap } from "../../data/terrainFixture.ts";`, null],
  ["src/app/nativeStop.ts", `import { nativeStop } from "../routing/frame.ts";`, NATIVE_STOP],
  ["src/app/map/nativePlan.ts", `import { nativePlan } from "../../routing/frame.ts";`, NATIVE_STOP],
  ["src/nativeStop.ts", `import { nativeStop } from "./routing/frame.ts";`, NATIVE_STOP],
  ["src/app/map/layers/nativePlan.ts", `import { nativePlan } from "../../../routing/frame.ts";`, NATIVE_STOP],
  ["src/app/nativeStopJs.ts", `import { nativeStop } from "../routing/frame.js";`, NATIVE_STOP],
  ["src/app/frameOf.ts", `import { frameOf } from "../routing/frame.ts";`, null],
  ["src/app/palette.ts", `import palette from "./palette.json" with { type: "json" };`, APP_JSON],
  ["src/app/map/lazyPalette.ts", `export const palette = import("./palette.json");`, APP_JSON],
  ["src/app/rawPalette.ts", `import palette from "./palette.json?raw";`, APP_JSON],
  ["src/app/routing/ridesFixture.tsx", `import rides from "./fixtures/rides.json" with { type: "json" };`, null],
  ["src/app/routing/rides.test.ts", `import rides from "./fixtures/rides.json" with { type: "json" };`, null],
  ["src/palette.ts", `import palette from "./palette.json" with { type: "json" };`, APP_JSON],
  ["src/palette.mts", `import palette from "./palette.json" with { type: "json" };`, APP_JSON],
  ["src/palette.js", `import palette from "./palette.json" with { type: "json" };`, APP_JSON],
  ["src/theme2/palette.ts", `import palette from "./palette.json" with { type: "json" };`, APP_JSON],
  ["src/rides.test.ts", `import rides from "./app/routing/fixtures/rides.json" with { type: "json" };`, null],
  ["src/theme2/palette.test.ts", `import palette from "./palette.json" with { type: "json" };`, null],
  ["packages/data-contract/src.ts", `import { GameData } from "../../src/data/index.ts";`, CONTRACT],
  ["packages/data-contract/own.ts", `import type { Quest } from "./model.ts";`, null],
];
const COLORS: Case[] = [
  ...["src/app/ink.ts", "src/ink.mts", "src/ink.js", "src/theme2/ink.ts"].map((file): Case => [
    file,
    `export const ink = "white";`,
    RAW_COLOR,
  ]),
  ...Object.keys(BEFORE).map((core): Case => [`src/${core}/ink.ts`, `export const ink = "white";`, null]),
  ["src/app/theme/colors.ts", `export const ink = "white";`, null],
  ["src/theme2/ink.test.ts", `export const ink = "white";`, null],
];
const REPO: Case[] = [
  ...["palette.ts", "packages/theme/palette.ts", "public/palette.js"].flatMap((file): Case[] => [
    [file, `import palette from "./palette.json" with { type: "json" };`, APP_JSON],
    [file.replace("palette", "ink"), `export const ink = "white";`, RAW_COLOR],
  ]),
  ["packages/theme/palette.test.ts", `import palette from "./palette.json" with { type: "json" };`, null],
  ["packages/theme/ink.test.ts", `export const ink = "white";`, null],
  ["packages/data-contract/model.test.ts", `import { GameData } from "../../src/data/index.ts";`, CONTRACT],
  ...["scripts/theme", "packages/oxlint-plugin-rxpplanner/src", "packages/data-contract"].flatMap((folder): Case[] => [
    [`${folder}/palette.ts`, `import palette from "./palette.json" with { type: "json" };`, null],
    [`${folder}/ink.ts`, `export const ink = "white";`, null],
  ]),
];
const TOOLS: Case[] = [
  ["bridge.ts", `export { appVersion } from "./scripts/version.ts";`, APP_SCRIPTS],
  ["packages/theme/bridge.ts", `export { appVersion } from "../../scripts/version.ts";`, APP_SCRIPTS],
  ["public/bridge.js", `export { appVersion } from "../scripts/version.ts";`, APP_SCRIPTS],
  ["src/app/plugin.ts", `import plugin from "../../packages/oxlint-plugin-rxpplanner/src/index.ts";`, PLUGIN],
  ["src/app/pluginName.ts", `import plugin from "oxlint-plugin-rxpplanner";`, PLUGIN],
  ["packages/theme/plugin.ts", `import plugin from "../oxlint-plugin-rxpplanner/src/index.ts";`, PLUGIN],
  ["packages/theme/pluginName.ts", `import plugin from "oxlint-plugin-rxpplanner";`, PLUGIN],
  ["src/rules/plugin.test.ts", `import plugin from "oxlint-plugin-rxpplanner";`, PLUGIN],
  ["vite.config.ts", `import { appVersion } from "./scripts/version.ts";`, null],
  ["integration/vitest.routing.config.ts", `import { DATA_DIR } from "../scripts/dataset/local.ts";`, null],
  ["integration/vitest.release.config.ts", `import plugin from "oxlint-plugin-rxpplanner";`, PLUGIN],
  ["stylelint.config.js", `import { RESERVED_PROPERTY } from "./packages/oxlint-plugin-rxpplanner/src/tokens.ts";`, null],
  ["scripts/theme/plugin.ts", `import plugin from "../../packages/oxlint-plugin-rxpplanner/src/index.ts";`, null],
  ["packages/oxlint-plugin-rxpplanner/src/script.ts", `import { appVersion } from "../../../scripts/version.ts";`, null],
];
const MOTION_FORMS = [
  `document.body.animate([], 200);`,
  `export const play = (effect: AnimationEffect) => new Animation(effect).play();`,
  `new KeyframeEffect(document.body, [], 200);`,
  `new DocumentTimeline();`,
  `new ScrollTimeline({ source: document.body });`,
  `new ViewTimeline({ subject: document.body });`,
  `document.createElementNS("http://www.w3.org/2000/svg", "animate");`,
  `document.body.scrollIntoView({ behavior: "smooth" });`,
  `window.scrollTo({ top: 0, behavior: "smooth" as ScrollBehavior });`,
  `document.body.getAnimations()[0]?.effect?.updateTiming({ duration: 200 });`,
  `document.startViewTransition(() => document.body.append("x"));`,
  `document.createElementNS("http://www.w3.org/2000/svg", "set");`,
];
const MOTION: Case[] = [
  ...MOTION_FORMS.flatMap((code, i) =>
    [`src/app/motion${i}.ts`, `src/storage/motion${i}.ts`].map((file): Case => [file, code, MOTION_CODE]),
  ),
  ["src/app/spinner.tsx", `export const Spinner = () => <svg><animate attributeName="opacity" dur="1s" /></svg>;`, MOTION_CODE],
];
const SAVED_SETTING = "src/app/savedSetting.ts";
const CASES = [...DIRECTIONS, ...FORMS, ...SUPPORT, ...APP_AND_CONTRACT, ...COLORS, ...REPO, ...TOOLS, ...MOTION];

const repo = join(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "module-order-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const RULES = new Set(["eslint/no-restricted-imports", "rxpplanner/no-raw-color", "rxpplanner/no-script-motion"]);
interface Override {
  files: string[];
  rules: Record<string, unknown>;
}
// The config has comments, which JSON.parse refuses. Strings match first, so the `/*` of a glob stays.
const text = readFileSync(join(repo, ".oxlintrc.json"), "utf8").replace(/("(?:\\.|[^"\\])*")|\/\/.*|\/\*[\s\S]*?\*\//g, "$1");
const config = JSON.parse(text) as { rules: Override["rules"]; overrides: Override[] };
const pick = (rules: Override["rules"]) => Object.fromEntries(Object.entries(rules).filter(([rule]) => RULES.has(rule)));
const overrides = config.overrides.flatMap((o) => {
  const rules = pick(o.rules);
  return Object.keys(rules).length > 0 ? [{ files: o.files, rules }] : [];
});
const plugin = join(repo, "packages/oxlint-plugin-rxpplanner/src/index.ts");
writeFileSync(
  join(root, ".oxlintrc.json"),
  JSON.stringify({ jsPlugins: [plugin], categories: { correctness: "off" }, rules: pick(config.rules), overrides }),
);
for (const [file, code] of [...CASES, [SAVED_SETTING, MOTION_FORMS.join(" ")]]) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), `${code}\n`);
}

const lint = spawnSync(join(repo, "node_modules/.bin/oxlint"), ["-c", ".oxlintrc.json", "--format", "json", "."], {
  cwd: root,
  encoding: "utf8",
});
const reported = new Map<string, string[]>();
// An import ban puts the configured message in `help`. A plugin rule has no help, so its cases name its code.
for (const d of (JSON.parse(lint.stdout) as { diagnostics: { filename: string; code: string; help?: string }[] }).diagnostics) {
  reported.set(d.filename, [...(reported.get(d.filename) ?? []), d.help ?? d.code]);
}

it.each(CASES)("%s: %s", (file, _code, message) => {
  expect(reported.get(file) ?? []).toEqual(message === null ? [] : [message]);
});

it("rejects each motion form in savedSetting.ts, where other bans are off", () => {
  expect(reported.get(SAVED_SETTING)).toEqual(MOTION_FORMS.map(() => MOTION_CODE));
});
