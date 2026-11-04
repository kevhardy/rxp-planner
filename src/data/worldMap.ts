import type { Interior } from "../../packages/data-contract/interiors.ts";
import type { DatasetIcon } from "../../packages/data-contract/manifest.ts";
import type { WorldMapData } from "../../packages/data-contract/worldMap.ts";
import type { SurfaceMap } from "./surfaces.ts";
export * from "../../packages/data-contract/worldMap.ts";

export interface LoadedWorldMap extends WorldMapData {
  readonly tileBase: string;
  readonly tile?: (path: string) => Promise<string>;
  readonly imageUrls?: ReadonlyMap<string, string>;
  readonly icons?: Record<string, DatasetIcon>;
  readonly interiors?: LoadedInteriors;
}

export interface LoadedInteriors {
  readonly list: readonly Interior[];
  image(path: string): Promise<string>;
  loadedSurfaces(interior: Interior): SurfaceMap | undefined;
  surfaces(interior: Interior): Promise<SurfaceMap>;
}
