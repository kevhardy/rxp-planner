import { describe, expect, it } from "vitest";
import type { WorldMapPlace } from "../../data/index.ts";
import { clearLabels, labelShows, pickLabels } from "./labels.ts";

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

describe("pickLabels", () => {
  const box = (x: number, y: number) => ({ x, y, width: 100, height: 14 });

  it("keeps the capital over a zone it covers, and keeps a zone that covers nothing", () => {
    expect(
      pickLabels([
        { rank: 1, name: box(100, 100) },
        { rank: 0, name: box(150, 105) },
        { rank: 1, name: box(400, 100) },
      ]),
    ).toEqual([
      { name: false, levels: false },
      { name: true, levels: false },
      { name: true, levels: false },
    ]);
  });
  it("hides one name that covers two neighbors rather than the two neighbors", () => {
    expect(pickLabels([box(180, 100), box(100, 100), box(260, 100)].map((name) => ({ rank: 1, name })))).toEqual([
      { name: false, levels: false },
      { name: true, levels: false },
      { name: true, levels: false },
    ]);
  });
  it("drops a level range that covers another name before it drops that name", () => {
    expect(
      pickLabels([
        { rank: 1, name: box(100, 100), levels: box(100, 114) },
        { rank: 1, name: box(120, 124), levels: box(120, 138) },
      ]),
    ).toEqual([
      { name: true, levels: false },
      { name: true, levels: true },
    ]);
  });
  it("draws a label again when the zoom spreads it clear of its neighbor", () => {
    const at = (k: number) => [
      { rank: 1, name: box(100 * k, 100 * k), levels: box(100 * k, 100 * k + 14) },
      { rank: 1, name: box(150 * k, 105 * k), levels: box(150 * k, 105 * k + 14) },
    ];
    expect([pickLabels(at(1))[1], pickLabels(at(4))[1]]).toEqual([
      { name: false, levels: false },
      { name: true, levels: true },
    ]);
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
