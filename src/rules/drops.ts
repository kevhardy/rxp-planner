import type { Dropper } from "../data/index.ts";

export type DropSource =
  | ({ kind: "guaranteed" } & NonNullable<Dropper["guaranteed"]>)
  | { kind: "estimated" }
  | { kind: "default" }
  | { kind: "override" };

export interface DropChance {
  /** Above 0, at most 1. */
  value: number;
  source: DropSource;
}

const DEFAULT_DROP_CHANCE = 0.5;

export const MIN_DROP_CHANCE = 0.01;

export function dropChance(dropper: Pick<Dropper, "chance" | "guaranteed"> | undefined): DropChance {
  if (dropper?.guaranteed) return { value: 1, source: { kind: "guaranteed", source: dropper.guaranteed.source } };
  if (dropper?.chance !== undefined) return { value: dropper.chance, source: { kind: "estimated" } };
  return { value: DEFAULT_DROP_CHANCE, source: { kind: "default" } };
}

/**
 * Expected items within this of a whole number count as that number. Kills
 * add their chances as floats, so 10 kills at 0.3 give 2.9999999999999996.
 */
export const ITEM_TOLERANCE = 1e-9;
