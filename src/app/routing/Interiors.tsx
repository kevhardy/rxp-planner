import { useMemo } from "react";
import type { Interior } from "../../../packages/data-contract/interiors.ts";
import { interiorAt } from "../../data/heightMap.ts";
import type { Surface } from "../../data/surfaces.ts";
import type { LoadedInteriors } from "../../data/worldMap.ts";
import type { WorldStop } from "../../routing/plan.ts";
import { STOREY } from "../../routing/terrain.ts";
import { useAssets } from "../effects.ts";
import { interiorAssets } from "../map/mapAssets.ts";

export interface StopLevel {
  interior: Interior;
  surfaces: Surface[];
  onWorldMap: boolean;
  level: Surface | undefined;
}

export const stacked = (where: StopLevel | undefined) => (where?.level?.of ?? 0) > 1;

export const levelChip = (where: StopLevel) => {
  const { level } = where;
  return level && (stacked(where) ? `${level.place} · level ${level.rank + 1} of ${level.of}` : level.place);
};

export function levelOf(interiors: LoadedInteriors | undefined, stop: WorldStop): StopLevel | undefined {
  const interior = interiors && interiorAt(interiors.list, stop);
  const surfaces = interior && interiors.loadedSurfaces(interior);
  if (!surfaces) return undefined;
  const { height } = stop;
  return {
    interior,
    surfaces: surfaces.at(stop),
    onWorldMap: height === null,
    level: height === null ? undefined : surfaces.nearest(stop, height),
  };
}

export function insideOf(interiors: LoadedInteriors | undefined, stop: WorldStop): Interior | undefined {
  const where = levelOf(interiors, stop);
  if (!where?.surfaces.length) return undefined;
  return stop.height === null || (where.level && Math.abs(where.level.height - stop.height) < STOREY) ? where.interior : undefined;
}

export function useSurfaces(interiors: LoadedInteriors | undefined, stops: readonly WorldStop[], inView: Interior | undefined) {
  const needed = useMemo(() => {
    if (!interiors) return [];
    return [...new Set([...(inView ? [inView] : []), ...stops.flatMap((stop) => interiorAt(interiors.list, stop) ?? [])])];
  }, [interiors, stops, inView]);
  useAssets(interiorAssets(interiors).surfaces, needed);
}
