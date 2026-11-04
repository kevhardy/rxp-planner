// Simulates and prices every built-in guide chain, and writes or compares a
// dump of each result, to show that a change to the simulation keeps its
// behavior.
//
//   node scripts/guides/simulation-diff.ts dump OUT.gz
//   node scripts/guides/simulation-diff.ts compare BASE.gz HEAD.gz
//
// `dump` runs from every built-in guide, at each profile below, solo and duo,
// on the installed release file. Each line of OUT.gz is one case: its key, a
// tab, and the JSON of the simulation and the timeline. It exits nonzero when
// a run throws. `compare` exits nonzero when a case is missing, added, or
// differs, and names the first path that differs.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { isDeepStrictEqual } from "node:util";
import { createGunzip, createGzip } from "node:zlib";
import type { CommentLine, GuideDocument } from "../../src/guide/index.ts";
import { guideMeta } from "../../src/rules/registration.ts";
import {
  createProfile,
  DUNGEONS,
  factionData,
  previewDoc,
  priceRoute,
  simulateRoute,
  timelineNpcs,
  type Profile,
} from "../../src/rules/index.ts";
import { RACE_FACTION } from "../../src/data/index.ts";
import { installedDataset } from "../dataset/local.ts";
import { loadGuides } from "./load-guides.ts";

const BUILTINS = new URL("../../public/data/rxp-forever.json.gz", import.meta.url);
const PIN = new URL("../dataset/pin.json", import.meta.url);

const ALL_DUNGEONS = [...DUNGEONS.keys()];

const PROFILES = {
  humanWarrior: { race: "Human", class: "WARRIOR", sex: "male", soloSelfFound: true, groupQuests: false, dungeons: [] },
  nightElfHunter: { race: "NightElf", class: "HUNTER", sex: "female", soloSelfFound: false, groupQuests: true, dungeons: ALL_DUNGEONS },
  windshaperShaman: { race: "Windshaper", class: "SHAMAN", sex: "male", soloSelfFound: true, groupQuests: true, dungeons: ALL_DUNGEONS },
} satisfies Record<string, Pick<Profile, "race" | "class" | "sex" | "soloSelfFound" | "groupQuests" | "dungeons">>;

const PARTIES = [1, 2] as const;

function encode(value: unknown, docs: ReadonlyMap<GuideDocument, number>): unknown {
  if (value === undefined) return { $undefined: true };
  if (typeof value === "number") {
    if (Object.is(value, -0)) return { $number: "-0" };
    return Number.isFinite(value) ? value : { $number: String(value) };
  }
  if (value === null || typeof value !== "object") return value;
  const doc = docs.get(value as GuideDocument);
  if (doc !== undefined) return { $doc: doc };
  if (value instanceof Map) return { $map: [...value].map(([k, v]) => [encode(k, docs), encode(v, docs)]) };
  if (value instanceof Set) return { $set: [...value].map((v) => encode(v, docs)) };
  if (Array.isArray(value)) return value.map((v) => encode(v, docs));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => typeof v !== "function")
      .map(([k, v]) => [k, encode(v, docs)]),
  );
}

const withParty = (docs: readonly GuideDocument[], party: number): GuideDocument[] =>
  docs.map((doc) => ({
    ...doc,
    header: [...doc.header, { kind: "comment", indent: "", comment: ` @sim party=${party}` } satisfies CommentLine],
  }));

async function* cases() {
  const builtins = new Uint8Array(await readFile(BUILTINS));
  const { records } = await loadGuides(builtins);
  const { game, entities } = await installedDataset();
  const pin = (JSON.parse(await readFile(PIN, "utf8")) as { sha256: string }).sha256;
  yield `#\t${JSON.stringify({ pin, builtins: createHash("sha256").update(builtins).digest("hex") })}\n`;
  const parsed = records.map((r) => previewDoc(r));
  let runs = 0;
  let failed = 0;
  let steps = 0;
  for (const [name, character] of Object.entries(PROFILES)) {
    const faction = RACE_FACTION[character.race];
    const { sim: data } = factionData(game, entities, faction);
    const npcs = timelineNpcs(game, faction);
    for (const party of PARTIES) {
      const guides = withParty(parsed, party);
      const docs = new Map(guides.map((doc, i) => [doc, i]));
      for (let start = 0; start < records.length; start++) {
        const key = `${start}/${name}/party=${party}`;
        const profile = createProfile({ ...character, level: guideMeta(records[start]!).range?.min ?? 1 });
        runs++;
        try {
          const simulation = simulateRoute(guides, start, profile, data);
          const timeline = await priceRoute(simulation, guides, profile, data, npcs);
          const { start: first, guides: route, warnings, end, settings, hearth } = simulation;
          const result = { simulation: { start: first, guides: route, warnings, end, settings, hearth }, timeline };
          yield `${key}\t${JSON.stringify(encode(result, docs))}\n`;
          steps += timeline.steps.length;
        } catch (error) {
          failed++;
          console.error(`${key} threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        }
      }
    }
  }
  console.log(
    `${runs} runs (${records.length} starts, ${Object.keys(PROFILES).length} profiles, ${PARTIES.length} parties), ${steps} timeline steps, ${failed} threw.`,
  );
  if (failed) process.exitCode = 1;
}

const dump = (out: string) => pipeline(cases, createGzip(), createWriteStream(out));

async function* readDump(file: string) {
  for await (const line of createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })) {
    const tab = line.indexOf("\t");
    yield { key: line.slice(0, tab), text: line.slice(tab + 1) };
  }
}

function firstDifference(a: unknown, b: unknown, path = "$"): string | undefined {
  if (isDeepStrictEqual(a, b)) return undefined;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b))
    return `${path}: ${JSON.stringify(a)} became ${JSON.stringify(b)}`;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const key of keys) {
    const found = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
    if (found) return found;
  }
  return `${path}: key order differs`;
}

async function compare(baseFile: string, headFile: string) {
  const base = readDump(baseFile);
  const head = readDump(headFile);
  let matched = 0;
  const problems: string[] = [];
  for (;;) {
    const [was, now] = await Promise.all([base.next(), head.next()]);
    if (was.done && now.done) break;
    if (was.done || now.done || was.value.key !== now.value.key) {
      problems.push(`case ${matched + problems.length}: ${was.value?.key ?? "missing"} became ${now.value?.key ?? "missing"}`);
      break;
    }
    if (was.value.text === now.value.text) matched++;
    else problems.push(`${was.value.key}: ${firstDifference(JSON.parse(was.value.text), JSON.parse(now.value.text)) ?? "text differs"}`);
  }
  console.log([...problems, `${matched} cases match, ${problems.length} problems.`].join("\n"));
  if (problems.length) process.exitCode = 1;
}

const [command, ...files] = process.argv.slice(2);
if (command === "dump" && files.length === 1) await dump(files[0]!);
else if (command === "compare" && files.length === 2) await compare(files[0]!, files[1]!);
else {
  console.error("Usage: simulation-diff.ts dump OUT.gz | compare BASE.gz HEAD.gz");
  process.exitCode = 2;
}
