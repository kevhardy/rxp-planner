import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual, parseArgs } from "node:util";
import type { GameData } from "../../src/data/gameData.ts";
import type { WorldLocation } from "../../src/data/index.ts";
import { TILE_PIXELS } from "../../src/routing/artifact.ts";
import { nativeStop, nativeToWorld, type Point } from "../../src/routing/frame.ts";
import { regionBuildings } from "../../src/routing/indoor.ts";
import { routeJourney } from "../../src/routing/journey.ts";
import { createPlan, DEFAULT_MAX_SLOPE, withHeight, type Leg } from "../../src/routing/plan.ts";
import { fallLines, floorLines, routeOf } from "../../src/routing/result.ts";
import { snapNode, type IndoorPath, type LegResult, type LegStop, type TerrainRoute } from "../../src/routing/search.ts";
import { nativeToCell, nodeRecord, type Terrain } from "../../src/routing/terrain.ts";
import { installedDataset } from "../dataset/local.ts";
import { openInstalled } from "./installed.ts";

/** World X (north) and Y (west) in yards. A third value (Z) is not used. */
type World = number[];

export type End = World | { npc: number };

export function endPoint(end: End, game: Pick<GameData, "npc" | "quests">): World {
  if (Array.isArray(end)) return end;
  const spawns = game.npc(end.npc)?.spawns ?? [];
  if (spawns.length !== 1) throw new Error(`NPC ${end.npc} has ${spawns.length} spawns, expected 1`);
  const spawn = spawns[0]!.world;
  const points = game.quests
    .flatMap((q) => [...q.startPoints, ...q.endPoints, ...q.objectivePoints])
    .filter((p) => p.sourceType === "npc" && p.sourceId === end.npc && p.world.instance === spawn.instance)
    .map((p) => p.world);
  const from = (p: WorldLocation) => Math.hypot(p.x - spawn.x, p.y - spawn.y);
  const best = points.length ? points.reduce((a, b) => (from(b) < from(a) ? b : a)) : spawn;
  return [best.y, best.x];
}

/**
 * One row of acceptance-sites.json. Every check that a site names must pass. A drop expects the height that the
 * artifact stores. A route expects the time and length that the site names. `compare` checks its length against the
 * truth within a tolerance, because the smoothed route cuts the corners of the grid walk.
 */
export interface Site {
  id: string;
  name: string;
  /** An NPC end names the NPC by ID, so the file copies no position from the dataset. `endPoint` resolves it. */
  from: End;
  to: End;
  /** The producer's truth: a walk with no drop and no swim, and its time at 7 yd/s. */
  truth: { length: number; time: number };
  /** Leg settings that differ from a new plan's. */
  leg?: Partial<Pick<Leg, "downhill" | "damagingFalls">>;
  /** Expected seconds, within `TOLERANCE`, or a range. */
  time?: number | [number, number];
  /** Expected yards, within `TOLERANCE`. */
  length?: number;
  /** Compare the length with the truth. With `shorter: "note"`, a shorter route is a note, not a failure. */
  compare?: { tolerance: number; shorter?: "note" };
  /** The kinds of the stored building paths, in route order. */
  paths?: IndoorPath["kind"][];
  startOnPath?: boolean;
  /** Where the route's first stored path leaves the ground route. */
  door?: World;
  turn?: { at: World; degrees: number; side: "left" | "right" };
  via?: World[];
  swim?: false;
  fallCount?: number;
  falls?: { height: number; at?: World }[];
  /** Text that the result lines (`floorLines`, `fallLines`) contain. */
  text?: string[];
  /** The route with fatal falls allowed is the same route. */
  fatalSame?: boolean;
  /** Informational: record the result, never fail. */
  info?: boolean;
  /** The owner's cause of a known failure. The row still fails, and the table gives the cause. */
  known?: string;
}

export interface Routed {
  result: LegResult;
  world: World[];
  fatal?: LegResult;
}

const TOLERANCE = 0.1;
/** Yards between a route and a point that it passes: half the diagonal of a 4.17 yd cell, rounded up. */
const NEAR = 3;
const DROP = 0.5;
const TURN = 15;

const length = (route: TerrainRoute) => route.distance + route.swimDistance;
const near = (a: World, b: World) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

