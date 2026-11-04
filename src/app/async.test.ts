import { expect, it } from "vitest";
import { AssetMap, Demand, Latest } from "./async.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

function latest() {
  const released: string[] = [];
  const store = new Latest<string>((value) => released.push(value));
  const signals: AbortSignal[] = [];
  const run = () => {
    const load = deferred<string>();
    store.run((signal) => {
      signals.push(signal);
      return load.promise;
    });
    return load;
  };
  return { store, released, signals, run };
}

it("shows a loaded value and keeps its signal live", async () => {
  const { store, signals, run } = latest();
  const load = run();
  expect(store.getState()).toEqual({ kind: "loading" });
  load.resolve("a");
  await settle();
  expect(store.getState()).toEqual({ kind: "ready", value: "a" });
  expect(signals[0]!.aborted).toBe(false);
});

it("aborts the previous load, and releases its value when it arrives without showing it", async () => {
  const { store, released, signals, run } = latest();
  const first = run();
  const second = run();
  expect(signals.map((s) => s.aborted)).toEqual([true, false]);
  first.resolve("stale");
  await settle();
  expect(released).toEqual(["stale"]);
  expect(store.getState()).toEqual({ kind: "loading" });
  second.resolve("fresh");
  await settle();
  expect(store.getState()).toEqual({ kind: "ready", value: "fresh" });
  expect(released).toEqual(["stale"]);
});

it("releases a shown value and aborts its signal when a new load starts", async () => {
  const { store, released, signals, run } = latest();
  run().resolve("a");
  await settle();
  run();
  expect(released).toEqual(["a"]);
  expect(signals[0]!.aborted).toBe(true);
  expect(store.getState()).toEqual({ kind: "loading" });
});

it("shows a rejection as its error text, and drops a stale one", async () => {
  const { store, run } = latest();
  const first = run();
  const second = run();
  first.reject(new Error("stale failure"));
  await settle();
  expect(store.getState()).toEqual({ kind: "loading" });
  second.reject(new Error("offline"));
  await settle();
  expect(store.getState()).toEqual({ kind: "failed", error: "offline" });
});

it("clears once: aborts the load, releases the value, and releases a value that arrives after", async () => {
  const { store, released, signals, run } = latest();
  run().resolve("a");
  await settle();
  const notified: string[] = [];
  store.subscribe(() => notified.push(store.getState().kind));
  store.clear();
  store.clear();
  expect(released).toEqual(["a"]);
  expect(signals[0]!.aborted).toBe(true);
  expect(notified).toEqual(["idle"]);

  const late = run();
  store.clear();
  expect(signals[1]!.aborted).toBe(true);
  late.resolve("late");
  await settle();
  expect(released).toEqual(["a", "late"]);
  expect(store.getState()).toEqual({ kind: "idle" });
});

function demand() {
  const calls: string[] = [];
  const keys = new Demand<string>(
    (key) => calls.push(`first ${key}`),
    (key) => calls.push(`last ${key}`),
  );
  return { keys, calls };
}

it("waits a microtask after the last holder leaves, then runs `last`", async () => {
  const { keys, calls } = demand();
  const one = keys.retain("a");
  const two = keys.retain("a");
  one();
  two();
  expect([calls, keys.has("a")]).toEqual([["first a"], true]);
  await Promise.resolve();
  expect([calls, keys.has("a")]).toEqual([["first a", "last a"], false]);
});

it("keeps a key that a holder retains again before the microtask, and does not run `first` again", async () => {
  const { keys, calls } = demand();
  keys.retain("a")();
  keys.retain("a");
  await settle();
  expect([calls, keys.has("a")]).toEqual([["first a"], true]);
});

it("runs `first` again for a key retained after its teardown", async () => {
  const { keys, calls } = demand();
  keys.retain("a")();
  await settle();
  keys.retain("a");
  expect(calls).toEqual(["first a", "last a", "first a"]);
});

it("counts a release once, also when it is called again", async () => {
  const { keys, calls } = demand();
  const one = keys.retain("a");
  keys.retain("a");
  one();
  one();
  await settle();
  expect(calls).toEqual(["first a"]);
});

function assets() {
  const loads = new Map<string, ReturnType<typeof deferred<string>>[]>();
  const map = new AssetMap((key: string) => {
    const load = deferred<string>();
    loads.set(key, [...(loads.get(key) ?? []), load]);
    return load.promise;
  });
  return { map, loads };
}

it("loads a key once for its holders, and keeps its value after they leave", async () => {
  const { map, loads } = assets();
  const one = map.retain("a");
  const two = map.retain("a");
  expect(map.peek("a")).toEqual({ kind: "loading" });
  loads.get("a")![0]!.resolve("A");
  await settle();
  one();
  two();
  await settle();
  map.retain("a");
  expect([loads.get("a")!.length, map.peek("a")]).toEqual([1, { kind: "ready", value: "A" }]);
});

it("forgets a failed key when its last holder leaves, so the next retain loads it again", async () => {
  const { map, loads } = assets();
  const release = map.retain("a");
  loads.get("a")![0]!.reject(new Error("offline"));
  await settle();
  expect(map.peek("a")).toEqual({ kind: "failed", error: "offline" });
  release();
  await settle();
  expect(map.peek("a")).toBeUndefined();
  map.retain("a");
  expect([loads.get("a")!.length, map.peek("a")]).toEqual([2, { kind: "loading" }]);
});

it("forgets a failure that arrives after the last holder left, and keeps a value that does", async () => {
  const { map, loads } = assets();
  map.retain("a")();
  map.retain("b")();
  await settle();
  loads.get("a")![0]!.reject(new Error("offline"));
  loads.get("b")![0]!.resolve("B");
  await settle();
  expect([map.peek("a"), map.peek("b")]).toEqual([undefined, { kind: "ready", value: "B" }]);
});
