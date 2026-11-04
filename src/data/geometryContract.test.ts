import { describe, expect, it } from "vitest";
import {
  canvasToWorld,
  locateCanvas,
  mapToWorld,
  percentToWorld,
  restoreMapBounds,
  worldToCanvas,
  worldToMap,
  type MapBoundsRecords,
  type WorldBounds,
} from "../../packages/data-contract/geometry.ts";
import { terrainGeometry, type TerrainGeometry } from "../../packages/data-contract/worldMap.ts";

describe("serialized map geometry", () => {
  const bounds: WorldBounds = { instance: 1, minX: -100, minY: -200, maxX: 300, maxY: 600 };
  const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  it("restores shared edition bounds and resolves equal parsed objects, exclusive maps, and unknown maps", () => {
    const parsed = roundTrip({ classic: { 10: bounds }, forever: { 10: bounds, 20: { ...bounds, instance: 2991 } } });
    expect(parsed.classic[10]).not.toBe(parsed.forever[10]);
    const classic = restoreMapBounds(parsed.classic);
    const forever = restoreMapBounds(parsed.forever, classic);
    expect(forever.get(10)).toBe(classic.get(10));
    expect(classic.has(20)).toBe(false);
    expect(restoreMapBounds({}, classic).size).toBe(0);
    expect(percentToWorld([parsed.classic[10], parsed.forever[10]], 25, 75)).toEqual({
      ok: true,
      world: { instance: 1, x: 400, y: 0 },
      bounds,
    });
    expect(percentToWorld([classic.get(20), forever.get(20)], 25, 75)).toEqual({
      ok: true,
      world: { instance: 2991, x: 400, y: 0 },
      bounds: { ...bounds, instance: 2991 },
    });
    expect(percentToWorld([classic.get(99), forever.get(99)], 25, 75)).toEqual({ ok: false, reason: "no-bounds" });
    expect(worldToMap(classic.get(10)!, { x: 400, y: 0 })).toEqual({ x: 25, y: 75 });
    expect(mapToWorld(forever.get(10)!, 25, 75)).toEqual({ x: 400, y: 0 });
    const placed = percentToWorld([classic.get(10), forever.get(10)], 25, 75);
    expect(placed.ok && placed.bounds).toBe(forever.get(10));
  });

  it.each([
    ["instance", 2, { instance: 2, x: 400, y: 0 }],
    ["minX", -200, { instance: 1, x: 400, y: -75 }],
    ["minY", -400, { instance: 1, x: 350, y: 0 }],
    ["maxX", 700, { instance: 1, x: 400, y: 100 }],
    ["maxY", 1000, { instance: 1, x: 700, y: 0 }],
  ] as const)("keeps a different %s ambiguous unless the client is declared", (field, value, world) => {
    const parsed = roundTrip<{ classic: MapBoundsRecords; forever: MapBoundsRecords }>({
      classic: { 10: bounds },
      forever: { 10: { ...bounds, [field]: value } },
    });
    const classic = restoreMapBounds(parsed.classic);
    const forever = restoreMapBounds(parsed.forever, classic);
    expect(forever.get(10)).not.toBe(classic.get(10));
    expect(percentToWorld([classic.get(10), forever.get(10)], 25, 75)).toEqual({ ok: false, reason: "ambiguous-map" });
    expect(percentToWorld([forever.get(10)], 25, 75)).toEqual({ ok: true, world, bounds: parsed.forever[10] });
  });

  it("preserves calibrated terrain placement, tile ambiguity, crop, and unknown positions", () => {
    const area = {
      width: 1024,
      height: 1024,
      canvasX: 100,
      canvasY: 200,
      originCol: 31,
      originRow: 30,
      cropLeft: 128,
    };
    const map = roundTrip(
      terrainGeometry({
        tileSize: 256,
        minZoom: 1,
        nativeZoom: 2,
        pxPerChunk: 512,
        yardsPerChunk: 533.33333,
        canvas: { left: 228, width: 1124, height: 1224 },
        areas: [
          { ...area, key: "kalimdor", map: 1, tiles: { 2: [[1, 1, 1]] } },
          { ...area, key: "zephras-isle", map: 2991, originCol: 30, originRow: 29, tiles: { 2: [[0, 1, 1]] } },
        ],
      } satisfies TerrainGeometry),
    );
    const at = { x: 356, y: 456 };
    const world = { instance: 1, x: 266.666665, y: 799.999995 };
    const expectedWorld = { ...world, y: expect.closeTo(799.999995, 8) };
    expect(canvasToWorld(map, at)).toEqual(expectedWorld);
    expect(worldToCanvas(map, world)).toEqual(at);
    expect(locateCanvas(map, "kalimdor", at)).toEqual({ ok: true, world: expectedWorld });
    expect(locateCanvas(map, "zephras-isle", at)).toEqual({ ok: false, reason: "ambiguous" });
    expect(canvasToWorld(map, { x: 227, y: 456 })).toBeUndefined();
    expect(locateCanvas(map, "kalimdor", { x: 227, y: 456 })).toEqual({ ok: false, reason: "off-map" });
    expect(worldToCanvas(map, { ...world, instance: 999 })).toBeUndefined();
  });
});
