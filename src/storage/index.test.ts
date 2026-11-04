// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import type { GuideRecord } from "../guide/index.ts";
import { done, GUIDES, META, openDb, result } from "./db.ts";
import {
  loadLibrary,
  saveLibrary,
  startAutosave,
  type Autosave,
  type AutosaveSource,
  type StoredLibrary,
  type StoredSession,
} from "./index.ts";

const RECOVERY = "restedxp-planner:unsaved";
const KEPT = `${RECOVERY}:kept:`;
const TAB = `${RECOVERY}:tab:`;

function stored(prefix: string): string[] {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(prefix))
    .map((key) => localStorage.getItem(key)!);
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function close(autosave: Autosave) {
  autosave.stop();
  await vi.waitFor(async () => {
    const { held = [] } = await navigator.locks.query();
    expect(held.filter((lock) => lock.name?.startsWith(TAB))).toEqual([]);
  });
}

function editor(initial: StoredLibrary, onStatus?: Parameters<typeof startAutosave>[2]) {
  let guides = new Map(initial.guides.map((g) => [g.id, g]));
  let session: StoredSession = { guideId: "a", step: 0, line: null };
  const listeners = new Set<() => void>();
  const source: AutosaveSource = {
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    snapshot: () => ({ guides, session }),
  };
  const autosave = startAutosave(source, initial, onStatus, 60_000);
  const edit = (guide: GuideRecord, nextSession = session) => {
    guides = new Map([...guides, [guide.id, guide]]);
    session = nextSession;
    listeners.forEach((l) => l());
  };
  return { autosave, edit };
}

it("loads guides in order with exact text, metadata, and session", async () => {
  const db = await openDb();
  const previousSession = await result<unknown>(db.transaction(META).objectStore(META).get("session"));
  const first: GuideRecord = {
    id: "zexact",
    text: "#name Exact\r\n-- comment\r\nstep\r\n    .unknown syntax\r\n",
    order: 0,
    registerArgs: { group: "Custom", defaultFor: "Alliance" },
    fileName: "exact.lua",
  };
  const second: GuideRecord = { id: "later", text: "#name Later\nstep", order: 1 };
  const session: StoredSession = { guideId: "zexact", step: 0, line: null };
  onTestFinished(async () => {
    await saveLibrary([], [first.id, second.id]);
    const tx = db.transaction(META, "readwrite");
    if (previousSession === undefined) tx.objectStore(META).delete("session");
    else tx.objectStore(META).put(previousSession, "session");
    await done(tx);
  });
  await saveLibrary([second, first], [], session);

  const loaded = await loadLibrary();
  expect(loaded.guides.filter((guide) => guide.id === first.id || guide.id === second.id)).toEqual([first, second]);
  expect(loaded.session).toEqual(session);
});

it.each([
  {
    store: GUIDES,
    key: "invalid",
    value: { id: "invalid", text: 42, order: 0 },
    error: 'Invalid stored guide "invalid" in browser storage',
  },
  { store: META, key: "session", value: { guideId: "a", step: -1, line: null }, error: "Invalid stored session in browser storage" },
  { store: META, key: "session", value: { guideId: "a", step: 0, line: "bad" }, error: "Invalid stored session in browser storage" },
  { store: META, key: "session", value: null, error: "Invalid stored session in browser storage" },
])("rejects $error without changing the stored record ($value)", async ({ store, key, value, error }) => {
  const db = await openDb();
  const original = await result<unknown>(db.transaction(store, "readonly").objectStore(store).get(key));
  const neighbor: GuideRecord = {
    id: "valid-neighbor",
    text: "#name Neighbor\r\n-- comment\r\nstep\r\n    .unknown syntax\r\n",
    order: 1,
    registerArgs: { group: "Custom", defaultFor: "Alliance" },
    fileName: "neighbor.lua",
  };
  if (store === GUIDES) {
    onTestFinished(() => saveLibrary([], [neighbor.id]));
    await saveLibrary([neighbor], []);
  }
  onTestFinished(async () => {
    const tx = db.transaction(store, "readwrite");
    if (original === undefined) tx.objectStore(store).delete(key);
    else tx.objectStore(store).put(original, ...(store === META ? [key] : []));
    await done(tx);
  });
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value, ...(store === META ? [key] : []));
  await done(tx);

  await expect(loadLibrary()).rejects.toThrow(new Error(error));
  if (store === GUIDES) {
    expect(await result<unknown>(db.transaction(GUIDES).objectStore(GUIDES).get(neighbor.id))).toEqual(neighbor);
  }
  expect(await result<unknown>(db.transaction(store, "readonly").objectStore(store).get(key))).toEqual(value);
});

