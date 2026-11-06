import type { InstanceId } from "../../data/index.ts";
import { noArtifact, type NativeFrame } from "../../routing/frame.ts";
import type { ArtifactManifest } from "../../routing/artifact.ts";
import { routeTrip, type JourneyOptions, type Journeys, type LegUpdate } from "../../routing/journey.ts";
import type { RoutePlan } from "../../routing/plan.ts";
import { PAGE_RECORDS, recentRecords, SEARCH_RECORDS } from "../../routing/reuse.ts";
import type { LegResult } from "../../routing/search.ts";
import type { Terrain } from "../../routing/terrain.ts";
import type { Rides } from "../../routing/transport.ts";
import { loadZoneGrid, type ZoneGrid } from "../../routing/zones.ts";
import { layerPainter, type LayerPainter } from "./layerPainter.ts";
import { openArtifacts, openTerrains } from "./pinned.ts";
import { errorText } from "../../data/errorText.ts";

export interface MapRouting {
  manifest: Pick<ArtifactManifest, "id" | "scope" | "frame" | "tiles">;
  zones?: ZoneGrid;
}

export interface RoutingEngine extends MapRouting {
  maps: readonly MapRouting[];
  route(
    plan: RoutePlan,
    maxSlope: number,
    signal?: AbortSignal,
    onLegs?: JourneyOptions["onLegs"],
    rides?: Rides,
    mode?: string,
  ): Promise<Journeys>;
  release(): void;
  layers?: LayerPainter;
}

export interface Search extends Pick<RoutingEngine, "release"> {
  route(...args: [...Parameters<RoutingEngine["route"]>, known?: ReadonlyMap<string, LegResult>]): Promise<Journeys>;
}

function routingEngine(maps: readonly MapRouting[], search: Search): RoutingEngine {
  const [first] = maps;
  if (!first) throw new RangeError("An engine needs at least one map");
  const loaded = new Set(maps.map((m) => m.manifest.scope.map));
  const route: Search["route"] = (plan, ...rest) => {
    const other = plan.stops.find((stop) => !loaded.has(stop.instance));
    return other === undefined ? search.route(plan, ...rest) : Promise.reject(noArtifact(other.instance));
  };
  return { ...first, maps, ...search, route };
}

export const searchLane = (engine: Pick<RoutingEngine, "maps">): RoutingEngine =>
  routingEngine(engine.maps, workerSearch(engine.maps.map((m) => m.manifest)));

export function searchRouting(terrains: ReadonlyMap<InstanceId, Terrain>): Search {
  const found = recentRecords(SEARCH_RECORDS);
  return {
    route: (plan, maxSlope, _signal, onLegs, rides, mode, known) =>
      routeTrip(
        plan,
        (map) => {
          const terrain = terrains.get(map);
          return terrain && { terrain, groundKey: `map ${map}` };
        },
        {
          maxSlope,
          ...(onLegs && { onLegs }),
          ...(rides && { rides }),
          ...(mode !== undefined && { modes: [mode] }),
          known: found.merged(known),
          found: found.keep,
        },
      ),
    release: () => {},
  };
}

interface SearchRequest {
  plan: RoutePlan;
  maxSlope: number;
  rides?: Rides;
  mode?: string;
  known: [string, LegResult][];
}
type SearchReply = { ok: true; value: Journeys } | { ok: false; error: string } | { progress: LegUpdate[] };

