import type { InstanceId } from "./shared.ts";

export const WORLD_MAP_AREAS = ["kalimdor", "eastern-kingdoms", "zephras-isle"] as const;
export type WorldMapAreaKey = (typeof WORLD_MAP_AREAS)[number];

/**
 * Coordinates are canvas pixels at `nativeZoom`, not guide zone percentages.
 * Each area's art starts at (`canvasX`, `canvasY`); 512 px cover one
 * 533.33333-yard terrain chunk, and art pixel (0, 0) is the corner of chunk
 * (`originCol`, `originRow`).
 */
export interface WorldMapArea {
  readonly key: WorldMapAreaKey;
  readonly map: InstanceId;
  readonly width: number;
  readonly height: number;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly originCol: number;
  readonly originRow: number;
  /** Art left of this x (within the area) is hidden; no tiles are stored there. */
  readonly cropLeft: number;
  /** Stored tiles per zoom, as `[row, firstCol, lastCol]` runs in the area's own tile grid. */
  readonly tiles: Readonly<Record<string, readonly (readonly [number, number, number])[]>>;
}

/** 0 = both factions, 1 = Alliance, 2 = Horde. */
export type WorldMapSide = 0 | 1 | 2;

export interface WorldMapPlace {
  readonly name: string;
  readonly kind: "zone" | "capital" | "landmark";
  readonly area: WorldMapAreaKey;
  readonly x: number;
  readonly y: number;
  /** The source's label zoom hints, on the viewer's zoom scale. */
  readonly minZoom: number;
  readonly roomZoom?: number;
  readonly side?: WorldMapSide;
  /** Level range text, such as "5–10". */
  readonly levels?: string;
  /** New in Forever compared with Classic. */
  readonly new?: true;
}

export interface WorldMapPoi {
  readonly name: string;
  /** Shorter display label, when the source gives one. */
  readonly label?: string;
  readonly category: string;
  readonly area: WorldMapAreaKey;
  readonly x: number;
  readonly y: number;
  readonly side: WorldMapSide;
  /** Detail level at which the source map shows the pin; larger values appear later. */
  readonly level: number;
  /** Source entity. Transport and instance entrances have none; never infer one from the name. */
  readonly entity?: { readonly type: "npc" | "item"; readonly id: number };
  readonly levels?: string;
  /** `WorldMapRoute.path` IDs this transport pin departs on. */
  readonly paths?: readonly number[];
  /** In built terrain, each remaining route of `paths`, in path then route order, with the trip's end the pin offers. */
  readonly links?: readonly WorldMapLink[];
  /** Transport pins at the same dock share a group. */
  readonly group?: string;
  readonly groupName?: string;
  readonly new?: true;
}

/**
 * A pin's route and the endpoint that the pin offers as the arrival. On a
 * two-way route, the arrival is the endpoint farther from the pin in
 * straight-line canvas pixels, or the first endpoint on a tie, and is absent
 * when that endpoint is the pin's own pixel. On a one-way route, the arrival
 * is the last point, and only a pin on the first point offers it. On both
 * kinds of route, the arrival is absent when an earlier link already offers
 * that endpoint. The link is for display only, so the pin need not stand at
 * either endpoint.
 */
export interface WorldMapLink {
  /** The route's `id`. */
  readonly route: string;
  readonly arrival?: readonly [number, number];
}

export interface WorldMapRoute {
  /** In built terrain, the segment's source identity (`routeId`). */
  readonly id?: string;
  /** Transport path ID; one path may have several segments. */
  readonly path: number;
  readonly vessel: "ship" | "zeppelin";
  readonly color: number;
  /** Canvas polyline; it can cross open sea between areas. */
  readonly points: readonly (readonly [number, number])[];
  /** Trips run only from `points[0]` to the last point; absent, both ways. */
  readonly oneWay?: true;
  readonly new?: true;
}

export interface WorldMapCategory {
  readonly key: string;
  readonly group: string;
  readonly name: string;
  readonly icon: string;
  readonly startsOff?: true;
  readonly labelMinZoom?: number;
  readonly labelLayer?: string;
}

export interface WorldMapData {
  readonly version: 1;
  readonly tileSize: number;
  readonly minZoom: number;
  readonly nativeZoom: number;
  readonly pxPerChunk: number;
  readonly yardsPerChunk: number;
  /** Visible canvas: x from `left` to `width`, y from 0 to `height`. */
  readonly canvas: { readonly left: number; readonly width: number; readonly height: number };
  readonly areas: readonly WorldMapArea[];
  readonly groups: readonly { readonly key: string; readonly name: string }[];
  readonly categories: readonly WorldMapCategory[];
  readonly places: readonly WorldMapPlace[];
  readonly pois: readonly WorldMapPoi[];
  readonly routes: readonly WorldMapRoute[];
}

/**
 * The fields that place a canvas pixel in the world and choose the tiles that
 * show it.
 */
export type TerrainGeometry = Pick<
  WorldMapData,
  "tileSize" | "minZoom" | "nativeZoom" | "pxPerChunk" | "yardsPerChunk" | "canvas" | "areas"
>;

/** Hashes that bind terrain to a snapshot; each is `sha256:<hex>`. */
export interface TerrainPins {
  /** Of `canonical(terrainGeometry(map))`. */
  geometry: string;
  /** Of the stored tiles' exact bytes, as `sha256sum` lines sorted by path. */
  tiles: string;
  /** Of `canonical(map.routes)`. */
  routes: string;
}

/**
 * What the data producer's build records about the terrain it built. `json` hashes
 * the terrain JSON bytes without their gzip layer, which a server may remove
 * in transit, so the hash holds however the file is delivered. `asset` names
 * the snapshot the terrain was built on: its snapshot directory ID, which
 * hashes all its files, and `data`, the SHA-256 of the source download that
 * its sources.json pins. `pins` are the terrain set's.
 * `routes` hashes the built routes as `TerrainPins.routes` does the
 * snapshot's; overrides can make them differ.
 */
export interface TerrainDescriptor {
  version: 3;
  json: string;
  asset: { id: string; data: string };
  pins: TerrainPins;
  routes: string;
}

export const terrainGeometry = ({
  tileSize,
  minZoom,
  nativeZoom,
  pxPerChunk,
  yardsPerChunk,
  canvas,
  areas,
}: TerrainGeometry): TerrainGeometry => ({ tileSize, minZoom, nativeZoom, pxPerChunk, yardsPerChunk, canvas, areas });

/** Tile path under the snapshot directory; as the snapshot does, it puts the row (y) before the column (x). */
export function worldMapTilePath(area: WorldMapAreaKey, zoom: number, x: number, y: number): string {
  return `tiles/${area}/${zoom}/${y}/${x}.webp`;
}

export function worldMapTiles(map: TerrainGeometry): string[] {
  return map.areas
    .flatMap((area) =>
      Object.entries(area.tiles).flatMap(([zoom, runs]) =>
        runs.flatMap(([row, first, last]) =>
          Array.from({ length: last - first + 1 }, (_, i) => worldMapTilePath(area.key, Number(zoom), first + i, row)),
        ),
      ),
    )
    .sort();
}
