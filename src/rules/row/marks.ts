import { cropKey, textureKey, type CropKey, type GuideIconKey, type TextureKey } from "../../../packages/data-contract/guideIcons.ts";
import type { TexturePart } from "../../guide/index.ts";

export interface MarkSpec {
  name: string;
  texture?: GuideIconKey;
  /** An inventory icon, whose dark frame the mark crops. */
  framed?: true;
}

function tex(path: string): TextureKey {
  return textureKey(path)!;
}

/** A cell of `interface/minimap/poiicons`, at the texture coordinates that RXP's `addon.icons` in `functions.lua` gives WoW Forever. */
function poi(left: number, right: number): CropKey {
  return cropKey(136441, { width: 128, height: 128, left, right, top: 0, bottom: 4 })!;
}

/** Each key is also the CSS class `mk-<kind>`, which sets the kind's color. */
export const MARKS = {
  accept: { name: "Accept", texture: tex("interface/gossipframe/availablequesticon") },
  daily: { name: "Accept daily", texture: tex("interface/gossipframe/dailyquesticon") },
  turnin: { name: "Turn in", texture: tex("interface/gossipframe/activequesticon") },
  dailyturnin: { name: "Turn in daily", texture: tex("interface/gossipframe/dailyactivequesticon") },
  complete: { name: "Objective" },
  collect: { name: "Collect", texture: tex("interface/gossipframe/vendorgossipicon") },
  kill: { name: "Kill", texture: tex("interface/cursor/attack") },
  xp: { name: "Grind", texture: tex("interface/petbattles/battlebar-abilitybadge-strong-small") },
  hs: { name: "Hearthstone", texture: tex("interface/icons/inv_misc_rune_01"), framed: true },
  home: { name: "Set hearth", texture: poi(45, 54) },
  goto: { name: "Go to", texture: poi(63, 72) },
  path: { name: "Map path", texture: tex("interface/icons/inv_misc_map_01"), framed: true },
  target: { name: "Target" },
  train: { name: "Train", texture: tex("interface/gossipframe/trainergossipicon") },
  trainer: { name: "Trainer", texture: tex("interface/gossipframe/trainergossipicon") },
  vendor: { name: "Vendor", texture: tex("interface/gossipframe/bankergossipicon") },
  buy: { name: "Buy", texture: tex("interface/gossipframe/auctioneergossipicon") },
  bank: { name: "Bank", texture: tex("interface/minimap/tracking/banker") },
  fly: { name: "Fly", texture: tex("interface/gossipframe/taxigossipicon") },
  fp: { name: "Flight path", texture: tex("interface/minimap/tracking/flightmaster") },
  use: { name: "Use" },
  equip: { name: "Equip", texture: tex("interface/paperdollinfoframe/ui-equipmentmanager-toggle") },
  destroy: { name: "Destroy", texture: tex("interface/raidframe/readycheck-notready") },
  cast: { name: "Cast" },
  abandon: { name: "Abandon", texture: tex("interface/buttons/ui-grouploot-pass-up") },
  tame: { name: "Tame", texture: tex("interface/icons/ability_hunter_beasttaming"), framed: true },
  stable: { name: "Stable", texture: tex("interface/minimap/tracking/stablemaster") },
  gossip: { name: "Gossip option", texture: tex("interface/gossipframe/gossipgossipicon") },
  emote: { name: "Emote", texture: tex("interface/gossipframe/petitiongossipicon") },
  vehicle: { name: "Vehicle", texture: tex("interface/cursor/vehichlecursor") },
  engrave: { name: "Engrave", texture: tex("interface/icons/inv_misc_rune_06"), framed: true },
  reputation: { name: "Reputation", texture: tex("interface/icons/achievement_reputation_01"), framed: true },
  skill: { name: "Skill", texture: tex("interface/minimap/tracking/profession") },
  next: { name: "Open the next guide", texture: tex("interface/tooltips/reforgegreenarrow") },
  check: { name: "Check" },
  setting: { name: "Setting" },
  note: { name: "Note" },
  tag: { name: "Tag" },
  checkpoint: { name: "Assume" },
  deathskip: { name: "Spirit healer", texture: poi(72, 81) },
  other: { name: "Other" },
} as const satisfies Record<string, MarkSpec>;

export type MarkKind = keyof typeof MARKS;

export type MarkRef = { kind: MarkKind } | { icon: TexturePart };

/** The textures that marks draw, each once and sorted. */
export function markTextureKeys(): GuideIconKey[] {
  const specs: readonly MarkSpec[] = Object.values(MARKS);
  return [...new Set(specs.flatMap((mark) => (mark.texture ? [mark.texture] : [])))].sort();
}
