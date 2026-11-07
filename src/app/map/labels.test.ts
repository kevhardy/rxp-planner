import { describe, expect, it } from "vitest";
import type { WorldMapPlace } from "../../data/index.ts";
import { clearLabels, labelShows, nameSide, pickLabels } from "./labels.ts";

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

  it("moves a zone label that covers a landmark label the shortest way to 4 pixels clear, and leaves one that covers none", () => {
    expect(clearLabels([zone, { ...zone, x: 400 }], [below])).toEqual([
      { x: 0, y: -17 },
      { x: 0, y: 0 },
    ]);
  });
  it("moves past a landmark label that blocks the shortest way", () => {
    expect(clearLabels([zone], [below, { x: 100, y: 75, width: 80, height: 14 }])).toEqual([{ x: 0, y: 25 }]);
  });
  it("keeps a moved zone label off the other zone labels", () => {
    expect(clearLabels([zone, { ...zone, y: 70 }], [below])).toEqual([
      { x: 0, y: 25 },
      { x: 0, y: 0 },
    ]);
  });
  it("moves a name 12 pixels clear to the side, so that it does not read as one name with its neighbor", () => {
    const icon = { x: 100, y: 100, width: 18, height: 18 };
    const name = { x: 100, y: 100, width: 40, height: 14 };
    const above = { x: 100, y: 72, width: 200, height: 14 };
    const below = { x: 100, y: 128, width: 200, height: 14 };
    expect(clearLabels([name], [icon, above, below])).toEqual([{ x: -41, y: 0 }]);
  });
  it("hides a zone label with no clear spot within 64 pixels, and moves a capital's as far as it takes", () => {
    const block = { x: 100, y: 100, width: 200, height: 100 };
    expect(clearLabels([zone, { ...zone, x: 101, mustShow: true }], [block])).toEqual([null, { x: 0, y: -64 }]);
  });
});

describe("nameSide", () => {
  const icon = { x: 100, y: 50, width: 18, height: 18 };
  const name = { width: 80, height: 14 };
  const quest = (x: number) => ({ x, y: 50, width: 16, height: 16 });

  it("draws the name after its icon, unless a quest marker covers it there and not before the icon", () => {
    expect([
      nameSide(icon, name, []),
      nameSide(icon, name, [quest(140)]),
      nameSide(icon, name, [quest(140), quest(50)]),
      nameSide(icon, name, [quest(60)]),
    ]).toEqual(["end", "start", "end", "end"]);
  });
});
