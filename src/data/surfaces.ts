import type { WorldPoint } from "../../packages/data-contract/geometry.ts";
import type { Interior } from "../../packages/data-contract/interiors.ts";
import { pixelSurfaces, surfacePixelAt, type InteriorSurfaces } from "../../packages/data-contract/interiorSurfaces.ts";
import type { HeightMap } from "./heightMap.ts";

export interface Surface {
  height: number;
  place: string;
  rank: number;
  of: number;
}

export interface SurfaceMap {
  readonly ground: HeightMap;
  at(at: WorldPoint): Surface[];
  nearest(at: WorldPoint, height: number): Surface | undefined;
  stackMask: () => Uint8Array;
}

export function fromSurfaces(interior: Interior, data: InteriorSurfaces): SurfaceMap {
  const { width, height, groundHeight, stacked, upperStart } = data;
  const ground: HeightMap = { width, height, values: groundHeight };
  const yards = (v: number) => interior.heightBase + (v - 1) / 8;
  const name = (p: number) => interior.places[p - 1] ?? interior.label;
  const at = (point: WorldPoint): Surface[] => {
    const i = surfacePixelAt(interior, data, point);
    return i < 0
      ? []
      : pixelSurfaces(data, i).map((s, rank, all) => ({ height: yards(s.height), place: name(s.place), rank, of: all.length }));
  };
  let mask: Uint8Array | undefined;
  return {
    ground,
    at,
    nearest: (point, to) =>
      at(point).reduce<Surface | undefined>(
        (best, s) => (best && Math.abs(best.height - to) <= Math.abs(s.height - to) ? best : s),
        undefined,
      ),
    stackMask: () => {
      if (mask) return mask;
      mask = new Uint8Array(width * height);
      for (let s = 0; s < stacked.length; s++) mask[stacked[s]!] = Math.min(upperStart[s + 1]! - upperStart[s]! + 1, 3);
      return mask;
    },
  };
}
