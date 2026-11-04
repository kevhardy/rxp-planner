import { defineConfig } from "vitest/config";
import { DATA_DIR, installedMaps } from "../scripts/dataset/local.ts";
import { installedArtifact } from "../scripts/routing/installed.ts";

export default defineConfig(async () => {
  const maps = await installedMaps();
  if (!maps.length) throw new Error(`Routing tests need the release file in ${DATA_DIR}. Install it with pnpm data:install FILE.`);
  for (const map of maps) {
    try {
      await installedArtifact(map);
    } catch (cause) {
      throw new Error(
        `Routing tests need the artifact of map ${map} in ${DATA_DIR}: ${cause instanceof Error ? cause.message : String(cause)}. ` +
          `Install the release file again with pnpm data:install FILE.`,
        { cause },
      );
    }
  }
  return {
    test: {
      reporters: ["minimal"],
      include: ["src/**/*.routing.test.ts", "scripts/**/*.routing.test.ts"],
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  };
});
