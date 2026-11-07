/**
 * Real routeTrip workloads, using the installed release and seeded stop keys.
 * Use an external wall-clock limit:
 *   timeout 1800s pnpm bench:routing --runs 5
 *   timeout 180s pnpm bench:routing --case boat --runs 5 --cache cold
 * With no --case, every scenario runs, each in a fresh process. A case must run in a fresh process.
 * Cache: cold creates terrain per request;
 * warm retains terrain but does not supply exact ground results through `known`.
 * --mode selects a DEFAULT_MODES name, with Epic mount as the default.
 * --runs 0 checks correctness only. --trace emits progress outside measurement runs.
 * --diagnose counts coarse destination keys and allocations, separately with --runs 0.
 * --profile FILE records routing and validation CPU work, separately with --runs 0 and one --case.
 * Allocations count returned bound arrays.
 * Region diagnostic durations can overlap; toward durations are synchronous.
 * Timing includes route completion, output validation, and hashing. Artifact loading is excluded.
 * Memory reports process RSS and heap, including loaded artifacts, not just the routing increment.
 * Stdout is the JSON Lines of `results.ts`: one `meta`, then a `routeMs` and a `cpuMs` sample for each timed run.
 * A nonzero exit or timeout is a failed run, never a latency sample.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { routeTrip } from "../../src/routing/journey.ts";
import { nativeToWorld } from "../../src/routing/frame.ts";
import { createPlan, DEFAULT_MAX_SLOPE, DEFAULT_MODES, withHeight } from "../../src/routing/plan.ts";
import { parseStopTable, seedStopKeys, STOP_TABLE_FILE } from "../../src/routing/stop-table.ts";
import { createTerrain } from "../../src/routing/terrain.ts";
import { groundSeconds, placeTransports, usableLinks, type TransportAccess } from "../../src/routing/transport.ts";
import { DATA_DIR, installedDataset, installedManifestHash, installedMaps, installedTransports } from "../dataset/local.ts";
import { endPoint, type End } from "../routing/acceptance.ts";
import { installedArtifact } from "../routing/installed.ts";
import { transportsHash } from "../routing/stop-keys.ts";
import { assertOneSignature, forkBench } from "./child.ts";
import { benchMeta, emit } from "./results.ts";

const { values } = parseArgs({
  options: {
    case: { type: "string" },
    runs: { type: "string", default: "5" },
    cache: { type: "string", default: "cold" },
    mode: { type: "string", default: "Epic mount" },
    trace: { type: "boolean", default: false },
    diagnose: { type: "boolean", default: false },
    profile: { type: "string" },
  },
});

type Scenario = { name: string } & (
  | { kind: "ride"; from: string; to: string; faction: TransportAccess["faction"]; race: string; ride: RegExp }
  /** A route on one map with no rides. */
  | { kind: "ground"; map: number; from: End; to: End }
);

const scenarios: Scenario[] = [
  { name: "boat", kind: "ride", from: "FLIGHT_19", to: "FLIGHT_80", faction: "Horde", race: "Orc", ride: /^DOCK_BOOTYBAY>DOCK_RATCHET$/ },
  {
    name: "elevator",
    kind: "ride",
    from: "elevator-great-lift-1:bottom",
    to: "elevator-great-lift-2:top",
    faction: "Horde",
    race: "Orc",
    ride: /^elevator-great-lift-.*:bottom>.*:top$/,
  },
  {
    name: "flight",
    kind: "ride",
    from: "PORTAL_DARNASSUS_RUTTHERAN",
    to: "FLIGHT_26",
    faction: "Alliance",
    race: "Human",
    ride: /^FLIGHT_27:air>FLIGHT_26:air$/,
  },
  {
    name: "long-flight",
    kind: "ride",
    from: "FLIGHT_26",
    to: "FLIGHT_31",
    faction: "Alliance",
    race: "Human",
    ride: /^FLIGHT_.*:air>FLIGHT_.*:air$/,
  },
  // Marshal Dughan in Goldshire to Supervisor Raelen at Eastvale Logging Camp, both in Elwynn Forest.
  { name: "open-ground", kind: "ground", map: 0, from: { npc: 240 }, to: { npc: 10616 } },
  // The Stormwind City gate to Furen Longbeard in the Dwarven District.
  { name: "city", kind: "ground", map: 0, from: [-9110.96, 390.08], to: { npc: 5413 } },
  // Marshal Dughan in Elwynn Forest to Gryan Stoutmantle at Sentinel Hill in Westfall.
  { name: "zone-border", kind: "ground", map: 0, from: { npc: 240 }, to: { npc: 234 } },
];

