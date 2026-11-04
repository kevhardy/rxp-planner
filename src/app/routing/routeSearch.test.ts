import { describe, expect, it } from "vitest";
import type { LegUpdate } from "../../routing/journey.ts";
import { at, TEST_FRAME } from "../../routing/fixtures/region.ts";
import { createPlan, insertWaypoint, type RoutePlan } from "../../routing/plan.ts";
import type { LegResult } from "../../routing/search.ts";
import type { Rides } from "../../routing/transport.ts";
import { summarizeJourney } from "../../routing/result.ts";
import { legStates, NO_SEARCH, routeSearch, searchView, type RouteSearch, type SearchEvent, type SearchView } from "./routeSearch.ts";

const RUN = { name: "Run", speed: 7, activation: 0 };
const EPIC = { name: "Epic mount", speed: 14, activation: 3 };
const rides: Rides = { links: [] };
const FRAMES = [TEST_FRAME];
const straight = (seconds: number): LegResult => ({
  kind: "straight",
  points: [
    [0, 0],
    [70, 0],
  ],
  distance: 70,
  activation: 0,
  seconds,
});
const walk = straight(10);
const gallop = straight(5);
const noPath: LegResult = { kind: "no-path" };
const ground: LegResult = {
  kind: "route",
  points: [
    [0, 0],
    [70, 0],
  ],
  descents: [],
  descentDrop: 0,
  falls: [],
  swims: [],
  swimDistance: 0,
  swimSeconds: 0,
  swimRemounts: [],
  distance: 70,
  terrainSeconds: 10,
  activation: 0,
  seconds: 10,
};

const twoLegs = (id: string) => insertWaypoint(createPlan(at([0, 0]), at([140, 0]), id), 0, at([70, 0]));
const run = (plan: RoutePlan, maxSlope = 45) => ({ plan, maxSlope, rides, mode: "Run" });
const legs = (plan: RoutePlan, updates: LegUpdate[]): SearchEvent => ({ type: "legs", search: run(plan), updates });
const replay = (events: SearchEvent[], from: RouteSearch = NO_SEARCH) => events.reduce(routeSearch, from);
const finished = (plan: RoutePlan, legs: LegResult[]): SearchEvent => ({
  type: "finished",
  search: run(plan),
  journeys: { journeys: [{ mode: RUN, legs }] },
});

