import { useSyncExternalStore } from "react";
import type { TransportsFile } from "../../../packages/data-contract/transports.ts";
import { errorText } from "../../data/errorText.ts";
import type { ClassName, PlayableRace } from "../../data/index.ts";
import { RACE_FACTION } from "../../data/races.ts";
import { placeTransports, tripRides, type Rides, type TransportLink } from "../../routing/transport.ts";
import { loadZoneBorders, type Border, type ZoneGrid } from "../../routing/zones.ts";
import { raceToken } from "../../rules/profile.ts";
import { AssetMap, Demand, type Retains } from "../async.ts";
import { useStores } from "../context.ts";
import type { DatasetStore } from "../datasetStore.ts";
import { useRetain } from "../effects.ts";
import { memo } from "../memo.ts";
import type { SettingsStore } from "../preview/settings.ts";
import { searchLane, type RoutingEngine, type RoutingLoad } from "./engine.ts";
import type { LayerPainter } from "./layerPainter.ts";

export type RoutingUse = "routes" | "playback" | "zones";

export interface RoutingState {
  load: RoutingLoad | null;
  lane: RoutingEngine | null;
  painter: LayerPainter | null;
  placed: readonly TransportLink[];
  rides: Rides;
}

const placeOn = (engine: RoutingEngine | null, transports: TransportsFile | undefined): readonly TransportLink[] =>
  engine && transports
    ? placeTransports(
        transports,
        engine.maps.map((m) => m.manifest),
      )
    : [];

export class RoutingStore implements Retains<RoutingUse> {
  readonly borders = new AssetMap((grid: ZoneGrid): Promise<Border[]> =>
    loadZoneBorders(grid).catch((error: unknown) => {
      console.warn("Zone borders did not load", error);
      throw error;
    }),
  );
  readonly #dataset: DatasetStore;
  readonly #preview: SettingsStore;
  readonly #loadRouting: () => Promise<RoutingLoad>;
  readonly #demand = new Demand<RoutingUse>(
    (use) => this.#first(use),
    (use) => this.#last(use),
  );
  #loading = false;
  #releaseOnArrival = false;
  readonly #placed = memo(placeOn);
  readonly #rides = memo((links: readonly TransportLink[], race: PlayableRace, cls: ClassName) =>
    tripRides(links, { faction: RACE_FACTION[race], class: cls, race: raceToken(race) }),
  );
  #state: RoutingState;
  readonly #listeners = new Set<() => void>();

  constructor(dataset: DatasetStore, preview: SettingsStore, loadRouting: () => Promise<RoutingLoad>) {
    this.#dataset = dataset;
    this.#preview = preview;
    this.#loadRouting = loadRouting;
    this.#state = this.#next(null, null);
    dataset.subscribe(() => this.#update(this.#state.load));
    preview.subscribe(() => this.#update(this.#state.load));
  }

  getState = (): RoutingState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  retain(use: RoutingUse): () => void {
    return this.#demand.retain(use);
  }

  #first(use: RoutingUse): void {
    if (use === "routes") this.#releaseOnArrival = false;
    if (this.#loading || this.#state.load?.ok) {
      this.#update(this.#state.load);
      return;
    }
    this.#loading = true;
    this.#update(null);
    this.#loadRouting().then(
      (load) => this.#arrive(load),
      (error: unknown) => this.#arrive({ ok: false, reason: errorText(error) }),
    );
  }

  #arrive(load: RoutingLoad): void {
    this.#loading = false;
    if (load.ok && this.#releaseOnArrival) load.engine.release();
    this.#releaseOnArrival = false;
    this.#update(load);
  }

  #last(use: RoutingUse): void {
    if (use === "routes") {
      const { load } = this.#state;
      if (load?.ok) load.engine.release();
      else this.#releaseOnArrival = this.#loading;
    }
    this.#update(this.#state.load);
  }

  #update(load: RoutingLoad | null): void {
    let { lane } = this.#state;
    if (lane && !this.#demand.has("playback")) {
      lane.release();
      lane = null;
    }
    if (!lane && load?.ok && this.#demand.has("playback")) lane = searchLane(load.engine);
    const next = this.#next(load, lane);
    const was = this.#state;
    if (
      next.load === was.load &&
      next.lane === was.lane &&
      next.painter === was.painter &&
      next.placed === was.placed &&
      next.rides === was.rides
    )
      return;
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }

  #next(load: RoutingLoad | null, lane: RoutingEngine | null): RoutingState {
    const engine = load?.ok ? load.engine : null;
    const placed = this.#placed(engine, this.#dataset.getState().data?.transports);
    const { race, class: cls } = this.#preview.getState();
    return {
      load,
      lane,
      painter: (!this.#demand.has("routes") && engine?.layers) || null,
      placed,
      rides: this.#rides(placed, race, cls),
    };
  }
}

export function useRouting(use: RoutingUse | null): RoutingState {
  const { routing } = useStores();
  useRetain(routing, use);
  return useSyncExternalStore(routing.subscribe, routing.getState);
}
