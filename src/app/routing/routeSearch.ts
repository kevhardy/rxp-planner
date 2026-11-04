import { keptLegs, type Journey, type JourneyLeg, type Journeys, type LegUpdate } from "../../routing/journey.ts";
import type { NativeFrame } from "../../routing/frame.ts";
import type { RoutePlan } from "../../routing/plan.ts";
import { routeOf, summarizeLeg, type JourneySummary, type LegSummary } from "../../routing/result.ts";
import type { Rides } from "../../routing/transport.ts";

export interface SearchKey {
  plan: RoutePlan;
  maxSlope: number;
  rides: Rides;
  mode: string;
}

export type Shown = Omit<SearchKey, "plan"> & { plan: RoutePlan | null };

type Settings = Omit<SearchKey, "mode">;

type Routed = SearchKey & ({ kind: "routed"; journeys: Journeys } | { kind: "failed" } | { kind: "cancelled" });

interface Trying {
  mode: string;
  leg: number;
  ride: string;
}

export interface RouteSearch {
  found:
    | (Settings & {
        legs: ReadonlyMap<string, JourneyLeg[]>;
        searching: ReadonlyMap<string, ReadonlyMap<number, JourneyLeg["kind"]>>;
        trying?: Trying | undefined;
      })
    | null;
  results: readonly Routed[];
}

export type SearchEvent =
  | { type: "legs"; search: Settings; updates: readonly LegUpdate[] }
  | { type: "finished"; search: SearchKey; journeys: Journeys }
  | { type: "failed"; search: SearchKey; error: string }
  | { type: "cancelled"; search: SearchKey }
  | { type: "retried"; search: SearchKey }
  | { type: "started"; search: SearchKey }
  | { type: "shown"; shown: Shown };

export type SearchView =
  | { kind: "calculating"; journey: Journey | undefined; phase: string; searchingRides: ReadonlyMap<number, string> }
  | { kind: "cancelled"; journey: Journey | undefined }
  | { kind: "routed"; journey: Journey | undefined }
  | { kind: "failed" };

export type LegState =
  | { state: "pending"; phase: string }
  | { state: "failed"; reason: string }
  | { state: "routed"; result: JourneyLeg; summary: LegSummary; mode: string };

export const PHASES = {
  walk: "Finding walking paths…",
  rides: "Searching rides…",
  noWalk: "No walking path.",
  cancelled: "Search cancelled.",
  ship: "Trying boats…",
  zeppelin: "Trying zeppelins…",
  tram: "Trying the Deeprun Tram…",
  portal: "Trying portals…",
  transition: "Trying portals…",
  access: "Trying entrances…",
  "druid-flight": "Trying druid flights…",
  elevator: "Trying elevators…",
  flight: "Trying flights…",
} as const;

const ridePhase = (ride: string) => (Object.hasOwn(PHASES, ride) ? PHASES[ride as keyof typeof PHASES] : PHASES.rides);

export const SEARCH_FAILED = "The route search failed.";

export const NO_SEARCH: RouteSearch = { found: null, results: [] };

const RECENT_ROUTES = 16;
const NO_LEGS: ReadonlyMap<number, JourneyLeg["kind"]> = new Map();
const NO_RIDES: ReadonlyMap<number, string> = new Map();

const isSearchOf = (r: Routed, shown: Shown) =>
  r.plan === shown.plan && r.maxSlope === shown.maxSlope && r.rides === shown.rides && r.mode === shown.mode;

export function routeSearch(state: RouteSearch, event: SearchEvent): RouteSearch {
  switch (event.type) {
    case "legs": {
      const { plan, maxSlope, rides } = event.search;
      const { found } = state;
      const same = found?.plan === plan && found.maxSlope === maxSlope && found.rides === rides;
      const legs = new Map(same ? found.legs : []);
      const searching = new Map(same ? found.searching : []);
      let trying = same ? found.trying : undefined;
      for (const { mode, leg, result, searching: rideSearch, trying: ride } of event.updates) {
        if (ride) trying = { mode, leg, ride };
        else if (trying?.mode === mode && trying.leg === leg) trying = undefined;
        const waiting = new Map(searching.get(mode));
        if (rideSearch) waiting.set(leg, result.kind);
        else waiting.delete(leg);
        searching.set(mode, waiting);
        if (rideSearch && result.kind !== "straight" && !routeOf(result)) continue;
        const list = legs.get(mode)?.slice() ?? [];
        list[leg] = result;
        legs.set(mode, list);
      }
      return { ...state, found: { plan, maxSlope, rides, legs, searching, trying } };
    }
    case "finished":
      return keep(state, { ...event.search, kind: "routed", journeys: event.journeys });
    case "failed":
      return keep(
        state,
        event.error ? { ...event.search, kind: "failed" } : { ...event.search, kind: "routed", journeys: { journeys: [] } },
      );
    case "cancelled":
      return keep(state, { ...event.search, kind: "cancelled" });
    case "retried": {
      const results = state.results.filter((r) => r.kind === "routed" || !isSearchOf(r, event.search));
      return stop({ ...state, results }, (mode) => mode === event.search.mode);
    }
    case "started":
      return stop(state, (mode) => mode === event.search.mode);
    case "shown": {
      const { found } = state;
      const { shown } = event;
      const offScreen = (r: Routed) => r.kind !== "routed" && !isSearchOf(r, shown);
      const kept = state.results.some(offScreen) ? { ...state, results: state.results.filter((r) => !offScreen(r)) } : state;
      const same = found?.plan === shown.plan && found.maxSlope === shown.maxSlope && found.rides === shown.rides;
      return stop(kept, (mode) => !same || mode !== shown.mode);
    }
  }
}

