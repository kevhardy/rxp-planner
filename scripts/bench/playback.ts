/**
 * Run with `timeout 900s pnpm bench:playback --runs 5`, or one scenario with `--case northshire-1`.
 * Use an external timeout.
 * Each run is a fresh process, so no route result, Playback way, or terrain search record survives from an
 * earlier run. An equal `routeCalls` on every cold run shows it. The default --every 0 prices only first and last,
 * because each price at an --every interval changes which leg routes next, so the route calls depend on timing.
 * `--run K` does one run in this process and labels its samples K.
 * Data loading is excluded. Cold is not an empty OS file cache.
 * Warm repeats the calculation on the same Playback instance, which retains its ways.
 * --replay uses exact real route results in memory and measures orchestration only.
 * Faster replay can publish fewer intermediate prices. Missing recorded requests
 * fail the run.
 * For CPU attribution, run separately with --run 1 --profile FILE.cpuprofile.
 * The profile covers calculation and output checks, excluding loading and simulation.
 * This Node run excludes browser rendering and worker messaging.
 * nonRoutingMs includes benchmark request recording. Output hashes are computed
 * after timing. CPU attribution is needed to separate pricing and selection.
 * Stdout is the JSON Lines of `results.ts`: one `meta`, then the cold, warm, and `routeCalls` samples of each run.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import { parseArgs } from "node:util";
import { guideNamed } from "../../src/rules/registration.ts";
import { routeTrip, type Journeys } from "../../src/routing/journey.ts";
import { PlaybackRouting, type Playback, type WayRouter } from "../../src/routing/playback.ts";
import { DEFAULT_MAX_SLOPE } from "../../src/routing/plan.ts";
import { recentRecords, SEARCH_RECORDS } from "../../src/routing/reuse.ts";
import { placeTransports, tripRides, type Rides } from "../../src/routing/transport.ts";
import { createProfile, factionData, previewDoc, simulateRoute, timelineNpcs } from "../../src/rules/index.ts";
import { installedDataset, installedManifestHash, installedRouting } from "../dataset/local.ts";
import { BUILTIN_FILE, loadGuides } from "../guides/load-guides.ts";
import { openInstalled } from "../routing/installed.ts";
import { assertOneSignature, forkBench } from "./child.ts";
import { benchMeta, emit, type BenchSample } from "./results.ts";

const { values } = parseArgs({
  options: {
    case: { type: "string" },
    runs: { type: "string", default: "5" },
    run: { type: "string" },
    every: { type: "string", default: "0" },
    profile: { type: "string" },
    replay: { type: "boolean", default: false },
  },
});
const START = "1-6 Northshire";
/** `guides` counts the guides that Playback prices, from `START`. */
const scenarios = [
  { name: "northshire-1", guides: 1 },
  { name: "northshire-3", guides: 3 },
];
const runs = Number(values.runs);
const every = Number(values.every);
assert(Number.isInteger(runs) && runs > 0, "--runs must be a positive integer");
assert(Number.isFinite(every) && every >= 0, "--every must be nonnegative milliseconds");
const chosen = values.case === undefined ? scenarios : scenarios.filter((s) => s.name === values.case);
assert(chosen.length, `--case must be one of ${scenarios.map((s) => s.name).join(", ")}`);

if (values.run === undefined) {
  assert(!values.profile, "--profile needs --run, so that it profiles one process");
  emit(benchMeta("playback", await installedManifestHash(), { ...values, scenarios: chosen.map((s) => s.name) }));
  for (const { name } of chosen) {
    const samples: BenchSample[] = [];
    for (let run = 1; run <= runs; run++)
      samples.push(...(await forkBench(import.meta.filename, [...process.argv.slice(2), "--case", name, "--run", String(run)])));
    assertOneSignature(name, samples);
    const calls = new Set(samples.flatMap((s) => (s.metric === "routeCalls" ? [s.value] : [])));
    if (every === 0) assert.equal(calls.size, 1, `${name}: cold runs made different route calls, so one was not cold`);
    else console.error(`${name}: with --every above 0, route calls depend on timing, so they do not prove cold runs`);
  }
} else {
  const run = Number(values.run);
  assert(Number.isInteger(run) && run > 0, "--run must be a positive integer");
  assert.equal(chosen.length, 1, "--run needs one --case");
  await runOnce(chosen[0]!, run);
}

async function runOnce(scenario: (typeof scenarios)[number], run: number) {
  emit(benchMeta("playback", await installedManifestHash(), values));
  const digest = (value: unknown) =>
    createHash("sha256")
      .update(JSON.stringify(value, (_, item: unknown) => (item instanceof Map ? [...item] : item instanceof Set ? [...item] : item)))
      .digest("hex");

  const { game, entities, transports } = await installedDataset();
  const bytes = await readFile(BUILTIN_FILE);
  const { records } = await loadGuides(bytes);
  const start = guideNamed(records, START);
  assert(start >= 0, `${START} must be present`);
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
        emit({
          event: "route",
          call: routeCalls,
          ms: performance.now() - begin,
          kinds: result.journeys.flatMap((j) => j.legs.map((l) => l.kind)),
        });
        return result;
      } catch (error) {
        failures++;
        emit({ event: "route-error", replay, message: String(error) });
        throw error;
      } finally {
        routeMs += performance.now() - begin;
      }
    },
  };
  emit({
    event: "input",
    node: process.version,
    guidesHash: createHash("sha256").update(bytes).digest("hex"),
    scenario: scenario.name,
    run,
    guides: scenario.guides,
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
      scenario.guides,
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
    const timing = { elapsedMs, cpuMs: (used.user + used.system) / 1000, firstMs, routeMs, nonRoutingMs: elapsedMs - routeMs, routeCalls };
    const signature = playbackSignature(result);
    emit({
      event: "calculation",
      kind,
      ...timing,
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
    return { ...timing, signature };
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
  const warm = await calculate("real-warm", routing);
  assert.equal(warm.signature, cold.signature, "Warm calculation changed the output");
  if (values.replay) {
    replay = true;
    const replayed = await calculate("recorded-route-replay", new PlaybackRouting(router, { every }));
    assert.equal(replayed.signature, cold.signature, "Replay changed the output");
    replay = false;
  }
  if (profiler && values.profile) {
    const { profile: trace } = await profiler.post("Profiler.stop");
    profiler.disconnect();
    await writeFile(values.profile, JSON.stringify(trace));
  }
  const sample = { event: "sample", scenario: scenario.name, run, signature: cold.signature } as const;
  for (const metric of ["elapsedMs", "cpuMs", "firstMs", "routeMs", "nonRoutingMs"] as const)
    emit({ ...sample, metric: `cold.${metric}`, unit: "ms", value: cold[metric] });
  emit({ ...sample, metric: "warm.elapsedMs", unit: "ms", value: warm.elapsedMs });
  emit({ ...sample, metric: "routeCalls", unit: "count", value: cold.routeCalls });
}
