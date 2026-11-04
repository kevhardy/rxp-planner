import { describe, expect, it } from "vitest";
import { interiorAt, surfaceOutline, type HeightMap } from "./heightMap.ts";
import { interiorsFixture } from "./manifestFixture.ts";

const cave = interiorsFixture().interiors.interiors[0]!;
const city = {
  ...cave,
  id: "stormwind",
  label: "Stormwind City",
  kind: "city",
  bounds: { north: -8081.93, south: -9344.89, west: 1438.14, east: 208.17 },
} as const;
const harbor = {
  ...cave,
  id: "stormwind-harbor-66885945",
  label: "Stormwind Harbor",
  kind: "building",
  bounds: { north: -8490.09, south: -8526.35, west: 1338.16, east: 1292.05 },
} as const;

describe("height maps", () => {
  it("finds the smallest interior that holds a world point on its map", () => {
    expect(interiorAt([city, harbor], { instance: 0, x: 1315, y: -8500 })?.id).toBe("stormwind-harbor-66885945");
    expect(interiorAt([city, harbor], { instance: 0, x: 900, y: -8500 })?.id).toBe("stormwind");
    expect(interiorAt([city, harbor], { instance: 1, x: 1315, y: -8500 })).toBeUndefined();
  });

  describe("the outer edge of a height map's surface", () => {
    const paint = (
      width: number,
      height: number,
      ...rects: [left: number, top: number, right: number, bottom: number, value: number][]
    ): HeightMap => {
      const values = new Uint16Array(width * height);
      for (const [left, top, right, bottom, v] of rects)
        for (let y = top; y < bottom; y++) values.fill(v, y * width + left, y * width + right);
      return { width, height, values };
    };
    const square = (left: number, top: number, right: number, bottom: number) => [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ];

    it("starts each loop at the left end of its top row and runs clockwise on screen, with a point only where the edge turns", () => {
      expect(surfaceOutline(paint(40, 40, [20, 0, 30, 30, 1], [0, 20, 40, 30, 1]))).toEqual([
        [
          [20, 0],
          [30, 0],
          [30, 20],
          [40, 20],
          [40, 30],
          [0, 30],
          [0, 20],
          [20, 20],
        ],
      ]);
    });

    it("draws the outer edge of a part but not the edge of a gap in it", () => {
      expect(surfaceOutline(paint(30, 30, [0, 0, 30, 30, 1], [10, 10, 20, 20, 0]))).toEqual([square(0, 0, 30, 30)]);
    });

    it("draws one loop for each separate part, top part first, and joins parts that touch at a corner", () => {
      expect(surfaceOutline(paint(60, 60, [30, 0, 53, 23, 1], [0, 10, 23, 33, 1]))).toEqual([square(30, 0, 53, 23), square(0, 10, 23, 33)]);
      expect(surfaceOutline(paint(46, 46, [0, 0, 23, 23, 1], [23, 23, 46, 46, 1]))).toEqual([
        [
          [0, 0],
          [23, 0],
          [23, 23],
          [46, 23],
          [46, 46],
          [23, 46],
          [23, 23],
          [0, 23],
        ],
      ]);
    });

    it("draws an island in a courtyard as its own part, without the courtyard's edge", () => {
      expect(surfaceOutline(paint(40, 40, [0, 0, 40, 40, 1], [5, 5, 35, 35, 0], [8, 8, 31, 31, 1]))).toEqual([
        square(0, 0, 40, 40),
        square(8, 8, 31, 31),
      ]);
    });

    it("leaves out a part that encloses fewer than 512 pixels", () => {
      const map = paint(40, 80, [0, 0, 7, 73, 1], [10, 0, 26, 32, 1], [30, 50, 31, 51, 1]);
      expect(surfaceOutline(map)).toEqual([square(10, 0, 26, 32)]);
    });
  });
});
