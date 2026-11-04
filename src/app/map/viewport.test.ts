import { describe, expect, it } from "vitest";
import { frameOf, lineInFrame, panLimit, resizeZoom, zoomTo, type Box } from "./viewport.ts";

describe("resizeZoom", () => {
  const tall: Box = { vw: 418, vh: 421, w: 404, h: 421 };
  const short: Box = { vw: 418, vh: 326, w: 313, h: 326 };
  const zoom = { s: 10.91, tx: -3476.22, ty: -2640.28 };
  const center = (z: typeof zoom, box: Box) => {
    const f = frameOf(z, box);
    return { x: f.left + f.width / 2, y: f.top + f.height / 2 };
  };

  it("keeps the view's center and size on screen when the viewport shrinks", () => {
    const resized = resizeZoom(zoom, tall, short, 40);
    expect(center(resized, short).x).toBeCloseTo(center(zoom, tall).x);
    expect(center(resized, short).y).toBeCloseTo(center(zoom, tall).y);
    expect(short.w * resized.s).toBeCloseTo(tall.w * zoom.s);
  });
  it("keeps the whole stage's size and center at zoom 1 when the viewport doubles, and back", () => {
    const [small, large]: [Box, Box] = [
      { vw: 300, vh: 200, w: 300, h: 200 },
      { vw: 600, vh: 400, w: 600, h: 400 },
    ];
    expect(resizeZoom({ s: 1, tx: 0, ty: 0 }, small, large, 40)).toEqual({ s: 0.5, tx: 150, ty: 100 });
    expect(resizeZoom({ s: 0.5, tx: 150, ty: 100 }, large, small, 40)).toEqual({ s: 1, tx: 0, ty: 0 });
  });
  it("keeps the center at zoom 1 when only the empty space beside the stage grows", () => {
    const [narrow, wide]: [Box, Box] = [
      { vw: 300, vh: 200, w: 200, h: 200 },
      { vw: 600, vh: 200, w: 200, h: 200 },
    ];
    expect(resizeZoom({ s: 1, tx: 0, ty: 0 }, narrow, wide, 40)).toEqual({ s: 1, tx: 150, ty: 0 });
  });
});

describe("panLimit", () => {
  const box: Box = { vw: 400, vh: 400, w: 400, h: 400 };
  const none = { top: 0, right: 0, bottom: 0, left: 0 };

  it("pans each edge of a zoomed stage to the middle of the viewport, and no further", () => {
    expect(panLimit({ s: 4, tx: 1000, ty: -5000 }, box)).toEqual({ s: 4, tx: 200, ty: -1400 });
    expect(panLimit({ s: 4, tx: -900, ty: 100 }, box)).toEqual({ s: 4, tx: -900, ty: 100 });
  });
  it("pans an edge further, to the middle of the part that a panel leaves clear", () => {
    expect(panLimit({ s: 4, tx: -5000, ty: 0 }, box, { ...none, right: 300 })).toEqual({ s: 4, tx: -1550, ty: 0 });
    expect(panLimit({ s: 4, tx: 0, ty: 1000 }, box, { ...none, top: 100 })).toEqual({ s: 4, tx: 0, ty: 250 });
  });
  it("pans a stage that a resize left below zoom 1 until an edge meets the middle", () => {
    expect(panLimit({ s: 0.5, tx: 400, ty: 100 }, box)).toEqual({ s: 0.5, tx: 200, ty: 100 });
  });
  it("keeps the whole stage in place at zoom 1", () => {
    expect(panLimit({ s: 1, tx: 150, ty: -30 }, box, { ...none, right: 300 })).toEqual({ s: 1, tx: 0, ty: 0 });
  });
});

describe("zoomTo", () => {
  const box: Box = { vw: 400, vh: 400, w: 400, h: 400 };

  it("fits a frame into the viewport less its insets, centered in the clear part", () => {
    const frame = { left: 40, top: 40, width: 10, height: 10 };
    const zoom = zoomTo({ ...frame, inset: { top: 0, right: 100, bottom: 100, left: 0 } }, box, 40);
    expect(zoom.s).toBeCloseTo(7.5);
    expect(zoom.tx + (45 / 100) * 400 * zoom.s).toBeCloseTo(150);
    expect(zoom.ty + (45 / 100) * 400 * zoom.s).toBeCloseTo(150);
  });

  it("keeps the zoom for a center with no width, and puts the center in the middle of the clear part", () => {
    const zoom = zoomTo({ x: 45, y: 45, inset: { top: 0, right: 100, bottom: 100, left: 0 } }, box, 40, 6);
    expect([zoom.s, zoom.tx + (45 / 100) * 400 * zoom.s, zoom.ty + (45 / 100) * 400 * zoom.s]).toEqual([6, 150, 150]);
  });
});

describe("lineInFrame", () => {
  const frame = { left: 40, top: 40, width: 20, height: 20 };

  it("finds a segment that crosses the frame with both ends outside it", () => {
    expect(
      lineInFrame(
        [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
        frame,
      ),
    ).toBe(true);
    expect(
      lineInFrame(
        [
          { x: 0, y: 0 },
          { x: 20, y: 90 },
          { x: 90, y: 30 },
        ],
        frame,
      ),
    ).toBe(true);
  });
  it("finds a line with a point inside, and misses one that passes beside the frame", () => {
    expect(
      lineInFrame(
        [
          { x: 50, y: 50 },
          { x: 90, y: 90 },
        ],
        frame,
      ),
    ).toBe(true);
    expect(
      lineInFrame(
        [
          { x: 0, y: 30 },
          { x: 100, y: 30 },
        ],
        frame,
      ),
    ).toBe(false);
    expect(
      lineInFrame(
        [
          { x: 0, y: 60 },
          { x: 60, y: 0 },
        ],
        frame,
      ),
    ).toBe(false);
  });
});
