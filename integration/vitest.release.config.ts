import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { validateInstalled } from "../scripts/dataset/local.ts";
import { appVersion } from "../scripts/version.ts";

export default defineConfig(async () => {
  const { location } = await validateInstalled();
  return {
    plugins: [react()],
    define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(JSON.stringify(appVersion({ tag: undefined, commit: undefined }))) },
    test: {
      reporters: ["minimal"],
      include: ["src/**/*.release.test.{ts,tsx}"],
      env: { RXP_RELEASE_MANIFEST: location.manifest, RXP_RELEASE_BASE: location.base },
      setupFiles: ["src/app/testSetup.ts"],
      css: { include: [/\/src\/app\/theme\/tokens\.css\?raw$/] },
      fileParallelism: false,
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  };
});
