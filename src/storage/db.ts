// The planner's former name. A new name would open an empty database and lose every saved guide.
const DB_NAME = "restedxp-planner";
const VERSION = 6;

export const GUIDES = "guides";
export const META = "meta";
export const ROUTE_PLANS = "routePlans";

function dropPixelRoutes(db: IDBDatabase): void {
  for (const name of [ROUTE_PLANS, "routingDrafts"]) if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
  db.createObjectStore(ROUTE_PLANS, { keyPath: "id" });
}

let opening: Promise<IDBDatabase> | undefined;
let blocked = () => console.warn("Waiting for other planner tabs to close before upgrading browser storage");

/** Sets what to do while another tab blocks an upgrade. The open completes when that tab closes the database. */
export function onUpgradeBlocked(listener: () => void): void {
  blocked = listener;
}

export function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore(GUIDES, { keyPath: "id" });
        db.createObjectStore(META);
      }
      if (event.oldVersion < 6) dropPixelRoutes(db);
    };
    request.onblocked = () => blocked();
    request.onsuccess = () => {
      const db = request.result;
      // Lets a tab with a newer version upgrade; the next call here opens again.
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
