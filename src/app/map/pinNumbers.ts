import type { Pin } from "./MapCanvas.tsx";

// A numbered pin in map.css is a round-ended bar about 16px tall. It grows
// past 16px wide by 2px of padding and a 1px rim on each side of its text,
// and a character of the 11px tabular numerals is about 7px wide.
const PIN_SIZE = 16;
const PIN_EDGES = 6;
const DIGIT_WIDTH = 7;
// How close, in pixels, a chip sits to a mark of the selected step when it
// fades, and how close it sits to a pin under that mark when it takes in the
// pin's step.
const NEAR = 20;

/** The length of the straight part between the pin's two round ends. */
const barOf = (text: string) => Math.max(0, PIN_EDGES + text.length * DIGIT_WIDTH - PIN_SIZE);

/**
 * What a ranked pin prints at this scale. `null` draws no pin, because a chip
 * or a mark of the selected step already covers its place.
 */
export type PinLook = { text: string; near: boolean } | null;

interface Spot {
  x: number;
  y: number;
  bar: number;
}

interface Chip {
  key: string;
  kind: Pin["kind"];
  x: number;
  y: number;
  low: number;
  high: number;
}

const chipText = ({ low, high }: Chip) => (low === high ? String(low) : `${low}–${high}`);
const drawn = (c: Chip): Spot => ({ ...c, bar: barOf(chipText(c)) });
/** The distance between two pins' outlines, plus a pin's size. */
const gap = (a: Spot, b: Spot) => Math.hypot(Math.max(0, Math.abs(a.x - b.x) - (a.bar + b.bar) / 2), a.y - b.y);
const overlaps = (a: Spot, b: Spot) => gap(a, b) < PIN_SIZE;

function take(chip: Chip, step: number) {
  chip.low = Math.min(chip.low, step);
  chip.high = Math.max(chip.high, step);
}

/**
 * How each ranked pin with a number draws. Where such pins overlap, the pin
 * nearest the selected step becomes a chip that prints the step range of the
 * pins of its kind that it covers, and those pins draw nothing. A pin under a
 * mark of the selected step draws nothing, and a chip of its kind close by
 * takes in its step.
 *
 * A ranked pin's text is its step number.
 */
export function pinLooks(pins: readonly Pin[], pxPerPercent: number, aspect: number): Map<string, PinLook> {
  const spot = (p: Pin): Spot => ({ x: p.at.x * pxPerPercent, y: (p.at.y * pxPerPercent) / aspect, bar: p.text ? barOf(p.text) : 0 });
  const marks = pins.flatMap((p) => (p.rank ? [] : [spot(p)]));
  const ranked = pins.filter((p) => p.text && p.rank).sort((a, b) => a.rank! - b.rank!);
  const chips: Chip[] = [];
  const under: { pin: Pin; at: Spot }[] = [];
  const looks = new Map<string, PinLook>();
  for (const pin of ranked) {
    const at = spot(pin);
    const chip = chips.find((c) => c.kind === pin.kind && overlaps(drawn(c), at));
    if (chip) take(chip, Number(pin.text));
    else if (marks.some((m) => overlaps(m, at))) under.push({ pin, at });
    else {
      chips.push({ key: pin.key, kind: pin.kind, x: at.x, y: at.y, low: Number(pin.text), high: Number(pin.text) });
      continue;
    }
    looks.set(pin.key, null);
  }
  for (const { pin, at } of under) {
    const chip = chips.find((c) => c.kind === pin.kind && gap(drawn(c), at) <= NEAR);
    if (chip) take(chip, Number(pin.text));
  }
  // A chip widens as its range grows, so it can come to cover a chip after it.
  for (let i = 0; i < chips.length; i++) {
    for (let j = i + 1; j < chips.length; j++) {
      const [a, b] = [chips[i]!, chips[j]!];
      if (a.kind !== b.kind || !overlaps(drawn(a), drawn(b))) continue;
      take(a, b.low);
      take(a, b.high);
      looks.set(b.key, null);
      chips.splice(j, 1);
      j = i;
    }
  }
  for (const chip of chips) {
    const near = marks.some((m) => Math.hypot(m.x - chip.x, m.y - chip.y) <= NEAR);
    looks.set(chip.key, { text: chipText(chip), near });
  }
  return looks;
}
