import { TIMELINE_MODEL } from "./model.ts";

interface NumberSpec {
  kind: "number";
  label: string;
  description: string;
  /** Shown after the field, such as "s". */
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

interface ToggleSpec {
  kind: "toggle";
  label: string;
  description: string;
  default: boolean;
}

export type PlaybackSettingSpec = NumberSpec | ToggleSpec;

const PLAYBACK_SETTINGS = {
  respawn: {
    kind: "number",
    label: "Mob respawn",
    description: "Seconds until a killed mob respawns. A guide's -- @sim respawn= overrides it.",
    unit: "s",
    min: 1,
    max: 1800,
    step: 1,
    default: TIMELINE_MODEL.respawn.value,
  },
  area: {
    kind: "number",
    label: "Kill area",
    description:
      "A step's kills stay this close to its -- @sim near= point, else to where the character stands at the first kill. A guide's -- @sim area= overrides it.",
    unit: "yd",
    min: 1,
    max: 5000,
    step: 1,
    default: TIMELINE_MODEL.killArea.value,
  },
  ignoreDeathskip: {
    kind: "toggle",
    label: "Ignore death skips",
    description: "The character stays where it died and walks on from there.",
    default: false,
  },
} as const satisfies Record<string, PlaybackSettingSpec>;

export type PlaybackSettingKey = keyof typeof PLAYBACK_SETTINGS;

type SpecValue<S extends PlaybackSettingSpec> = S extends NumberSpec ? number : boolean;

export type PlaybackSettings = { readonly [K in PlaybackSettingKey]: SpecValue<(typeof PLAYBACK_SETTINGS)[K]> };

/** The saved form: only valid values that differ from the default. */
export type PlaybackChoices = Partial<PlaybackSettings>;

/** The registry's entries, in menu order. */
export const PLAYBACK_SETTING_ENTRIES = Object.entries(PLAYBACK_SETTINGS) as [PlaybackSettingKey, PlaybackSettingSpec][];

const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = Object.freeze(
  Object.fromEntries(PLAYBACK_SETTING_ENTRIES.map(([key, spec]) => [key, spec.default])) as PlaybackSettings,
);

export function fitsSetting(spec: PlaybackSettingSpec, value: unknown): boolean {
  switch (spec.kind) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) && value >= spec.min && value <= spec.max;
    case "toggle":
      return typeof value === "boolean";
  }
}

/** Keeps each known setting whose value fits its spec and differs from the default. */
export function readPlaybackChoices(saved: unknown): PlaybackChoices {
  const s = (typeof saved === "object" && saved !== null ? saved : {}) as Record<string, unknown>;
  const choices: Record<string, unknown> = {};
  for (const [key, spec] of PLAYBACK_SETTING_ENTRIES) if (fitsSetting(spec, s[key]) && s[key] !== spec.default) choices[key] = s[key];
  return choices;
}

export function resolvePlaybackSettings(choices: PlaybackChoices): PlaybackSettings {
  return Object.freeze({ ...DEFAULT_PLAYBACK_SETTINGS, ...choices });
}
