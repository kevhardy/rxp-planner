import type { NativeFrame, Point } from "../../routing/frame.ts";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoutingPin } from "../../routing/artifact.ts";
import { ARTIFACT_DIR, bundleJson, fixturePin } from "../../routing/fixtures/repin.ts";
import { at, TEST_FRAME, testFrame, whole } from "../../routing/fixtures/region.ts";
import { flatArtifact } from "../../routing/fixtures/synthetic.ts";
import { routeTrip, type LegUpdate } from "../../routing/journey.ts";
import { createPlan, DEFAULT_MAX_SLOPE, type RoutePlan } from "../../routing/plan.ts";
import { routeLeg } from "../../routing/search.ts";
import type { TerrainRegion } from "../../routing/terrain.ts";
import { loadRouting, openSearch, searchRouting, serveSearch, workerSearch, type Search, type SearchWorker } from "./engine.ts";

const pins = { more: [] as RoutingPin[] };
const bundle = async () => new Response(JSON.stringify(bundleJson(await fixturePin(), ...pins.more)));
const map0File = async (path: string) => readFile(`${ARTIFACT_DIR}${path}`).catch(() => undefined);
vi.mock("../../routing/search.ts", async (original) => {
  const actual = await original<typeof import("../../routing/search.ts")>();
  return { ...actual, routeLeg: vi.fn(actual.routeLeg) };
});

