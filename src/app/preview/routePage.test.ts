import { describe, expect, it } from "vitest";
import { pageShowing, routePage } from "./routePage.ts";

const long = { count: 13, start: 0, open: 6, slots: 8 };

describe("routePage", () => {
  it("shows a short route whole, with nothing to page", () => {
    expect(routePage({ count: 4, start: 0, open: 1, slots: 8, first: 0 })).toEqual({
      shown: [0, 1, 2, 3],
      from: 0,
      to: 3,
      earlier: 0,
      later: 0,
    });
  });

  it("fills the page around the open guide, with the start pinned before it and a pager on each side", () => {
    expect(routePage({ ...long, first: 5 })).toEqual({
      shown: [0, 5, 6, 7, 8, 9],
      from: 5,
      to: 9,
      earlier: 4,
      later: 3,
      previous: 0,
      next: 9,
    });
  });

  it("gives the first page's earlier pager slot to one more guide", () => {
    const { previous, ...first } = routePage({ ...long, first: 0 });
    expect([previous, first]).toEqual([undefined, { shown: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 6, earlier: 0, later: 6, next: 6 }]);
  });

  it("gives the last page's later pager slot to one more guide, and pins the open guide before its run", () => {
    const { next, ...last } = routePage({ ...long, first: 9 });
    expect([next, last]).toEqual([undefined, { shown: [0, 6, 8, 9, 10, 11, 12], from: 8, to: 12, earlier: 6, later: 0, previous: 4 }]);
    expect(routePage({ ...long, first: 12 })).toEqual(routePage({ ...long, first: 9 }));
  });

  it("still shows the start, the open guide, one more, and the pagers when fewer slots fit", () => {
    expect(routePage({ ...long, slots: 1, first: 5 })).toMatchObject({ shown: [0, 5, 6], earlier: 4, later: 6 });
  });

  it("fills every slot of every page, and shows a pager only for guides it leaves out", () => {
    const wrong = [];
    for (let count = 1; count <= 14; count++)
      for (let open = 0; open < count; open++)
        for (let slots = 5; slots <= count + 1; slots++)
          for (let first = 0; first < count; first++) {
            const page = routePage({ count, start: 0, open, slots, first });
            const pagers = Number(page.earlier > 0) + Number(page.later > 0);
            const filled = page.shown.length + pagers === Math.min(slots, count);
            const counted = page.shown.length + page.earlier + page.later === count;
            const ends = (page.previous !== undefined) === page.earlier > 0 && (page.next !== undefined) === page.later > 0;
            if (!filled || !counted || !ends) wrong.push({ count, open, slots, first, page });
          }
    expect(wrong).toEqual([]);
  });

  it("moves at least one guide with each pager, and reaches every guide, when only one guide fits besides the pinned ones", () => {
    const wrong = [];
    for (let count = 1; count <= 14; count++)
      for (let open = 0; open < count; open++)
        for (let slots = 1; slots <= count + 1; slots++)
          for (let first = 0; first < count; first++) {
            const input = { count, start: 0, open, slots, first };
            const page = routePage(input);
            const before = page.previous === undefined ? undefined : routePage({ ...input, first: page.previous });
            const after = page.next === undefined ? undefined : routePage({ ...input, first: page.next });
            if ((before && before.from >= page.from) || (after && after.to <= page.to)) wrong.push({ ...input, page, before, after });
          }
    expect(wrong).toEqual([]);
    const tight = { count: 8, start: 0, open: 5, slots: 5, first: 4 };
    expect(Array.from({ length: 8 }, (_, i) => routePage({ ...tight, first: pageShowing(tight, i) }).shown.includes(i))).toEqual(
      Array(8).fill(true),
    );
  });

  it("finds the page that shows a guide, from either side", () => {
    expect([pageShowing({ ...long, first: 5 }, 10), pageShowing({ ...long, first: 5 }, 1), pageShowing({ ...long, first: 5 }, 7)]).toEqual([
      9, 0, 5,
    ]);
  });
});
