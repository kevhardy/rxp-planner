import { describe, expect, it } from "vitest";
import type { WorldMapPlace } from "../../data/index.ts";
import { clearLabels, labelShows } from "./labels.ts";

describe("labelShows", () => {
  const place = (kind: WorldMapPlace["kind"], minZoom = 0): WorldMapPlace => ({ name: "A", kind, area: "kalimdor", x: 0, y: 0, minZoom });

  it("shows zone and capital labels at every level, and landmark labels from level 4", () => {
    expect(
      [2, 3.9, 4].map((level) => [
        labelShows(place("zone"), level),
        labelShows(place("capital"), level),
        labelShows(place("landmark"), level),
      ]),
    ).toEqual([
      [true, true, false],
      [true, true, false],
      [true, true, true],
    ]);
  });
  it("keeps a place's own higher minimum", () => {
    expect([labelShows(place("landmark", 6), 5), labelShows(place("landmark", 6), 6)]).toEqual([false, true]);
  });
});

describe("clearLabels", () => {
  const zone = { x: 100, y: 100, width: 120, height: 20 };
  const below = { x: 130, y: 104, width: 80, height: 14 };

  it("moves a zone label that covers a landmark label the shortest way to 2 pixels clear, and leaves one that covers none", () => {
    expect(clearLabels([zone, { ...zone, x: 400 }], [below])).toEqual([
      { x: 0, y: -15 },
      { x: 0, y: 0 },
    ]);
  });
  it("moves past a landmark label that blocks the shortest way", () => {
    expect(clearLabels([zone], [below, { x: 100, y: 75, width: 80, height: 14 }])).toEqual([{ x: 0, y: 23 }]);
  });
  it("keeps a moved zone label off the other zone labels", () => {
    expect(clearLabels([zone, { ...zone, y: 70 }], [below])).toEqual([
      { x: 0, y: 23 },
      { x: 0, y: 0 },
    ]);
  });
});
