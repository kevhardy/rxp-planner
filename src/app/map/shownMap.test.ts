import { describe, expect, it } from "vitest";
import type { ResolvedMapFocus } from "./lineFocus.ts";
import { AZEROTH, endFocus, follow, holdFocus, NO_VIEW, pickMap, shownMap, type ViewState } from "./shownMap.ts";

const ELWYNN = 1429;
const WESTFALL = 1436;
const DUSKWOOD = 1431;

const focusOn = (map: number | undefined): ResolvedMapFocus => ({
  fit: { x: 50, y: 50, width: 6 },
  map,
  marks: [],
  paths: [],
  objective: null,
  caption: "Focus",
});

const at = (guide: string, jumps: number, step: number | null) => ({ guide, jumps, step });
const onElwynn: ViewState = { anchor: { guide: "g", jumps: 2, map: ELWYNN }, held: null };
const pickedWestfall = pickMap(onElwynn, WESTFALL);

const unread = () => {
  throw new Error("read the followed map");
};

describe("follow", () => {
  it("follows the step's map when the first guide opens", () => {
    expect(follow(NO_VIEW, at("g", 0, 0), () => ELWYNN)).toEqual({ anchor: { guide: "g", jumps: 0, map: ELWYNN }, held: null });
  });

  it("keeps the anchor and a picked map while the guide and the jump count stay, as an edit or a built-in's copy leaves them", () => {
    expect(follow(pickedWestfall, at("g", 2, 1), unread)).toBe(pickedWestfall);
  });

  it("follows the step's map and ends a pick on a jump to a step, as undo, redo, and a new selection make", () => {
    expect(follow(pickedWestfall, at("g", 3, 1), () => DUSKWOOD)).toEqual({ anchor: { guide: "g", jumps: 3, map: DUSKWOOD }, held: null });
  });

  it("keeps the map and a pick on a jump to no step, as when the selection clears", () => {
    expect(follow(pickedWestfall, at("g", 3, null), unread)).toEqual({
      anchor: { guide: "g", jumps: 3, map: ELWYNN },
      held: { kind: "picked", map: WESTFALL },
    });
  });

  it("follows another guide's map and ends a focus, even with no step selected", () => {
    const focused = holdFocus(onElwynn, "focus 1", focusOn(WESTFALL));
    expect(follow(focused, at("h", 2, null), () => DUSKWOOD)).toEqual({ anchor: { guide: "h", jumps: 2, map: DUSKWOOD }, held: null });
  });
});

describe("shownMap", () => {
  it("shows a picked map, else a focus's map, else the followed map, else Azeroth", () => {
    expect([pickedWestfall, holdFocus(onElwynn, "focus 1", focusOn(DUSKWOOD)), onElwynn, NO_VIEW].map(shownMap)).toEqual([
      WESTFALL,
      DUSKWOOD,
      ELWYNN,
      AZEROTH,
    ]);
  });

  it("keeps the followed map under a focus on a place no zone map covers", () => {
    expect(shownMap(holdFocus(onElwynn, "focus 1", focusOn(undefined)))).toBe(ELWYNN);
  });
});

describe("endFocus", () => {
  it("ends a focus and keeps a picked map", () => {
    expect(endFocus(holdFocus(onElwynn, "focus 1", focusOn(DUSKWOOD)))).toEqual(onElwynn);
    expect(endFocus(pickedWestfall)).toBe(pickedWestfall);
  });
});

describe("pickMap", () => {
  it("ends a focus, and a later focus shows over the pick", () => {
    const focused = holdFocus(onElwynn, "focus 1", focusOn(DUSKWOOD));
    expect(pickMap(focused, WESTFALL)).toEqual(pickedWestfall);
    expect(shownMap(holdFocus(pickedWestfall, "focus 2", focusOn(DUSKWOOD)))).toBe(DUSKWOOD);
  });
});
