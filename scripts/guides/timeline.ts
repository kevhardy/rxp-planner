// Prints the play-time timeline of a guide route, step by step, with totals
// and the time each level is reached.
//
//   pnpm --silent guides:timeline --guide "1-6 Northshire" --race Human --class WARRIOR
//
// Plays solo self-found, as Playback does, so it hides `#ah` steps and shows
// `#ssf` steps. Each guide's header sets its party.
//
//   --guide NAME       the guide where the route starts; default the first guide
//   --guides N         stop after N guides of the `#next` chain, hidden guides
//                      included
//   --race RACE
//   --class CLASS      any case
//   --level N          the start level, with 0 XP
//   --travel routing   route each leg on the installed routing artifact, and
//                      cache it by `travelCacheKey`
//   --budget SECONDS   search time for `--travel routing`, after which each leg
//                      keeps the straight-line estimate
//   --file FILE        read the guides of an addon zip, a Lua file, or a guide
//                      text file in place of the built-in guides
//   --builtins FILE    the built-in guide file
//   --json OUT         write the timeline result to OUT, without the state
//                      before each step
//   --aggregate        print and write only the summary, so no guide text of a
//                      private guide leaves its folder

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { factionData, previewDoc } from "../../src/rules/index.ts";
import { CLASSES, PLAYABLE_RACES, RACE_FACTION, type ClassName, type WorldLocation } from "../../src/data/index.ts";
import { guideNamed } from "../../src/rules/registration.ts";
import { importGuides } from "../../src/io/import.ts";
import { routeTrip, type MapGround } from "../../src/routing/journey.ts";
import { createPlan, DEFAULT_MAX_SLOPE, withHeight } from "../../src/routing/plan.ts";
import {
  buildTimeline,
  createProfile,
  reportTitle,
  straightTravel,
  timelineNpcs,
  type TimelineResult,
  type Travel,
  type TravelEstimate,
} from "../../src/rules/index.ts";
import type { GuideRecord } from "../../src/guide/index.ts";
import { BUILTIN_FILE, loadGuides } from "./load-guides.ts";
import { installedDataset } from "../dataset/local.ts";
import { routeOf } from "../../src/routing/result.ts";
import { openInstalled, travelCacheKey } from "../routing/installed.ts";

interface RoutingStats {
  routed: number[];
  cached: number;
  seconds: { routing: number; straight: number };
  slowest?: { ms: number; from: WorldLocation; to: WorldLocation; result: string };
  fallbacks: Map<string, number>;
}

function routingTravel(budget: number, stats: RoutingStats): Travel {
  const grounds = new Map<number, Promise<Awaited<ReturnType<typeof openInstalled>> | undefined>>();
  const groundOf = (map: number) => {
    if (!grounds.has(map))
      grounds.set(
        map,
        openInstalled(map).catch(() => undefined),
      );
    return grounds.get(map)!;
  };
  const cache = new Map<string, TravelEstimate>();
  let spent = 0;
  const fallback = (reason: string, estimate: TravelEstimate): TravelEstimate => {
    stats.fallbacks.set(reason, (stats.fallbacks.get(reason) ?? 0) + 1);
    return { ...estimate, source: `straight (${reason})` };
  };
  return async ({ from, to, mode }) => {
    const estimate = straightTravel({ from, to, mode });
    if (from.instance !== to.instance) return estimate;
    const key = `${travelCacheKey(from, to)} ${mode}`;
    const known = cache.get(key);
    if (known) {
      stats.cached++;
      return known;
    }
    if (spent > budget) return fallback("budget", estimate);
    const ground = await groundOf(from.instance);
    if (!ground) return fallback("no artifact", estimate);
    const plan = createPlan(withHeight(from, null), withHeight(to, null), key);
    const started = performance.now();
    const terrain: MapGround = { terrain: ground.terrain };
    const journeys = await routeTrip(plan, () => terrain, { modes: [mode], maxSlope: DEFAULT_MAX_SLOPE });
    const ms = performance.now() - started;
    spent += ms / 1000;
    stats.routed.push(ms);
    const leg = journeys.journeys[0]?.legs[0];
    const route = leg && routeOf(leg);
    const result = route ? { seconds: route.seconds, source: "routing" } : fallback(leg?.kind ?? "no route", estimate);
    if (ms > (stats.slowest?.ms ?? 0)) stats.slowest = { ms, from, to, result: leg?.kind ?? "none" };
    if (route) {
      stats.seconds.routing += route.seconds;
      stats.seconds.straight += estimate.seconds;
    }
    cache.set(key, result);
    return result;
  };
}

async function guideRecords(values: { builtins: string; file?: string }): Promise<GuideRecord[]> {
  if (!values.file) return (await loadGuides(new Uint8Array(await readFile(values.builtins)))).records;
  const { guides } = await importGuides(new Uint8Array(await readFile(values.file)));
  return guides.map(({ text, registerArgs }, order) => ({ id: `file:${order}`, text, order, ...(registerArgs && { registerArgs }) }));
}

const clock = (seconds: number) => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const pad = (value: string | number, width: number) => String(value).padStart(width);

