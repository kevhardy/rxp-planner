import { decodeDatasetManifest, loadDataset, type DatasetLocation, type LoadedDataset } from "./dataset.ts";

import { readFile, realpath } from "node:fs/promises";
import { join, relative, sep, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

export async function readDataset(location: DatasetLocation): Promise<LoadedDataset> {
  try {
    const base = await realpath(location.base);
    const manifest = await decodeDatasetManifest(new Uint8Array(await readFile(location.manifest)), location.manifestHash);
    return await loadDataset(
      manifest,
      async (path) => {
        const file = await realpath(join(base, path));
        const rel = relative(base, file);
        if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Asset escapes dataset base: ${path}`);
        return new Uint8Array(await readFile(file));
      },
      pathToFileURL(base + sep).href,
    );
  } catch (cause) {
    throw new Error(`Could not load dataset ${location.manifest}: ${String(cause)}`, { cause });
  }
}
