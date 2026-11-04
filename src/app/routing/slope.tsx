import { useState } from "react";
import { DEFAULT_MAX_SLOPE } from "../../routing/plan.ts";
import { useTimeout } from "../effects.ts";
import { loadSaved, saveSaved, type SavedSetting } from "../savedSetting.ts";
import { Field, Input } from "../ui/Field.tsx";

const MIN_SLOPE = 1;
const MAX_SLOPE = 89;
const SETTLE = 300;

function readSlope(text: string): number | undefined {
  const n = text.trim() === "" ? NaN : Number(text);
  return Number.isFinite(n) ? Math.min(MAX_SLOPE, Math.max(MIN_SLOPE, Math.round(n))) : undefined;
}

const valid = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= MIN_SLOPE && (n as number) <= MAX_SLOPE;

const SAVED: SavedSetting<{ maxSlope: number }> = {
  key: "routes",
  unsavedKey: "restedxp-planner:unsaved-routes",
  read: (saved) => {
    const maxSlope = (saved as { maxSlope?: unknown } | null | undefined)?.maxSlope;
    return { maxSlope: valid(maxSlope) ? maxSlope : DEFAULT_MAX_SLOPE };
  },
  defaults: { maxSlope: DEFAULT_MAX_SLOPE },
  name: "the route settings",
};

export async function loadMaxSlope(): Promise<number> {
  return (await loadSaved(SAVED)).maxSlope;
}

export function saveMaxSlope(maxSlope: number): void {
  saveSaved(SAVED, { maxSlope });
}

export function SlopeField(props: { value: number; onChange: (maxSlope: number) => void }) {
  const { value, onChange } = props;
  const [text, setText] = useState<string | null>(null);
  const slope = text === null ? undefined : readSlope(text);
  const settling = slope !== undefined && slope !== value;
  useTimeout(() => settling && onChange(slope), settling ? SETTLE : null, text);
  const apply = () => {
    if (settling) onChange(slope);
    setText(null);
  };
  return (
    <Field label="Max slope" description="Steepest ground a route walks on, 1° to 89°" className="route-slope">
      <Input
        type="number"
        mono
        className="slope-degrees"
        aria-label="Max slope in degrees"
        min={MIN_SLOPE}
        max={MAX_SLOPE}
        step={1}
        value={text ?? value}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
        }}
      />
      °
    </Field>
  );
}
