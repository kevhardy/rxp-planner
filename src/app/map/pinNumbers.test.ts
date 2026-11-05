// @vitest-environment jsdom
import { expect, it } from "vitest";
import { plannerData } from "../../data/plannerFixture.ts";
import { worldMap } from "../../data/terrainFixture.ts";
import { parseGuide } from "../../guide/index.ts";
import { guideLayout } from "./guideLayout.ts";
import type { Pin } from "./MapCanvas.tsx";
import { clearOfMarks, pinLooks } from "./pinNumbers.ts";
import { terrainSurface } from "./surfaces.ts";

const pin = (text: string, rank: number, x: number, y = 0, kind: Pin["kind"] = "upcoming"): Pin => ({
  key: `${text}@${x},${y}`,
  at: { x, y },
  kind,
  label: text,
  text,
  rank,
});
const looks = (pins: Pin[]) => Object.fromEntries(pinLooks(pins, 1, 1));

it("draws no other step's pin under the selected step's pins, and every number apart from them", () => {
  const data = plannerData();
  const goto = (at: string) => `.goto Elwynn Forest,${at}\n`;
  const text = [goto("40,40"), goto("40.2,40"), goto("40,40.2") + goto("40.1,40.2"), goto("40.2,40.2"), goto("50,50")].map(
    (g) => `step\n${g}`,
  );
  const laid = guideLayout(terrainSurface(data, worldMap, new WeakMap()), {
    data,
    doc: parseGuide(`#group T\n#name One\n${text.join("")}`),
    selection: { step: 2, line: null },
    spots: [],
    areas: [],
    highlight: null,
    showGuide: true,
    previousSteps: "dimmed",
    upcomingSteps: "dimmed",
  });
  // At 400 px a percent, a 0.2 zone percent step is about 7 px, under a pin's 16 px; at 4000 px it is about 70 px.
  expect(Object.fromEntries(pinLooks(laid.pins, 400, 1))).toEqual({
    "p0:0": null,
    "p1:0": null,
    "p3:0": null,
    "p4:0": { text: "5", near: false },
  });
  expect(Object.fromEntries(pinLooks(laid.pins, 4000, 1))).toEqual({
    "p0:0": { text: "1", near: false },
    "p1:0": { text: "2", near: false },
    "p3:0": { text: "4", near: false },
    "p4:0": { text: "5", near: false },
  });
});

it("joins two pins of a kind whose outlines come within 2 px, measuring a two-digit pin by its wider bar", () => {
  // At 1 px a percent: two 20px bars 20px apart leave 16 px between their outlines, under a pin's 16 px and the 2 px space; 22 px apart, they clear.
  expect(looks([pin("11", 6, 0), pin("12", 7, 20)])).toEqual({ "11@0,0": { text: "11–12", near: false }, "12@20,0": null });
  // Their 20px boxes then leave 2 px, so "12" moves 6 px right to leave 8 px.
  expect(looks([pin("11", 6, 0), pin("12", 7, 22)])).toEqual({
    "11@0,0": { text: "11", near: false },
    "12@22,0": { text: "12", near: false, at: { x: 28, y: 0 } },
  });
});

it("keeps 8 px between the boxes of placed chips, which draw 17 px tall and at least 17 px wide", () => {
  expect(looks([pin("11", 6, 0), pin("12", 7, 28)])).toEqual({
    "11@0,0": { text: "11", near: false },
    "12@28,0": { text: "12", near: false },
  });
  expect(looks([pin("6", 1, 0), pin("7", 2, 18)])).toEqual({
    "6@0,0": { text: "6", near: false },
    "7@18,0": { text: "7", near: false, at: { x: 25, y: 0 } },
  });
  // The round ends clear on a diagonal, but the boxes' corners would touch.
  expect(looks([pin("6", 1, 0), pin("7", 2, 13, 13)])).toEqual({
    "6@0,0": { text: "6", near: false },
    "7@13,13": { text: "7", near: false, at: { x: 25, y: 13 } },
  });
  expect(looks([pin("6", 1, 0), pin("7", 2, 0, 20)])).toEqual({
    "6@0,0": { text: "6", near: false },
    "7@0,20": { text: "7", near: false, at: { x: 0, y: 25 } },
  });
});

it("joins two chips of a kind that touch, so neither draws under the other", () => {
  expect(looks([pin("6", 1, 0, 16), pin("11", 6, 0, 0)])).toEqual({ "6@0,16": { text: "6–11", near: false }, "11@0,0": null });
});

it("draws a crowded run as one chip at the nearest step, with the run's step range", () => {
  expect(looks([pin("12", 7, 4), pin("7", 2, 8), pin("6", 1, 0)])).toEqual({
    "6@0,0": { text: "6–12", near: false },
    "7@8,0": null,
    "12@4,0": null,
  });
});

