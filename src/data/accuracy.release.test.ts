import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { extractGuides, parseGuide, type CommandLine } from "../guide/index.ts";
import type { GameData, GotoError, GotoForm, GotoLocation } from "./gameData.ts";
import { canvasToWorld, RXP_ZONE_TOKENS, type WorldLocation } from "./maps.ts";
import type { WorldMapData } from "./worldMap.ts";

import { releaseData, releaseTerrain } from "./releaseInputs.ts";

let data: GameData;
let map: WorldMapData;
beforeAll(async () => {
  data = releaseData();
  map = releaseTerrain;
});

function readGuides(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .sort()
    .flatMap((file) => {
      if (file.endsWith(".lua")) return extractGuides(readFileSync(join(dir, file), "utf8")).map((g) => g.text);
      return file.endsWith(".txt") ? [readFileSync(join(dir, file), "utf8")] : [];
    });
}

function stepCommands(texts: string[]): CommandLine[][] {
  return texts.flatMap((text) => parseGuide(text).steps.map((step) => step.body.filter((line) => line.kind === "command")));
}

const isGoto = (line: CommandLine) => line.name === "goto" || line.name === "waypoint";

function measure(steps: CommandLine[][]): Record<GotoForm, number[]> {
  const distances: Record<GotoForm, number[]> = { name: [], "map-id": [], world: [] };
  for (const commands of steps) {
    const gotos = commands.filter((c) => c.name === "goto");
    if (gotos.length !== 1) continue;
    const placed = data.locateGoto(gotos[0]!.args);
    if (!placed.ok) continue;
    for (const command of commands) {
      if (command.name !== "accept" && command.name !== "turnin") continue;
      const quest = data.quest(Number(command.args[0]));
      const points = (command.name === "accept" ? quest?.startPoints : quest?.endPoints) ?? [];
      const near = points
        .filter((p) => p.uiMapId === placed.uiMapId)
        .map((p) => data.locateQuestPoint(p))
        .map((p) => Math.hypot(p.x - placed.x, p.y - placed.y));
      if (near.length > 0) distances[placed.form].push(Math.min(...near));
    }
  }
  return distances;
}

const distance = (a: WorldLocation, b: WorldLocation) => (a.instance === b.instance ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
  const round = (n: number) => Number(n.toFixed(4));
  return { count: sorted.length, median: round(at(0.5)), p90: round(at(0.9)) };
}

function report(label: string, steps: CommandLine[][]) {
  const results = Object.entries(measure(steps)).map(([form, values]) => ({ form, ...summary(values) }));
  console.log(`${label} .goto accuracy (map-percent distance to quest NPC):`);
  console.table(results);
  return Object.fromEntries(results.map((r) => [r.form, r]));
}

type Result = GotoLocation | GotoError;

function locateAll(steps: CommandLine[][]): Map<string, Result[]> {
  const byZone = new Map<string, Result[]>();
  for (const line of steps.flat().filter(isGoto)) {
    const key = line.args[0] ?? "";
    byZone.set(key, [...(byZone.get(key) ?? []), data.locateGoto(line.args)]);
  }
  return byZone;
}

function failures(byZone: Map<string, Result[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [zone, results] of byZone) {
    const reasons = new Set(results.flatMap((r) => (r.ok ? [] : [r.reason])));
    if (reasons.size > 0) out[zone] = [...reasons];
  }
  return out;
}

