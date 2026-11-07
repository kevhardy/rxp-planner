import type { Pin } from "./MapCanvas.tsx";
import type { ViewPoint } from "./points.ts";

// A numbered pin in map.css is a round-ended bar about 16px tall. It grows
// past 16px wide by 2px of padding and a 1px rim on each side of its text,
// and a character of the 12px tabular numerals is about 7px wide.
const PIN_SIZE = 16;
const PIN_EDGES = 6;
const DIGIT_WIDTH = 7;
// How close, in pixels, a chip's point sits to a mark of the selected step
// when the chip draws quieter, and how close it sits to a pin under that mark
// when it takes in the pin's step.
const NEAR = 20;
// Two chips of a kind closer than this, between their outlines, join.
const CLEAR = 2;
// The visible space that placed chips keep between their boxes, so that they
// never read as a stack. Two pills whose round ends nest on a diagonal read as
// touching, so the boxes keep it and not the outlines. Over bright foliage, a
// 4px space still reads as one clipped badge.
const BOX_CLEAR = 8;
// A step pin in map.css draws 1px larger than `PIN_SIZE` each way: 17px tall,
// and at least 17px wide.
const STEP_PIN_SIZE = 17;
// A mark of the selected step reaches past a pin's size by its 4.5px ring in
// map.css, and by 1px more for an 18px quest icon.
const MARK_EDGE = 6;
// The space between that ring and another mark, so neither reads as pressed
// against the ring. A chip's dark rim meets the ring's ink edge, so a chip
// needs more.
const MARK_CLEAR = 4;
const CHIP_MARK_CLEAR = 6;
// How far, in pixels, a chip can move from its point to clear another mark.
const MAX_SHIFT = 24;
// In Playback, map.css draws a selected step's pin as a badge this far right
// of and above its point, which clears its own mark's ring by `MARK_CLEAR`.
const BADGE_OFFSET = 19;
// The character marker in playback.css is a 16px disc with a 2px outline.
const CHARACTER_REACH = 10;
const RINGED: ReadonlySet<Pin["kind"]> = new Set(["start", "end", "both"]);

/** The length of the straight part between the pin's two round ends. */
const barOf = (text: string) => Math.max(0, PIN_EDGES + text.length * DIGIT_WIDTH - PIN_SIZE);

/**
 * What a ranked pin prints at this scale. `null` draws no pin, because a chip
 * or a mark of the selected step already covers its place. `at` is where the
 * chip draws when it moves off its point to clear another mark, or where a
 * ringed mark draws to clear the character. `badge` is how far, in pixels, a
 * selected step's badge moves to take the corner of a ringed mark whose ring
 * it would cover.
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
const stepPinWidth = (s: Spot) => Math.max(STEP_PIN_SIZE, PIN_SIZE + s.bar);
const boxesClear = (a: Spot, b: Spot) =>
  Math.max(Math.abs(a.x - b.x) - (stepPinWidth(a) + stepPinWidth(b)) / 2, Math.abs(a.y - b.y) - STEP_PIN_SIZE) >= BOX_CLEAR;

/**
 * Where a ringed mark draws so that its ring clears the character at `stand` by `MARK_CLEAR`: straight away from the
 * character, or to its upper left when the mark sits under it. The step's badge takes the upper right, and the
 * character's level chip the space below. Undefined when the ring already clears.
 */
function besideCharacter(mark: Spot, stand: Spot): Spot | undefined {
  const reach = PIN_SIZE / 2 + MARK_EDGE + MARK_CLEAR + CHARACTER_REACH;
  const [dx, dy] = [mark.x - stand.x, mark.y - stand.y];
  const d = Math.hypot(dx, dy);
  if (d >= reach) return undefined;
  const [ux, uy] = d > PIN_SIZE / 2 ? [dx / d, dy / d] : [-Math.SQRT1_2, -Math.SQRT1_2];
  return { ...mark, x: stand.x + ux * reach, y: stand.y + uy * reach };
}

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
 * A ranked pin's text is its step number. `stand` is where the character
 * stands still, in Playback. A ringed mark under it moves beside it.
 */
export function pinLooks(pins: readonly Pin[], pxPerPercent: number, aspect: number, stand?: ViewPoint): Map<string, PinLook> {
  const toView = (s: Spot): ViewPoint => ({ x: s.x / pxPerPercent, y: (s.y * aspect) / pxPerPercent });
  const toPx = (at: ViewPoint, bar = 0): Spot => ({ x: at.x * pxPerPercent, y: (at.y * pxPerPercent) / aspect, bar });
  const spot = (p: Pin) => toPx(p.at, p.text ? barOf(p.text) : 0);
  const character = stand && toPx(stand);
  const looks = new Map<string, PinLook>();
  const besides = new Map<string, Spot>();
  for (const p of pins) {
    const beside = character && RINGED.has(p.kind) ? besideCharacter(spot(p), character) : undefined;
    if (!beside) continue;
    besides.set(p.key, beside);
    looks.set(p.key, { text: "", near: false, at: toView(beside) });
  }
  const markSpot = (p: Pin) => besides.get(p.key) ?? spot(p);
  const marks = pins.flatMap((p) => (p.rank ? [] : [markSpot(p)]));
  const ranked = pins.filter((p) => p.text && p.rank).sort((a, b) => a.rank! - b.rank!);
  const chips: Chip[] = [];
  const under: { pin: Pin; at: Spot }[] = [];
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
  const free = (s: Spot) =>
    marks.every((m) => gap(m, s) >= PIN_SIZE + MARK_EDGE + CHIP_MARK_CLEAR) && placed.every((p) => boxesClear(p, s));
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
    const at = toView({ ...own, x: own.x + shift.x, y: own.y + shift.y });
    looks.set(chip.key, { text: chipText(chip), near, ...(moved && { at }) });
  }
  const rings = pins.flatMap((p) => (RINGED.has(p.kind) ? [markSpot(p)] : []));
  for (const pin of pins) {
    if (pin.rank !== 0 || !pin.text) continue;
    const own = spot(pin);
    const badge = { x: own.x + BADGE_OFFSET, y: own.y - BADGE_OFFSET, bar: 0 };
    const ring = rings.find((r) => gap(r, badge) < PIN_SIZE + MARK_EDGE + MARK_CLEAR);
    if (ring) looks.set(pin.key, { text: pin.text, near: false, badge: { x: ring.x - own.x, y: ring.y - own.y } });
  }
  return looks;
}