it("keeps changes made just before the page unloads", async () => {
  const { autosave, edit } = editor(await loadLibrary());
  const guide: GuideRecord = { id: "a", text: "#name A\nstep\n", order: 0 };
  edit(guide);

  expect(autosave.saveBeforeLeaving()).toBe(true);
  await close(autosave);

  const reloaded = await loadLibrary();
  expect(reloaded.guides).toEqual([guide]);
  expect(reloaded.session).toEqual({ guideId: "a", step: 0, line: null });
  expect(localStorage.length).toBe(0);
});

it("reports saved only after a save queued during another has committed", async () => {
  const commits: Array<() => void> = [];
  let holding = true;
  const transaction = IDBDatabase.prototype.transaction;
  vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, ...args) {
    const tx = transaction.apply(this, args);
    if (tx.mode === "readwrite") {
      let oncomplete: ((event: Event) => void) | null = null;
      Object.defineProperty(tx, "oncomplete", {
        get: () => null,
        set: (handler) => {
          oncomplete = handler;
        },
      });
      tx.addEventListener("complete", (event) => {
        const release = () => oncomplete?.(event);
        if (holding) commits.push(release);
        else release();
      });
    }
    return tx;
  });
  const onStatus = vi.fn();
  const { autosave, edit } = editor(await loadLibrary(), onStatus);
  onTestFinished(async () => {
    autosave.stop();
    holding = false;
    commits.splice(0).forEach((release) => release());
    await autosave.settled();
  });

  edit({ id: "g", text: "#name G\n", order: 6 });
  autosave.flush();
  const first = autosave.settled();
  await vi.waitFor(() => expect(commits).toHaveLength(1));
  const latest = { id: "g", text: "#name G\nstep\n", order: 6 };
  edit(latest, { guideId: "g", step: 1, line: null });
  autosave.flush();
  const second = autosave.settled();

  commits.shift()!();
  await first;
  expect(onStatus).toHaveBeenLastCalledWith("pending");
  await vi.waitFor(() => expect(commits).toHaveLength(1));
  commits.shift()!();
  await second;
  expect(onStatus).toHaveBeenLastCalledWith("saved");

  const reloaded = await loadLibrary();
  expect(reloaded.guides.find((g) => g.id === "g")).toEqual(latest);
  expect(reloaded.session).toEqual({ guideId: "g", step: 1, line: null });
});

it("keeps malformed recovery data aside, and a later page exit leaves it alone", async () => {
  localStorage.setItem(RECOVERY, '{"put": [');
  const { autosave, edit } = editor(await loadLibrary());
  expect(stored(KEPT)).toEqual(['{"put": [']);
  expect(localStorage.getItem(RECOVERY)).toBeNull();
  expect(console.warn).toHaveBeenCalled();

  edit({ id: "b", text: "#name B\n", order: 1 });
  expect(autosave.saveBeforeLeaving()).toBe(true);
  autosave.stop();
  expect(stored(KEPT)).toEqual(['{"put": [']);
  expect(stored(TAB).map((raw) => JSON.parse(raw).put)).toEqual([[{ id: "b", text: "#name B\n", order: 1 }]]);
});

it.each([
  ["guide", { put: [{ id: "c", text: 1, order: 2 }], remove: [] }],
  ["session", { put: [], remove: [], session: { guideId: "c", step: "0", line: null } }],
  ["session step", { put: [], remove: [], session: { guideId: "c", step: 0.5, line: null } }],
  ["session line", { put: [], remove: [], session: { guideId: "c", step: 0, line: -1 } }],
])("keeps recovery data with a wrong %s shape aside without applying it", async (_, changes) => {
  const raw = JSON.stringify(changes);
  localStorage.setItem(RECOVERY, raw);
  const library = await loadLibrary();
  expect(library.guides.map((g) => g.id)).not.toContain("c");
  expect(library.session?.guideId).not.toBe("c");
  expect(stored(KEPT)).toEqual([raw]);
  expect(localStorage.getItem(RECOVERY)).toBeNull();
});

it("keeps each malformed payload under its own key when tabs load at once", async () => {
  localStorage.setItem(`${KEPT}1`, "kept earlier");
  localStorage.setItem(RECOVERY, "first");
  localStorage.setItem(`${TAB}closed`, "[]");
  await Promise.all([loadLibrary(), loadLibrary()]);
  expect(stored(KEPT).sort()).toEqual(["[]", "first", "kept earlier"]);
  expect(localStorage.getItem(`${KEPT}1`)).toBe("kept earlier");
  expect(localStorage.length).toBe(3);
});

