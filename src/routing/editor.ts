import type { WorldLocation } from "../../packages/data-contract/geometry.ts";
import type { Interior } from "../../packages/data-contract/interiors.ts";
import { interiorAt } from "../data/heightMap.ts";
import type { LoadedInteriors } from "../data/worldMap.ts";
import {
  cancelDrag,
  clear,
  dragStop,
  endDrag,
  record,
  startHistory,
  undo,
  withHeight,
  type PlanHistory,
  type RoutePlan,
  type WorldStop,
} from "./plan.ts";

export interface Floors {
  interiors: LoadedInteriors | undefined;
  inside: boolean;
}

export interface RouteEdits {
  history: PlanHistory | null;
  pending: WorldStop | null;
  loading: Interior | null;
  /** The loaded plans and each committed plan, in ID order, or null until `load`. */
  plans: RoutePlan[] | null;
}

/** The plan to search and save: null while there is no plan or while a stop is dragged. */
export const committedPlan = (history: PlanHistory | null): RoutePlan | null => (history && !history.dragging ? history.plan : null);

const withPlan = (plans: RoutePlan[], plan: RoutePlan): RoutePlan[] =>
  plans.some((p) => p.id === plan.id)
    ? plans.map((p) => (p.id === plan.id ? plan : p))
    : [...plans, plan].toSorted((a, b) => (a.id < b.id ? -1 : 1));

type HeightRead = { kind: "ready"; height: number | null } | { kind: "load"; interior: Interior };

const ready = (height: number | null = null): HeightRead => ({ kind: "ready", height });

function newStopHeight({ interiors, inside }: Floors, at: WorldLocation, before: WorldStop | undefined): HeightRead {
  const interior = interiors && interiorAt(interiors.list, at);
  if (!interior || !inside) return ready();
  const surfaces = interiors.loadedSurfaces(interior);
  if (!surfaces) return { kind: "load", interior };
  const beforeHeight = before && before.height !== null && interiorAt(interiors.list, before) === interior ? before.height : null;
  const ground = () => surfaces.at(at)[0];
  return ready((beforeHeight === null ? ground() : surfaces.nearest(at, beforeHeight))?.height ?? null);
}

function movedStopHeight(floors: Floors, from: WorldStop, to: WorldLocation, before: WorldStop | undefined): HeightRead {
  const { interiors } = floors;
  const interior = interiors && interiorAt(interiors.list, to);
  const staysInside = !!interior && interiorAt(interiors.list, from) === interior;
  if (!staysInside) return newStopHeight(floors, to, before);
  if (from.height === null) return ready();
  const surfaces = interiors.loadedSurfaces(interior);
  return surfaces ? ready(surfaces.nearest(to, from.height)?.height ?? null) : { kind: "load", interior };
}

/**
 * A stop placement whose interior's surfaces are not in memory loads them
 * first. Until they load, every edit is refused, so no edit can come between
 * the placement and its plan. Each new committed plan replaces the plan with
 * its ID in `plans`, or joins them.
 */
export class RouteEditor {
  #state: RouteEdits = { history: null, pending: null, loading: null, plans: null };
  readonly #listeners = new Set<() => void>();
  readonly #loadFailed: (error: unknown) => void;

  constructor(loadFailed: (error: unknown) => void) {
    this.#loadFailed = loadFailed;
  }

  get = (): RouteEdits => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  get busy(): boolean {
    return this.#state.loading !== null;
  }

  #set(change: Partial<RouteEdits>): void {
    const before = committedPlan(this.#state.history);
    const state = { ...this.#state, ...change };
    const committed = committedPlan(state.history);
    if (committed && committed !== before && state.plans) state.plans = withPlan(state.plans, committed);
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }

  load(plans: RoutePlan[]): void {
    this.#set({ plans });
  }

  /** Takes a plan out of `plans`. The caller deletes it from storage. */
  forget(id: string): void {
    const { plans } = this.#state;
    if (plans) this.#set({ plans: plans.filter((p) => p.id !== id) });
  }

  open(plan: RoutePlan | null): boolean {
    if (this.busy) return false;
    this.#set({ history: plan && startHistory(plan), pending: null });
    return true;
  }

  setPending(pending: WorldStop | null): boolean {
    if (this.busy) return false;
    this.#set({ pending });
    return true;
  }

  edit(change: (plan: RoutePlan) => RoutePlan, label: string): boolean {
    const { history } = this.#state;
    if (this.busy || !history?.plan) return false;
    this.#set({ history: record(history, change(history.plan), label) });
    return true;
  }

  clear(): RoutePlan | undefined {
    const { history } = this.#state;
    if (this.busy || !history?.plan) return undefined;
    this.#set({ history: clear(history), pending: null });
    return history.plan;
  }

  undo(): boolean {
    if (this.busy) return false;
    this.#set({ history: this.#state.history && undo(this.#state.history), pending: null });
    return true;
  }

  drag(stop: number, to: WorldLocation, label: string): boolean {
    const { history } = this.#state;
    if (this.busy || !history?.plan) return false;
    this.#set({ history: dragStop(history, stop, withHeight(to, history.plan.stops[stop]?.height ?? null), label) });
    return true;
  }

  cancelDrag(): boolean {
    const { history } = this.#state;
    if (this.busy || !history?.plan) return false;
    this.#set({ history: cancelDrag(history) });
    return true;
  }

  place(floors: Floors, at: WorldLocation, before: WorldStop | undefined, placed: (at: WorldStop) => void): boolean {
    return this.#resolve(
      floors,
      () => newStopHeight(floors, at, before),
      (height) => placed(withHeight(at, height)),
    );
  }

  move(floors: Floors, stop: number, to: WorldLocation, label: string, moved: () => void): boolean {
    const { history } = this.#state;
    if (this.busy || !history?.plan) return false;
    const before = history.dragging ? history.past.at(-1)!.plan : history.plan;
    return this.#resolve(
      floors,
      () => movedStopHeight(floors, before.stops[stop]!, to, before.stops[stop - 1]),
      (height) => {
        const { history } = this.#state;
        if (!history?.plan) return;
        this.#set({ history: endDrag(dragStop(history, stop, withHeight(to, height), label)) });
        moved();
      },
      () => this.cancelDrag(),
    );
  }

  #resolve(floors: Floors, read: () => HeightRead, apply: (height: number | null) => void, restore?: () => void): boolean {
    if (this.busy) return false;
    const result = read();
    if (result.kind === "ready") {
      apply(result.height);
      return true;
    }
    this.#set({ loading: result.interior });
    floors.interiors!.surfaces(result.interior).then(
      () => {
        this.#set({ loading: null });
        this.#resolve(floors, read, apply, restore);
      },
      (error: unknown) => {
        this.#set({ loading: null });
        restore?.();
        this.#loadFailed(error);
      },
    );
    return true;
  }
}
