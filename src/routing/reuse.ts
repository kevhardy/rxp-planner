import type { LegUpdate } from "./journey.ts";
import { keepNewest } from "./kept.ts";
import { resolvedOn, type NativeFrame, type Point } from "./frame.ts";
import type { Leg, RoutePlan } from "./plan.ts";
import type { LegRequest, LegResult } from "./search.ts";
import type { Rides } from "./transport.ts";

export const GROUND_SETTINGS = [
  "followTerrain",
  "downhill",
  "damagingFalls",
  "fatalFalls",
  "hazards",
] as const satisfies readonly (keyof Leg)[];
const groundSetting = (leg: Leg) => GROUND_SETTINGS.map((name) => leg[name]);

const ends = (from: Point, to: Point) => `${from.join()}>${to.join()}|`;

export function searchKey(from: Point, to: Point, leg: Leg, request: LegRequest, groundKey: string): string {
  return ends(from, to) + JSON.stringify([groundKey, groundSetting(leg), request]);
}

export function noPathKey(from: Point, to: Point, leg: Leg, request: LegRequest, groundKey: string): string {
  return (
    ends(from, to) +
    JSON.stringify([groundKey, groundSetting(leg), { ...request, mode: undefined, active: undefined, continues: undefined }])
  );
}

export const PAGE_RECORDS = 256;
export const SEARCH_RECORDS = 2048;

export interface RecentRecords {
  keep: (key: string, result: LegResult) => void;
  keepUpdates(updates: readonly LegUpdate[]): void;
  /** The records between stops of `plan` on `frames` and ride stops. A plan with a stop off `frames` gives none of its stops. */
  atStops(plan: RoutePlan, frames: readonly NativeFrame[], rides?: Rides): [string, LegResult][];
  merged: (known?: ReadonlyMap<string, LegResult>) => Map<string, LegResult>;
}

export function recentRecords(limit: number): RecentRecords {
  const records = new Map<string, LegResult>();
  const keep = (key: string, result: LegResult) => {
    records.delete(key);
    keepNewest(records, key, result, limit);
  };
  return {
    keep,
    keepUpdates(updates) {
      for (const update of updates) {
        if ("key" in update && update.key !== undefined) keep(update.key, update.result);
        if (update.result.kind === "transport")
          for (const part of update.result.parts) if (part.kind === "ground" && part.key !== undefined) keep(part.key, part.result);
      }
    },
    atStops(plan, frames, rides) {
      const stops = new Set(
        [...(resolvedOn(frames, plan)?.stops ?? []), ...(rides?.links ?? []).flatMap((link) => [link.from.point, link.to.point])].map((p) =>
          p.join(),
        ),
      );
      return [...records].filter(([key]) => {
        const [from, to] = key.slice(0, key.indexOf("|")).split(">");
        return stops.has(from!) && stops.has(to!);
      });
    },
    merged: (known) => new Map([...records, ...(known ?? [])]),
  };
}
