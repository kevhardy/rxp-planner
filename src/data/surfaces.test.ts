import { describe, expect, it } from "vitest";
import type { WorldPoint } from "../../packages/data-contract/geometry.ts";
import type { Interior } from "../../packages/data-contract/interiors.ts";
import type { HeightMap } from "./heightMap.ts";
import { groundSurfaces, interiorsFixture } from "./manifestFixture.ts";
import { fromSurfaces } from "./surfaces.ts";

const f = interiorsFixture();
const cave = f.interiors.interiors[0]!;
const pixel = (col: number, row: number) => ({ instance: 0, x: 1516.5 - (col + 0.5) / 2, y: -11093 - (row + 0.5) / 2 });
const heightAt = (interior: Interior, map: HeightMap, at: WorldPoint) => fromSurfaces(interior, groundSurfaces(map)).at(at)[0]?.height;
const jasperlode = {
  ...cave,
  id: "jasperlode-mine-71446",
  label: "Jasperlode Mine",
  placement: { model: 111538, id: 71446 },
  places: ["Jasperlode Mine"],
};

describe("surfaces", () => {
  const mine = { ...jasperlode, heightBase: 0, bounds: { north: -9100, south: -9102, west: -600, east: -603 } };
  const surfaces = fromSurfaces(mine, {
    width: 3,
    height: 2,
    groundHeight: Uint16Array.of(9, 9, 9, 0, 0, 33),
    groundPlace: new Uint8Array(6),
    stacked: Uint32Array.of(1, 2),
    upperStart: Uint32Array.of(0, 1, 3),
    upperHeight: Uint16Array.of(17, 17, 25),
    upperPlace: new Uint8Array(3),
  });
  const at = (x: number, y: number) => ({ instance: 0, x: -600 - x, y: -9100 - y });
  const two = [
    { height: 1, place: "Jasperlode Mine", rank: 0, of: 2 },
    { height: 2, place: "Jasperlode Mine", rank: 1, of: 2 },
  ];

  it("gives the surfaces at a pixel, bottom first", () => {
    expect([surfaces.at(at(0.5, 0.5)), surfaces.at(at(1.5, 0.5)), surfaces.at(at(2.5, 0.5))]).toEqual([
      [{ height: 1, place: "Jasperlode Mine", rank: 0, of: 1 }],
      two,
      [
        { height: 1, place: "Jasperlode Mine", rank: 0, of: 3 },
        { height: 2, place: "Jasperlode Mine", rank: 1, of: 3 },
        { height: 3, place: "Jasperlode Mine", rank: 2, of: 3 },
      ],
    ]);
    expect([...surfaces.ground.values]).toEqual([9, 9, 9, 0, 0, 33]);
  });

  it("takes the surfaces of the nearest pixel with ground where a pixel has none", () => {
    expect([surfaces.at(at(1.5, 1.5)), surfaces.at(at(2.5, 1.5))]).toEqual([
      two,
      [{ height: 4, place: "Jasperlode Mine", rank: 0, of: 1 }],
    ]);
  });

  it("finds the surface nearest a height, and the lower one on a tie", () => {
    expect([1.4, 1.5, 1.6, 9].map((h) => surfaces.nearest(at(2.5, 0.5), h)?.height)).toEqual([1, 1, 2, 3]);
    expect(surfaces.nearest(at(1.5, 0.5), 1.5)?.height).toBe(1);
  });

  it("marks pixels where 2 surfaces stack, and where 3 or more do", () => {
    expect([...surfaces.stackMask()]).toEqual([0, 2, 3, 0, 0, 0]);
  });
});

describe("surfaces from a surfaces asset", () => {
  const fromAsset = fromSurfaces(cave, f.surfaces);

  it("takes the nearest ground pixel where a pixel has none, and clamps a point outside the image", () => {
    const heights = (at: WorldPoint) => fromAsset.at(at).map((s) => s.height);
    expect([heights(pixel(1, 0)), heights(pixel(0, 0)), heights(pixel(7, -3))]).toEqual([[20, 37], [20, 37], [51]]);
  });

  it("names each surface's place, and gives the interior's label to a surface with no place", () => {
    expect([fromAsset.at(pixel(3, 1)), fromAsset.at(pixel(0, 1)), fromAsset.at(pixel(2, 1))]).toEqual([
      [{ height: 51, place: "The Deadmines", rank: 0, of: 1 }],
      [
        { height: 20, place: "Defias Hideout", rank: 0, of: 2 },
        { height: 37, place: "The Deadmines", rank: 1, of: 2 },
      ],
      [
        { height: 43.125, place: "The Deadmines", rank: 0, of: 2 },
        { height: 49.375, place: "The Deadmines", rank: 1, of: 2 },
      ],
    ]);
  });
});

