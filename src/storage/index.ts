// IndexedDB persistence for the library and the last session. Guides are
// stored as their exact text plus metadata, so an unedited guide reloads
// exactly as imported.
//
// IndexedDB writes finish after the page is gone if it unloads first, so
// changes still waiting to be saved then go to localStorage, which writes
// synchronously, and the next load applies them. Each autosave, so each tab,
// writes only its own recovery key and holds a Web Lock of the same name while
// it runs; a load applies only keys whose lock it can take, so it never takes
// an open tab's changes. Recovery data that fails validation is copied to a
// new kept key, never replaced, and stays where it was until that copy succeeds.

import type { GuideRecord } from "../guide/index.ts";
import { done, GUIDES, META, openDb, result } from "./db.ts";

export interface StoredSession {
  guideId: string | null;
  step: number | null;
  line: number | null;
}

export interface StoredLibrary {
  guides: GuideRecord[];
  session?: StoredSession;
}

const SESSION_KEY = "session";
const LEGACY_SHARED_KEY = "restedxp-planner:unsaved";
const TAB_KEY = "restedxp-planner:unsaved:tab:";
const KEPT_KEY = "restedxp-planner:unsaved:kept:";
const LOAD_LOCK = "restedxp-planner:load";

interface Changes {
  put: GuideRecord[];
  remove: string[];
  session?: StoredSession;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isOptional = (v: unknown, type: "string" | "number") => v === undefined || typeof v === type;
const isIndex = (v: unknown) => v === null || (Number.isSafeInteger(v) && (v as number) >= 0);

// IndexedDB saves a GuideRecord as it is, so each new field needs a check here.
const SAVED_GUIDE_FIELDS: { readonly [K in keyof Required<GuideRecord>]: (v: unknown) => boolean } = {
  id: (v) => typeof v === "string",
  text: (v) => typeof v === "string",
  order: (v) => typeof v === "number",
  fileName: (v) => isOptional(v, "string"),
  registerArgs: (v) => v === undefined || (isObject(v) && typeof v.group === "string" && isOptional(v.defaultFor, "string")),
};

const isGuide = (v: unknown): v is GuideRecord =>
  isObject(v) && Object.entries(SAVED_GUIDE_FIELDS).every(([field, isValid]) => isValid(v[field]));

function isSession(v: unknown): v is StoredSession {
  return isObject(v) && (v.guideId === null || typeof v.guideId === "string") && isIndex(v.step) && isIndex(v.line);
}

function isChanges(v: unknown): v is Changes {
  return (
    isObject(v) &&
    Array.isArray(v.put) &&
    v.put.every(isGuide) &&
    Array.isArray(v.remove) &&
    v.remove.every((id) => typeof id === "string") &&
    (v.session === undefined || isSession(v.session))
  );
}

function parseChanges(raw: string): Changes | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  return isChanges(v) ? v : null;
}

/**
 * Saves the changes under recovery key `key`, or copies unreadable changes
 * to a new kept key. Then removes `key` if its value has not changed. A tab
 * from before per-tab keys can still change the shared key. Leaves `key` if
 * the save or copy fails. The caller holds the key's lock.
 */
async function recover(key: string): Promise<void> {
  const raw = localStorage.getItem(key);
  if (raw === null) return;
  const changes = parseChanges(raw);
  if (changes) {
    await saveLibrary(changes.put, changes.remove, changes.session);
  } else {
    const kept = `${KEPT_KEY}${crypto.randomUUID()}`;
    try {
      localStorage.setItem(kept, raw);
    } catch (error) {
      console.error(`Could not copy unreadable unsaved changes; they stay in localStorage["${key}"]`, error);
      return;
    }
    console.warn(`Unsaved changes from an earlier visit were unreadable; kept them in localStorage["${kept}"]`);
  }
  if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
}

/**
 * Loads the library, first saving changes closed tabs left in localStorage.
 * Unreadable changes are kept aside, and loading continues without them.
 */
export function loadLibrary(): Promise<StoredLibrary> {
  return navigator.locks.request(LOAD_LOCK, async () => {
    const storage = globalThis.localStorage;
    const keys = storage ? Array.from({ length: storage.length }, (_, i) => storage.key(i) ?? "") : [];
    for (const key of keys.filter((k) => k === LEGACY_SHARED_KEY || k.startsWith(TAB_KEY))) {
      await navigator.locks.request(key, { ifAvailable: true }, (lock) => lock && recover(key));
    }
    const db = await openDb();
    const tx = db.transaction([GUIDES, META], "readonly");
    const [guides, session] = await Promise.all([
      result<unknown[]>(tx.objectStore(GUIDES).getAll()),
      result<unknown>(tx.objectStore(META).get(SESSION_KEY)),
    ]);
    if (!Array.isArray(guides) || !guides.every(isGuide)) {
      const invalid: unknown = Array.isArray(guides) ? guides.find((guide: unknown) => !isGuide(guide)) : undefined;
      const id = isObject(invalid) && typeof invalid.id === "string" ? ` "${invalid.id}"` : "";
      throw new Error(`Invalid stored guide${id} in browser storage`);
    }
    if (session !== undefined && !isSession(session)) throw new Error("Invalid stored session in browser storage");
    const library: StoredLibrary = { guides: guides.sort((a, b) => a.order - b.order) };
    if (session) library.session = session;
    return library;
  });
}

