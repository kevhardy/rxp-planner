// Prints a floor hint for each distinct point of the built-in guide steps that
// have a `.goto` in the selected zones. The points are each `.goto` point, and
// the NPC point of each `.accept` and `.turnin` quest. Each point prints once,
// with the first step that uses it and the number of steps that use it.
//
//   pnpm --silent guides:floor-hints --zone "Stormwind City" --zone Ironforge
//
//   --zone NAME       a zone to read. Repeat it for more zones.
//   --map ID          the routing artifact that holds the zones, such as 1 for
//                     Kalimdor. The script skips a point on another map.
//   --guide NAME      keep only the named guide. Repeat it for more guides.
//   --faction NAME    `Alliance` or `Horde`, for the quest points
//   --builtins FILE   the built-in guide file
//   --json OUT        write all the hints to OUT

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { previewDoc } from "../../src/rules/index.ts";
import type { WorldLocation } from "../../src/data/index.ts";
import { guideMeta } from "../../src/rules/registration.ts";
import { TILE_PIXELS } from "../../src/routing/artifact.ts";
import { floorHint, floorHintText, type FloorHint } from "../../src/routing/floorHint.ts";
import { worldToNative, type Point } from "../../src/routing/frame.ts";
import { classifyStop } from "../../src/routing/indoor.ts";
import { createTerrain } from "../../src/routing/terrain.ts";
import type { Faction } from "../../src/rules/index.ts";
import { BUILTIN_FILE, loadGuides } from "./load-guides.ts";
import { installedDataset } from "../dataset/local.ts";
import { installedArtifact } from "../routing/installed.ts";

const { values } = parseArgs({
  options: {
    builtins: { type: "string", default: BUILTIN_FILE },
    guide: { type: "string", multiple: true, default: [] },
    zone: { type: "string", multiple: true, default: ["Stormwind City", "Ironforge"] },
    faction: { type: "string", default: "Alliance" },
    map: { type: "string", default: "0" },
    json: { type: "string" },
  },
});
if (values.faction !== "Alliance" && values.faction !== "Horde") throw new Error(`Unknown faction ${values.faction}`);
const faction: Faction = values.faction;
const zones = new Set(values.zone.map((z) => z.toLowerCase()));

const { game } = await installedDataset();
const { records } = await loadGuides(new Uint8Array(await readFile(values.builtins)));
const artifact = await installedArtifact(Number(values.map));
const terrain = createTerrain(artifact);

interface Row {
  guide: string;
  step: number;
  source: string;
  label: string;
  world: WorldLocation;
  native: Point;
  stop: string;
  hint: FloorHint;
  text: string | undefined;
  steps: number;
}
const rows = new Map<string, Row>();

for (const record of records) {
  const name = guideMeta(record).name;
  if (values.guide.length && !values.guide.includes(name)) continue;
  const doc = previewDoc(record);
  for (const [s, step] of doc.steps.entries()) {
    const commands = step.body.flatMap((l) => (l.kind === "command" ? [l] : []));
    const gotos = commands.flatMap((c) => {
      const located = c.name === "goto" ? game.locateGoto(c.args) : undefined;
      return located?.ok && zones.has(game.mapName(located.uiMapId).toLowerCase()) ? [located.world] : [];
    });
    if (!gotos.length) continue;
    const said = commands.find((c) => c.text)?.text ?? step.body.find((l) => l.kind === "text")?.text ?? "";
    const target = commands.find((c) => c.name === "target")?.args.join(" ");
    const points: { source: string; label: string; world: WorldLocation }[] = [];
    for (const world of gotos) points.push({ source: "goto", label: target ?? said, world });
    // The dataset has points only for quest NPCs. Other NPCs, such as trainers and innkeepers, use the step's `.goto` point.
    for (const c of commands) {
      if (c.name !== "accept" && c.name !== "turnin") continue;
      const quest = game.quest(Number(c.args[0]), faction);
      for (const p of (c.name === "accept" ? quest?.startPoints : quest?.endPoints) ?? [])
        if (p.sourceType === "npc") points.push({ source: `${c.name} ${quest!.id}`, label: p.sourceName, world: p.world });
    }
    for (const { source, label, world } of points) {
      const at = worldToNative(artifact.manifest, world);
      if (!at) continue;
      const native: Point = [Math.round(at[0]), Math.round(at[1])];
      const key = `${source === "goto" ? "goto" : label}@${native.join()}`;
      const seen = rows.get(key);
      if (seen) {
        seen.steps++;
        continue;
      }
      const region = await terrain.region([native], TILE_PIXELS);
      const hint = floorHint(region, native);
      rows.set(key, {
        guide: name,
        step: s,
        source,
        label,
        world,
        native,
        stop: classifyStop(region, native).class,
        hint,
        text: floorHintText(hint),
        steps: 1,
      });
    }
  }
}

const counts = { single: 0, stacked: 0, known: 0 };
for (const r of rows.values()) {
  counts[r.hint.kind]++;
  const where = `${r.world.x.toFixed(1)}, ${r.world.y.toFixed(1)}`;
  console.log(`${r.guide} step ${r.step} [${r.source}] ${r.label} (${where}; ${r.stop}; ${r.steps} steps): ${r.text ?? "single floor"}`);
}
console.log(`\n${rows.size} points: ${counts.single} single, ${counts.stacked} stacked, ${counts.known} known`);
if (values.json)
  await writeFile(values.json, JSON.stringify({ zones: values.zone, faction, counts, points: [...rows.values()] }, null, 2) + "\n");
