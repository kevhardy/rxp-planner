import type { GameData } from "../../data/index.ts";
import { stepLocations } from "../../rules/points.ts";
import type { RouteView } from "../../rules/index.ts";

export function routeContinents(route: RouteView, data: GameData): (string | undefined)[] {
  return route.preview.guides.map((guide) => {
    for (const [i, step] of guide.doc.steps.entries()) {
      const preview = guide.steps[i];
      if (!preview?.shown) continue;
      const point = stepLocations(data, step).points.find((p) => preview.lines[p.line]);
      if (point) return (data.zoneByUiMapId(point.uiMapId) ?? data.zoneAt(point.world))?.continent?.name;
    }
    return undefined;
  });
}
