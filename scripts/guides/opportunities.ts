// Prints the while-you're-here opportunities of a guide route.
//
//   pnpm --silent guides:opportunities --guide "1-6 Northshire" --race Human --class WARRIOR --ssf --zone 40
//
// Give --ssf for Forever, which has no auction house. Without it, the
// simulator buys the items of each `#ah` step, so their objectives are done.
//
//   --guide NAME        the guide where the route starts; required. The route
//                       follows `#next` from there.
//   --race RACE
//   --class CLASS       upper case
//   --level N           the start level; default the number at the start of a
//                       name such as `1-6 Northshire`, else 1
//   --ssf               play solo self-found
//   --zone ID           keep only the steps in one Questie zone, such as 40 for Westfall
//   --radius, --focus, --min-share
//                       the `OpportunityOptions` fields of the same name
//   --top N             results to print for each step
//   --file FILE         add the guides of an addon zip, a Lua file, or a guide
//                       text file. Repeat it for more files. A loaded guide
//                       replaces a built-in guide with the same group and name.
//   --builtins FILE     the built-in guide file
//   --json OUT          write all results to OUT

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { factionData, previewDoc } from "../../src/rules/index.ts";
import { guideMeta, guideNamed } from "../../src/rules/registration.ts";
import { importGuides, type ImportedGuide } from "../../src/io/import.ts";
import { findOpportunities } from "../../src/rules/opportunities.ts";
import { createProfile, simulateRoute } from "../../src/rules/index.ts";
import { CLASSES, PLAYABLE_RACES } from "../../src/data/index.ts";
import { BUILTIN_FILE, loadGuides } from "./load-guides.ts";
import { installedDataset } from "../dataset/local.ts";

const { values } = parseArgs({
  options: {
    builtins: { type: "string", default: BUILTIN_FILE },
    file: { type: "string", multiple: true, default: [] },
    guide: { type: "string" },
    race: { type: "string", default: "Human" },
    class: { type: "string", default: "WARRIOR" },
    level: { type: "string" },
    ssf: { type: "boolean", default: false },
    zone: { type: "string" },
    radius: { type: "string", default: "100" },
    focus: { type: "string", default: "150" },
    "min-share": { type: "string", default: "0.1" },
    top: { type: "string", default: "5" },
    json: { type: "string" },
  },
});
if (!values.guide) throw new Error("Name the start guide with --guide");
const race = PLAYABLE_RACES.find((race) => race === values.race);
if (!race) throw new Error(`Unknown race ${values.race}`);
const className = CLASSES.find((name) => name === values.class);
if (!className) throw new Error(`Unknown class ${values.class}`);

const { game, entities } = await installedDataset();
const extra: ImportedGuide[] = [];
for (const file of values.file) extra.push(...(await importGuides(new Uint8Array(await readFile(file)))).guides);
const { records } = await loadGuides(new Uint8Array(await readFile(values.builtins)), extra);
const docs = records.map((record) => previewDoc(record));
const names = records.map((record) => guideMeta(record).name);
const extras = records.slice(records.length - extra.length);
const fromFile = guideNamed(extras, values.guide);
const start = fromFile >= 0 ? records.length - extra.length + fromFile : guideNamed(records, values.guide);
if (start < 0) throw new Error(`No loaded guide is named ${values.guide}`);
const level = Number(values.level ?? /^(\d+)-/.exec(values.guide)?.[1] ?? 1);
const profile = createProfile({ race, class: className, level, soloSelfFound: values.ssf });
const { sim, opportunities } = factionData(game, entities, profile.faction);
const simulation = simulateRoute(docs, start, profile, sim);
const found = findOpportunities(docs, simulation, profile, opportunities, {
  radius: Number(values.radius),
  focus: Number(values.focus),
  minShare: Number(values["min-share"]),
}).filter((s) => values.zone === undefined || s.zoneId === Number(values.zone));

const stepLine = (g: number, s: number) =>
  docs[g]!.header.length + docs[g]!.steps.slice(0, s).reduce((n, step) => n + 1 + step.body.length, 0) + 1;
const top = Number(values.top);
for (const { guide, step, zoneId, points, opportunities } of found) {
  const said = docs[guide]!.steps[step]!.body.find((l) => l.kind === "text" || (l.kind === "command" && l.text));
  const text = said?.kind === "text" ? said.text : said?.kind === "command" ? said.text : "";
  console.log(`\n${names[guide]} step ${step} (line ${stepLine(guide, step)}), zone ${zoneId}, ${points} area points: ${text}`);
  for (const o of opportunities.slice(0, top)) {
    const quest = sim.quest(o.questId)?.name;
    const flags = [o.covered && "covered", o.plannedStep !== null && `planned at step ${o.plannedStep}`].filter(Boolean).join(", ");
    console.log(
      `  [${o.source}] ${o.questId} ${quest}: ${o.objective.name} (${o.kind}), ${o.distanceYards} yd, share ${o.overlapShare}, ` +
        `remaining ${o.remaining ?? "?"}${flags && `, ${flags}`}`,
    );
    console.log(o.suggestion.replace(/^/gm, "      "));
  }
  if (opportunities.length > top) console.log(`  ... and ${opportunities.length - top} more`);
}
if (values.json)
  await writeFile(
    values.json,
    JSON.stringify(
      { guide: values.guide, race: values.race, class: values.class, level, steps: found.map((s) => ({ ...s, name: names[s.guide] })) },
      null,
      2,
    ) + "\n",
  );
