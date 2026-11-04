import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { worldToCanvas } from "../../data/index.ts";
import { releaseData, releaseTerrain } from "../../data/releaseInputs.ts";
import { extractGuides, parseGuide, type CommandLine } from "../../guide/index.ts";
import { locateOnTerrain, movedArgs } from "./points.ts";

describe("locateOnTerrain", () => {
  it("returns every bundled Forever coordinate to its map and percentages", async () => {
    const data = releaseData();
    const map = releaseTerrain;
    const dir = join(import.meta.dirname, "../../../guides/rxp-forever");
    const lines = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".lua"))
      .flatMap((f) => extractGuides(readFileSync(join(dir, f), "utf8")))
      .flatMap((g) => parseGuide(g.text).steps.flatMap((s) => s.body))
      .filter((l): l is CommandLine => l.kind === "command" && (l.name === "goto" || l.name === "waypoint"));
    const mismatches: string[] = [];
    let checked = 0;
    for (const line of lines) {
      const location = data.locateGoto(line.args);
      if (!location.ok || location.x < 0 || location.x > 100 || location.y < 0 || location.y > 100) continue;
      const at = worldToCanvas(map, location.world);
      const back = at && locateOnTerrain(data, map, at, location.uiMapId);
      const same = back?.uiMapId === location.uiMapId && Math.hypot(back.x - location.x, back.y - location.y) < 1e-6;
      if (!same) mismatches.push(`${line.args.join(",")} -> ${back && movedArgs(data, line, back).join(",")}`);
      checked++;
    }
    expect(checked).toBeGreaterThan(10000);
    expect(mismatches).toEqual([]);
  });
});
