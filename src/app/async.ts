import { errorText } from "../data/errorText.ts";

/** `error` is the rejection's `errorText`, ready to show. */
export type Status<T> = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; value: T } | { kind: "failed"; error: string };

/**
 * One load at a time, and the latest `run` wins. At most one value is live:
 * `run` and `clear` abort the running load and release the shown value.
 * A load's signal aborts exactly when the load is stale, so a value that
 * arrives after that is released and never shown, and a late rejection is
 * dropped. A shown value's signal stays live until it is replaced or cleared.
 */
export class Latest<T> {
  readonly #release: (value: T) => void;
  #status: Status<T> = { kind: "idle" };
  #controller: AbortController | undefined;
  readonly #listeners = new Set<() => void>();

  /** `release` frees a value that is replaced, cleared, or arrives stale. */
  constructor(release: (value: T) => void = () => {}) {
    this.#release = release;
  }

  getState = (): Status<T> => this.#status;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  run(load: (signal: AbortSignal) => Promise<T>): void {
    this.#stop();
    const { signal } = (this.#controller = new AbortController());
    this.#publish({ kind: "loading" });
    load(signal).then(
      (value) => {
        if (signal.aborted) this.#release(value);
        else this.#publish({ kind: "ready", value });
      },
      (error: unknown) => {
        if (!signal.aborted) this.#publish({ kind: "failed", error: errorText(error) });
      },
    );
  }

  clear(): void {
    if (this.#status.kind === "idle") return;
    this.#stop();
    this.#publish({ kind: "idle" });
  }

  #stop(): void {
    this.#controller?.abort();
    this.#controller = undefined;
    if (this.#status.kind === "ready") this.#release(this.#status.value);
  }

  #publish(status: Status<T>): void {
    this.#status = status;
    for (const listener of this.#listeners) listener();
  }
}

/** `retain` gives the release, which does nothing after its first call. */
export interface Retains<K> {
  retain(key: K): () => void;
}

/**
 * Holders per key. `first` runs when a key gets a holder and has none, and
 * `last` runs in a microtask after the last holder leaves, unless a holder
 * came back first. So a release and a retain in one task, such as a
 * StrictMode remount, keep what `first` started.
 */
export class Demand<K> implements Retains<K> {
  readonly #holders = new Map<K, number>();
  readonly #first: (key: K) => void;
  readonly #last: (key: K) => void;

  constructor(first: (key: K) => void, last: (key: K) => void) {
    this.#first = first;
    this.#last = last;
  }

  retain(key: K): () => void {
    const holders = this.#holders.get(key);
    this.#holders.set(key, (holders ?? 0) + 1);
    if (holders === undefined) this.#first(key);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const left = this.#holders.get(key)! - 1;
      this.#holders.set(key, left);
      if (left === 0) queueMicrotask(() => this.#end(key));
    };
  }

  /** Whether `first` ran for `key` and `last` has not run since. */
  has(key: K): boolean {
    return this.#holders.has(key);
  }

  #end(key: K): void {
    if (this.#holders.get(key) !== 0) return;
    this.#holders.delete(key);
    this.#last(key);
  }
}

/**
 * Values by key. A key loads when it gets its first holder, and its value
 * stays after the holders leave. A failed key is forgotten when no holder
 * retains it, so the next retain loads it again.
 */
export class AssetMap<K, V> implements Retains<K> {
  readonly #load: (key: K) => Promise<V>;
  readonly #states = new Map<K, Status<V>>();
  readonly #demand = new Demand<K>(
    (key) => this.#first(key),
    (key) => this.#last(key),
  );
  readonly #listeners = new Set<() => void>();

  constructor(load: (key: K) => Promise<V>) {
    this.#load = load;
  }

  retain(key: K): () => void {
    return this.#demand.retain(key);
  }

  /** Undefined for a key that no holder retained, and for a forgotten failure. */
  peek(key: K): Status<V> | undefined {
    return this.#states.get(key);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #first(key: K): void {
    if (this.#states.has(key)) return;
    this.#set(key, { kind: "loading" });
    this.#load(key).then(
      (value) => this.#set(key, { kind: "ready", value }),
      (error: unknown) => {
        if (this.#demand.has(key)) this.#set(key, { kind: "failed", error: errorText(error) });
        else this.#states.delete(key);
      },
    );
  }

  #last(key: K): void {
    if (this.#states.get(key)?.kind === "failed") this.#states.delete(key);
  }

  #set(key: K, status: Status<V>): void {
    this.#states.set(key, status);
    for (const listener of this.#listeners) listener();
  }
}