afterEach(() => {
  pins.more = [];
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const region: TerrainRegion = {
  tile: [0, 0],
  width: 9,
  height: 3,
  spacing: 7,
  elevation: new Float32Array(27),
  slope: new Float32Array(27),
  blocked: new Uint8Array(27).map((_, i) => (i % 9 === 4 ? 1 : 0)),
  water: new Float32Array(27).fill(Number.NaN),
  failed: [],
  coverage: ([x, y]) => (x >= 0 && y >= 0 && x < 9 && y < 3 ? "present" : undefined),
};
const terrain = whole(region);

const plan = (...stops: Point[]): RoutePlan => {
  const p = createPlan(at(stops[0]!), at(stops[1]!));
  return { ...p, stops: stops.map((stop) => at(stop)), legs: stops.slice(1).map(() => p.legs[0]!) };
};
const west = plan([4, 4], [12, 8]);
const across = plan([4, 4], [32, 4]);
const direct = searchRouting(new Map([[0, terrain]]));
const fresh = () => searchRouting(new Map([[0, terrain]]));

function channelWorkers(search: Search | (() => Search), refuse = 0) {
  const workers = { made: 0, ended: [] as number[] };
  const create = (): SearchWorker => {
    if (refuse-- > 0) throw new DOMException("The worker cannot start.", "SecurityError");
    const { port1, port2 } = new MessageChannel();
    const served = typeof search === "function" ? search() : search;
    serveSearch(port2, async () => served);
    const index = workers.made++;
    const terminate = () => {
      workers.ended.push(index);
      port1.close();
      port2.close();
    };
    return Object.assign(port1 as unknown as SearchWorker, { terminate, onerror: null });
  };
  return { workers, search: workerSearch([TEST_FRAME], create) };
}

describe("worker search", () => {
  it("gives the same journeys as a search in this thread", async () => {
    const { search } = channelWorkers(direct);
    for (const p of [west, plan([4, 4], [12, 8], [4, 8]), across, plan([4, 4], [4, 4])]) {
      const routed = await search.route(p, DEFAULT_MAX_SLOPE);
      expect(routed).toEqual(await direct.route(p, DEFAULT_MAX_SLOPE));
      if (routed.fastest) expect(routed.journeys).toContain(routed.fastest);
    }
  });

  it("passes search limits and errors through", async () => {
    const limited: Search = {
      ...direct,
      route: (p, maxSlope) => routeTrip(p, (map) => (map === 0 ? { terrain } : undefined), { cellBudget: 100, maxSlope }),
    };
    const { search } = channelWorkers(limited);
    const { journeys } = await search.route(west, DEFAULT_MAX_SLOPE);
    expect(journeys[0]!.legs).toEqual([{ kind: "limit", cells: 128 * 128 }]);
    const unloaded = { ...west, stops: [west.stops[0]!, { ...west.stops[1]!, instance: 5 }] };
    await expect(search.route(unloaded, DEFAULT_MAX_SLOPE)).rejects.toThrow(new Error("No routing artifact is loaded for map 5."));
  });

  it("ends an unfinished search for a new one", async () => {
    const { workers, search } = channelWorkers(direct);
    const first = search.route(west, DEFAULT_MAX_SLOPE);
    const second = search.route(across, DEFAULT_MAX_SLOPE);
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(await second).toEqual(await direct.route(across, DEFAULT_MAX_SLOPE));
    expect(workers).toEqual({ made: 2, ended: [0] });

    await search.route(west, DEFAULT_MAX_SLOPE);
    expect(workers.made).toBe(2);
  });

  it("stops a search when its workspace no longer needs it", async () => {
    const { workers, search } = channelWorkers(direct);
    const effect = new AbortController();
    const unfinished = search.route(west, DEFAULT_MAX_SLOPE, effect.signal);
    effect.abort();
    await expect(unfinished).rejects.toMatchObject({ name: "AbortError" });
    expect(workers).toEqual({ made: 1, ended: [0] });

    const done = new AbortController();
    await search.route(west, DEFAULT_MAX_SLOPE, done.signal);
    done.abort();
    await search.route(across, DEFAULT_MAX_SLOPE);
    expect(workers).toEqual({ made: 2, ended: [0] });

    const open = search.route(plan([4, 8], [12, 4]), DEFAULT_MAX_SLOPE);
    search.release();
    await expect(open).rejects.toMatchObject({ name: "AbortError" });
    expect(workers).toEqual({ made: 2, ended: [0, 1] });
  });

  it("rejects a search whose worker cannot start, and starts one for the next search", async () => {
    const { workers, search } = channelWorkers(direct, 1);
    await expect(search.route(west, DEFAULT_MAX_SLOPE)).rejects.toMatchObject({ name: "SecurityError" });
    expect(await search.route(west, DEFAULT_MAX_SLOPE)).toEqual(await direct.route(west, DEFAULT_MAX_SLOPE));
    expect(workers).toEqual({ made: 1, ended: [] });
  });
});

describe("kept leg results", () => {
  async function routeOnce(search: Search, p: RoutePlan, slope = DEFAULT_MAX_SLOPE, mode?: string) {
    vi.mocked(routeLeg).mockClear();
    const reports: LegUpdate[][] = [];
    const journeys = await search.route(p, slope, undefined, (u) => reports.push(u), undefined, mode);
    const first = [...new Set(reports[0]?.map((u) => u.leg))];
    return { journeys, searched: vi.mocked(routeLeg).mock.calls.length, first };
  }
  const S: Point = [0, 0],
    T: Point = [8, 8],
    D: Point = [12, 0],
    E: Point = [0, 8];

  it("searches only the legs that changed, and gives the same journeys as a new search", async () => {
    const { search } = channelWorkers(fresh);
    const all = 3 + 3;
    expect((await routeOnce(search, plan(S, T, D, E))).searched).toBe(all);
    const destination = plan(S, T, D, [0, 4]);
    const moved = await routeOnce(search, destination);
    expect([moved.searched, moved.first]).toEqual([1, [0, 1]]);
    expect(moved.journeys).toEqual(await fresh().route(destination, DEFAULT_MAX_SLOPE));
    const middle = plan(S, [6, 11], D, E);
    const both = await routeOnce(search, middle);
    expect([both.searched, both.first]).toEqual([4 + 1, [2]]);
    expect(both.journeys).toEqual(await fresh().route(middle, DEFAULT_MAX_SLOPE));
    expect(await routeOnce(search, plan(S, T, D, E))).toMatchObject({ searched: 0, first: [0, 1, 2] });

    expect((await routeOnce(search, plan(S, T, D, E), 30)).searched).toBe(all);
    const faster = plan(S, T, D, E);
    faster.settings.modes[1] = { ...faster.settings.modes[1]!, speed: 20 };
    const mount = await routeOnce(search, faster);
    expect(mount.searched).toBe(1);
    expect(mount.journeys).toEqual(await fresh().route(faster, DEFAULT_MAX_SLOPE));
  });

  it("keeps the results after a search stops its worker", async () => {
    const { workers, search } = channelWorkers(fresh);
    await routeOnce(search, plan(S, T, D, E));
    const drag = new AbortController();
    const stopped = search.route(plan(S, T, D, [4, 4]), DEFAULT_MAX_SLOPE, drag.signal);
    drag.abort();
    await expect(stopped).rejects.toMatchObject({ name: "AbortError" });
    expect(workers).toEqual({ made: 1, ended: [0] });
    expect((await routeOnce(search, plan(S, T, D, E))).searched).toBe(0);
    expect(workers.made).toBe(2);
  });

  const distinctLegs = (legs: number) => {
    const strides = [1, 5, 7, 11, 13, 17, 19, 23, 25, 29, 31];
    const at = (i: number) => (strides[Math.floor(i / 192)]! * i) % 192;
    const p = plan(...Array.from({ length: legs + 1 }, (_, i): Point => [at(i) % 16, Math.floor(at(i) / 16)]));
    p.settings.modes = p.settings.modes.slice(0, 1);
    return p;
  };

  it("keeps at most 256 leg results on the page, after the worker ends", async () => {
    const { search } = channelWorkers(fresh);
    const long = distinctLegs(257);
    expect((await routeOnce(search, long)).searched).toBe(257);
    search.release();
    expect((await routeOnce(search, long)).searched).toBe(1);
    search.release();
    expect((await routeOnce(search, long)).searched).toBe(1);
  });

  it("keeps at most 2048 leg results in the search thread", async () => {
    const search = fresh();
    const long = distinctLegs(2049);
    expect((await routeOnce(search, long)).searched).toBe(2049);
    expect((await routeOnce(search, long)).searched).toBe(1);
  });

  it("routes one mode, and times a later faster mode with the routes that the worker kept from the slowest mode", async () => {
    const { search } = channelWorkers(fresh);
    const p = plan(S, T, D, E);
    const all = await fresh().route(p, DEFAULT_MAX_SLOPE);
    const run = await routeOnce(search, p, DEFAULT_MAX_SLOPE, "Run");
    expect([run.searched, run.journeys.journeys]).toEqual([3, all.journeys.slice(0, 1)]);
    const epic = await routeOnce(search, p, DEFAULT_MAX_SLOPE, "Epic mount");
    expect([epic.searched, epic.journeys.journeys]).toEqual([1, all.journeys.slice(2, 3)]);
    const alone = await routeOnce(channelWorkers(fresh).search, p, DEFAULT_MAX_SLOPE, "Epic mount");
    expect(alone.searched).toBe(3);
    expect(alone.journeys.journeys[0]!.seconds).toBeCloseTo(epic.journeys.journeys[0]!.seconds!, 9);
  });
});

it("routes in the search worker when the page loads routing", async () => {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === "/bundle.json") return bundle();
    const path = url.replace(/^\/routing\/m0\//, "");
    const bytes = await map0File(path);
    return bytes ? new Response(bytes) : new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  const reply = { journeys: [] };
  class FakeWorker {
    static made: FakeWorker[] = [];
    sent: unknown[] = [];
    url: URL;
    options: WorkerOptions;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror = null;
    constructor(url: URL, options: WorkerOptions) {
      this.url = url;
      this.options = options;
      FakeWorker.made.push(this);
    }
    postMessage(request: unknown) {
      this.sent.push(request);
      setTimeout(() => this.onmessage?.({ data: { ok: true, value: reply } }));
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", FakeWorker);

  const load = await loadRouting();
  if (!load.ok) throw new Error(load.reason);
  expect(load.engine.manifest.id).toBe((await fixturePin()).id);
  expect(new Set(fetch.mock.calls.map(([, init]) => init?.cache))).toEqual(new Set(["no-cache"]));
  expect(FakeWorker.made).toHaveLength(0);
  const frame = load.engine.maps[0]!.manifest;
  const p = { ...plan([4, 4], [32, 4]), stops: [at([4, 4], null, frame), at([32, 4], null, frame)] };
  expect(await load.engine.route(p, DEFAULT_MAX_SLOPE)).toEqual(reply);

  expect(FakeWorker.made.map((w) => [w.url.pathname.split("/").at(-1), w.options, w.sent])).toEqual([
    ["search.worker.ts", { type: "module" }, [{ plan: p, maxSlope: DEFAULT_MAX_SLOPE, known: [] }]],
  ]);
});

describe("a second map", async () => {
  const kalimdor = await flatArtifact(
    1,
    [40, 31],
    [2, 2],
    [
      [0, 0],
      [1, 0],
    ],
  );
  const serve = (withMap1 = true, map1 = kalimdor) =>
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "/bundle.json") return bundle();
      const [, map, path] = /^\/routing\/m(\d+)\/(.+)$/.exec(url) ?? [];
      const bytes = map === "0" ? await map0File(path!) : withMap1 ? map1.files.get(path!) : undefined;
      return bytes ? new Response(bytes) : new Response(null, { status: 404 });
    });
  const map1: NativeFrame = { scope: { map: 1 }, frame: { ...testFrame(1).frame, origin: [40, 31], size: [2, 2] } };
  const onMap1 = (...stops: Point[]): RoutePlan => ({ ...plan(...stops), stops: stops.map((stop) => at(stop, null, map1)) });

  it("routes a plan on map 1 with that map's artifact, and a leg from map 0 is a crossing", async () => {
    pins.more = [kalimdor.pin];
    serve();
    const search = await openSearch();
    const { fastest } = await search.route(onMap1([100, 100], [900, 200]), DEFAULT_MAX_SLOPE);
    expect(fastest?.seconds).toBeGreaterThan(0);
    const leg = fastest?.legs[0];
    expect(leg?.kind === "route" && leg.points.length).toBeGreaterThan(1);
    const onBoth = onMap1([5000, 11500], [100, 100], [900, 200]);
    const map0 = JSON.parse(await readFile(`${ARTIFACT_DIR}manifest.json`, "utf8")) as NativeFrame;
    const crossing = { ...onBoth, stops: onBoth.stops.with(0, at([5000, 11500], null, map0)) };
    const trip = await search.route(crossing, DEFAULT_MAX_SLOPE);
    expect(trip.fastest?.legs.map((leg) => leg.kind)).toEqual(["crossing", "route"]);
  });

  it("keeps routing map 0 when map 1 does not load", async () => {
    pins.more = [kalimdor.pin];
    serve(false);
    const search = await openSearch();
    await expect(search.route(onMap1([100, 100], [900, 200]), DEFAULT_MAX_SLOPE)).rejects.toThrow(
      "No routing artifact is loaded for map 1.",
    );
    vi.resetModules();
    const fresh = await import("./engine.ts");
    const load = await fresh.loadRouting();
    if (!load.ok) throw new Error(load.reason);
    expect(load.engine.maps.map((m) => m.manifest.scope.map)).toEqual([0]);
    expect(load.missing).toEqual([{ map: 1, reason: "No routing artifact is installed." }]);
  });
});
