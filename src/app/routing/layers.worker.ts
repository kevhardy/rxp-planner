import type { InstanceId } from "../../data/index.ts";
import { noArtifact } from "../../routing/frame.ts";
import type { Tile } from "../../routing/artifact.ts";
import { tripLegRequest } from "../../routing/journey.ts";
import { classColors, isSearchLayer, layerCells, layerTile, type SearchLayer, type TerrainLayer } from "../../routing/layers.ts";
import { floodLeg, routeLeg, type ExpandedCells } from "../../routing/search.ts";
import type { Terrain, TileCache } from "../../routing/terrain.ts";
import type { LayerReply, LayerSearch, LayerTile } from "./layerPainter.ts";
import { openTerrains } from "./pinned.ts";

let opening: Promise<ReadonlyMap<InstanceId, Terrain>> | undefined;
const cache: TileCache = { keep: 192, tiles: new Map() };

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const KEPT_SEARCHES = 2;
const searches = new Map<string, Promise<ExpandedCells>>();

function searched(layer: SearchLayer, search: LayerSearch, maxSlope: number): Promise<ExpandedCells> {
  const key = `${layer}/${maxSlope}/${search.id}`;
  let cells = searches.get(key);
  if (!cells) {
    cells = searchCells(layer, search, maxSlope);
    searches.set(key, cells);
    cells.catch(() => searches.delete(key));
    for (const old of searches.keys()) {
      if (searches.size <= KEPT_SEARCHES) break;
      searches.delete(old);
    }
  }
  return cells;
}

async function searchCells(
  layer: SearchLayer,
  { plan, mode: name, leg, stop, walks }: LayerSearch,
  maxSlope: number,
): Promise<ExpandedCells> {
  const terrains = await openTerrains();
  const ground = (map: number) => {
    const terrain = terrains.get(map);
    if (!terrain) throw noArtifact(map);
    return terrain;
  };
  const mode = plan.settings.modes.find((m) => m.name === name);
  if (!mode) throw new Error(`The plan has no mode ${name}.`);
  const trip = await tripLegRequest(plan, ground, mode, { maxSlope }, leg, walks);
  if (!trip) return new Map();
  const { terrain, request, from, to } = trip;
  if (layer === "reachable") return floodLeg(terrain, stop === leg ? from : to, plan.legs[leg]!, request);
  const cells: ExpandedCells = new Map();
  await routeLeg(terrain, from, to, plan.legs[leg]!, request, cells);
  return cells;
}

async function paint({ map, tile, layer, maxSlope, search }: LayerTile): Promise<string> {
  const classes = isSearchLayer(layer)
    ? search && (await searched(layer, search, maxSlope)).get(tile.join())
    : await terrainClasses(map, tile, layer, maxSlope);
  if (!classes?.some(Boolean)) return "";
  const size = layerCells(layer);
  const canvas = new OffscreenCanvas(size, size);
  canvas.getContext("2d")!.putImageData(new ImageData(classColors(classes, layer), size), 0, 0);
  return dataUrl(await canvas.convertToBlob());
}

async function terrainClasses(map: InstanceId, tile: Tile, layer: TerrainLayer, maxSlope: number): Promise<Uint8Array> {
  opening ??= openTerrains(cache).catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  const terrain = (await opening).get(map);
  if (!terrain) throw noArtifact(map);
  return layerTile(terrain, tile, layer, maxSlope);
}

// The DOM types give `self` as a window; here it is the worker scope.
const port = self as {
  onmessage: (event: MessageEvent<LayerTile & { key: string }>) => void;
  postMessage(reply: LayerReply): void;
};
port.onmessage = ({ data }) => {
  paint(data).then(
    (url) => port.postMessage({ key: data.key, url }),
    (error: unknown) => port.postMessage({ key: data.key, url: "", error: error instanceof Error ? error.message : String(error) }),
  );
};