/** Writes changed guides, deletes removed ones, and saves the session in one transaction. */
export async function saveLibrary(put: GuideRecord[], remove: string[], session?: StoredSession): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([GUIDES, META], "readwrite");
  const guides = tx.objectStore(GUIDES);
  for (const guide of put) guides.put(guide);
  for (const id of remove) guides.delete(id);
  if (session) tx.objectStore(META).put(session, SESSION_KEY);
  await done(tx);
}

export async function loadSetting(key: string): Promise<unknown> {
  const db = await openDb();
  return result(db.transaction(META, "readonly").objectStore(META).get(`setting:${key}`));
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(META, "readwrite");
  tx.objectStore(META).put(value, `setting:${key}`);
  await done(tx);
}

/** `outdated`: a newer planner upgraded the database, so this page cannot save until it reloads. */
export type SaveStatus = "saved" | "pending" | "error" | "outdated";

// IndexedDB rejects an open with this error when the stored database has a higher version.
const outdated = (error: unknown) => error instanceof DOMException && error.name === "VersionError";

export interface AutosaveSource {
  subscribe(listener: () => void): () => void;
  snapshot(): { guides: ReadonlyMap<string, GuideRecord>; session: StoredSession };
}

export interface Autosave {
  flush(): void;
  /** Resolves when every save started so far has finished. It never rejects. */
  settled(): Promise<void>;
  /**
   * Writes pending changes to localStorage at once, for a page that is about
   * to unload. Returns false if they could not be kept, for example because
   * localStorage is full.
   */
  saveBeforeLeaving(): boolean;
  stop(): void;
}

/**
 * Saves the library after changes settle for `delay` ms. Guides are compared
 * by object identity, so records must be replaced, not mutated, when they
 * change. `initial` holds what the database already contains.
 */
export function startAutosave(
  source: AutosaveSource,
  initial: StoredLibrary,
  onStatus: (status: SaveStatus, error?: unknown) => void = () => {},
  delay = 400,
): Autosave {
  let saved = new Map(initial.guides.map((g) => [g.id, g]));
  let savedSession = JSON.stringify(initial.session ?? null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  const key = `${TAB_KEY}${crypto.randomUUID()}`;
  let unlock!: () => void;
  const locked = new Promise<void>((resolve) => (unlock = resolve));
  navigator.locks
    .request(key, () => locked)
    .catch((error: unknown) => console.error("Could not lock unsaved changes; another tab may save them first", error));

  const pending = () => {
    const { guides, session } = source.snapshot();
    const put = [...guides.values()].filter((g) => saved.get(g.id) !== g);
    const remove = [...saved.keys()].filter((id) => !guides.has(id));
    const sessionText = JSON.stringify(session);
    const changes: Changes = { put, remove };
    if (sessionText !== savedSession) changes.session = session;
    const empty = put.length === 0 && remove.length === 0 && !changes.session;
    return { guides, sessionText, changes: empty ? null : changes };
  };

  const save = async () => {
    const { guides, sessionText, changes } = pending();
    if (changes) {
      await saveLibrary(changes.put, changes.remove, changes.session);
      saved = new Map(guides);
      savedSession = sessionText;
    }
    if (!pending().changes) globalThis.localStorage?.removeItem(key);
  };

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const run: Promise<void> = running.then(save).then(
      () => onStatus(timer || running !== run ? "pending" : "saved"),
      (error: unknown) => onStatus(outdated(error) ? "outdated" : "error", error),
    );
    running = run;
  };

  const unsubscribe = source.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
    onStatus("pending");
  });

  return {
    flush,
    settled: () => running,
    saveBeforeLeaving() {
      const { changes } = pending();
      if (!changes) return true;
      try {
        localStorage.setItem(key, JSON.stringify(changes));
        return true;
      } catch (error) {
        onStatus("error", error);
        return false;
      }
    },
    stop() {
      unsubscribe();
      clearTimeout(timer);
      unlock();
    },
  };
}