it("keeps a page exit another tab writes while this tab keeps malformed data aside", async () => {
  const guide: GuideRecord = { id: "h", text: "#name H\n", order: 7 };
  const other = editor({ guides: [] });
  other.edit(guide);
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key.startsWith(KEPT)) expect(other.autosave.saveBeforeLeaving()).toBe(true);
    setItem.call(this, key, value);
  });
  localStorage.setItem(RECOVERY, "not json");
  await loadLibrary();
  await close(other.autosave);
  vi.mocked(Storage.prototype.setItem).mockRestore();

  expect((await loadLibrary()).guides).toContainEqual(guide);
  expect(stored(KEPT)).toEqual(["not json"]);
});

it("shows a tab that loads during another tab's recovery the recovered library", async () => {
  await saveLibrary([{ id: "l", text: "#name L\n", order: 11 }], []);
  const recovered: GuideRecord = { id: "l", text: "#name L\nstep\n", order: 11 };
  localStorage.setItem(`${TAB}closed`, JSON.stringify({ put: [recovered], remove: [] }));
  vi.resetModules();
  const first = await import("./index.ts");
  vi.resetModules();
  const second = await import("./index.ts");
  const open = indexedDB.open.bind(indexedDB);
  vi.spyOn(indexedDB, "open").mockImplementationOnce((...args) => {
    const request = open(...args);
    let onsuccess: ((event: Event) => void) | null = null;
    Object.defineProperty(request, "onsuccess", {
      get: () => onsuccess,
      set: (handler: (event: Event) => void) => {
        onsuccess = (event) => setTimeout(() => handler(event), 50);
      },
    });
    return request;
  });

  const libraries = await Promise.all([first.loadLibrary(), second.loadLibrary()]);
  expect(libraries.map((library) => library.guides.find((g) => g.id === "l"))).toEqual([recovered, recovered]);
});

it("keeps each tab's page exit", async () => {
  const guides: GuideRecord[] = [
    { id: "i", text: "#name I\n", order: 8 },
    { id: "j", text: "#name J\n", order: 9 },
  ];
  for (const guide of guides) {
    const { autosave, edit } = editor({ guides: [] });
    edit(guide);
    expect(autosave.saveBeforeLeaving()).toBe(true);
    await close(autosave);
  }
  expect((await loadLibrary()).guides).toEqual(expect.arrayContaining(guides));
  expect(localStorage.length).toBe(0);
});

it("leaves an open tab's page exit for that tab, and applies it once the tab closes", async () => {
  const guide: GuideRecord = { id: "k", text: "#name K\n", order: 10 };
  const open = editor({ guides: [] });
  open.edit(guide);
  expect(open.autosave.saveBeforeLeaving()).toBe(true);

  expect((await loadLibrary()).guides).not.toContainEqual(guide);
  expect(stored(TAB)).toHaveLength(1);
  await close(open.autosave);
  expect((await loadLibrary()).guides).toContainEqual(guide);
  expect(localStorage.length).toBe(0);
});

it("protects malformed recovery data it cannot copy, and still keeps new work at page exit", async () => {
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key.startsWith(KEPT)) throw new DOMException("full", "QuotaExceededError");
    setItem.call(this, key, value);
  });
  localStorage.setItem(RECOVERY, "not json");
  const onStatus = vi.fn();
  const { autosave, edit } = editor(await loadLibrary(), onStatus);
  expect(console.error).toHaveBeenCalled();

  edit({ id: "d", text: "#name D\n", order: 3 });
  autosave.flush();
  await autosave.settled();
  expect(onStatus).toHaveBeenLastCalledWith("saved");
  expect(localStorage.getItem(RECOVERY)).toBe("not json");

  const latest = { id: "d", text: "#name D\nstep\n", order: 3 };
  edit(latest);
  expect(autosave.saveBeforeLeaving()).toBe(true);
  autosave.stop();
  expect(localStorage.getItem(RECOVERY)).toBe("not json");
  expect(stored(TAB).map((raw) => JSON.parse(raw).put)).toEqual([[latest]]);
});

it("reports a page exit that cannot reach localStorage", async () => {
  const onStatus = vi.fn();
  const { autosave, edit } = editor(await loadLibrary(), onStatus);
  edit({ id: "f", text: "#name F\n", order: 5 });
  const denied = new DOMException("denied", "SecurityError");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw denied;
  });
  expect(autosave.saveBeforeLeaving()).toBe(false);
  autosave.stop();
  expect(onStatus).toHaveBeenLastCalledWith("error", denied);
});

it("keeps valid recovery data when saving it to IndexedDB fails", async () => {
  const raw = JSON.stringify({ put: [{ id: "e", text: "#name E\n", order: 4 }], remove: [] });
  localStorage.setItem(RECOVERY, raw);
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  await expect(loadLibrary()).rejects.toThrow("full");
  expect(localStorage.getItem(RECOVERY)).toBe(raw);
});