const runs = Number(values.runs);
assert(Number.isInteger(runs) && runs >= 0 && runs <= 100, "runs must be an integer from 0 to 100");
assert(values.cache === "cold" || values.cache === "warm", "cache must be cold or warm");
assert(!(values.trace || values.diagnose || values.profile) || runs === 0, "Use --runs 0 for a separate trace run");

if (values.case === undefined) {
  assert(!values.profile, "--profile needs one --case");
  emit(benchMeta("routing", await installedManifestHash(), { ...values, scenarios: scenarios.map((s) => s.name) }));
  for (const { name } of scenarios)
    assertOneSignature(name, await forkBench(import.meta.filename, [...process.argv.slice(2), "--case", name]));
} else {
  const workload = scenarios.find((s) => s.name === values.case);
  assert(workload, `case must be one of ${scenarios.map((s) => s.name).join(", ")}`);
  await runCase(workload);
}

async function runCase(workload: Scenario) {
  emit(benchMeta("routing", await installedManifestHash(), values));
  const setupStart = performance.now();
  const file = await installedTransports();
  const table = parseStopTable(JSON.parse(await readFile(join(DATA_DIR, STOP_TABLE_FILE), "utf8")));
  assert.equal(
    table.transports,
    transportsHash(
      file,
      table.maps.map((m) => m.map),
    ),
    "stale stop table",
  );
  const artifacts = new Map<number, Awaited<ReturnType<typeof installedArtifact>>>();
  for (const map of await installedMaps()) artifacts.set(map, await installedArtifact(map));
  const placed = placeTransports(
    file,
    [...artifacts.values()].map((a) => a.manifest),
  );
  const links =
    workload.kind === "ride"
      ? usableLinks(placed, {
          faction: workload.faction,
          race: workload.race,
          class: "WARRIOR",
          otherFaction: false,
        })
      : [];
  const ends = await scenarioEnds(workload, placed, artifacts);
  const plan = createPlan(ends.from, ends.to, "routing benchmark");
  const mode = DEFAULT_MODES.find((m) => m.name === values.mode);
  assert(mode, `mode must be one of ${DEFAULT_MODES.map((m) => m.name).join(", ")}`);
  plan.settings.modes = [{ ...mode }];
  function terrains() {
    return new Map(
      [...artifacts].map(([map, artifact]) => {
        const terrain = createTerrain(artifact);
        assert(seedStopKeys(table, map, artifact.manifest.id, terrain) > 0, `No seeded keys for map ${map}`);
        return [map, { terrain, groundKey: `map ${map}` }];
      }),
    );
  }
  const setupMs = performance.now() - setupStart;
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  emit({
    event: "setup",
    case: workload.name,
    cache: values.cache,
    setupMs,
    node: process.version,
    pin: JSON.parse(await readFile(new URL("../dataset/pin.json", import.meta.url), "utf8")) as unknown,
    artifacts: [...artifacts].map(([map, a]) => ({ map, id: a.manifest.id })),
    stopTable: hash(table),
    links: links.length,
    nodes: new Set(links.flatMap((l) => [l.from.id, l.to.id])).size,
    groundDestinations: [...artifacts.keys()].map((map) => ({
      map,
      count: new Set(links.filter((l) => l.from.map === map && !l.from.air).map((l) => JSON.stringify([l.from.point, l.from.height]))).size,
    })),
    settings: plan.settings,
    from: ends.from,
    to: ends.to,
  });
  let ground = terrains();
  let expected: string | undefined;
  for (let run = 0; run <= runs; run++) {
    if (values.cache === "cold") ground = terrains();
    const diagnostic = [];
    if (values.diagnose)
      for (const [map, { terrain }] of ground) {
        const layer = await terrain.coarse?.();
        if (!layer) continue;
        const row = {
          map,
          calls: 0,
          builds: 0,
          allocatedBytes: 0,
          towardMs: 0,
          destinations: new Set<string>(),
          regionCalls: 0,
          regionMs: 0,
        };
        diagnostic.push(row);
        const seen = new WeakSet<object>();
        const toward = layer.toward.bind(layer);
        layer.toward = (band, to) => {
          const start = performance.now();
          const result = toward(band, to);
          row.towardMs += performance.now() - start;
          row.calls++;
          const key = `${band.maxSlope} ${to.join()}`;
          row.destinations.add(key);
          if (!seen.has(result)) {
            row.builds++;
            row.allocatedBytes += result.length.byteLength + result.swim.byteLength;
            seen.add(result);
          }
          return result;
        };
        const region = terrain.region.bind(terrain);
        terrain.region = async (...args) => {
          const start = performance.now();
          const result = await region(...args);
          row.regionCalls++;
          row.regionMs += performance.now() - start;
          return result;
        };
      }
    const found: Record<string, number> = {};
    const profiler = values.profile ? new Session() : undefined;
    if (profiler) {
      profiler.connect();
      await profiler.post("Profiler.enable");
      await profiler.post("Profiler.start");
    }
    const memoryBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    const start = performance.now();
    const result = await routeTrip(plan, (map) => ground.get(map), {
      maxSlope: DEFAULT_MAX_SLOPE,
      ...(workload.kind === "ride" && { rides: { links } }),
      found: (_key, leg) => {
        found[leg.kind] = (found[leg.kind] ?? 0) + 1;
      },
      ...(values.trace && {
        onLegs: (updates) => emit({ event: "progress", ms: performance.now() - start, updates }),
      }),
    });
    assert.equal(result.journeys.length, 1, "Expected one movement mode");
    const outputs = result.journeys.map((j) => {
      assert(Number.isFinite(j.seconds) && j.seconds! > 0, "Incomplete journey cost");
      return {
        mode: j.mode.name,
        seconds: j.seconds,
        legs: j.legs.map((leg) => {
          if (workload.kind === "ground") {
            assert(leg.kind === "route" && Number.isFinite(leg.seconds), "Incomplete ground route");
            assert(Math.abs(leg.seconds - j.seconds!) < 1e-9, "Incorrect journey total");
            return { kind: leg.kind, seconds: leg.seconds };
          }
          assert(leg.kind === "transport", "Workload must complete with rides");
          const rides = leg.parts.flatMap((p) => (p.kind === "ride" ? [`${p.link.from.id}>${p.link.to.id}`] : []));
          assert(
            rides.some((r) => workload.ride.test(r)),
            "Expected ride did not run",
          );
          const ground = leg.parts.flatMap((p) => (p.kind === "ride" ? [] : [{ kind: p.result.kind, seconds: groundSeconds(p.result) }]));
          assert(
            ground.every((g) => g.kind === "route" && Number.isFinite(g.seconds)),
            "Incomplete ground route",
          );
          const sum = leg.parts.reduce(
            (sum, part) => sum + (part.kind === "ride" ? part.link.seconds.average : groundSeconds(part.result)!),
            0,
          );
          assert(Math.abs(sum - leg.seconds) < 1e-9 && Math.abs(leg.seconds - j.seconds!) < 1e-9, "Incorrect journey total");
          return { kind: leg.kind, rides, ground };
        }),
      };
    });
    const signature = hash(result);
    expected ??= signature;
    assert.equal(signature, expected, "Output changed between repetitions");
    const routeMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuBefore);
    const memoryAfter = process.memoryUsage();
    if (profiler && values.profile) {
      const { profile } = await profiler.post("Profiler.stop");
      profiler.disconnect();
      await writeFile(values.profile, JSON.stringify(profile));
    }
    if (values.diagnose) emit({ event: "diagnostic", routeMs, maps: diagnostic.map((r) => ({ ...r, destinations: [...r.destinations] })) });
    emit({
      event: run === 0 ? "correctness" : "run",
      run,
      cpu,
      memoryBefore,
      memoryAfter,
      maxRssKiB: process.resourceUsage().maxRSS,
      found,
      outputs,
      signature,
    });
    if (run === 0) continue;
    const sample = { event: "sample", scenario: workload.name, unit: "ms", run, signature } as const;
    emit({ ...sample, metric: "routeMs", value: routeMs });
    emit({ ...sample, metric: "cpuMs", value: (cpu.user + cpu.system) / 1000 });
  }
}

async function scenarioEnds(
  workload: Scenario,
  placed: ReturnType<typeof placeTransports>,
  artifacts: Map<number, Awaited<ReturnType<typeof installedArtifact>>>,
) {
  if (workload.kind === "ground") {
    const { game } = await installedDataset();
    const stop = (end: End) => {
      const [x, y] = endPoint(end, game);
      return withHeight({ instance: workload.map, x: y!, y: x! }, null);
    };
    return { from: stop(workload.from), to: stop(workload.to) };
  }
  const stops = new Map(
    placed.flatMap((l) => [
      [l.from.id, l.from],
      [l.to.id, l.to],
    ]),
  );
  const from = stops.get(workload.from),
    to = stops.get(workload.to);
  assert(from && to, "Missing workload stop");
  return {
    from: withHeight(nativeToWorld(artifacts.get(from.map)!.manifest, from.point), from.height ?? null),
    to: withHeight(nativeToWorld(artifacts.get(to.map)!.manifest, to.point), to.height ?? null),
  };
}
