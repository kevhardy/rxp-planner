import { textureKey, type GuideIconKey } from "../../packages/data-contract/guideIcons.ts";
import type { GuideIconCatalog, GuideIconEntry } from "../data/guideIcons.ts";
import { textureSize, type RxpTexture } from "../guide/index.ts";
import { MARKS, type MarkKind } from "../rules/index.ts";
// `no-inline` keeps each file a cached asset, so a mark's inline style holds a
// short URL and not the whole file as a data URL.
import abandon from "./guideIcons/abandon.svg?url&no-inline";
import accept from "./guideIcons/accept.svg?url&no-inline";
import bank from "./guideIcons/bank.svg?url&no-inline";
import buy from "./guideIcons/buy.svg?url&no-inline";
import collect from "./guideIcons/collect.svg?url&no-inline";
import daily from "./guideIcons/daily.svg?url&no-inline";
import dailyturnin from "./guideIcons/dailyturnin.svg?url&no-inline";
import deathskip from "./guideIcons/deathskip.svg?url&no-inline";
import destroy from "./guideIcons/destroy.svg?url&no-inline";
import emote from "./guideIcons/emote.svg?url&no-inline";
import fly from "./guideIcons/fly.svg?url&no-inline";
import fp from "./guideIcons/fp.svg?url&no-inline";
import gossip from "./guideIcons/gossip.svg?url&no-inline";
import goto from "./guideIcons/goto.svg?url&no-inline";
import home from "./guideIcons/home.svg?url&no-inline";
import interact from "./guideIcons/interact.svg?url&no-inline";
import kill from "./guideIcons/kill.svg?url&no-inline";
import next from "./guideIcons/next.svg?url&no-inline";
import skill from "./guideIcons/skill.svg?url&no-inline";
import stable from "./guideIcons/stable.svg?url&no-inline";
import talk from "./guideIcons/talk.svg?url&no-inline";
import train from "./guideIcons/train.svg?url&no-inline";
import turnin from "./guideIcons/turnin.svg?url&no-inline";
import vehicle from "./guideIcons/vehicle.svg?url&no-inline";
import vendor from "./guideIcons/vendor.svg?url&no-inline";
import xp from "./guideIcons/xp.svg?url&no-inline";

type TexturedKind = { [K in MarkKind]: (typeof MARKS)[K] extends { texture: GuideIconKey } ? K : never }[MarkKind];

const MARK_VECTORS = {
  accept,
  daily,
  turnin,
  dailyturnin,
  collect,
  kill,
  xp,
  home,
  goto,
  train,
  trainer: train,
  vendor,
  buy,
  bank,
  fly,
  fp,
  destroy,
  abandon,
  stable,
  gossip,
  emote,
  vehicle,
  skill,
  next,
  deathskip,
} satisfies Partial<Record<TexturedKind, string>>;

export type VectorKind = keyof typeof MARK_VECTORS;

const VECTOR_ICONS: ReadonlyMap<GuideIconKey, string> = new Map([
  ...Object.entries(MARK_VECTORS).map(([kind, url]) => [MARKS[kind as TexturedKind].texture, url] as const),
  [textureKey("interface/worldmap/chatbubble_64grey")!, talk],
  [textureKey("interface/cursor/crosshair/interact")!, interact],
]);

// White and yellow fills fade into a light page, so light mode edges both
// tones. On a dark page the white speech bubbles would read as solid blobs,
// so they turn to outlines as on a light page. A deep icon's dark fills weigh
// at least twice as much on a light page as on a dark one, so both themes lift
// them toward the other icons.
const VECTOR_TONES: ReadonlyMap<string, "pale" | "vivid" | "deep"> = new Map([
  [talk, "pale"],
  [gossip, "pale"],
  [emote, "pale"],
  [accept, "vivid"],
  [turnin, "vivid"],
  [abandon, "deep"],
  [collect, "deep"],
  [deathskip, "deep"],
  [destroy, "deep"],
  [goto, "deep"],
  [train, "deep"],
]);

const vectorsByCatalog = new WeakMap<GuideIconCatalog, Map<GuideIconEntry, string>>();

function vectorByCatalogEntry(catalog: GuideIconCatalog) {
  let byIcon = vectorsByCatalog.get(catalog);
  if (!byIcon) {
    byIcon = new Map(
      [...VECTOR_ICONS].flatMap(([key, url]) => {
        const entry = catalog.get(key);
        return entry ? [[entry, url] as const] : [];
      }),
    );
    vectorsByCatalog.set(catalog, byIcon);
  }
  return byIcon;
}

type Size = { width: number; height: number };

type IconVars = {
  "--icon-w": string;
  "--icon-h": string;
  "--icon-ratio"?: string;
  "--sheet-w"?: string;
  "--sheet-h"?: string;
  "--cell-x"?: string;
  "--cell-y"?: string;
  "--icon-url"?: string;
};

export type IconLook = { className: string; vars: IconVars; drawn: boolean };

const length = (pixels: number) => (pixels === 0 ? "1em" : `${pixels}px`);

/**
 * The class and CSS variables of an icon drawn at `size`, where 0 is the text
 * height. `icon` is a catalog icon, or a key, which draws its vector redraw
 * even when the catalog has no row for it. `drawn` is false when no icon
 * shows, and the outline shows in its place.
 */
export function iconLook(catalog: GuideIconCatalog, icon: GuideIconEntry | GuideIconKey | undefined, size: Size): IconLook {
  const box: IconVars = { "--icon-w": length(size.width), "--icon-h": length(size.height) };
  if (size.width > 0 && size.height > 0) box["--icon-ratio"] = String(size.width / size.height);
  const entry = typeof icon === "string" ? catalog.get(icon) : icon;
  const vector = (typeof icon === "string" ? VECTOR_ICONS.get(icon) : undefined) ?? (entry && vectorByCatalogEntry(catalog).get(entry));
  if (vector)
    return {
      className: ["guide-icon vector", VECTOR_TONES.get(vector)].filter(Boolean).join(" "),
      vars: { ...box, "--icon-url": `url("${vector}")` },
      drawn: true,
    };
  if (!entry) return { className: "guide-icon missing", vars: box, drawn: false };
  const { cell } = entry;
  const vars = {
    ...box,
    "--sheet-w": String(catalog.sheet.width / cell.width),
    "--sheet-h": String(catalog.sheet.height / cell.height),
    "--cell-x": String(-cell.x / cell.width),
    "--cell-y": String(-cell.y / cell.height),
  };
  return { className: "guide-icon", vars, drawn: true };
}

/**
 * How a texture escape shows: its icon at the size of its arguments, and its
 * catalog name. `look.drawn` is false when no icon has the key or the
 * arguments crop the file, which the planner does not draw.
 */
export function textureIcon(catalog: GuideIconCatalog, texture: RxpTexture, written: string) {
  const size = textureSize(texture.args);
  const key = size && texture.key;
  return { name: catalog.get(key)?.name ?? `Icon ${written}`, look: iconLook(catalog, key, size ?? { width: 0, height: 0 }) };
}
