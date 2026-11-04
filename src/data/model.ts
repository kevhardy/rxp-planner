export type * from "../../packages/data-contract/model.ts";

/** WoW class bits in `Quest.requiredClassMask`, keyed by RXP class token. */
export const CLASS_BITS = {
  WARRIOR: 1,
  PALADIN: 2,
  HUNTER: 4,
  ROGUE: 8,
  PRIEST: 16,
  SHAMAN: 64,
  MAGE: 128,
  WARLOCK: 256,
  DRUID: 1024,
} as const;
