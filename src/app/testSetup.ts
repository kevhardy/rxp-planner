import { configure } from "@testing-library/react";

// findBy and waitFor give up after 1 s by default. Under load, the first map
// render of a MapPanel file can take longer. 10 s stays under the test
// timeout, so a missing element still fails with its own message.
configure({ asyncUtilTimeout: 10_000 });

/**
 * Exclusive Web Locks for one test file, granted in request order. jsdom has
 * none, and Node before 24.5 cannot lend its own.
 */
class TestLocks {
  readonly #held = new Map<string, Array<() => void>>();

  async request<T>(name: string, ...args: [(lock: Lock | null) => T] | [LockOptions, (lock: Lock | null) => T]) {
    const [options, callback] = args.length === 1 ? [{}, args[0]] : args;
    const waiters = this.#held.get(name);
    if (waiters && options.ifAvailable) return callback(null);
    if (waiters) await new Promise<void>((resolve) => waiters.push(resolve));
    else this.#held.set(name, []);
    try {
      return await callback({ name, mode: "exclusive" });
    } finally {
      const next = this.#held.get(name)!.shift();
      if (next) next();
      else this.#held.delete(name);
    }
  }

  async query() {
    return { held: [...this.#held.keys()].map((name) => ({ name, mode: "exclusive" as const })), pending: [] };
  }
}

if (typeof navigator !== "undefined" && !("locks" in navigator)) {
  Object.defineProperty(navigator, "locks", { value: new TestLocks() });
}

/**
 * jsdom has no dialog API. This stands in for the parts the app uses: the
 * `open` attribute, and Escape that sends `cancel` to the top modal dialog
 * after the key event passes, then closes it unless `cancel` is canceled.
 */
if (typeof HTMLDialogElement !== "undefined" && !("showModal" in HTMLDialogElement.prototype)) {
  const modals: HTMLDialogElement[] = [];
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
      modals.push(this);
    },
    close(this: HTMLDialogElement) {
      this.removeAttribute("open");
      const at = modals.indexOf(this);
      if (at >= 0) modals.splice(at, 1);
    },
  });
  window.addEventListener("keydown", (e) => {
    const top = modals.at(-1);
    if (e.key === "Escape" && !e.defaultPrevented && top?.dispatchEvent(new Event("cancel", { cancelable: true }))) top.close();
  });
}
