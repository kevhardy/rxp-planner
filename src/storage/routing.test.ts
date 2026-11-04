// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addDestination, createPlan, DEFAULT_LEG, type WorldStop } from "../routing/plan.ts";

const GOLDSHIRE: WorldStop = { instance: 0, x: 62.0625, y: -9464.875, height: null };
const STORMWIND: WorldStop = { instance: 0, x: 554.633, y: -8913.218, height: null };

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const storage = async () => ({ ...(await import("./index.ts")), ...(await import("./routing.ts")) });

async function openV1(): Promise<IDBDatabase> {
  const v1 = indexedDB.open("restedxp-planner", 1);
  v1.onupgradeneeded = () => {
    v1.result.createObjectStore("guides", { keyPath: "id" });
    v1.result.createObjectStore("meta");
  };
  const db = await new Promise<IDBDatabase>((resolve) => (v1.onsuccess = () => resolve(v1.result)));
  const tx = db.transaction(["guides", "meta"], "readwrite");
  tx.objectStore("guides").put({ id: "a", text: "#name A\n", order: 0 });
  tx.objectStore("meta").put({ guideId: "a", step: 1, line: null }, "session");
  tx.objectStore("meta").put("Elwynn", "setting:character");
  await new Promise((resolve) => (tx.oncomplete = resolve));
  return db;
}

it("keeps guides, settings, and unsaved changes when version 1 upgrades", async () => {
  (await openV1()).close();
  const unsaved = { id: "b", text: "#name B\n", order: 1 };
  localStorage.setItem("restedxp-planner:unsaved:tab:closed", JSON.stringify({ put: [unsaved], remove: [] }));

  const { loadLibrary, loadSetting, loadPlans, savePlan } = await storage();
  expect(await loadLibrary()).toEqual({
    guides: [{ id: "a", text: "#name A\n", order: 0 }, unsaved],
    session: { guideId: "a", step: 1, line: null },
  });
  expect(await loadSetting("character")).toBe("Elwynn");
  const plan = createPlan(GOLDSHIRE, STORMWIND, "p");
  await savePlan(plan);
  expect(await loadPlans()).toEqual([plan]);
});

it("reports an upgrade that an open version 1 tab blocks, and finishes once that tab closes", async () => {
  const v1 = await openV1();
  const { loadLibrary } = await storage();
  const blocked = vi.fn();
  (await import("./db.ts")).onUpgradeBlocked(blocked);
  let loaded = false;
  const loading = loadLibrary().then((library) => ((loaded = true), library));

  await vi.waitFor(() => expect(blocked).toHaveBeenCalledOnce());
  expect(loaded).toBe(false);
  v1.close();
  expect((await loading).guides).toEqual([{ id: "a", text: "#name A\n", order: 0 }]);
});

it("saves, replaces, and deletes plans with world stops on any maps and heights, and stores no other key", async () => {
  const { loadPlans, savePlan, deletePlan } = await storage();
  const { openDb, result, ROUTE_PLANS } = await import("./db.ts");
  const plan = createPlan(GOLDSHIRE, STORMWIND, "p");
  await savePlan(plan);
  await savePlan(createPlan(STORMWIND, GOLDSHIRE, "q"));
  await savePlan(addDestination(plan, { instance: 1, x: -618.5181, y: -4251.6699, height: 385.125 }));
  const [loaded, other] = await loadPlans();
  expect(loaded!.stops).toEqual([
    { instance: 0, x: 62.0625, y: -9464.875, height: null },
    { instance: 0, x: 554.633, y: -8913.218, height: null },
    { instance: 1, x: -618.5181, y: -4251.6699, height: 385.125 },
  ]);
  expect(other!.id).toBe("q");
  const stored = await result((await openDb()).transaction(ROUTE_PLANS).objectStore(ROUTE_PLANS).get("p"));
  expect(Object.keys(stored as object)).toEqual(["id", "stops", "legs", "settings"]);
  await deletePlan("p");
  expect((await loadPlans()).map((p) => p.id)).toEqual(["q"]);
});

it("refuses to save a plan that it could not load, and keeps the plan saved before", async () => {
  const { loadPlans, savePlan } = await storage();
  const plan = createPlan(GOLDSHIRE, STORMWIND, "p");
  await savePlan(plan);
  const oneMode = { ...plan, settings: { ...plan.settings, modes: plan.settings.modes.slice(0, 1) } };
  await expect(savePlan(oneMode)).rejects.toThrow("route plan.settings.modes: expected Run, Mount, Epic mount, Ghost Wolf, Travel Form");
  expect(await loadPlans()).toEqual([plan]);
});