function toLine(world: World[], p: World): number {
  let best = world.length ? near(world[0]!, p) : Infinity;
  for (let i = 1; i < world.length; i++) {
    const [ax, ay] = world[i - 1]!,
      [bx, by] = world[i]!;
    const dx = bx! - ax!,
      dy = by! - ay!;
    const t = dx || dy ? Math.max(0, Math.min(1, ((p[0]! - ax!) * dx + (p[1]! - ay!) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, near([ax! + t * dx, ay! + t * dy], p));
  }
  return best;
}

/** The turn at route point `i`, in degrees. World X is north and Y is west, so a right turn is clockwise from above. */
function turnAt(world: World[], i: number) {
  const [a, b, c] = [world[i - 1]!, world[i]!, world[i + 1]!];
  const [ex1, ny1] = [-(b[1]! - a[1]!), b[0]! - a[0]!];
  const [ex2, ny2] = [-(c[1]! - b[1]!), c[0]! - b[0]!];
  const degrees = (Math.atan2(ex1 * ny2 - ny1 * ex2, ex1 * ex2 + ny1 * ny2) * 180) / Math.PI;
  return { degrees: Math.abs(degrees), side: degrees < 0 ? "right" : "left" };
}

const yd = (n: number) => `${n.toFixed(1)} yd`;
const percent = (value: number, expected: number) =>
  `${value >= expected ? "+" : ""}${(((value - expected) / expected) * 100).toFixed(1)}%`;

export function expectedOf(site: Site): string {
  const parts: string[] = [];
  if (typeof site.time === "number") parts.push(`${site.time} s`);
  if (Array.isArray(site.time)) parts.push(`${site.time[0]}–${site.time[1]} s`);
  if (site.length !== undefined) parts.push(`${site.length} yd`);
  if (site.compare) parts.push(`truth ±${site.compare.tolerance * 100}%${site.compare.shorter ? " or shorter" : ""}`);
  if (site.paths) parts.push(`paths: ${site.paths.join(", ") || "none"}`);
  if (site.startOnPath) parts.push("starts on a path");
  if (site.door) parts.push(`door at [${site.door.join(", ")}]`);
  if (site.turn) parts.push(`turn ${site.turn.side} ${site.turn.degrees}°`);
  for (const p of site.via ?? []) parts.push(`via [${p.join(", ")}]`);
  if (site.swim === false) parts.push("no swim");
  if (site.fallCount !== undefined) parts.push(`${site.fallCount} drops`);
  for (const fall of site.falls ?? []) parts.push(`drop ${fall.height} yd`);
  for (const text of site.text ?? []) parts.push(`"${text}"`);
  if (site.fatalSame) parts.push("same with fatal falls");
  if (site.info) parts.push("informational");
  return parts.join("; ");
}

export function checkSite(site: Site, { result, world, fatal }: Routed): { fails: string[]; notes: string[] } {
  const fails: string[] = [],
    notes: string[] = [];
  const route = result.kind === "route" ? result : undefined;
  if (!route) {
    const provisional = routeOf(result);
    fails.push(`${result.kind}${provisional ? ` (provisional ${yd(length(provisional))})` : ""}`);
    return { fails, notes };
  }
  const yards = length(route);
  if (typeof site.time === "number" && Math.abs(route.seconds - site.time) > TOLERANCE * site.time)
    fails.push(`time ${route.seconds.toFixed(1)} s, expected ${site.time} s (${percent(route.seconds, site.time)})`);
  if (Array.isArray(site.time) && (route.seconds < site.time[0] || route.seconds > site.time[1]))
    fails.push(`time ${route.seconds.toFixed(1)} s, expected ${site.time[0]}–${site.time[1]} s`);
  if (site.length !== undefined && Math.abs(yards - site.length) > TOLERANCE * site.length)
    fails.push(`length ${yd(yards)}, expected ${site.length} yd (${percent(yards, site.length)})`);
  if (site.compare) {
    const { tolerance, shorter } = site.compare;
    const off = (yards - site.truth.length) / site.truth.length;
    const text = `length ${yd(yards)}, truth ${site.truth.length} yd (${percent(yards, site.truth.length)})`;
    if (off < -tolerance && shorter === "note")
      notes.push(`${text}: shorter with ${route.falls.length} drops, ${yd(route.swimDistance)} swim`);
    else if (Math.abs(off) > tolerance) fails.push(text);
  }

  const kinds = (route.paths ?? []).map((p) => p.kind);
  if (site.paths && kinds.join() !== site.paths.join())
    fails.push(`paths ${kinds.join(", ") || "none"}, expected ${site.paths.join(", ") || "none"}`);
  if (site.startOnPath && route.paths?.[0]?.start !== 0) fails.push("does not start on a stored path");
  if (site.door) {
    const at = route.paths?.[0] && world[route.paths[0].start];
    if (!at) fails.push("no door");
    else if (near(at, site.door) > NEAR) fails.push(`door ${yd(near(at, site.door))} from expected`);
  }
  if (site.turn) {
    const { at, degrees, side } = site.turn;
    const i = world.reduce((best, p, j) => (near(p, at) < near(world[best]!, at) ? j : best), 0);
    const turn = i > 0 && i < world.length - 1 ? turnAt(world, i) : undefined;
    if (!turn || near(world[i]!, at) > NEAR) fails.push(`no route point within ${NEAR} yd of the turn`);
    else if (turn.side !== side || Math.abs(turn.degrees - degrees) > TURN)
      fails.push(`turn ${turn.side} ${turn.degrees.toFixed(0)}°, expected ${side} ${degrees}°`);
  }
  for (const p of site.via ?? []) if (toLine(world, p) > NEAR) fails.push(`passes ${yd(toLine(world, p))} from [${p.join(", ")}]`);
  if (site.swim === false && route.swims.length) fails.push(`swims ${yd(route.swimDistance)}`);

  const drops = route.falls.map((f) => `${yd(f.height)} at [${world[f.point]!.map((n) => n.toFixed(1)).join(", ")}]`);
  if (site.fallCount !== undefined && route.falls.length !== site.fallCount)
    fails.push(`${route.falls.length} drops${drops.length ? ` (${drops.join("; ")})` : ""}, expected ${site.fallCount}`);
  for (const fall of site.falls ?? []) {
    const match = route.falls.find((f) => Math.abs(f.height - fall.height) <= DROP && (!fall.at || near(world[f.point]!, fall.at) <= NEAR));
    if (!match)
      fails.push(`no drop of ${fall.height} yd${fall.at ? ` at [${fall.at.join(", ")}]` : ""}; drops: ${drops.join("; ") || "none"}`);
  }
  const lines = [...floorLines(route).map((l) => l.text), ...fallLines(route).map((f) => `${f.height} ${f.damage}`)];
  for (const text of site.text ?? []) if (!lines.some((l) => l.includes(text))) fails.push(`no text "${text}"`);
  if (site.fatalSame) {
    const other = fatal && routeOf(fatal);
    const same = other && isDeepStrictEqual(other.points, route.points) && isDeepStrictEqual(other.falls, route.falls);
    if (fatal?.kind !== "route" || !same)
      fails.push(`fatal falls on gives another route (${fatal?.kind ?? "none"}${other ? `, ${other.seconds.toFixed(1)} s` : ""})`);
  }
  if (drops.length && site.fallCount === undefined && !site.falls) notes.push(`drops: ${drops.join("; ")}`);
  if (route.swims.length && site.swim !== false) notes.push(`swims ${yd(route.swimDistance)}`);
  if (route.descents.length) notes.push(`${route.descents.length} steep descents, ${yd(route.descentDrop)} down`);
  notes.push(...lines.filter((l) => !site.text?.some((t) => l.includes(t))));
  return { fails, notes };
}

export function checkEnds(result: LegResult): string[] {
  if (result.kind === "no-path" && result.endpoint) return [`${result.endpoint} cannot be used`];
  if (result.kind === "no-terrain") return [`${result.endpoint} has no terrain`];
  const route = routeOf(result);
  const fails = (route?.stops ?? []).flatMap((stop, i) => (stop.floor === "door" ? [`${i ? "end" : "start"} moves to a door`] : []));
  if (route?.paths?.some((p) => p.kind === "pair")) fails.push("enters on a path between two targets");
  return fails;
}

async function endFacts(terrain: Terrain, point: Point, stop: LegStop | undefined, hazards: boolean) {
  const region = await terrain.region([point], TILE_PIXELS);
  let best = Infinity;
  for (const { home, record } of regionBuildings(region))
    for (const { point: at } of record.targets)
      best = Math.min(best, Math.hypot(at[0] / 16 + home[0] * TILE_PIXELS - point[0], at[1] / 16 + home[1] * TILE_PIXELS - point[1]));
  const floor =
    typeof stop?.floor === "object" ? `floor index ${stop.floor.index}${stop.floor.confirmed ? "" : ", not confirmed"}` : stop?.floor;
  const node = (stop?.class ?? "ground") === "ground" ? snapNode(region, point, DEFAULT_MAX_SLOPE, hazards) : -1;
  let snap = "";
  if (node >= 0 && region.floor) {
    const [x, y] = nativeToCell(region, point);
    const cells = region.width * region.height;
    const z =
      node < cells && !region.floor.head[node] ? region.elevation[node]! : region.floor.height[nodeRecord(region, region.floor, node)]!;
    snap = `, snap z ${z.toFixed(1)} on terrain ${region.elevation[y * region.width + x]!.toFixed(1)}`;
  }
  return `${stop?.class ?? "ground"}${floor ? ` (${floor})` : ""}${best < 10 ? `, target ${best.toFixed(1)} px` : ""}${snap}`;
}

async function routeSite(terrain: Terrain, site: Site, [from, to]: [World, World], leg: Partial<Leg> = {}) {
  const stop = ([x, y]: World) => withHeight({ instance: terrain.frame.scope.map, x: y!, y: x! }, null);
  const plan = createPlan(stop(from), stop(to), site.id);
  plan.legs[0] = { ...plan.legs[0]!, ...site.leg, ...leg };
  const journey = await routeJourney(terrain, plan, plan.settings.modes[0]!, { maxSlope: DEFAULT_MAX_SLOPE });
  return { plan, result: journey.legs[0]! };
}

const ROW = /^(10|\d+)/;
const cell = (text: string) => text.replaceAll("|", "\\|");

async function main() {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  const { artifact, terrain } = await openInstalled();
  const { manifest } = artifact;
  const { game } = await installedDataset();
  const { sites } = JSON.parse(await readFile(new URL("./acceptance-sites.json", import.meta.url), "utf8")) as { sites: Site[] };
  const world = (p: Point): World => {
    const w = nativeToWorld(manifest, p);
    return [w.y, w.x];
  };

  const rows: string[] = [],
    failed: string[] = [],
    ends: string[] = [];
  for (const site of sites) {
    const points: [World, World] = [endPoint(site.from, game), endPoint(site.to, game)];
    const started = performance.now();
    const { plan, result } = await routeSite(terrain, site, points);
    const seconds = (performance.now() - started) / 1000;
    const route = routeOf(result);
    const fatal = site.fatalSame ? (await routeSite(terrain, site, points, { fatalFalls: true })).result : undefined;
    const { fails, notes } = checkSite(site, { result, world: route?.points.map(world) ?? [], ...(fatal && { fatal }) });
    const row = ROW.exec(site.id)![1]!;
    if (Number(row) <= 8) {
      const facts = checkEnds(result);
      if (site.info) notes.push(...facts);
      else ends.push(...facts.map((fact) => `${site.id}: ${fact}`));
    }
    if (seconds > 2) notes.push(`search ${seconds.toFixed(1)} s`);
    const hazards = plan.legs[0]!.hazards;
    const [a, b] = plan.stops.map((stop) => nativeStop(manifest, stop).point);
    const stops = route
      ? `${await endFacts(terrain, a!, route.stops?.[0], hazards)} → ${await endFacts(terrain, b!, route.stops?.[1], hazards)}`
      : "";
    const status = site.info ? "info" : fails.length ? "FAIL" : "pass";
    if (status === "FAIL") failed.push(site.id);
    if (status === "FAIL" && site.known) fails.push(`known: ${site.known}`);
    const measured = route ? `${result.kind}, ${route.seconds.toFixed(1)} s, ${yd(length(route))}` : result.kind;
    rows.push(
      `| ${site.id} | ${cell(site.name)} | ${cell(expectedOf(site))} | ${measured} | ${site.truth.length} | ${cell(stops)} | ${status} | ${cell(site.info ? "" : fails.join("; "))} | ${cell([...(site.info ? fails : []), ...notes].join("; "))} |`,
    );
  }
  rows.push(
    `| 9 | Ends of rows 1–8 and the way into buildings | no refused end, no door end, no path between targets | | | | ${ends.length ? "FAIL" : "pass"} | ${cell(ends.join("; "))} | |`,
  );
  if (ends.length) failed.push("9");

  const table = [
    `Artifact \`${manifest.id}\`. Run at 7 yd/s, slope ${DEFAULT_MAX_SLOPE}°. Truth: the producer's walk with no drop and no swim.`,
    "",
    "| Row | Site | Expected | Measured | Truth (yd) | Ends | Status | Cause of failure | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  if (values.out) await writeFile(values.out, table);
  console.log(table);
  if (failed.length) {
    console.error(`Failing rows: ${[...new Set(failed)].join(", ")}`);
    process.exitCode = 1;
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