function stepTable(result: TimelineResult): string[] {
  const rows = ["  start   lvl  travel    kill  inter  wait   total   qXP   kXP  step"];
  for (const s of result.steps) {
    const { travel, kill, interact, wait, total } = s.seconds;
    const level = s.levelAfter > s.levelBefore ? `${s.levelBefore}>${s.levelAfter}` : String(s.levelBefore);
    rows.push(
      [
        clock(s.start),
        pad(level, 5),
        pad(travel.toFixed(0), 7),
        pad(kill.toFixed(0), 7),
        pad(interact.toFixed(0), 6),
        pad(wait.toFixed(0), 5),
        pad(total.toFixed(0), 7),
        pad(s.xp.quest, 5),
        pad(s.xp.kill, 5),
        ` ${s.guide} #${s.step + 1} ${reportTitle(s.title)}${s.notes.length ? ` [${s.notes.join("; ")}]` : ""}`,
      ].join(" "),
    );
  }
  return rows;
}

const parties = (result: TimelineResult) => result.steps.map((s) => s.party).filter((p, i, all) => p !== all[i - 1]);

function summary(result: TimelineResult, stats: RoutingStats | undefined): string[] {
  const t = result.totals;
  const lines = [
    `Party ${parties(result).join(", then ") || 1}. Levels ${t.levelStart} to ${t.levelEnd} in ${clock(t.seconds)} (${t.seconds.toFixed(0)} s).`,
    `XP ${t.xp}, ${t.xpPerHour} XP/h. ${t.kills} kills, ${t.questsTurnedIn} quests turned in.`,
    `Travel ${clock(t.travelSeconds)}, kills ${clock(t.killSeconds)}, other ${clock(t.seconds - t.travelSeconds - t.killSeconds)}.`,
    `Levels: ${result.byLevel.map((l) => `${l.level} at ${clock(l.reachedAt)}`).join(", ")}.`,
    `${result.warnings.length} timeline warnings.`,
  ];
  if (stats) {
    const sorted = [...stats.routed].sort((a, b) => a - b);
    const quantile = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!.toFixed(0) : "-");
    const totalMs = sorted.reduce((a, b) => a + b, 0);
    lines.push(
      `Routing: ${sorted.length} legs searched in ${(totalMs / 1000).toFixed(1)} s (mean ${sorted.length ? (totalMs / sorted.length).toFixed(0) : "-"} ms, p50 ${quantile(0.5)} ms, p95 ${quantile(0.95)} ms, max ${quantile(1)} ms), ${stats.cached} cache hits, routed legs ${(stats.seconds.routing / stats.seconds.straight).toFixed(2)}× the straight-line estimate, fallbacks: ${[...stats.fallbacks].map(([r, n]) => `${r} ${n}`).join(", ") || "none"}.`,
    );
    const slow = stats.slowest;
    const place = (p: WorldLocation) => `${p.instance}/${p.x.toFixed(0)},${p.y.toFixed(0)}`;
    if (slow) lines.push(`Slowest search: ${slow.ms.toFixed(0)} ms, ${place(slow.from)} to ${place(slow.to)}, ${slow.result}.`);
  }
  return lines;
}

async function main() {
  const { values } = parseArgs({
    options: {
      builtins: { type: "string", default: BUILTIN_FILE },
      file: { type: "string" },
      guide: { type: "string" },
      race: { type: "string", default: "Human" },
      class: { type: "string", default: "WARRIOR" },
      level: { type: "string", default: "1" },
      travel: { type: "string", default: "straight" },
      budget: { type: "string", default: "600" },
      guides: { type: "string" },
      json: { type: "string" },
      aggregate: { type: "boolean", default: false },
    },
  });
  const race = PLAYABLE_RACES.find((race) => race === values.race);
  const cls = values.class.toUpperCase() as ClassName;
  if (!race) throw new Error(`--race must be one of ${PLAYABLE_RACES.join(", ")}`);
  if (!CLASSES.includes(cls)) throw new Error(`--class must be one of ${CLASSES.join(", ")}`);
  if (values.travel !== "straight" && values.travel !== "routing") throw new Error("--travel must be straight or routing");

  const records = await guideRecords(values);
  const name = values.guide;
  const start = name === undefined ? 0 : guideNamed(records, name);
  if (start < 0) throw new Error(`No guide is named ${name}`);
  const { game, entities } = await installedDataset();
  const faction = RACE_FACTION[race];
  const profile = createProfile({ race, class: cls, level: Number(values.level), soloSelfFound: true });
  const stats: RoutingStats | undefined =
    values.travel === "routing" ? { routed: [], cached: 0, seconds: { routing: 0, straight: 0 }, fallbacks: new Map() } : undefined;
  const started = performance.now();
  const result = await buildTimeline(
    records.map((r) => previewDoc(r)),
    start,
    profile,
    factionData(game, entities, faction).sim,
    {
      ...(stats && { travel: routingTravel(Number(values.budget), stats) }),
      ...timelineNpcs(game, faction),
      ...(values.guides && { maxGuides: Number(values.guides) }),
    },
  );
  const elapsed = (performance.now() - started) / 1000;

  const out = values.aggregate ? [] : stepTable(result);
  out.push(...summary(result, stats), `Timeline built in ${elapsed.toFixed(1)} s with ${values.travel} travel.`);
  console.log(out.join("\n"));
  if (values.json) {
    const { totals, byLevel, warnings, steps } = result;
    const json = values.aggregate
      ? { party: parties(result), totals, byLevel, steps: steps.length, warnings: warnings.length }
      : { ...result, steps: steps.map(({ before: _, ...s }) => s) };
    await writeFile(values.json, `${JSON.stringify(json, null, 2)}\n`);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
