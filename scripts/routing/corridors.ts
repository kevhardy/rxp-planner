import type { Point } from "../../src/routing/frame.ts";
import { fail, fields, list } from "../../src/routing/artifact.ts";
import { MODE_NAMES, MODES, type Mode, type RoutedCorridor } from "../../src/routing/calibration.ts";
import { DEFAULT_LEG, DEFAULT_MAX_SLOPE, DEFAULT_MODES, DEFAULT_SWIM_SPEED } from "../../src/routing/plan.ts";
import { routeOf } from "../../src/routing/journey.ts";
import { routeLeg } from "../../src/routing/search.ts";
import type { Terrain } from "../../src/routing/terrain.ts";

export interface CorridorCases {
  /** False to route without swimming; true by default. */
  swimming?: boolean;
  /** False to route without downhill shortcuts; true by default. */
  downhill?: boolean;
  /** Routes from `from` to `to`. Without `mode`, in each mode. */
  corridors?: { name: string; from: Point; to: Point; mode?: Mode }[];
}

export async function routeCorridors(terrain: Terrain, value: unknown) {
  const cases = parseCases(value);
  const settings = {
    maxSlope: DEFAULT_MAX_SLOPE,
    swimming: { enabled: cases.swimming ?? true, speed: DEFAULT_SWIM_SPEED },
    leg: { ...DEFAULT_LEG, downhill: cases.downhill ?? DEFAULT_LEG.downhill },
  };
  const round = (n: number) => Math.round(n * 100) / 100;
  const corridors: RoutedCorridor[] = [];
  for (const corridor of cases.corridors ?? []) {
    const runs: RoutedCorridor["runs"] = [];
    for (const mode of corridor.mode ? [corridor.mode] : MODES) {
      const movement = DEFAULT_MODES.find((m) => m.name === MODE_NAMES[mode])!;
      const { maxSlope, swimming, leg } = settings;
      const result = await routeLeg(terrain, corridor.from, corridor.to, leg, { maxSlope, swimming, mode: movement });
      const route = routeOf(result);
      runs.push({
        mode,
        estimate: {
          kind: result.kind,
          ...(route && result.kind !== "route" && { provisional: true }),
          ...(route && { seconds: round(route.seconds), distance: round(route.distance + route.swimDistance) }),
        },
      });
    }
    corridors.push({ name: corridor.name, from: corridor.from, to: corridor.to, runs });
  }
  return { settings, corridors };
}

function parseCases(value: unknown): CorridorCases {
  const root = fields(value, "cases", [], ["swimming", "downhill", "corridors"]);
  const point = (p: unknown, path: string): Point => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => Number.isInteger(n) && n >= 0 && n <= 32767))
      fail(path, "expected [x, y] integer native pixels from 0 to 32767");
    return p as Point;
  };
  const cases: CorridorCases = {};
  for (const key of ["swimming", "downhill"] as const)
    if (key in root) {
      if (typeof root[key] !== "boolean") fail(`cases.${key}`, "expected true or false");
      cases[key] = root[key];
    }
  if ("corridors" in root)
    cases.corridors = list(root.corridors, "cases.corridors").map((c, i) => {
      const at = `cases.corridors[${i}]`;
      const corridor = fields(c, at, ["name", "from", "to"], ["mode"]);
      if (typeof corridor.name !== "string" || !corridor.name.trim()) fail(`${at}.name`, "expected text");
      if ("mode" in corridor && !MODES.includes(corridor.mode as Mode)) fail(`${at}.mode`, `expected one of ${MODES.join(", ")}`);
      return {
        name: corridor.name,
        from: point(corridor.from, `${at}.from`),
        to: point(corridor.to, `${at}.to`),
        ...("mode" in corridor && { mode: corridor.mode as Mode }),
      };
    });
  return cases;
}
