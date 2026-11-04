import { decodeJson } from "../data/index.ts";
import { extractGuides, type GuideRecord } from "../guide/index.ts";
import { registerArgs } from "./addon.ts";

export const BUILTIN_PATH = "data/rxp-forever.json.gz";

/** Contents of the built-in guide file: RXP's Lua files in load order. */
export interface BuiltinFile {
  /** RestedXP Guides version, from `RXPGuides.toc`. */
  version: string;
  files: { name: string; source: string }[];
}

export interface Builtins {
  version: string;
  /**
   * Library records in load order. IDs are `rxp:<file>#<n>`, where `n` is the
   * guide's 1-based position in its file; `order` is its position overall.
   */
  guides: GuideRecord[];
}

/**
 * Fetches and decodes the built-in guides. Returns `null` and logs a warning
 * when they cannot be loaded, so the app can start without them.
 */
export async function fetchBuiltins(): Promise<Builtins | null> {
  const url = `${import.meta.env.BASE_URL}${BUILTIN_PATH}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await decodeBuiltins(await response.arrayBuffer());
  } catch (error) {
    console.warn(`Could not load the built-in guides from ${url}:`, error);
    return null;
  }
}

/** Decodes the built-in guide file into library records. Throws if it is malformed. */
export async function decodeBuiltins(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<Builtins> {
  const { version, files } = checkFile(await decodeJson(bytes));
  let order = 0;
  const guides = files.flatMap(({ name, source }) =>
    extractGuides(source).map(({ text, group, defaultFor }, i) => {
      const guide: GuideRecord = { id: `rxp:${name}#${i + 1}`, text, order: order++ };
      if (group !== undefined) guide.registerArgs = registerArgs(group, defaultFor);
      guide.fileName = name;
      return guide;
    }),
  );
  return { version, guides };
}

function checkFile(data: unknown): BuiltinFile {
  const file = data as Partial<BuiltinFile> | null;
  if (typeof file?.version !== "string" || !file.version || !Array.isArray(file.files)) {
    throw new Error("Built-in guide file lacks a version or file list.");
  }
  const names = new Set<string>();
  for (const f of file.files as unknown[]) {
    const { name, source } = (f ?? {}) as Partial<BuiltinFile["files"][number]>;
    if (typeof name !== "string" || !name || typeof source !== "string") {
      throw new Error("Built-in guide file has a file without a name or source.");
    }
    if (names.has(name)) throw new Error(`Built-in guide file lists ${name} twice.`);
    names.add(name);
  }
  return file as BuiltinFile;
}
