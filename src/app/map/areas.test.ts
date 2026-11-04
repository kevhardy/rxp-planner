import { describe, expect, it } from "vitest";
import { spawnAreas } from "./areas.ts";

const at = (x: number, y: number, instance = 0) => ({ instance, x, y });
const distances = (points: { x: number; y: number }[], from: { x: number; y: number }) =>
  points.map((p) => Math.hypot(p.x - from.x, p.y - from.y));

describe("spawnAreas", () => {
  it("draws a circle of about 30 yards around a lone spawn", () => {
    const rings = spawnAreas([at(1000, -500, 1)]);
    expect(rings).toHaveLength(1);
    expect(rings[0]!.instance).toBe(1);
    for (const d of distances(rings[0]!.points, at(1000, -500))) expect(d).toBeCloseTo(30.3, 0);
  });

  it("joins spawns 50 yards apart, and not 120", () => {
    expect(spawnAreas([at(0, 0), at(50, 0)])).toHaveLength(1);
    expect(spawnAreas([at(0, 0), at(120, 0)])).toHaveLength(2);
  });

  it("leaves a hole inside a circle of spawns", () => {
    const circle = Array.from({ length: 12 }, (_, k) => at(100 * Math.cos((k * Math.PI) / 6), 100 * Math.sin((k * Math.PI) / 6)));
    const rings = spawnAreas(circle);
    expect(rings).toHaveLength(2);
    const reach = rings.map((r) => Math.max(...distances(r.points, at(0, 0))));
    expect(Math.max(...reach)).toBeGreaterThan(125);
    expect(Math.min(...reach)).toBeLessThan(100);
  });

  it("draws nothing without spawns, and keeps instances apart", () => {
    expect(spawnAreas([])).toEqual([]);
    expect(spawnAreas([at(0, 0, 0), at(0, 0, 1)]).map((r) => r.instance)).toEqual([0, 1]);
  });
});
