/**
 * Real routeTrip workloads, using the installed release and seeded stop keys.
 * Run each case in a fresh process, with an external wall-clock limit:
 *   timeout 180s node scripts/bench/routing.ts --case boat --runs 5 --cache cold
 * Cases: boat, elevator, flight, long-flight. Cache: cold creates terrain per request;
 * warm retains terrain but does not supply exact ground results through `known`.
 * --mode selects a DEFAULT_MODES name, with Epic mount as the default.
 * --runs 0 checks correctness only. --trace emits progress outside measurement runs.
 * --diagnose counts coarse destination keys and allocations, separately with --runs 0.
 * --profile FILE records routing and validation CPU work, separately with --runs 0.
 * Allocations count returned bound arrays.
 * Region diagnostic durations can overlap; toward durations are synchronous.
 * Timing includes route completion, output validation, and hashing. Artifact loading is excluded.
 * Memory reports process RSS and heap, including loaded artifacts, not just the routing increment.
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
import { DATA_DIR, installedMaps, installedTransports } from "../dataset/local.ts";
import { installedArtifact } from "../routing/installed.ts";
import { transportsHash } from "../routing/stop-keys.ts";

const { values } = parseArgs({
  options: {
    case: { type: "string", default: "boat" },
    runs: { type: "string", default: "5" },
    cache: { type: "string", default: "cold" },
    mode: { type: "string", default: "Epic mount" },
    trace: { type: "boolean", default: false },
    diagnose: { type: "boolean", default: false },
    profile: { type: "string" },
  },
});
const cases = [
  { name: "boat", from: "FLIGHT_19", to: "FLIGHT_80", faction: "Horde", race: "Orc", ride: /^DOCK_BOOTYBAY>DOCK_RATCHET$/ },
  {
    name: "elevator",
    from: "elevator-great-lift-1:bottom",
    to: "elevator-great-lift-2:top",
    faction: "Horde",
    race: "Orc",
    ride: /^elevator-great-lift-.*:bottom>.*:top$/,
  },
  {
    name: "flight",
    from: "PORTAL_DARNASSUS_RUTTHERAN",
    to: "FLIGHT_26",
    faction: "Alliance",
    race: "Human",
    ride: /^FLIGHT_27:air>FLIGHT_26:air$/,
  },
  { name: "long-flight", from: "FLIGHT_26", to: "FLIGHT_31", faction: "Alliance", race: "Human", ride: /^FLIGHT_.*:air>FLIGHT_.*:air$/ },
] satisfies { name: string; from: string; to: string; faction: TransportAccess["faction"]; race: string; ride: RegExp }[];
const workload = cases.find((c) => c.name === values.case);
assert(workload, "Unknown case");
const runs = Number(values.runs);
assert(Number.isInteger(runs) && runs >= 0 && runs <= 100, "runs must be an integer from 0 to 100");
assert(values.cache === "cold" || values.cache === "warm", "cache must be cold or warm");
assert(!(values.trace || values.diagnose || values.profile) || runs === 0, "Use --runs 0 for a separate trace run");
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
const links = usableLinks(placed, {
  faction: workload.faction,
  race: workload.race,
  class: "WARRIOR",
  otherFaction: false,
});
const stops = new Map(
  placed.flatMap((l) => [
    [l.from.id, l.from],
    [l.to.id, l.to],
  ]),
);
const from = stops.get(workload.from),
  to = stops.get(workload.to);
assert(from && to, "Missing workload stop");
const plan = createPlan(
  withHeight(nativeToWorld(artifacts.get(from.map)!.manifest, from.point), from.height ?? null),
  withHeight(nativeToWorld(artifacts.get(to.map)!.manifest, to.point), to.height ?? null),
  "transport benchmark",
);
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
console.log(
  JSON.stringify({
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
    from,
    to,
  }),
);
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
    rides: { links },
    found: (_key, leg) => {
      found[leg.kind] = (found[leg.kind] ?? 0) + 1;
    },
    ...(values.trace && {
      onLegs: (updates) => console.log(JSON.stringify({ event: "progress", ms: performance.now() - start, updates })),
    }),
  });
  assert.equal(result.journeys.length, 1, "Expected one movement mode");
  const outputs = result.journeys.map((j) => ({
    mode: j.mode.name,
    seconds: j.seconds,
    legs: j.legs.map((leg) => {
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
      assert(Number.isFinite(j.seconds) && j.seconds! > 0, "Incomplete journey cost");
      const sum = leg.parts.reduce(
        (sum, part) => sum + (part.kind === "ride" ? part.link.seconds.average : groundSeconds(part.result)!),
        0,
      );
      assert(Math.abs(sum - leg.seconds) < 1e-9 && Math.abs(leg.seconds - j.seconds!) < 1e-9, "Incorrect journey total");
      return { kind: leg.kind, rides, ground };
    }),
  }));
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
  if (values.diagnose)
    console.log(
      JSON.stringify({ event: "diagnostic", routeMs, maps: diagnostic.map((r) => ({ ...r, destinations: [...r.destinations] })) }),
    );
  console.log(
    JSON.stringify({
      event: run === 0 ? "correctness" : "sample",
      run,
      ...(run > 0 && { routeMs }),
      cpu,
      memoryBefore,
      memoryAfter,
      maxRssKiB: process.resourceUsage().maxRSS,
      found,
      outputs,
      signature,
    }),
  );
}
