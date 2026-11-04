// Zone and continent percentages match `/way` and map addons, which use
// HereBeDragons' `GetZoneCoordinatesFromWorld`.

import { worldToMap, type GameData, type WorldLocation } from "../data/index.ts";
import { frameOf, worldToNative } from "./frame.ts";
import { gridZone, type ZoneGrid } from "./zones.ts";

/** A map's name and percentages of it, 0 to 100 inside the map, x then y. */
export interface MapCoordinates {
  name: string;
  x: number;
  y: number;
}

/**
 * The zone and continent coordinates of a world position, or undefined
 * outside every zone map. The zone grid of the map picks the zone. Where the
 * grid gives no zone, RXP's continent `.goto` zone (`GameData.zoneAt`) is
 * used. A map off every continent, such as Zephras Isle, has only its grid zone.
 */
export function playerCoordinates(
  data: GameData,
  world: WorldLocation,
  grids: readonly ZoneGrid[] = [],
): { zone: MapCoordinates; continent?: MapCoordinates } | undefined {
  const grid = frameOf(grids, world.instance);
  const native = grid && worldToNative(grid, world);
  const id = native && gridZone(grid, native);
  const surface = id ? data.zoneByUiMapId(id) : undefined;
  const zone = surface?.bounds && (surface.continent || surface.bounds.instance === world.instance) ? surface : data.zoneAt(world);
  if (!zone?.bounds) return undefined;
  const { continent } = zone;
  return {
    zone: { name: zone.name, ...worldToMap(zone.bounds, world) },
    ...(continent && { continent: { name: continent.name, ...worldToMap(continent.bounds, world) } }),
  };
}
