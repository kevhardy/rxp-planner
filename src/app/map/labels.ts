import type { WorldMapPlace } from "../../data/index.ts";

export const MIN_LEVEL: Readonly<Record<WorldMapPlace["kind"], number>> = { zone: 0, capital: 0, landmark: 4 };

export const labelShows = (place: WorldMapPlace, level: number) => level >= Math.max(place.minZoom, MIN_LEVEL[place.kind]);

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clearLabels(movable: readonly LabelBox[], fixed: readonly LabelBox[]): { x: number; y: number }[] {
  const placed = [...movable];
  return movable.map((box, i) => {
    if (!fixed.some((f) => covers(box, f))) return { x: 0, y: 0 };
    const to = nearestFree(box, [...fixed, ...placed.filter((_, j) => j !== i)]);
    placed[i] = { ...box, ...to };
    return { x: to.x - box.x, y: to.y - box.y };
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

const covers = (a: LabelBox, b: LabelBox) =>
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2;

const GAP = 2;

const REACH = 32;

function nearestFree(box: LabelBox, obstacles: readonly LabelBox[]): { x: number; y: number } {
  const grown = obstacles.map((o) => ({
    left: o.x - (o.width + box.width) / 2 - GAP,
    right: o.x + (o.width + box.width) / 2 + GAP,
    top: o.y - (o.height + box.height) / 2 - GAP,
    bottom: o.y + (o.height + box.height) / 2 + GAP,
  }));
  for (let reach = REACH; ; reach *= 2) {
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