function stop(state: RouteSearch, stopped: (mode: string) => boolean): RouteSearch {
  const { found } = state;
  if (!found || ![...found.searching].some(([mode, legs]) => legs.size && stopped(mode))) return state;
  const searching = new Map([...found.searching].filter(([mode]) => !stopped(mode)));
  return { ...state, found: { ...found, searching, trying: found.trying && stopped(found.trying.mode) ? undefined : found.trying } };
}

const keep = (state: RouteSearch, result: Routed): RouteSearch => ({
  ...state,
  results: [result, ...state.results].slice(0, RECENT_ROUTES),
});

export function searchView(state: RouteSearch, mapPlan: RoutePlan | null, shown: Shown, frames: readonly NativeFrame[]): SearchView {
  const routed = state.results.find((r) => isSearchOf(r, shown));
  if (routed?.kind === "failed") return { kind: "failed" };
  if (routed?.kind === "routed") return { kind: "routed", journey: routed.journeys.journeys.find((j) => j.mode.name === shown.mode) };
  const journey = mapPlan ? partialJourney(state, mapPlan, shown, frames) : undefined;
  if (routed) return { kind: "cancelled", journey };
  const last = state.found;
  const found = journey && last?.plan === mapPlan && last.maxSlope === shown.maxSlope && last.rides === shown.rides ? last : undefined;
  const searching = (journey && found?.searching.get(journey.mode.name)) ?? NO_LEGS;
  const trying = found?.trying?.mode === journey?.mode.name ? found?.trying : undefined;
  const legPhase = (i: number, ground: JourneyLeg["kind"]) => {
    const rides = trying?.leg === i ? ridePhase(trying.ride) : PHASES.rides;
    return ground === "no-path" || ground === "crossing" ? `${PHASES.noWalk} ${rides}` : rides;
  };
  const waiting = [...searching].filter(([i]) => !journey?.legs[i]);
  const searchingRides = waiting.length ? new Map(waiting.map(([i, ground]) => [i, legPhase(i, ground)])) : NO_RIDES;
  const walking = !mapPlan || mapPlan.legs.some((_, i) => !journey?.legs[i] && !searching.has(i));
  const phase = trying
    ? (searchingRides.get(trying.leg) ?? ridePhase(trying.ride))
    : walking || !searching.size
      ? PHASES.walk
      : (searchingRides.values().next().value ?? PHASES.rides);
  return { kind: "calculating", journey, phase, searchingRides };
}

function partialJourney(state: RouteSearch, plan: RoutePlan, shown: Shown, frames: readonly NativeFrame[]): Journey | undefined {
  const mode = plan.settings.modes.find((m) => m.name === shown.mode);
  if (!mode) return undefined;
  const { found, results } = state;
  const sources = [
    ...(found ? [{ ...found, legs: found.legs.get(mode.name) }] : []),
    ...results.map((r) => ({
      ...r,
      legs: r.kind === "routed" ? r.journeys.journeys.find((j) => j.mode.name === mode.name)?.legs : undefined,
    })),
  ];
  const legs: JourneyLeg[] = [];
  for (const source of sources)
    if (source.legs && source.maxSlope === shown.maxSlope && source.rides === shown.rides)
      for (const [i, leg] of keptLegs(source.plan, source.legs, plan, frames).entries()) if (leg) legs[i] ??= leg;
  return { mode, legs };
}

export function legStates(view: SearchView, plan: RoutePlan | null, summary: JourneySummary | undefined): LegState[] {
  return (plan?.legs ?? []).map((_, i): LegState => {
    if (view.kind === "calculating" || view.kind === "cancelled") {
      const partial = view.journey;
      const result = partial?.legs[i];
      if (result) return { state: "routed", result, summary: summarizeLeg(result), mode: partial.mode.name };
      return { state: "pending", phase: view.kind === "cancelled" ? PHASES.cancelled : (view.searchingRides.get(i) ?? PHASES.walk) };
    }
    if (view.kind === "failed") return { state: "failed", reason: SEARCH_FAILED };
    const result = view.journey?.legs[i];
    return result && summary
      ? { state: "routed", result, summary: summary.legs[i]!, mode: summary.mode }
      : { state: "failed", reason: "No movement modes to route." };
  });
}
