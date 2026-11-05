import type { Pin } from "./MapCanvas.tsx";
import type { ViewPoint } from "./points.ts";

// A numbered pin in map.css is a round-ended bar about 16px tall. It grows
// past 16px wide by 2px of padding and a 1px rim on each side of its text,
// and a character of the 11px tabular numerals is about 7px wide.
const PIN_SIZE = 16;
const PIN_EDGES = 6;
const DIGIT_WIDTH = 7;
// How close, in pixels, a chip's point sits to a mark of the selected step
// when the chip draws quieter, and how close it sits to a pin under that mark
// when it takes in the pin's step.
const NEAR = 20;
// The space between two drawn chips, so that they never read as a stack.
const CLEAR = 2;
// A mark of the selected step reaches past a pin's size by its 4.5px ring in
// map.css, and by 1px more for an 18px quest icon.
const MARK_EDGE = 6;
// The space between that ring and a chip or a plain point, so neither reads as
// pressed against the ring.
const MARK_CLEAR = 4;
// A plain point in map.css draws its shape in a 14px box, and the points of a
// row sit 14px apart.
const DOT_REACH = 7;
const DOT_STEP = 14;
// How far, in pixels, a chip can move from its point to clear another mark.
const MAX_SHIFT = 24;
// In Playback, map.css draws a selected step's pin as a badge this far right
// of and above its point, which clears its own mark's ring by `MARK_CLEAR`.
const BADGE_OFFSET = 19;
const RINGED: ReadonlySet<Pin["kind"]> = new Set(["start", "end", "both"]);

/** The length of the straight part between the pin's two round ends. */
const barOf = (text: string) => Math.max(0, PIN_EDGES + text.length * DIGIT_WIDTH - PIN_SIZE);

/**
 * What a ranked pin prints at this scale. `null` draws no pin, because a chip
 * or a mark of the selected step already covers its place. `at` is where the
 * chip draws when it moves off its point to clear another mark. `badge` is
 * how far, in pixels, a selected step's badge moves to take the corner of a
 * ringed mark whose ring it would cover.
 */
export type PinLook = { text: string; near: boolean; at?: ViewPoint; badge?: { x: number; y: number } } | null;

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
const crowds = (a: Spot, b: Spot) => gap(a, b) < PIN_SIZE + CLEAR;

/** Each move a chip can make, shortest first. */
const SHIFTS = Array.from({ length: (2 * MAX_SHIFT + 1) ** 2 }, (_, i) => ({
  x: (i % (2 * MAX_SHIFT + 1)) - MAX_SHIFT,
  y: Math.floor(i / (2 * MAX_SHIFT + 1)) - MAX_SHIFT,
}))
  .filter((s) => Math.hypot(s.x, s.y) <= MAX_SHIFT)
  .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));

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
 * No chip draws on a mark or on another chip. A chip that would moves to the
 * nearest free place, nearest steps first, or draws nothing when no place
 * within `MAX_SHIFT` is free.
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
    const chip = chips.find((c) => c.kind === pin.kind && crowds(drawn(c), at));
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
      if (a.kind !== b.kind || !crowds(drawn(a), drawn(b))) continue;
      take(a, b.low);
      take(a, b.high);
      looks.set(b.key, null);
      chips.splice(j, 1);
      j = i;
    }
  }
  const placed: Spot[] = [];
  const free = (s: Spot) => marks.every((m) => gap(m, s) >= PIN_SIZE + MARK_EDGE + MARK_CLEAR) && placed.every((p) => !crowds(p, s));
  for (const chip of chips) {
    const own = drawn(chip);
    const shift = SHIFTS.find((s) => free({ ...own, x: own.x + s.x, y: own.y + s.y }));
    if (!shift) {
      looks.set(chip.key, null);
      continue;
    }
    placed.push({ ...own, x: own.x + shift.x, y: own.y + shift.y });
    const near = marks.some((m) => Math.hypot(m.x - chip.x, m.y - chip.y) <= NEAR);
    const moved = shift.x !== 0 || shift.y !== 0;
    const at = { x: (own.x + shift.x) / pxPerPercent, y: ((own.y + shift.y) * aspect) / pxPerPercent };
    looks.set(chip.key, { text: chipText(chip), near, ...(moved && { at }) });
  }
  const rings = pins.flatMap((p) => (RINGED.has(p.kind) ? [spot(p)] : []));
  for (const pin of pins) {
    if (pin.rank !== 0 || !pin.text) continue;
    const own = spot(pin);
    const badge = { x: own.x + BADGE_OFFSET, y: own.y - BADGE_OFFSET, bar: 0 };
    const ring = rings.find((r) => gap(r, badge) < PIN_SIZE + MARK_EDGE + MARK_CLEAR);
    if (ring) looks.set(pin.key, { text: pin.text, near: false, badge: { x: ring.x - own.x, y: ring.y - own.y } });
  }
  return looks;
}

/**
 * Where a row of `count` plain points draws, so that it clears each mark of
 * the selected step by `MARK_CLEAR`. `at` is the first point's center, and
 * the others follow to its right. The row keeps `at` when it is clear, and
 * when no place within `MAX_SHIFT` is.
 */
export function clearOfMarks(at: ViewPoint, count: number, marks: readonly ViewPoint[], pxPerPercent: number, aspect: number): ViewPoint {
  const toPx = (p: ViewPoint) => ({ x: p.x * pxPerPercent, y: (p.y * pxPerPercent) / aspect });
  const near = marks.map(toPx);
  const bar = (count - 1) * DOT_STEP;
  const row = { ...toPx(at), bar };
  const center = { ...row, x: row.x + bar / 2 };
  const free = (s: Spot) => near.every((m) => gap({ ...m, bar: 0 }, s) >= PIN_SIZE / 2 + MARK_EDGE + MARK_CLEAR + DOT_REACH);
  const shift = SHIFTS.find((s) => free({ ...center, x: center.x + s.x, y: center.y + s.y }));
  if (!shift || (shift.x === 0 && shift.y === 0)) return at;
  return { x: (row.x + shift.x) / pxPerPercent, y: ((row.y + shift.y) * aspect) / pxPerPercent };
}
