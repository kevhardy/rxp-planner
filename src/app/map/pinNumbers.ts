import type { Pin } from "./MapCanvas.tsx";
import type { ViewPoint } from "./points.ts";

// The width of a numbered pin in map.css.
const PIN_SIZE = 16;

/** The keys of the ranked pins that print no number, because a pin of a lower rank prints its number over them at this scale. */
export function crowdedNumbers(pins: readonly Pin[], pxPerPercent: number, aspect: number): Set<string> {
  const ranked = pins.flatMap(({ key, at, text, rank }) => (text && rank !== undefined ? [{ key, at, rank }] : []));
  ranked.sort((a, b) => a.rank - b.rank);
  const numbered: ViewPoint[] = [];
  const crowded = new Set<string>();
  for (const { key, at, rank } of ranked) {
    const overlaps = numbered.some((n) => Math.hypot((n.x - at.x) * pxPerPercent, ((n.y - at.y) * pxPerPercent) / aspect) < PIN_SIZE);
    if (rank > 0 && overlaps) crowded.add(key);
    else numbered.push(at);
  }
  return crowded;
}