it("drops saved route plans and routing drafts, and keeps guides, settings, and unsaved changes, when version 5 upgrades", async () => {
  const v5 = indexedDB.open("restedxp-planner", 5);
  v5.onupgradeneeded = () => {
    for (const name of ["guides", "meta"]) v5.result.createObjectStore(name, name === "guides" ? { keyPath: "id" } : undefined);
    v5.result.createObjectStore("routePlans", { keyPath: "id" });
    v5.result.createObjectStore("routingDrafts", { keyPath: ["scope.variant", "scope.build", "scope.map", "kind"] });
  };
  const db = await new Promise<IDBDatabase>((resolve) => (v5.onsuccess = () => resolve(v5.result)));
  const tx = db.transaction(["guides", "meta", "routePlans", "routingDrafts"], "readwrite");
  tx.objectStore("guides").put({ id: "a", text: "#name A\n", order: 0 });
  tx.objectStore("meta").put({ guideId: "a", step: 1, line: null }, "session");
  tx.objectStore("meta").put("Elwynn", "setting:character");
  tx.objectStore("meta").put(true, "routing:legacyPlanImported");
  tx.objectStore("routePlans").put({
    id: "p",
    scope: { variant: "forever", build: "1.60.1.70450" },
    stops: [
      [1, 2],
      [3, 4],
    ],
  });
  tx.objectStore("routingDrafts").put({ scope: { variant: "forever", build: "1.60.1.70450", map: 0 }, kind: "decisions", value: 1 });
  await new Promise((resolve) => (tx.oncomplete = resolve));
  db.close();
  const recovery = JSON.stringify({ put: [{ id: "b", text: "#name B\n", order: 1 }], remove: [] });
  localStorage.setItem("restedxp-planner:unsaved:tab:closed", recovery);

  const { openDb, result, META, ROUTE_PLANS } = await import("./db.ts");
  const upgraded = await openDb();
  expect([...upgraded.objectStoreNames]).toEqual(["guides", "meta", "routePlans"]);
  expect(await result(upgraded.transaction(ROUTE_PLANS).objectStore(ROUTE_PLANS).getAll())).toEqual([]);
  const meta = upgraded.transaction(META).objectStore(META);
  expect(await result(meta.getAllKeys())).toEqual(["routing:legacyPlanImported", "session", "setting:character"]);
  expect(await result(meta.getAll())).toEqual([true, { guideId: "a", step: 1, line: null }, "Elwynn"]);
  expect(await result(upgraded.transaction("guides").objectStore("guides").getAll())).toEqual([{ id: "a", text: "#name A\n", order: 0 }]);
  expect(localStorage.getItem("restedxp-planner:unsaved:tab:closed")).toBe(recovery);
});

it.each([
  ["missing settings", { settings: undefined }, "route plans[0].settings: expected an object"],
  [
    "invalid swimming flag",
    { settings: { swimming: { enabled: "yes", speed: 4.7 }, modes: [] } },
    "route plans[0].settings.swimming.enabled: expected true or false",
  ],
  [
    "invalid movement speed",
    { settings: { swimming: { enabled: true, speed: 4.7 }, modes: [{ name: "Run", speed: "7", activation: 0 }] } },
    "route plans[0].settings.modes[0].speed: expected a number above 0 and at most 100",
  ],
  [
    "pixel pairs",
    {
      stops: [
        [1, 2],
        [3, 4],
      ],
    },
    "route plans[0].stops[0]: expected a world stop { instance, x, y, height }",
  ],
  ["a missing instance", { stops: [{ x: 1, y: 2, height: null }, STORMWIND] }, "route plans[0].stops[0].instance: missing"],
  ["a NaN coordinate", { stops: [{ ...GOLDSHIRE, x: Number.NaN }, STORMWIND] }, "route plans[0].stops[0].x: expected finite world yards"],
  [
    "invalid height",
    { stops: [GOLDSHIRE, { ...STORMWIND, height: "high" }] },
    "route plans[0].stops[1].height: expected a number of yards or null",
  ],
  ["one stop", { stops: [GOLDSHIRE], legs: [] }, "route plans[0].stops: expected a start and a destination"],
  ["a missing leg", { legs: [] }, "route plans[0].legs: expected 1 legs"],
  [
    "invalid leg flag",
    { legs: [{ ...DEFAULT_LEG, followTerrain: "yes" }] },
    "route plans[0].legs[0].followTerrain: expected true or false",
  ],
  ["an unknown field", { floors: [null, null] }, "route plans[0].floors: unknown field"],
])("rejects a saved plan with %s and preserves the stored record", async (_name, fields, problem) => {
  const { loadPlans } = await storage();
  const { openDb, ROUTE_PLANS, done, result } = await import("./db.ts");
  const db = await openDb();
  const original = { ...createPlan(GOLDSHIRE, STORMWIND, "broken-plan"), ...fields };
  const tx = db.transaction(ROUTE_PLANS, "readwrite");
  tx.objectStore(ROUTE_PLANS).put(original);
  await done(tx);

  await expect.soft(loadPlans()).rejects.toThrow(problem);
  expect(await result(db.transaction(ROUTE_PLANS).objectStore(ROUTE_PLANS).get("broken-plan"))).toEqual(original);
});