describe("bundled Forever guides", () => {
  const steps = stepCommands(readGuides(join(import.meta.dirname, "../../guides/rxp-forever")));
  const typos = () =>
    steps
      .flat()
      .filter(isGoto)
      .filter((line) => {
        const result = data.locateGoto(line.args);
        return !result.ok && result.reason === "bad-coordinates";
      });
  const withoutTypos = () => {
    const malformed = typos();
    return steps.map((commands) => commands.filter((line) => !malformed.includes(line)));
  };

  it("places world-coordinate .goto lines within 0.2 map-percent of quest NPCs", () => {
    const stats = report("Bundled guides", steps);
    expect(stats.world!.count).toBeGreaterThan(600);
    expect(stats.world!.median).toBeLessThan(0.2);
  });

  it("locates every .goto and .waypoint, Zephras Isle included, except upstream coordinate typos", () => {
    const malformed = typos();
    expect(malformed).toHaveLength(1);
    for (const line of malformed)
      expect(line.args.slice(1, 3).some((arg) => /^-?\d+\.\d+\.\d+$/.test(arg) || arg === "2277.93+")).toBe(true);
    expect(failures(locateAll(withoutTypos()))).toEqual({});
  });

  it("puts Zephras Isle .goto lines within the dataset's precision of the NPCs their steps name", () => {
    // The dataset gives NPC positions to 0.1 percent, 3.7 to 5.6 yards on Zephras Isle. Each step with one .goto there counts
    // once, at the nearest NPC it names. A .deathskip step's .goto is where to die, not where its Spirit Healer stands.
    const npcs = map.pois.filter((p) => p.area === "zephras-isle" && p.entity?.type === "npc");
    const distances: number[] = [];
    const outliers: string[] = [];
    for (const guide of readGuides(join(import.meta.dirname, "../../guides/rxp-forever")).map(parseGuide)) {
      const title = guide.header.flatMap((line) => (line.kind === "tag" && line.name === "name" ? [line.value] : []))[0];
      guide.steps.forEach((step, index) => {
        const commands = step.body.filter((line) => line.kind === "command");
        const gotos = commands.filter((c) => c.name === "goto");
        if (gotos.length !== 1 || commands.some((c) => c.name === "deathskip")) return;
        const location = data.locateGoto(gotos[0]!.args);
        if (!location.ok || location.uiMapId !== 2521) return;
        const text = commands.map((c) => c.raw).join("\n");
        const near = npcs
          .filter((n) => text.includes(n.name))
          .map((npc) => ({ npc: npc.name, yards: distance(canvasToWorld(map, npc)!, location.world) }));
        if (near.length === 0) return;
        const nearest = near.reduce((a, b) => (b.yards < a.yards ? b : a));
        distances.push(nearest.yards);
        if (nearest.yards > 10) outliers.push(`${title} step ${index + 1}: ${nearest.npc} ${Math.round(nearest.yards)} yd`);
      });
    }
    expect(distances).toHaveLength(276);
    expect(summary(distances).median).toBeLessThan(5);
    expect(outliers).toEqual([
      "1-9 Zephras Isle step 28: Destin Thriceforged 18 yd",
      "1-9 Zephras Isle step 63: Dalia the Collector 75 yd",
      "1-9 Zephras Isle step 132: Dorii Brightwhisper 848 yd",
      "1-9 Zephras Isle step 155: Dorii Brightwhisper 848 yd",
      "1-9 Zephras Isle step 206: Dorii Brightwhisper 848 yd",
      "1-9 Zephras Isle step 290: Sania Silverstream 419 yd",
      "9-13 Zephras Isle step 16: Alvarion Windfield 14 yd",
      "9-13 Zephras Isle step 36: Fillion Flamebreeze 166 yd",
      "9-13 Zephras Isle step 92: Aamelia Windfield 135 yd",
      "9-13 Zephras Isle step 272: Elegael Thornpaw 217 yd",
      "9-13 Zephras Isle step 337: Ayessa Dawnsinger 11 yd",
    ]);
  });
});

describe("RXP zone names", () => {
  it("locates every zone name and alias RXP accepts, and its map ID, on the map that the dataset gives it", () => {
    expect(RXP_ZONE_TOKENS).toHaveLength(54);
    expect(["Elwynn Forest", "Kalimdor", "StormwindNew", "EPLClassic"].map((token) => data.uiMapNamed(token))).toEqual([
      1429, 1414, 1453, 1423,
    ]);
    const located = RXP_ZONE_TOKENS.flatMap((token) =>
      [token, String(data.uiMapNamed(token))].map((zone) => {
        const result = data.locateGoto([zone, "50", "50"]);
        return [zone, result.ok ? result.uiMapId : result.reason];
      }),
    );
    expect(located).toEqual(
      RXP_ZONE_TOKENS.flatMap((token) => {
        const uiMapId = data.uiMapNamed(token);
        return [
          [token, uiMapId],
          [String(uiMapId), uiMapId],
        ];
      }),
    );
  });

  it("names no map for a dataset zone that RXP rejects", () => {
    expect(data.zoneByUiMapId(1460)?.name).toBe("Warsong Gulch");
    expect(data.locateGoto(["Warsong Gulch", "50", "50"])).toMatchObject({ ok: false, reason: "unknown-zone" });
  });
});
