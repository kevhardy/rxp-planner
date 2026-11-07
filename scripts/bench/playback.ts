/**
 * Run with `node scripts/bench/playback.ts --guides 1 --runs 5`.
 * Use an external timeout.
 * Data loading is excluded. Cold means empty Playback ways and terrain search caches,
 * not an empty OS file cache. Warm retains Playback ways on the same instance.
 * --replay uses exact real route results in memory and measures orchestration only.
 * Faster replay can publish fewer intermediate prices. Missing recorded requests
 * fail the run. Use --every 0 for a deterministic first-and-last-price experiment.
 * For CPU attribution, run separately with --profile FILE.cpuprofile.
 * The profile covers calculation and output checks, excluding loading and simulation.
 * This Node run excludes browser rendering and worker messaging.
 * nonRoutingMs includes benchmark request recording. Output hashes are computed
 * after timing. CPU attribution is needed to separate pricing and selection.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { guideNamed } from "../../src/rules/registration.ts";
import { routeTrip, type Journeys } from "../../src/routing/journey.ts";
import { PlaybackRouting, type Playback, type WayRouter } from "../../src/routing/playback.ts";
import { DEFAULT_MAX_SLOPE } from "../../src/routing/plan.ts";
import { recentRecords, SEARCH_RECORDS } from "../../src/routing/reuse.ts";
import { placeTransports, tripRides, type Rides } from "../../src/routing/transport.ts";
import { createProfile, factionData, previewDoc, simulateRoute, timelineNpcs } from "../../src/rules/index.ts";
import { datasetDir, installedDataset, installedRouting } from "../dataset/local.ts";
import { BUILTIN_FILE, loadGuides } from "../guides/load-guides.ts";
import { openInstalled } from "../routing/installed.ts";

const { values } = parseArgs({
  options: {
    guides: { type: "string", default: "1" },
    runs: { type: "string", default: "5" },
    every: { type: "string", default: "1000" },
    profile: { type: "string" },
    replay: { type: "boolean", default: false },
  },
});
const reach = Number(values.guides);
const runs = Number(values.runs);
const every = Number(values.every);
assert(Number.isInteger(reach) && reach > 0, "--guides must be a positive integer");
assert(Number.isInteger(runs) && runs >= 0, "--runs must be a nonnegative integer");
assert(Number.isFinite(every) && every >= 0, "--every must be nonnegative milliseconds");
const report = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value, (_, item: unknown) => (item instanceof Map ? [...item] : item instanceof Set ? [...item] : item)))
    .digest("hex");

const { game, entities, transports } = await installedDataset();
const manifestBytes = await readFile(join(datasetDir(), "manifest.json"));
const bytes = await readFile(BUILTIN_FILE);
const { records } = await loadGuides(bytes);
const start = guideNamed(records, "1-6 Northshire");
assert(start >= 0, "Northshire must be present");
const guides = records.map((record) => previewDoc(record));
const profile = createProfile({ race: "Human", class: "WARRIOR", level: 1, soloSelfFound: true });
const data = factionData(game, entities, "Alliance").sim;
const simulationStart = performance.now();
const simulation = simulateRoute(guides, start, profile, data);
const simulationMs = performance.now() - simulationStart;
const input = { simulation, guides, profile, data, npcs: timelineNpcs(game, "Alliance") };
const grounds = new Map<number, Awaited<ReturnType<typeof openInstalled>>>();
const pins = await installedRouting();
for (const { map } of pins) grounds.set(map, await openInstalled(map));
const frames = [...grounds.values()].map((ground) => ground.artifact.manifest);
const rides = tripRides(placeTransports(transports, frames), { faction: "Alliance", class: "WARRIOR", race: "Human" });
const found = recentRecords(SEARCH_RECORDS);
const recorded = new Map<string, Journeys>();
const rideKeys = new WeakMap<Rides, string>();
const sequence: string[] = [];
let routeMs = 0;
let routeCalls = 0;
let failures = 0;
let replay = false;
const router: WayRouter = {
  frames,
  rides,
  async route(plan, mode, signal, legRides) {
    signal.throwIfAborted();
    if (legRides && !rideKeys.has(legRides)) rideKeys.set(legRides, digest(legRides));
    const key = JSON.stringify([plan, mode, legRides && rideKeys.get(legRides)]);
    sequence.push(key);
    routeCalls++;
    const begin = performance.now();
    try {
      if (replay) {
        const result = recorded.get(key);
        assert(result, "Replay encountered a request absent from real routing");
        return result;
      }
      const result = await routeTrip(
        plan,
        (map) => {
          const ground = grounds.get(map);
          return ground && { terrain: ground.terrain, groundKey: `map ${map}` };
        },
        { modes: [mode], maxSlope: DEFAULT_MAX_SLOPE, ...(legRides && { rides: legRides }), known: found.merged(), found: found.keep },
      );
      recorded.set(key, result);
      report({
        event: "route",
        call: routeCalls,
        ms: performance.now() - begin,
        kinds: result.journeys.flatMap((j) => j.legs.map((l) => l.kind)),
      });
      return result;
    } catch (error) {
      failures++;
      report({ event: "route-error", replay, message: String(error) });
      throw error;
    } finally {
      routeMs += performance.now() - begin;
    }
  },
};
report({
  event: "input",
  node: process.version,
  dataset: `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`,
  guidesHash: createHash("sha256").update(bytes).digest("hex"),
  reach,
  every,
  simulationMs,
  maps: [...grounds.keys()],
  routingPins: pins,
});

async function calculate(kind: string, routing: PlaybackRouting) {
  routeMs = 0;
  routeCalls = 0;
  failures = 0;
  sequence.length = 0;
  let publications = 0;
  let firstMs = 0;
  const cpu = process.cpuUsage();
  const begin = performance.now();
  const result = await routing.play(
    input,
    reach,
    () => 0,
    () => {
      publications++;
      if (publications === 1) firstMs = performance.now() - begin;
    },
  );
  const elapsedMs = performance.now() - begin;
  const used = process.cpuUsage(cpu);
  assert.equal(failures, 0, "Router errors invalidate the benchmark");
  assert.equal(result.routing.pending, 0, "Calculation must finish all pending legs");
  assert(result.timeline.steps.length > 0, "Calculation must price steps");
  const signature = playbackSignature(result);
  report({
    event: "calculation",
    kind,
    elapsedMs,
    cpuMs: (used.user + used.system) / 1000,
    firstMs,
    routeMs,
    nonRoutingMs: elapsedMs - routeMs,
    routeCalls,
    failures,
    publications,
    routing: result.routing,
    pricedGuides: result.chain.filter((guide) => guide.priced).map((guide) => guide.name),
    steps: result.timeline.steps.length,
    warnings: result.timeline.warnings.length,
    totals: result.timeline.totals,
    signature,
    sequence: digest(sequence),
  });
  return signature;
}

function playbackSignature(playback: Playback) {
  return digest({
    timeline: playback.timeline,
    routing: playback.routing,
    chain: playback.chain,
    ways: playback.timeline.steps.map((_, index) => playback.ways(index)),
    moments: playback.timeline.steps.map((step) => playback.at(step.start)),
  });
}

const routing = new PlaybackRouting(router, { every });
const profiler = values.profile ? new Session() : undefined;
if (profiler) {
  profiler.connect();
  await profiler.post("Profiler.enable");
  await profiler.post("Profiler.start");
}
const cold = await calculate("real-cold", routing);
for (let run = 0; run < runs; run++) {
  assert.equal(await calculate("real-warm", routing), cold, "Warm calculation changed the output");
  if (values.replay) {
    replay = true;
    assert.equal(await calculate("recorded-route-replay", new PlaybackRouting(router, { every })), cold, "Replay changed the output");
    replay = false;
  }
}
if (profiler && values.profile) {
  const { profile: trace } = await profiler.post("Profiler.stop");
  profiler.disconnect();
  await writeFile(values.profile, JSON.stringify(trace));
}
