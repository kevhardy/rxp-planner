import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Global styles first, so component styles win ties.
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./app/theme/tokens.css";
import "./app/ui/ui.css";
import "./app/styles.css";
import { App } from "./app/App.tsx";
import { fetchBuiltins } from "./io/index.ts";
import { startPage } from "./app/page.ts";
import { createStores, loadSettings } from "./app/stores.ts";
import { onUpgradeBlocked } from "./storage/db.ts";
import { loadLibrary } from "./storage/index.ts";
import { errorText } from "./data/errorText.ts";

const root = createRoot(document.getElementById("root")!);
let stopPage: (() => void) | undefined;

onUpgradeBlocked(() => {
  stopPage?.();
  root.render(
    <p className="fatal" role="alert">
      Close or reload other planner tabs. The planner is updating browser storage and starts when they close.
    </p>,
  );
});

Promise.all([loadLibrary(), fetchBuiltins(), loadSettings()]).then(
  ([library, builtins, settings]) => {
    const stores = createStores(library, builtins, settings);
    stopPage = startPage(stores, {
      manifest: `${import.meta.env.BASE_URL}dataset/manifest.json`,
      base: `${import.meta.env.BASE_URL}dataset/`,
      manifestHash: import.meta.env.VITE_DATASET_MANIFEST_HASH,
    });
    root.render(
      <StrictMode>
        <App stores={stores} />
      </StrictMode>,
    );
  },
  (error: unknown) =>
    root.render(
      <p className="fatal" role="alert">
        Could not load browser storage. Your saved guides remain stored and have not been deleted. Do not clear site data.{" "}
        {errorText(error)}
      </p>,
    ),
);
