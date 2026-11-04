import { fileURLToPath } from "node:url";
import type { TransportsFile } from "../../packages/data-contract/transports.ts";
import { worldToNative, type Point } from "../../src/routing/frame.ts";
import { DEFAULT_MAX_SLOPE, DEFAULT_MODES, DEFAULT_SWIM_SPEED } from "../../src/routing/plan.ts";
import { routeLeg } from "../../src/routing/search.ts";
import { openInstalled } from "./installed.ts";
import { installedMaps, installedTransports } from "../dataset/local.ts";

export async function checkStops(file: TransportsFile) {
  const rows: { id: string; map: number; point?: Point; land: string }[] = [];
  const maps = await installedMaps();
  const request = (enabled: boolean) => ({
    maxSlope: DEFAULT_MAX_SLOPE,
    swimming: { enabled, speed: DEFAULT_SWIM_SPEED },
    mode: DEFAULT_MODES[0]!,
  });
  for (const map of maps) {
    const { artifact, terrain } = await openInstalled(map);
    for (const node of file.nodes.filter((n) => n.world.instance === map && !n.air)) {
      const native = worldToNative(artifact.manifest, node.world)!;
      const point = native.map(Math.round) as Point;
      const leg = { followTerrain: true, downhill: false };
      const heights = node.height === undefined ? {} : { heights: { from: node.height, to: node.height } };
      const dry = await routeLeg(terrain, point, point, leg, { ...request(false), ...heights });
      const land =
        dry.kind === "route"
          ? "walkable"
          : dry.kind === "no-path" && (await routeLeg(terrain, point, point, leg, { ...request(true), ...heights })).kind === "route"
            ? "water"
            : dry.kind === "no-terrain"
              ? "no terrain"
              : "blocked or too steep";
      rows.push({ id: node.id, map, point, land });
    }
  }
  for (const { id, world, air } of file.nodes)
    if (!maps.includes(world.instance) && !air) rows.push({ id, map: world.instance, land: "no routing artifact" });
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const rows = await checkStops(await installedTransports());
    for (const row of rows) console.log([row.id, `map ${row.map}`, row.point?.join(",") ?? "", row.land].join("\t"));
    const bad = rows.filter((row) => row.land !== "walkable").length;
    if (bad) throw new Error(`${bad} of ${rows.length} stops are not walkable`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