describe("the pixel of a point", () => {
  describe("with real cave bounds and one nearest surface pixel", () => {
    const lone = ([width, height]: [number, number], [x, y]: [number, number], v: number): HeightMap => {
      const values = new Uint16Array(width * height);
      values[y * width + x] = v;
      return { width, height, values };
    };
    const den = {
      ...cave,
      id: "the-grizzled-den-350747",
      label: "The Grizzled Den",
      placement: { model: 111052, id: 350747 },
      size: [660, 602] as [number, number],
      places: ["The Grizzled Den"],
      heightBase: 343,
      bounds: { north: -5347.8148919630075, south: -5648.567554304715, west: -81.38843145616556, east: -411.1773919934094 },
    };
    const denMap = lone([660, 602], [561, 336], 154);
    const quarry = {
      ...cave,
      id: "golbolar-quarry-mine-350748",
      label: "Gol'Bolar Quarry Mine",
      placement: { model: 111061, id: 350748 },
      size: [670, 640] as [number, number],
      places: ["Gol'Bolar Quarry"],
      heightBase: 335,
      bounds: { north: -5484.3789571535635, south: -5804.040131089121, west: -1613.2697371035538, east: -1947.9754991639093 },
    };
    const quarryMap = lone([670, 640], [221, 425], 217);
    const at = ({ bounds: b }: Interior, { width, height }: HeightMap, col: number, row: number) => ({
      instance: 0,
      x: b.west - (col / width) * (b.west - b.east),
      y: b.north - (row / height) * (b.north - b.south),
    });

    it("gives no surface to an owner route start far outside the cave", () => {
      const denStart = { instance: 0, x: -406.25, y: -5537.5 };
      const quarryStart = { instance: 0, x: -1765.625, y: -5716.666666666667 };
      expect([heightAt(den, denMap, denStart), heightAt(quarry, quarryMap, quarryStart)]).toEqual([undefined, undefined]);
      expect([
        heightAt(den, denMap, at(den, denMap, 561.5, 336.5)),
        heightAt(quarry, quarryMap, at(quarry, quarryMap, 221.5, 425.5)),
      ]).toEqual([362.125, 362]);
    });

    it("takes the nearest surface up to 2.25 pixels away", () => {
      expect(heightAt(den, denMap, at(den, denMap, 561.5 + 2.2, 336.5))).toBe(362.125);
      expect(heightAt(den, denMap, at(den, denMap, 561.5, 336.5 - 2.2))).toBe(362.125);
      expect(heightAt(den, denMap, at(den, denMap, 561.5 + 2.3, 336.5))).toBeUndefined();
    });
  });

  describe("on a 5 by 5 map with one world yard for each pixel", () => {
    const square = { ...jasperlode, heightBase: 0, bounds: { north: -9100, south: -9105, west: -600, east: -605 } };
    const map = (rows: number[][]): HeightMap => ({ width: 5, height: 5, values: Uint16Array.from(rows.flat()) });
    const at = ({ bounds }: Interior, x: number, y: number) => ({ instance: 0, x: bounds.west - x, y: bounds.north - y });

    it("takes the surface pixel nearest the exact point, not the first one in the ring", () => {
      const rows = [
        [0, 0, 0, 0, 0],
        [0, 9, 0, 0, 0],
        [0, 0, 0, 17, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ];
      expect(heightAt(square, map(rows), at(square, 2.9, 2.5))).toBe(2);
      rows[2]![3] = 0;
      rows[2]![4] = 25;
      expect(heightAt(square, map(rows), at(square, 2.95, 2.5))).toBe(3);
    });

    it("takes the pixel in the top row, then the left column, from pixels at the same distance", () => {
      const rows = [
        [0, 0, 0, 0, 0],
        [0, 0, 9, 0, 0],
        [0, 17, 0, 25, 0],
        [0, 0, 33, 0, 0],
        [0, 0, 0, 0, 0],
      ];
      expect(heightAt(square, map(rows), at(square, 2.5, 2.5))).toBe(1);
      rows[1]![2] = 0;
      expect(heightAt(square, map(rows), at(square, 2.5, 2.5))).toBe(2);
    });

    it("takes 383.25 for native pixel 4249, 12428 on Level 1 of the Coldridge Valley cave", () => {
      const level1 = {
        ...cave,
        id: "coldridge-valley-8515",
        label: "Coldridge Valley",
        placement: { model: 111043, id: 8515 },
        places: [],
        heightBase: 366,
        bounds: { north: -6545, south: -6550, west: 375, east: 370 },
      };
      const crop = [
        [132, 132, 132, 133, 135],
        [137, 248, 134, 136, 138],
        [0, 0, 0, 139, 141],
        [0, 0, 0, 141, 143],
        [0, 0, 0, 0, 146],
      ];
      expect(heightAt(level1, map(crop), at(level1, 2.81830116630886, 2.20112966332064))).toBe(383.25);
    });
  });
});
