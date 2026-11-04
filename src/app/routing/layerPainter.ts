import type { InstanceId } from "../../data/index.ts";
import type { Tile } from "../../routing/artifact.ts";
import type { RideWalks } from "../../routing/journey.ts";
import type { RouterLayer } from "../../routing/layers.ts";
import type { RoutePlan } from "../../routing/plan.ts";

export interface LayerSearch {
  id: string;
  plan: RoutePlan;
  mode: string;
  leg: number;
  stop: number;
  walks: RideWalks[];
}

export interface LayerTile {
  map: InstanceId;
  tile: Tile;
  layer: RouterLayer;
  maxSlope: number;
  search?: LayerSearch;
}

export const layerKey = ({ map, tile, layer, maxSlope, search }: LayerTile): string =>
  `${map}/${tile[0]},${tile[1]}/${layer}${layer === "steep" || search ? `/${maxSlope}` : ""}${search ? `/${search.id}` : ""}`;

export interface LayerReply {
  key: string;
  url: string;
  error?: string;
}

export interface LayerWorker {
  postMessage(request: LayerTile & { key: string }): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<LayerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface LayerPainter {
  image(key: string): string | undefined;
  want(wanted: readonly LayerTile[]): void;
  subscribe(listener: () => void): () => void;
  version(): number;
  release(): void;
}

const KEPT_TILES = 768;

const createWorker = (): LayerWorker => new Worker(new URL("./layers.worker.ts", import.meta.url), { type: "module" });

export function layerPainter(create: () => LayerWorker = createWorker, kept = KEPT_TILES): LayerPainter {
  const images = new Map<string, string>();
  let wishes: (LayerTile & { key: string })[] = [];
  let worker: LayerWorker | undefined;
  let busy = false;
  let version = 0;
  const listeners = new Set<() => void>();
  const keep = (key: string, url: string) => {
    images.delete(key);
    images.set(key, url);
    for (const old of images.keys()) {
      if (images.size <= kept) break;
      images.delete(old);
    }
    version++;
    for (const listener of listeners) listener();
  };
  const next = () => {
    if (busy) return;
    const wish = wishes.shift();
    if (!wish) return;
    if (images.has(wish.key)) return next();
    busy = true;
    const w = (worker ??= create());
    const done = (url: string) => {
      busy = false;
      keep(wish.key, url);
      next();
    };
    w.onmessage = ({ data }) => {
      if (data.error) console.warn(`Router layer ${data.key}`, data.error);
      done(data.url);
    };
    w.onerror = (event) => {
      console.warn(`Router layer ${wish.key}`, event.message);
      w.terminate();
      worker = undefined;
      done("");
    };
    w.postMessage(wish);
  };
  return {
    image: (key) => images.get(key),
    want: (wanted) => {
      wishes = wanted.map(({ map, tile, layer, maxSlope, search }) => {
        const wish: LayerTile = { map, tile, layer, maxSlope, ...(search && { search }) };
        return { ...wish, key: layerKey(wish) };
      });
      for (const { key } of wishes) {
        const url = images.get(key);
        if (url === undefined) continue;
        images.delete(key);
        images.set(key, url);
      }
      next();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
    release: () => {
      worker?.terminate();
      worker = undefined;
      busy = false;
      wishes = [];
      images.clear();
    },
  };
}