describe("route search", () => {
  it("shows each leg once it is known, holds back a leg while its rides are searched, and then shows the finished journey", () => {
    const plan = twoLegs("a");
    const started = replay([
      legs(plan, [
        { mode: "Run", leg: 0, result: walk },
        { mode: "Run", leg: 1, result: noPath, searching: true },
      ]),
    ]);
    expect(searchView(started, plan, run(plan), FRAMES)).toEqual({
      kind: "calculating",
      journey: { mode: RUN, legs: [walk] },
      phase: "No walking path. Searching rides…",
      searchingRides: new Map([[1, "No walking path. Searching rides…"]]),
    });

    const ridesSearched = replay([legs(plan, [{ mode: "Run", leg: 1, result: noPath }])], started);
    expect(searchView(ridesSearched, plan, run(plan), FRAMES)).toEqual({
      kind: "calculating",
      journey: { mode: RUN, legs: [walk, noPath] },
      phase: "Finding walking paths…",
      searchingRides: new Map(),
    });

    const done = replay(
      [{ type: "finished", search: run(plan), journeys: { journeys: [{ mode: RUN, legs: [walk, noPath] }] } }],
      ridesSearched,
    );
    expect(searchView(done, plan, run(plan), FRAMES)).toEqual({ kind: "routed", journey: { mode: RUN, legs: [walk, noPath] } });
  });

  it("names the mode of ride that the search tries, for the leg and the chip, and says when a leg has no walking path", () => {
    const plan = twoLegs("a");
    const phases = (events: SearchEvent[], shown = run(plan)) => {
      const view = searchView(replay(events), plan, shown, FRAMES);
      return view.kind === "calculating" ? [view.phase, ...view.searchingRides] : view.kind;
    };
    const started = legs(plan, [
      { mode: "Run", leg: 0, result: ground, searching: true },
      { mode: "Run", leg: 1, result: noPath, searching: true },
    ]);
    const trying = (leg: number, result: LegResult, ride: string) =>
      legs(plan, [{ mode: "Run", leg, result, searching: true, trying: ride }]);
    expect(phases([legs(plan, [{ mode: "Run", leg: 0, result: ground, searching: true }])])).toEqual(["Finding walking paths…"]);
    expect(phases([started, trying(1, noPath, "toString")])).toEqual([
      "No walking path. Searching rides…",
      [1, "No walking path. Searching rides…"],
    ]);
    expect(phases([started])).toEqual(["No walking path. Searching rides…", [1, "No walking path. Searching rides…"]]);
    const walked = legs(plan, [{ mode: "Run", leg: 0, result: walk }]);
    const crossing = legs(plan, [{ mode: "Run", leg: 1, result: { kind: "crossing" }, searching: true }]);
    const crossingShips = legs(plan, [{ mode: "Run", leg: 1, result: { kind: "crossing" }, searching: true, trying: "ship" }]);
    expect(phases([walked, crossing])).toEqual(["No walking path. Searching rides…", [1, "No walking path. Searching rides…"]]);
    expect(phases([walked, crossing, crossingShips])).toEqual(["No walking path. Trying boats…", [1, "No walking path. Trying boats…"]]);
    expect(phases([started, trying(0, ground, "ship")])).toEqual(["Trying boats…", [1, "No walking path. Searching rides…"]]);
    expect(
      phases([started, trying(0, ground, "ship"), legs(plan, [{ mode: "Run", leg: 0, result: ground }]), trying(1, noPath, "ship")]),
    ).toEqual(["No walking path. Trying boats…", [1, "No walking path. Trying boats…"]]);
    expect(phases([started, trying(1, noPath, "ship"), trying(1, noPath, "flight")])).toEqual([
      "No walking path. Trying flights…",
      [1, "No walking path. Trying flights…"],
    ]);
    expect(phases([started, trying(1, noPath, "flight"), legs(plan, [{ mode: "Run", leg: 1, result: noPath }])])).toEqual([
      "Searching rides…",
    ]);
    const unknown = (result: LegResult) => phases([legs(plan, [{ mode: "Run", leg: 0, result: walk }]), trying(1, result, "ship")]);
    expect(unknown({ kind: "no-terrain", endpoint: "end" })).toEqual(["Trying boats…", [1, "Trying boats…"]]);
    expect(unknown({ kind: "limit", cells: 2_000_000 })).toEqual(["Trying boats…", [1, "Trying boats…"]]);
    expect(phases([started, trying(1, noPath, "ship")], run(plan, 50))).toEqual(["Finding walking paths…"]);
  });

  it("starts a new search with its own first phase, not the phase of the search that it replaced", () => {
    const plan = twoLegs("a");
    const old = replay([
      legs(plan, [
        { mode: "Run", leg: 0, result: walk },
        { mode: "Run", leg: 1, result: noPath, searching: true, trying: "ship" },
      ]),
    ]);
    const firstPhase = {
      kind: "calculating",
      journey: { mode: RUN, legs: [walk] },
      phase: "Finding walking paths…",
      searchingRides: new Map(),
    };

    expect(searchView(old, plan, run(plan, 50), FRAMES)).toEqual({ ...firstPhase, journey: { mode: RUN, legs: [] } });
    const steeper = run(plan, 50);
    const newSearch = replay([{ type: "legs", search: steeper, updates: [{ mode: "Run", leg: 0, result: gallop }] }], old);
    expect(searchView(newSearch, plan, steeper, FRAMES)).toEqual({
      ...firstPhase,
      journey: { mode: RUN, legs: [gallop] },
    });

    const otherMode = { ...run(plan), mode: EPIC.name };
    expect(searchView(replay([{ type: "shown", shown: otherMode }], old), plan, run(plan), FRAMES)).toEqual(firstPhase);
    expect(searchView(replay([{ type: "started", search: run(plan) }], old), plan, run(plan), FRAMES)).toEqual(firstPhase);
    const still = replay(
      [
        { type: "shown", shown: run(plan) },
        { type: "started", search: otherMode },
      ],
      old,
    );
    expect(searchView(still, plan, run(plan), FRAMES)).toEqual({
      ...firstPhase,
      phase: "No walking path. Trying boats…",
      searchingRides: new Map([[1, "No walking path. Trying boats…"]]),
    });
  });

  it("shows a cancelled search with only its finished legs until the user searches again or leaves it", () => {
    const plan = twoLegs("a");
    const searching = replay([
      legs(plan, [
        { mode: "Run", leg: 0, result: walk },
        { mode: "Run", leg: 1, result: noPath, searching: true, trying: "ship" },
      ]),
    ]);
    const cancelled = routeSearch(searching, { type: "cancelled", search: run(plan) });
    expect(searchView(cancelled, plan, run(plan), FRAMES)).toEqual({ kind: "cancelled", journey: { mode: RUN, legs: [walk] } });

    const again = routeSearch(cancelled, { type: "retried", search: run(plan) });
    expect(searchView(again, plan, run(plan), FRAMES)).toEqual({
      kind: "calculating",
      journey: { mode: RUN, legs: [walk] },
      phase: "Finding walking paths…",
      searchingRides: new Map(),
    });

    const left = replay([{ type: "shown", shown: run(plan, 50) }], cancelled);
    expect(left.results).toEqual([]);
  });

  it("adds the legs of another mode of the same plan, and drops them when a search of another plan reports", () => {
    const first = twoLegs("a");
    const second = twoLegs("b");
    const bothModes = replay([
      legs(first, [{ mode: "Run", leg: 0, result: walk }]),
      { type: "legs", search: run(first), updates: [{ mode: EPIC.name, leg: 0, result: gallop }] },
    ]);
    expect(bothModes.found).toEqual({
      plan: first,
      maxSlope: 45,
      rides,
      legs: new Map([
        ["Run", [walk]],
        ["Epic mount", [gallop]],
      ]),
      searching: new Map([
        ["Run", new Map()],
        ["Epic mount", new Map()],
      ]),
      trying: undefined,
    });

    const replaced = replay([legs(second, [{ mode: "Run", leg: 1, result: noPath }])], bothModes);
    expect(replaced.found).toEqual({
      plan: second,
      maxSlope: 45,
      rides,
      legs: new Map([["Run", [undefined, noPath]]]),
      searching: new Map([["Run", new Map()]]),
      trying: undefined,
    });
  });

  it("shows a failure only while its search is on screen, and keeps the finished results", () => {
    const plan = twoLegs("a");
    const journeys = { journeys: [{ mode: RUN, legs: [walk, walk] }] };
    const failed = replay([
      { type: "finished", search: run(plan), journeys },
      { type: "failed", search: run(plan, 50), error: "The worker stopped." },
    ]);
    expect(searchView(failed, plan, run(plan, 50), FRAMES)).toEqual({ kind: "failed" });

    const away = routeSearch(failed, { type: "shown", shown: run(plan) });
    expect(away.results).toEqual([{ ...run(plan), kind: "routed", journeys }]);
    expect(searchView(away, plan, run(plan, 50), FRAMES)).toEqual({
      kind: "calculating",
      journey: { mode: RUN, legs: [] },
      phase: "Finding walking paths…",
      searchingRides: new Map(),
    });
    expect(routeSearch(away, { type: "shown", shown: run(plan, 50) })).toBe(away);
  });

  it("fills the legs that a recent search of another plan keeps, and prefers the last search", () => {
    const before = twoLegs("a");
    const after = insertWaypoint(before, 1, at([105, 0]));
    const kept = replay([finished(before, [ground, ground])]);
    expect(searchView(kept, after, run(after), FRAMES)).toEqual({
      kind: "calculating",
      journey: { mode: RUN, legs: [ground] },
      phase: "Finding walking paths…",
      searchingRides: new Map(),
    });

    const reported = replay([legs(after, [{ mode: "Run", leg: 0, result: gallop }])], kept);
    expect(searchView(reported, after, run(after), FRAMES)).toEqual({
      kind: "calculating",
      journey: { mode: RUN, legs: [gallop] },
      phase: "Finding walking paths…",
      searchingRides: new Map(),
    });
  });

  it("keeps the 16 newest searches", () => {
    const plan = twoLegs("a");
    const others = Array.from({ length: 16 }, (_, i) => finished(createPlan(at([0, 0]), at([200 + i, 0])), [walk]));
    const fifteenLater = replay([finished(plan, [walk, walk]), ...others.slice(1)]);
    expect(searchView(fifteenLater, plan, run(plan), FRAMES)).toEqual({ kind: "routed", journey: { mode: RUN, legs: [walk, walk] } });

    const sixteenLater = replay([others[0]!], fifteenLater);
    expect(searchView(sixteenLater, plan, run(plan), FRAMES)).toEqual({
      kind: "calculating",
      journey: { mode: RUN, legs: [] },
      phase: "Finding walking paths…",
      searchingRides: new Map(),
    });
  });

  it("shows a failure without a message as a search with no modes, and keeps it off screen", () => {
    const plan = twoLegs("a");
    const failed = replay([
      { type: "failed", search: run(plan), error: "" },
      { type: "shown", shown: run(plan, 50) },
    ]);
    expect(searchView(failed, plan, run(plan), FRAMES)).toEqual({ kind: "routed", journey: undefined });
  });

  it("gives no journey without a plan or its mode, with one empty ride set", () => {
    const plan = twoLegs("a");
    const noPlan = searchView(NO_SEARCH, null, { ...run(plan), plan: null }, FRAMES);
    expect(noPlan).toEqual({ kind: "calculating", journey: undefined, phase: "Finding walking paths…", searchingRides: new Map() });
    const noMode = searchView(NO_SEARCH, plan, { ...run(plan), mode: "Swim" }, FRAMES);
    expect(noMode).toEqual({ kind: "calculating", journey: undefined, phase: "Finding walking paths…", searchingRides: new Map() });
    expect(noMode.kind === "calculating" && noPlan.kind === "calculating" && noMode.searchingRides === noPlan.searchingRides).toBe(true);
  });
});

