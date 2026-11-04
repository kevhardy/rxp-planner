import { DEFAULT_MODES } from "../../routing/plan.ts";
import { loadSaved, saveSaved, type SavedSetting } from "../savedSetting.ts";

export const DEFAULT_MODE = "Run";

const SAVED: SavedSetting<{ mode: string }> = {
  key: "routeMode",
  unsavedKey: "restedxp-planner:unsaved-route-mode",
  read: (saved) => {
    const mode = (saved as { mode?: unknown } | null | undefined)?.mode;
    return { mode: DEFAULT_MODES.some((m) => m.name === mode) ? (mode as string) : DEFAULT_MODE };
  },
  defaults: { mode: DEFAULT_MODE },
  name: "the travel mode",
};

export async function loadTravelMode(): Promise<string> {
  return (await loadSaved(SAVED)).mode;
}

export function saveTravelMode(mode: string): void {
  saveSaved(SAVED, { mode });
}
