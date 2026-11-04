import { errorText } from "../../data/errorText.ts";
import { committedPlan, RouteEditor } from "../../routing/editor.ts";
import type { RoutePlan } from "../../routing/plan.ts";
import { deletePlan, loadPlans, savePlan } from "../../storage/routing.ts";
import { Demand, type Retains } from "../async.ts";
import { memo } from "../memo.ts";
import type { RoutingEngine } from "./engine.ts";
import {
  NO_SEARCH,
  routeSearch,
  searchView,
  type RouteSearch,
  type SearchEvent,
  type SearchKey,
  type SearchView,
  type Shown,
} from "./routeSearch.ts";
import type { RoutingStore } from "./routingStore.ts";
import type { RouteSettingsStore } from "./settings.ts";
import type { ClosedRoute } from "./useRouteFit.ts";

export interface RouteSessionState {
  loadNote: string | null;
  saveError: string | null;
  view: SearchView;
  cancel: (() => void) | undefined;
  retry: (() => void) | undefined;
}

export interface RouteSessionOptions {
  reopen: Pick<ClosedRoute, "plan"> | null;
  opened: (plan: RoutePlan | null) => void;
  problem: (text: string) => void;
}

export class RouteSession implements Retains<"open"> {
  readonly editor: RouteEditor;
  readonly #routing: RoutingStore;
  readonly #settings: RouteSettingsStore;
  readonly #options: RouteSessionOptions;
  readonly #demand = new Demand<"open">(
    () => this.#open(),
    () => this.#retained?.abort(),
  );
  #retained: AbortController | undefined;
  readonly #listeners = new Set<() => void>();
  #loadNote: string | null = null;
  #saved: RoutePlan | null = null;
  readonly #latestSaves = new Map<string, symbol>();
  readonly #failures = new Map<string, string>();
  #search: RouteSearch = NO_SEARCH;
  #shown: Shown;
  #onScreen: RoutePlan | null = null;
  #engine: RoutingEngine | null = null;
  #running: { shown: Shown; engine: RoutingEngine; abort: AbortController } | undefined;
  readonly #frames = memo((engine: RoutingEngine | null) => engine?.maps.map((m) => m.manifest) ?? []);
  readonly #view = memo(searchView);
  #state: RouteSessionState;

  constructor(routing: RoutingStore, settings: RouteSettingsStore, options: RouteSessionOptions) {
    this.#routing = routing;
    this.#settings = settings;
    this.#options = options;
    this.editor = new RouteEditor((error) => options.problem(errorText(error)));
    const { maxSlope, mode } = settings.getState();
    this.#shown = { plan: null, maxSlope, rides: routing.getState().rides, mode };
    this.#state = this.#next();
  }

  getState = (): RouteSessionState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  retain(key: "open"): () => void {
    return this.#demand.retain(key);
  }

  clear(): RoutePlan | undefined {
    const cleared = this.editor.clear();
    if (!cleared) return undefined;
    this.#forget(cleared.id);
    deletePlan(cleared.id).catch((error: unknown) => this.#options.problem(`The cleared route was not deleted: ${errorText(error)}`));
    return cleared;
  }

  delete(plan: RoutePlan, deleted: () => void): void {
    deletePlan(plan.id).then(
      () => {
        this.#forget(plan.id);
        deleted();
      },
      (error: unknown) => this.#options.problem(`The route was not deleted: ${errorText(error)}`),
    );
  }

  #open(): void {
    const { signal } = (this.#retained = new AbortController());
    for (const store of [this.editor, this.#settings, this.#routing]) {
      const unsubscribe = store.subscribe(() => this.#read());
      signal.addEventListener("abort", unsubscribe);
    }
    signal.addEventListener("abort", () => {
      this.#running?.abort.abort();
      this.#running = undefined;
    });
    loadPlans().then(
      (plans) => {
        if (!signal.aborted) this.#loaded(plans);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        this.#loadNote = `Saved routes did not load: ${errorText(error)}`;
        this.#publish();
        this.editor.load([]);
      },
    );
    this.#read();
  }

  #loaded(plans: RoutePlan[]): void {
    const { reopen, opened } = this.#options;
    this.editor.load(plans);
    const plan = reopen?.plan === null ? null : (plans.find((p) => p.id === reopen?.plan) ?? plans[0] ?? null);
    this.editor.open(plan);
    opened(plan);
  }

  #read(): void {
    const { history } = this.editor.get();
    const committed = committedPlan(history);
    this.#save(committed);
    const { maxSlope, mode } = this.#settings.getState();
    const { load, rides } = this.#routing.getState();
    const was = this.#shown;
    const moved = committed !== was.plan || maxSlope !== was.maxSlope || rides !== was.rides || mode !== was.mode;
    if (moved) this.#shown = { plan: committed, maxSlope, rides, mode };
    this.#onScreen = history?.plan ?? null;
    this.#engine = load?.ok ? load.engine : null;
    this.#syncSearch();
    if (moved) this.#dispatch({ type: "shown", shown: this.#shown });
  }

  #save(committed: RoutePlan | null): void {
    if (committed === this.#saved) return;
    this.#saved = committed;
    if (!committed) return;
    const save = Symbol();
    this.#latestSaves.set(committed.id, save);
    const latest = () => this.#latestSaves.get(committed.id) === save;
    savePlan(committed).then(
      () => latest() && this.#settle(committed.id, null),
      (error: unknown) => latest() && this.#settle(committed.id, `The route did not save: ${errorText(error)}`),
    );
  }

  #forget(id: string): void {
    this.editor.forget(id);
    this.#latestSaves.delete(id);
    this.#settle(id, null);
  }

  #settle(id: string, failure: string | null): void {
    this.#failures.delete(id);
    if (failure) this.#failures.set(id, failure);
    this.#publish();
  }

  #syncSearch(): void {
    const calculating = this.#searchView().kind === "calculating";
    const running = this.#running;
    if (running && (running.shown !== this.#shown || running.engine !== this.#engine || !calculating)) {
      running.abort.abort();
      this.#running = undefined;
    }
    const key = this.#key();
    if (!this.#running && key && this.#engine && calculating) this.#start(key, this.#engine);
    this.#publish();
  }

  #start(key: SearchKey, engine: RoutingEngine): void {
    const abort = new AbortController();
    const { signal } = abort;
    this.#running = { shown: this.#shown, engine, abort };
    this.#search = routeSearch(this.#search, { type: "started", search: key });
    const live = (event: SearchEvent) => {
      if (!signal.aborted) this.#dispatch(event);
    };
    engine
      .route(key.plan, key.maxSlope, signal, (updates) => live({ type: "legs", search: key, updates }), key.rides, key.mode)
      .then(
        (journeys) => live({ type: "finished", search: key, journeys }),
        (error: unknown) => {
          if (signal.aborted) return;
          console.error("Route search failed", error);
          this.#dispatch({ type: "failed", search: key, error: error instanceof Error ? error.message : String(error) });
        },
      );
  }

  #dispatch(event: SearchEvent): void {
    this.#search = routeSearch(this.#search, event);
    this.#syncSearch();
  }

  #key(): SearchKey | null {
    const { plan } = this.#shown;
    return plan && { ...this.#shown, plan };
  }

  readonly #cancel = () => {
    const key = this.#key();
    if (key) this.#dispatch({ type: "cancelled", search: key });
  };

  readonly #retry = () => {
    const key = this.#key();
    if (key) this.#dispatch({ type: "retried", search: key });
  };

  #searchView(): SearchView {
    return this.#view(this.#search, this.#onScreen, this.#shown, this.#frames(this.#engine));
  }

  #next(): RouteSessionState {
    const view = this.#searchView();
    return {
      loadNote: this.#loadNote,
      saveError: [...this.#failures.values()].at(-1) ?? null,
      view,
      cancel: this.#running ? this.#cancel : undefined,
      retry: (view.kind === "cancelled" || view.kind === "failed") && this.#key() && this.#engine ? this.#retry : undefined,
    };
  }

  #publish(): void {
    const next = this.#next();
    const was = this.#state;
    if (
      next.loadNote === was.loadNote &&
      next.saveError === was.saveError &&
      next.view === was.view &&
      next.cancel === was.cancel &&
      next.retry === was.retry
    )
      return;
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}
