import type { LoadedWorldMap, WorldMapArea, WorldMapCategory, WorldMapData, WorldMapPlace, WorldMapPoi } from "../../data/index.ts";
import type { Faction } from "../../rules/index.ts";
import type { Frame } from "./MapCanvas.tsx";
import { CATEGORIES, isCategoryId, type LayerId } from "./mapSettings.ts";
import type { ViewPoint } from "./points.ts";
import { canvasSize, canvasToView, viewToCanvas } from "./viewport.ts";

export function zoomLevel(map: WorldMapData, k: number): number {
  return map.nativeZoom + Math.log2(k);
}

export function tileZoom(map: WorldMapData, k: number): number {
  return Math.min(map.nativeZoom, Math.max(map.minZoom, Math.ceil(zoomLevel(map, k) - 0.01)));
}

export interface Tile {
  area: WorldMapArea["key"];
  zoom: number;
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function visibleTiles(map: WorldMapData, zoom: number, frame: Frame): Tile[] {
  const size = canvasSize(map);
  const px = map.tileSize * 2 ** (map.nativeZoom - zoom);
  const from = viewToCanvas(map, { x: frame.left, y: frame.top });
  const to = viewToCanvas(map, { x: frame.left + frame.width, y: frame.top + frame.height });
  const tiles: Tile[] = [];
  for (const area of map.areas) {
    const rows = area.tiles[zoom] ?? [];
    const rowFrom = Math.floor((from.y - area.canvasY) / px) - 1;
    const rowTo = Math.floor((to.y - area.canvasY) / px) + 1;
    const colFrom = Math.floor((from.x - area.canvasX) / px) - 1;
    const colTo = Math.floor((to.x - area.canvasX) / px) + 1;
    for (const [row, first, last] of rows) {
      if (row < rowFrom || row > rowTo) continue;
      for (let col = Math.max(first, colFrom); col <= Math.min(last, colTo); col++) {
        tiles.push({
          area: area.key,
          zoom,
          x: col,
          y: row,
          left: ((area.canvasX + col * px - size.left) / size.width) * 100,
          top: ((area.canvasY + row * px) / size.height) * 100,
          width: (px / size.width) * 100,
          height: (px / size.height) * 100,
        });
      }
    }
  }
  return tiles;
}

export function layerOf(category: WorldMapCategory): LayerId | undefined {
  return isCategoryId(category.key) ? CATEGORIES[category.key] : undefined;
}

export function iconOf(category: WorldMapCategory, icons: Readonly<Record<string, unknown>> | undefined): string | undefined {
  return icons && Object.hasOwn(icons, category.icon) ? category.icon : undefined;
}

export function showsSide(poi: WorldMapPoi, faction: Faction, allFactions: boolean): boolean {
  return allFactions || poi.entity?.type !== "npc" || poi.side === 0 || poi.side === (faction === "Alliance" ? 1 : 2);
}

export interface PlacedPoi {
  poi: WorldMapPoi;
  layer: LayerId;
  category: WorldMapCategory;
  icon: string | undefined;
  at: ViewPoint;
}

const GROUP_PX = 20;

export function groupMarkers<T extends { at: ViewPoint }>(map: WorldMapData, markers: readonly T[], k: number): T[][] {
  return groupOnScreen(markers, (at) => {
    const on = viewToCanvas(map, at);
    return { x: on.x * k, y: on.y * k };
  });
}

export function groupOnScreen<T extends { at: ViewPoint }>(
  markers: readonly T[],
  screen: (at: ViewPoint) => { x: number; y: number },
): T[][] {
  const rows: { x: number; y: number; markers: T[] }[] = [];
  const cells = new Map<string, number[]>();
  for (const m of markers) {
    const { x, y } = screen(m.at);
    const [cx, cy] = [Math.floor(x / GROUP_PX), Math.floor(y / GROUP_PX)];
    let found: number | undefined;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if ((found === undefined || i < found) && Math.hypot(rows[i]!.x - x, rows[i]!.y - y) < GROUP_PX) found = i;
        }
      }
    }
    if (found !== undefined) rows[found]!.markers.push(m);
    else {
      const key = `${cx},${cy}`;
      cells.set(key, [...(cells.get(key) ?? []), rows.length]);
      rows.push({ x, y, markers: [m] });
    }
  }
  return rows.map((r) => r.markers);
}

export interface PlacedPlace {
  place: WorldMapPlace;
  at: ViewPoint;
}

export interface TerrainFeatures {
  pois: PlacedPoi[];
  places: PlacedPlace[];
  /** `points` is an SVG polyline's points, and `ends` an SVG path of a dot at each end. */
  routes: { path: number; vessel: string; points: string; ends: string }[];
}

export function placeFeatures(map: WorldMapData & Pick<LoadedWorldMap, "icons">): TerrainFeatures {
  const categories = new Map(map.categories.map((c) => [c.key, c]));
  return {
    pois: map.pois.flatMap((poi) => {
      const category = categories.get(poi.category);
      const layer = category && layerOf(category);
      return category && layer ? [{ poi, layer, category, icon: iconOf(category, map.icons), at: canvasToView(map, poi) }] : [];
    }),
    places: map.places.map((place) => ({ place, at: canvasToView(map, place) })),
    routes: map.routes.map((route) => {
      const points = route.points.map(([x, y]) => canvasToView(map, { x, y }));
      const ends = [points[0]!, points.at(-1)!];
      return {
        path: route.path,
        vessel: route.vessel,
        points: points.map((p) => `${p.x},${p.y}`).join(" "),
        ends: ends.map((p) => `M${p.x} ${p.y}h0`).join(""),
      };
    }),
  };
}
