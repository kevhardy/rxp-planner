import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentContext, Travel } from "../../src/agent/index.ts";
import { groundTravel } from "../../src/agent/travel.ts";
import type { AddonFile } from "../../src/io/index.ts";
import { decodeBuiltins } from "../../src/io/builtin.ts";
import { TILE_PIXELS } from "../../src/routing/artifact.ts";
import { floorHint } from "../../src/routing/floorHint.ts";
import { worldToNative, type Point } from "../../src/routing/frame.ts";
import { installedDataset } from "../dataset/local.ts";
import { BUILTIN_FILE } from "../guides/load-guides.ts";
import { openInstalled, travelCacheKey } from "../routing/installed.ts";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface HostOptions {
  out: string;
}

export async function loadAgentContext({ out }: HostOptions): Promise<AgentContext> {
  const started = performance.now();
  const { game, entities, manifest } = await installedDataset();
  const { guides } = await decodeBuiltins(new Uint8Array(await readFile(BUILTIN_FILE)));
  console.error(`Loaded dataset ${manifest.id} and ${guides.length} built-in guides in ${Math.round(performance.now() - started)} ms.`);

  const routings = new Map<number, Promise<Awaited<ReturnType<typeof openInstalled>> | undefined>>();
  const routing = (map: number) => {
    let opened = routings.get(map);
    if (!opened)
      routings.set(
        map,
        (opened = openInstalled(map).catch((error: unknown) => {
          console.error(`No routing for map ${map}: ${errorText(error)}`);
          return undefined;
        })),
      );
    return opened;
  };
  const legs = new Map<string, Promise<Travel | undefined>>();

  return {
    game,
    entities,
    guides,
    async save(files: readonly AddonFile[]) {
      return Promise.all(
        files.map(async ({ path, content }) => {
          const file = join(out, path);
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, content);
          return file;
        }),
      );
    },
    travel(from, to) {
      if (from.instance !== to.instance) return Promise.resolve(undefined);
      const key = travelCacheKey(from, to);
      let leg = legs.get(key);
      if (!leg) legs.set(key, (leg = routing(from.instance).then((opened) => opened && groundTravel(opened.terrain, from, to))));
      return leg;
    },
    async floorHint(at) {
      const opened = await routing(at.instance);
      const native = opened && worldToNative(opened.artifact.manifest, at);
      if (!opened || !native) return undefined;
      const point: Point = [Math.round(native[0]), Math.round(native[1])];
      return floorHint(await opened.terrain.region([point], TILE_PIXELS), point);
    },
  };
}