export interface SearchWorker {
  postMessage(request: SearchRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<SearchReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

const createWorker = (): SearchWorker => new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" });

export function workerSearch(frames: readonly NativeFrame[], create: () => SearchWorker = createWorker): Search {
  const routes = searcher(create);
  const kept = recentRecords(PAGE_RECORDS);
  return {
    route: (plan, maxSlope, signal, onLegs, rides, mode) => {
      const known = kept.atStops(plan, frames, rides);
      return routes.request({ plan, maxSlope, ...(rides && { rides }), ...(mode !== undefined && { mode }), known }, signal, (updates) => {
        kept.keepUpdates(updates);
        onLegs?.(updates);
      });
    },
    release: () => routes.release(),
  };
}

function searcher(create: () => SearchWorker) {
  let worker: SearchWorker | undefined;
  let stop: (() => void) | undefined;
  const end = (w: SearchWorker) => {
    w.terminate();
    if (worker === w) worker = undefined;
  };
  return {
    request(request: SearchRequest, signal?: AbortSignal, onProgress?: (updates: LegUpdate[]) => void): Promise<Journeys> {
      stop?.();
      return new Promise<Journeys>((resolve, reject) => {
        const canceled = () => new DOMException("The search was canceled.", "AbortError");
        if (signal?.aborted) {
          reject(canceled());
          return;
        }
        // In the executor, so that a worker that cannot start rejects the promise.
        const w = (worker ??= create());
        const settle = () => {
          stop = undefined;
          w.onmessage = w.onerror = null;
          signal?.removeEventListener("abort", onAbort);
        };
        const onAbort = () => {
          settle();
          end(w);
          reject(canceled());
        };
        stop = onAbort;
        signal?.addEventListener("abort", onAbort);
        w.onmessage = ({ data }) => {
          if ("progress" in data) {
            onProgress?.(data.progress);
            return;
          }
          settle();
          if (data.ok) resolve(data.value);
          else reject(new Error(data.error));
        };
        w.onerror = (event) => {
          settle();
          end(w);
          reject(new Error(event.message || "The search worker failed."));
        };
        w.postMessage(request);
      });
    },
    release() {
      stop?.();
      if (worker) end(worker);
    },
  };
}

export interface SearchPort {
  onmessage: ((event: MessageEvent<SearchRequest>) => void) | null;
  postMessage(reply: SearchReply): void;
}

export function serveSearch(port: SearchPort, open: () => Promise<Search>): void {
  let opening: Promise<Search> | undefined;
  port.onmessage = ({ data }) => {
    opening ??= open().catch((error: unknown) => {
      opening = undefined;
      throw error;
    });
    opening
      .then((search) =>
        search.route(
          data.plan,
          data.maxSlope,
          undefined,
          (progress) => port.postMessage({ progress }),
          data.rides,
          data.mode,
          new Map(data.known),
        ),
      )
      .then(
        (value) => port.postMessage({ ok: true, value }),
        (error: unknown) => port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
  };
}

export async function openSearch(): Promise<Search> {
  return searchRouting(await openTerrains());
}

interface MissingMap {
  map: InstanceId;
  reason: string;
}

export type RoutingLoad = { ok: true; engine: RoutingEngine; missing: MissingMap[] } | { ok: false; reason: string };

let loading: Promise<RoutingLoad> | undefined;

export function loadRouting(): Promise<RoutingLoad> {
  loading ??= (async (): Promise<RoutingLoad> => {
    const maps: MapRouting[] = [];
    const missing: MissingMap[] = [];
    for (const { pin, load } of await openArtifacts()) {
      if (!load.ok) {
        missing.push({ map: pin.map, reason: load.reason });
        continue;
      }
      const { artifact } = load;
      const zones = await loadZoneGrid(artifact).catch((error: unknown) => console.warn(`Map ${pin.map} zone grid`, error));
      maps.push({ manifest: artifact.manifest, ...(zones && { zones }) });
    }
    if (!maps.length) {
      const reason = missing.length === 1 ? missing[0]!.reason : missing.map((m) => `Map ${m.map}: ${m.reason}`).join(" ");
      return { ok: false, reason };
    }
    const layers = layerPainter();
    const engine = routingEngine(maps, workerSearch(maps.map((m) => m.manifest)));
    const release = () => {
      engine.release();
      layers.release();
    };
    return { ok: true, engine: { ...engine, layers, release }, missing };
  })()
    .catch((error: unknown) => ({ ok: false as const, reason: errorText(error) }))
    .then((result) => {
      if (!result.ok) loading = undefined;
      return result;
    });
  return loading;
}
