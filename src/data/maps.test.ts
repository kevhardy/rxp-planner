import { MAP_BOUNDS } from "./plannerFixture.ts";
import { beforeAll, describe, expect, it } from "vitest";
import { canvasToWorld, locateCanvas, mapToWorld, nearest, within, worldToCanvas, yards } from "./maps.ts";
import { terrainFixture } from "./terrainFixture.ts";
import type { WorldMapData } from "./worldMap.ts";

let map: WorldMapData;
beforeAll(async () => {
  map = structuredClone(terrainFixture);
});

describe("terrain canvas", () => {
  it("converts world positions to canvas pixels and back on every area", () => {
    const points = [
      { instance: 1, ...mapToWorld(MAP_BOUNDS.get(1411)!, 51.52, 41.63) },
      { instance: 0, ...mapToWorld(MAP_BOUNDS.get(1429)!, 43.77, 65.8) },
      { instance: 2991, ...mapToWorld(MAP_BOUNDS.get(2521)!, 43, 43.2) },
    ];
    for (const world of points) {
      const at = worldToCanvas(map, world);
      expect(at).toBeDefined();
      const back = canvasToWorld(map, at!)!;
      expect(back.instance).toBe(world.instance);
      expect(back.x).toBeCloseTo(world.x, 6);
      expect(back.y).toBeCloseTo(world.y, 6);
    }
  });

  it("places chunk corners on the canvas as the area's origin says", () => {
    const zephras = map.areas.find((a) => a.key === "zephras-isle")!;
    // HBD x runs along columns and y along rows; chunk 32 is world 0.
    const corner = { instance: 2991, x: (32 - zephras.originCol) * map.yardsPerChunk, y: (32 - zephras.originRow) * map.yardsPerChunk };
    expect(worldToCanvas(map, corner)).toEqual({ x: zephras.canvasX, y: zephras.canvasY });
  });

  it("includes edges and leaves out cropped art, other instances, and empty canvas", () => {
    const kalimdor = map.areas.find((a) => a.key === "kalimdor")!;
    const edge = { x: kalimdor.canvasX + kalimdor.cropLeft, y: kalimdor.canvasY + kalimdor.height };
    expect(canvasToWorld(map, edge)?.instance).toBe(1);
    expect(canvasToWorld(map, { x: edge.x - 1, y: 100 })).toBeUndefined();
    const cropped = canvasToWorld(map, { x: edge.x, y: 100 })!;
    expect(worldToCanvas(map, { ...cropped, x: cropped.x + 1 })).toBeUndefined();
    expect(worldToCanvas(map, { instance: 2997, ...mapToWorld(MAP_BOUNDS.get(2524)!, 50, 50) })).toBeUndefined();
    expect(canvasToWorld(map, { x: map.canvas.width + 1, y: 10000 })).toBeUndefined();
  });

  it("gives pixels where Kalimdor and Zephras Isle overlap to the area with a tile there", () => {
    expect(canvasToWorld(map, { x: 24700, y: 10850 })?.instance).toBe(1);
    expect(canvasToWorld(map, { x: 24700, y: 9000 })?.instance).toBe(2991);
  });

  it("places a pixel by the area its source declares, not the area drawn on top", () => {
    const overlap = { x: 24700, y: 10850 };
    expect(locateCanvas(map, "kalimdor", overlap)).toMatchObject({ ok: true, world: { instance: 1 } });
    expect(locateCanvas(map, "zephras-isle", overlap)).toEqual({ ok: false, reason: "ambiguous" });
    expect(locateCanvas(map, "kalimdor", { x: 24700, y: 9000 })).toMatchObject({ ok: true, world: { instance: 1 } });
    expect(locateCanvas(map, "zephras-isle", { x: 24700, y: 9000 })).toMatchObject({ ok: true, world: { instance: 2991 } });
    expect(locateCanvas(map, "kalimdor", { x: 26000, y: 9000 })).toEqual({ ok: false, reason: "wrong-instance" });
    expect(locateCanvas(map, "kalimdor", { x: 30000, y: 30000 })).toEqual({ ok: false, reason: "off-map" });
    expect(locateCanvas(map, "kalimdor", { x: 15401.2, y: 8193.3 })).toMatchObject({ ok: true, world: { instance: 1 } });
  });
});

describe("world distance", () => {
  const at = { instance: 0, x: 0, y: 0 };
  const east = { instance: 0, x: 3, y: 4 };
  const north = { instance: 0, x: 0, y: 5 };
  const elsewhere = { instance: 1, x: 0, y: 0 };

  it("measures yards in one instance and none across instances", () => {
    expect(yards(at, east)).toBe(5);
    expect(yards(at, elsewhere)).toBe(Infinity);
  });

  it("keeps a point in another instance out of any radius", () => {
    expect(within(east, at, 5)).toBe(true);
    expect(within(east, at, 4.9)).toBe(false);
    expect(within(elsewhere, at, Infinity)).toBe(false);
  });

  it("finds the nearest point in the instance, the first on a tie", () => {
    const far = { instance: 0, x: 10, y: 0 };
    expect(nearest([elsewhere, far, east, north], at)).toBe(east);
    expect(nearest([elsewhere], at)).toBeUndefined();
    expect(nearest([east], null)).toBeUndefined();
  });
});
