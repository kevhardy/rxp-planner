import type { Pin } from "./MapCanvas.tsx";
import type { ViewPoint } from "./points.ts";

// A numbered pin in map.css is a round-ended bar about 16px tall. It grows
// past 16px wide by 2px of padding and a 1px rim on each side of its digits,
// and a digit of the 11px numerals is about 7px wide.
const PIN_SIZE = 16;
const PIN_EDGES = 6;
const DIGIT_WIDTH = 7;

/** The length of the straight part between the pin's two round ends. */
const barOf = (text: string) => Math.max(0, PIN_EDGES + text.length * DIGIT_WIDTH - PIN_SIZE);

/** The keys of the ranked pins that print no number, because a pin of a lower rank prints its number over them at this scale. */
export function crowdedNumbers(pins: readonly Pin[], pxPerPercent: number, aspect: number): Set<string> {
  const ranked = pins.flatMap(({ key, at, text, rank }) => (text && rank !== undefined ? [{ key, at, bar: barOf(text), rank }] : []));
  ranked.sort((a, b) => a.rank - b.rank);
  const numbered: { at: ViewPoint; bar: number }[] = [];
  const crowded = new Set<string>();
  for (const { key, at, bar, rank } of ranked) {
    const overlaps = numbered.some((n) => {
      const dx = Math.max(0, Math.abs((n.at.x - at.x) * pxPerPercent) - (n.bar + bar) / 2);
      return Math.hypot(dx, ((n.at.y - at.y) * pxPerPercent) / aspect) < PIN_SIZE;
    });
    if (rank > 0 && overlaps) crowded.add(key);
    else numbered.push({ at, bar });
  }
  return crowded;
}
