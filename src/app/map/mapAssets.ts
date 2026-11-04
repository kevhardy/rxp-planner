import type { Interior } from "../../../packages/data-contract/interiors.ts";
import type { LoadedInteriors, LoadedWorldMap } from "../../data/index.ts";
import type { SurfaceMap } from "../../data/surfaces.ts";
import { AssetMap } from "../async.ts";
import { outline, type InteriorOutline } from "./outline.ts";

const tiles = new WeakMap<LoadedWorldMap, AssetMap<string, string>>();

export function mapTiles(map: LoadedWorldMap): AssetMap<string, string> {
  let assets = tiles.get(map);
  if (!assets) {
    assets = new AssetMap((path) => (map.tile ? map.tile(path) : Promise.reject(new Error("Terrain tiles require a checked loader"))));
    tiles.set(map, assets);
  }
  return assets;
}

interface InteriorAssets {
  images: AssetMap<string, string>;
  outlines: AssetMap<Interior, InteriorOutline>;
  surfaces: AssetMap<Interior, SurfaceMap>;
}

const interiors = new WeakMap<LoadedInteriors, InteriorAssets>();

const missing = () => Promise.reject(new Error("The map has no interiors"));
const NO_INTERIORS: LoadedInteriors = { list: [], image: missing, surfaces: missing, loadedSurfaces: () => undefined };

const warned =
  <K, V>(message: string, load: (key: K) => Promise<V>) =>
  (key: K) =>
    load(key).catch((error: unknown) => {
      console.warn(message, error);
      throw error;
    });

export function interiorAssets(source: LoadedInteriors = NO_INTERIORS): InteriorAssets {
  let assets = interiors.get(source);
  if (!assets) {
    assets = {
      images: new AssetMap(warned("Interior image did not load", (path: string) => source.image(path))),
      outlines: new AssetMap(warned("Interior outline did not load", (interior: Interior) => outline(source, interior))),
      surfaces: new AssetMap(warned("Height map did not load", (interior: Interior) => source.surfaces(interior))),
    };
    interiors.set(source, assets);
  }
  return assets;
}
