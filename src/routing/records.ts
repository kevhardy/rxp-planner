import { DEFAULT_MODES, LEG_KEYS, type Leg, type MovementMode, type PlanSettings, type RoutePlan, type WorldStop } from "./plan.ts";
import { fail, fields, isObject, list } from "./shape.ts";

export function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Not valid JSON: ${(error as Error).message}`, { cause: error });
  }
}

function positive(value: unknown, path: string, max: number): number {
  if (typeof value !== "number" || !(value > 0 && value <= max)) fail(path, `expected a number above 0 and at most ${max}`);
  return value;
}

const MODE_NAMES = DEFAULT_MODES.map((mode) => mode.name);

function readModes(value: unknown, path: string): MovementMode[] {
  const modes = list(value, path, MODE_NAMES.length).map((entry, i) => {
    const at = `${path}[${i}]`;
    const mode = fields(entry, at, ["name", "speed", "activation"]);
    if (mode.name !== MODE_NAMES[i]) fail(`${at}.name`, `expected "${MODE_NAMES[i]}"`);
    const activation = mode.activation;
    if (typeof activation !== "number" || !(activation >= 0 && activation <= 300))
      fail(`${at}.activation`, "expected a number from 0 to 300");
    return { name: MODE_NAMES[i] as string, speed: positive(mode.speed, `${at}.speed`, 100), activation };
  });
  if (modes.length !== MODE_NAMES.length) fail(path, `expected ${MODE_NAMES.join(", ")}`);
  return modes;
}

function readSwimming(value: unknown, path: string): PlanSettings["swimming"] {
  const swim = fields(value, path, ["enabled", "speed"]);
  if (typeof swim.enabled !== "boolean") fail(`${path}.enabled`, "expected true or false");
  return { enabled: swim.enabled, speed: positive(swim.speed, `${path}.speed`, 100) };
}

function readStop(value: unknown, path: string): WorldStop {
  if (!isObject(value)) fail(path, "expected a world stop { instance, x, y, height }");
  const stop = fields(value, path, ["instance", "x", "y", "height"]);
  if (!Number.isSafeInteger(stop.instance) || (stop.instance as number) < 0) fail(`${path}.instance`, "expected a map ID from 0");
  for (const axis of ["x", "y"] as const)
    if (typeof stop[axis] !== "number" || !Number.isFinite(stop[axis])) fail(`${path}.${axis}`, "expected finite world yards");
  if (stop.height !== null && (typeof stop.height !== "number" || !Number.isFinite(stop.height)))
    fail(`${path}.height`, "expected a number of yards or null");
  return { instance: stop.instance as number, x: stop.x as number, y: stop.y as number, height: stop.height };
}

/** Reads the stops, legs, and settings of a saved plan or of route text from `root`, with at most `maxStops` stops. */
export function readPlanParts(root: Record<string, unknown>, path: string, maxStops: number): Omit<RoutePlan, "id"> {
  const stops = list(root.stops, `${path}.stops`, maxStops).map((value, i) => readStop(value, `${path}.stops[${i}]`));
  if (stops.length < 2) fail(`${path}.stops`, "expected a start and a destination");
  const legs = list(root.legs, `${path}.legs`, maxStops).map((value, i): Leg => {
    const at = `${path}.legs[${i}]`;
    const leg = fields(value, at, LEG_KEYS);
    for (const key of LEG_KEYS) if (typeof leg[key] !== "boolean") fail(`${at}.${key}`, "expected true or false");
    return Object.fromEntries(LEG_KEYS.map((key) => [key, leg[key]])) as Record<keyof Leg, boolean>;
  });
  if (legs.length !== stops.length - 1) fail(`${path}.legs`, `expected ${stops.length - 1} legs`);
  const settings = fields(root.settings, `${path}.settings`, ["swimming", "modes"]);
  return {
    stops,
    legs,
    settings: {
      swimming: readSwimming(settings.swimming, `${path}.settings.swimming`),
      modes: readModes(settings.modes, `${path}.settings.modes`),
    },
  };
}
