import { describe, expect, it } from "vitest";
import { releaseData, releaseGeometry } from "./releaseInputs.ts";

describe("formatLocation", () => {
  it("round-trips through locateGoto for every zone map", () => {
    const data = releaseData();
    const zones = data.zones.filter((z) => z.uiMapId !== undefined && data.mapBounds.has(z.uiMapId));
    expect(zones.length).toBeGreaterThan(0);
    for (const { uiMapId } of zones) {
      expect(data.locateGoto(data.formatLocation({ uiMapId: uiMapId!, x: 12.34, y: 56.78 }))).toMatchObject({
        ok: true,
        uiMapId,
        x: 12.34,
        y: 56.78,
      });
    }
  });
});

describe("locateQuestPoint", () => {
  it("gives every zone the dataset geometry's bounds for its map", () => {
    const data = releaseData();
    const mapped = data.zones.filter((zone) => zone.uiMapId !== undefined && releaseGeometry.bounds[zone.uiMapId]);
    expect(mapped.length).toBeGreaterThan(0);
    for (const zone of mapped) expect(zone.bounds).toEqual(releaseGeometry.bounds[zone.uiMapId!]);
  });
});

describe("quests", () => {
  it("places all 520 Zephras Isle giver and ender points on a map with bounds", () => {
    const data = releaseData();
    const zephras = data.quests.flatMap((q) => [...q.startPoints, ...q.endPoints].filter((p) => p.zoneId === 16593));
    expect(zephras).toHaveLength(520);
    expect(zephras.every((p) => data.mapBounds.has(p.uiMapId))).toBe(true);
  });
});