it("moves a chip of another kind to the nearest free place, and draws none where no place is free", () => {
  // The "4" box needs 25 px from the "6" box 4 px away, so it moves 21 px right.
  expect(looks([pin("6", 1, 0), pin("4", 1, 4, 0, "previous")])).toEqual({
    "6@0,0": { text: "6", near: false },
    "4@4,0": { text: "4", near: false, at: { x: 25, y: 0 } },
  });
  const ring = [-36, -18, 0, 18, 36].flatMap((x) => [-36, -18, 0, 18, 36].map((y) => pin("6", 1, x, y)));
  expect(looks([...ring, pin("4", 2, 0, 0, "previous")])["4@0,0"]).toBeNull();
});

it("joins a chip that a growing range comes to cover", () => {
  // "6–9" reaches 13.5 px right of its center, 19.5 px from the "12" bar's end at 27 px; "6–14" reaches 17 px, 16 px from it.
  expect(looks([pin("6", 1, 0), pin("9", 4, 15), pin("12", 7, 27), pin("14", 9, 0)])).toEqual({
    "6@0,0": { text: "6–14", near: false },
    "9@15,0": null,
    "12@27,0": null,
    "14@0,0": null,
  });
});

it("quiets a chip whose point is 20 px or less from a mark of the selected step, moves it clear of the mark's ring, and draws none under the mark", () => {
  const selected: Pin = { key: "here", at: { x: 0, y: 0 }, kind: "goto", label: "here", text: "5", rank: 0 };
  const quest: Pin = { key: "quest", at: { x: 100, y: 0 }, kind: "start", label: "quest" };
  // A chip keeps 28 px from a mark: its 16 px, the mark's 6 px ring, and the 6 px space.
  expect(looks([selected, quest, pin("6", 1, 18), pin("7", 2, 0, 30), pin("8", 3, 100, 10), pin("9", 4, 60)])).toEqual({
    "6@18,0": { text: "6", near: true, at: { x: 28, y: 0 } },
    "7@0,30": { text: "7", near: false },
    "8@100,10": null,
    "9@60,0": { text: "9", near: false },
  });
});

it("puts the step of a pin under the selected step's mark in a chip close by", () => {
  const selected: Pin = { key: "here", at: { x: 0, y: 0 }, kind: "goto", label: "here", text: "5", rank: 0 };
  expect(looks([selected, pin("6", 1, 2), pin("11", 6, 0, 19), pin("7", 2, 0, -2, "previous")])).toEqual({
    "6@2,0": null,
    "11@0,19": { text: "6–11", near: true, at: { x: 0, y: 28 } },
    "7@0,-2": null,
  });
});

it("moves a row of plain points clear of a mark of the selected step, and keeps a clear row in place", () => {
  const marks = [{ x: 0, y: 0 }];
  // A row's nearest point keeps 25 px from a mark: the mark's 8 px half and 6 px ring, the 4 px space, and the point's 7 px reach.
  expect(clearOfMarks({ x: 14, y: 0 }, 2, marks, 1, 1)).toEqual({ x: 25, y: 0 });
  // The second point sits 14 px right of the first, so a row left of the mark moves by the second point.
  expect(clearOfMarks({ x: -30, y: 0 }, 2, marks, 1, 1)).toEqual({ x: -39, y: 0 });
  const clear = { x: 0, y: 30 };
  expect(clearOfMarks(clear, 3, marks, 1, 1)).toBe(clear);
});

it("moves a selected step's badge onto the corner of a ringed mark whose ring it would cover", () => {
  const selected: Pin = { key: "here", at: { x: 0, y: 0 }, kind: "goto", label: "here", text: "5", rank: 0 };
  // The badge draws 19 px right of and above its point, 21 px from a mark at (2, -7), under the 26 px of the mark's ring, the space, and the badge.
  expect(looks([selected, { key: "quest", at: { x: 2, y: -7 }, kind: "start", label: "quest" }])).toEqual({
    here: { text: "5", near: false, badge: { x: 2, y: -7 } },
  });
  expect(looks([selected, { key: "far", at: { x: 0, y: 60 }, kind: "start", label: "far" }])).toEqual({});
});

it("moves a ringed mark beside the standing character, so the character's marker does not cover it", () => {
  const quest: Pin = { key: "quest", at: { x: 0, y: 0 }, kind: "start", label: "quest" };
  const selected: Pin = { key: "here", at: { x: 0, y: 0 }, kind: "goto", label: "here", text: "5", rank: 0 };
  // The mark's ring reaches 14 px, the space 4 px, and the character's marker 10 px, so the mark's center goes 28 px off.
  // On the character, it takes the upper left, and the badge keeps the upper right, 39 px off the moved ring.
  expect(Object.fromEntries(pinLooks([selected, quest], 1, 1, { x: 0, y: 0 }))).toEqual({
    quest: { text: "", near: false, at: { x: -28 * Math.SQRT1_2, y: -28 * Math.SQRT1_2 } },
  });
  // Off to one side, it moves straight away from the character.
  expect(Object.fromEntries(pinLooks([{ ...quest, at: { x: 0, y: 20 } }], 1, 1, { x: 0, y: 0 }))).toEqual({
    quest: { text: "", near: false, at: { x: 0, y: 28 } },
  });
  expect(Object.fromEntries(pinLooks([{ ...quest, at: { x: 0, y: 28 } }], 1, 1, { x: 0, y: 0 }))).toEqual({});
  expect(looks([quest])).toEqual({});
});
