import type { WorldMapPlace } from "../../data/index.ts";

export const MIN_LEVEL: Readonly<Record<WorldMapPlace["kind"], number>> = { zone: 0, capital: 0, landmark: 4 };

export const labelShows = (place: WorldMapPlace, level: number) => level >= Math.max(place.minZoom, MIN_LEVEL[place.kind]);

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MovableLabel extends LabelBox {
  /** Moves as far as it takes to clear, where another label hides when no clear spot is within MAX_MOVE pixels. */
  mustShow?: boolean;
}

/** Moves each label clear of the fixed boxes and of the other labels, the shortest way, or returns null to hide it. */
export function clearLabels(movable: readonly MovableLabel[], fixed: readonly LabelBox[]): ({ x: number; y: number } | null)[] {
  const placed: (LabelBox | null)[] = [...movable];
  return movable.map((box, i) => {
    if (!fixed.some((f) => covers(box, f))) return { x: 0, y: 0 };
    const others = placed.filter((p, j): p is LabelBox => p !== null && j !== i);
    const to = nearestFree(box, [...fixed, ...others], box.mustShow ? Infinity : MAX_MOVE);
    placed[i] = to ? { ...box, ...to } : null;
    return to ? { x: to.x - box.x, y: to.y - box.y } : null;
  });
}

export interface PlaceLabelBoxes {
  /** A lower rank claims its space first. */
  rank: number;
  name: LabelBox;
  levels?: LabelBox;
}

/**
 * Draws every name, by rank, then every level range, each only where it covers no part already drawn. Within a rank, a
 * name that covers fewer other names goes first, so that one crowded name does not hide several that fit.
 */
export function pickLabels(labels: readonly PlaceLabelBoxes[]): { name: boolean; levels: boolean }[] {
  const crowd = labels.map((a) => labels.filter((b) => b !== a && covers(a.name, b.name)).length);
  const order = labels.map((_, i) => i).sort((a, b) => labels[a]!.rank - labels[b]!.rank || crowd[a]! - crowd[b]!);
  const drawn: LabelBox[] = [];
  const claim = (box: LabelBox) => {
    if (drawn.some((d) => covers(box, d))) return false;
    drawn.push(box);
    return true;
  };
  const picked = labels.map(() => ({ name: false, levels: false }));
  for (const i of order) picked[i]!.name = claim(labels[i]!.name);
  for (const i of order) {
    const levels = labels[i]!.levels;
    picked[i]!.levels = picked[i]!.name && levels !== undefined && claim(levels);
  }
  return picked;
}

// The gap that map.css leaves between a point's icon and its name.
const NAME_GAP = 4;

/** The side of its icon where a point's name draws: the end, unless an obstacle covers it there and not at the start. */
export function nameSide(icon: LabelBox, name: Omit<LabelBox, "x" | "y">, obstacles: readonly LabelBox[]): "start" | "end" {
  const at = (side: -1 | 1): LabelBox => ({ ...name, x: icon.x + side * (icon.width / 2 + NAME_GAP + name.width / 2), y: icon.y });
  const clear = (box: LabelBox) => !obstacles.some((o) => covers(box, o));
  return clear(at(1)) || !clear(at(-1)) ? "end" : "start";
}

const covers = (a: LabelBox, b: LabelBox) =>
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2;

// A gap of about one space between two names on a line would read as one name.
const GAP_X = 12;
const GAP_Y = 4;

const REACH = 32;
// Farther than this, a moved name sits over a neighboring zone and names the wrong place.
const MAX_MOVE = 2 * REACH;

function nearestFree(box: LabelBox, obstacles: readonly LabelBox[], limit: number): { x: number; y: number } | undefined {
  const grown = obstacles.map((o) => ({
    left: o.x - (o.width + box.width) / 2 - GAP_X,
    right: o.x + (o.width + box.width) / 2 + GAP_X,
    top: o.y - (o.height + box.height) / 2 - GAP_Y,
    bottom: o.y + (o.height + box.height) / 2 + GAP_Y,
  }));
  for (let reach = REACH; reach <= limit; reach *= 2) {
    const near = grown.filter(
      (g) => Math.hypot(Math.max(g.left - box.x, 0, box.x - g.right), Math.max(g.top - box.y, 0, box.y - g.bottom)) < reach,
    );
    let best: { x: number; y: number } | undefined;
    let distance = reach;
    for (const x of [box.x, ...near.flatMap((g) => [g.left, g.right])]) {
      for (const y of [box.y, ...near.flatMap((g) => [g.top, g.bottom])]) {
        const d = Math.hypot(x - box.x, y - box.y);
        if (d < distance && !near.some((g) => x > g.left && x < g.right && y > g.top && y < g.bottom)) [best, distance] = [{ x, y }, d];
      }
    }
    if (best) return best;
  }
}
