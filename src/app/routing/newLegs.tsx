import { DEFAULT_LEG, LEG_KEYS, type Leg } from "../../routing/plan.ts";
import { PopoverMenu } from "../map/PopoverMenu.tsx";
import { loadSaved, saveSaved, type SavedSetting } from "../savedSetting.ts";
import { LegSettings } from "./RouteResult.tsx";

const SAVED: SavedSetting<Leg> = {
  key: "route-new-legs",
  unsavedKey: "restedxp-planner:unsaved-route-new-legs",
  read: (saved) => {
    const value: Partial<Record<keyof Leg, unknown>> = typeof saved === "object" && saved !== null ? saved : {};
    const leg = { ...DEFAULT_LEG };
    for (const name of LEG_KEYS) {
      const on = value[name];
      if (typeof on === "boolean") leg[name] = on;
    }
    return leg;
  },
  defaults: DEFAULT_LEG,
  name: "the settings for new legs",
};

export const loadNewLegs = (): Promise<Leg> => loadSaved(SAVED);
export const saveNewLegs = (leg: Leg): void => saveSaved(SAVED, leg);

export function NewLegsMenu(props: { leg: Leg; onChange: (leg: Leg) => void }) {
  const { leg } = props;
  return (
    <PopoverMenu className="route-menu route-new-legs" label="New legs" description="Settings each new leg starts with">
      <LegSettings leg={leg} onChange={(change) => props.onChange({ ...leg, ...change })} />
      <p className="muted">Legs that exist keep their own settings.</p>
    </PopoverMenu>
  );
}
