// This module starts no worker. Vite cannot build a worker that imports a
// module which starts another worker, as engine.ts does.

import type { InstanceId } from "../../data/index.ts";
import { fetchAssets, loadArtifact, parseBundleRouting, type ArtifactLoad, type RoutingPin } from "../../routing/artifact.ts";
import { loadStopTable, seedStopKeys, STOP_TABLE_FILE } from "../../routing/stop-table.ts";
import { createTerrain, type Terrain, type TileCache } from "../../routing/terrain.ts";

async function installedPins(): Promise<RoutingPin[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}bundle.json`, { cache: "no-cache" }).catch(() => undefined);
  if (!response?.ok)
    throw new Error(
      `Routing data is not installed. Run pnpm data:install. (bundle.json: ${response ? `HTTP ${response.status}` : "no response"})`,
    );
  return parseBundleRouting(await response.json());
}

export const openArtifacts = async (): Promise<{ pin: RoutingPin; load: ArtifactLoad }[]> =>
  Promise.all(
    (await installedPins()).map(async (pin) => {
      const assets = fetchAssets(`${import.meta.env.BASE_URL}routing/m${pin.map}/`);
      return { pin, load: await loadArtifact(assets, pin) };
    }),
  );

export async function openTerrains(cache?: TileCache): Promise<Map<InstanceId, Terrain>> {
  const terrains = new Map<InstanceId, Terrain>();
  const [table, artifacts] = await Promise.all([
    loadStopTable(STOP_TABLE_FILE, async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}${STOP_TABLE_FILE}`, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }),
    openArtifacts(),
  ]);
  for (const { pin, load } of artifacts)
    if (load.ok) {
      const terrain = createTerrain(load.artifact, cache);
      if (table) seedStopKeys(table, pin.map, load.artifact.manifest.id, terrain);
      terrains.set(pin.map, terrain);
    }
  return terrains;
}