describe("leg states", () => {
  const plan = twoLegs("a");
  const oneLeg = createPlan(at([0, 0]), at([70, 0]), "b");
  const noPathLeg = {
    state: "routed",
    result: noPath,
    summary: { kind: "no-path", label: "No path", source: "none", provenance: "No route" },
    mode: "Run",
  };

  it("gives a leg that still walks the walking phase, and a leg whose rides are searched its ride phase", () => {
    const view: SearchView = {
      kind: "calculating",
      journey: { mode: RUN, legs: [] },
      phase: "",
      searchingRides: new Map([[1, "Trying boats…"]]),
    };
    expect(legStates(view, plan, undefined)).toEqual([
      { state: "pending", phase: "Finding walking paths…" },
      { state: "pending", phase: "Trying boats…" },
    ]);
  });

  it("keeps a finished leg of a cancelled search, and cancels the rest", () => {
    expect(legStates({ kind: "cancelled", journey: { mode: RUN, legs: [noPath] } }, plan, undefined)).toEqual([
      noPathLeg,
      { state: "pending", phase: "Search cancelled." },
    ]);
  });

  it("fails each leg of a failed search, or of a search with no movement modes", () => {
    expect(legStates({ kind: "failed" }, oneLeg, undefined)).toEqual([{ state: "failed", reason: "The route search failed." }]);
    expect(legStates({ kind: "routed", journey: undefined }, oneLeg, undefined)).toEqual([
      { state: "failed", reason: "No movement modes to route." },
    ]);
  });

  it("gives a routed leg without a path as routed, with its summary", () => {
    const journey = { mode: RUN, legs: [noPath] };
    expect(legStates({ kind: "routed", journey }, oneLeg, summarizeJourney(journey))).toEqual([noPathLeg]);
  });
});
