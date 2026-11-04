import { memo, useMemo } from "react";
import type { WorldMapData } from "../../data/index.ts";
import type { Border, ZoneGrid } from "../../routing/zones.ts";
import { useStores } from "../context.ts";
import { useAssets } from "../effects.ts";
import { projection, round, type Projection } from "./lines.ts";
import { useRouting } from "./routingStore.ts";

function borderPath(grids: readonly ZoneGrid[], borders: readonly Border[][], proj: Projection): string {
  return grids
    .flatMap((grid, i) =>
      borders[i]!.map(([a, b]) => {
        const from = proj.toView(a, grid.scope.map);
        const to = proj.toView(b, grid.scope.map);
        return from && to ? `M${round(from.x)} ${round(from.y)}L${round(to.x)} ${round(to.y)}` : "";
      }),
    )
    .join("");
}

export const ZoneBorders = memo(function ZoneBorders(props: { grids: readonly ZoneGrid[]; proj: Projection }) {
  const { grids, proj } = props;
  const states = useAssets(useStores().routing.borders, grids);
  const d = useMemo(() => {
    const borders: Border[][] = [];
    for (const state of states) {
      if (!state || state.kind === "loading") return "";
      borders.push(state.kind === "ready" ? state.value : []);
    }
    return borderPath(grids, borders, proj);
  }, [states, grids, proj]);
  return (
    <svg className="zone-borders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path className="zone-border-halo" d={d} />
      <path className="zone-border-line" d={d} />
    </svg>
  );
});

export function useZoneGrids(map: WorldMapData | undefined, on: boolean): { grids: ZoneGrid[]; proj: Projection } | null {
  const { load } = useRouting(on ? "zones" : null);
  return useMemo(() => {
    if (!on || !load?.ok || !map) return null;
    const { maps } = load.engine;
    return {
      grids: maps.flatMap((m) => m.zones ?? []),
      proj: projection(
        map,
        maps.map((m) => m.manifest),
      ),
    };
  }, [on, load, map]);
}
