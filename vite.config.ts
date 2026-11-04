import { localDataset } from "./scripts/dataset/vite.ts";
import { appVersion, readCommit } from "./scripts/version.ts";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [localDataset(), react()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(
      JSON.stringify(appVersion({ tag: process.env.APP_VERSION, commit: readCommit(import.meta.dirname) })),
    ),
  },
  test: {
    reporters: ["minimal"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts", "packages/oxlint-plugin-rxpplanner/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.routing.test.ts", "**/*.release.test.{ts,tsx}"],
    setupFiles: ["src/app/testSetup.ts"],
    // Vitest empties every CSS import that this does not match, `?raw` too, and `vars` reads the token names from tokens.css.
    css: { include: [/\/src\/app\/theme\/tokens\.css\?raw$/] },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
