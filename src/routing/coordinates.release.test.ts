import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { releaseData } from "../data/releaseInputs.ts";
import { playerCoordinates } from "./coordinates.ts";
import { ARTIFACT_DIR, fixtureManifest } from "./fixtures/repin.ts";
import { nativeToWorld, type NativePosition } from "./frame.ts";
import { zoneGrid } from "./zones.ts";

const data = releaseData();
const native = await fixtureManifest();
/**
 * The fixture's synthetic zone grid: tile [9, 22] only, whose chunk rows 0
 * to 7 are Dun Morogh and rows 8 to 15 Loch Modan, except its last chunk,
 * which has no zone. Ragnar is in row 7; Ghak and Flagongut are on other tiles.
 */
const grid = zoneGrid(native, await readFile(`${ARTIFACT_DIR}zones.bin`));
const at = (p: NativePosition) => playerCoordinates(data, nativeToWorld(native, p), [grid]);

describe("playerCoordinates", () => {
  it.each([
    { npc: "Ragnar Thunderbrew, Kharanos", pixel: [5092, 11516], zone: ["Dun Morogh", 46.83, 52.36], continent: [46.89, 55.66] },
    { npc: "Ghak Healtouch, Thelsamar", pixel: [7504, 11324], zone: ["Loch Modan", 37.07, 49.38], continent: [54.02, 54.81] },
    { npc: "Archaeologist Flagongut, Menethil Harbor", pixel: [5412, 9805], zone: ["Wetlands", 10.84, 60.43], continent: [47.83, 48.07] },
  ] as const)("places $npc", ({ pixel, zone, continent }) => {
    const c = at([...pixel])!;
    expect(c.zone.name).toBe(zone[0]);
    expect(c.zone.x).toBeCloseTo(zone[1], 1);
    expect(c.zone.y).toBeCloseTo(zone[2], 1);
    expect(c.continent!.name).toBe("Eastern Kingdoms");
    expect(c.continent!.x).toBeCloseTo(continent[0], 1);
    expect(c.continent!.y).toBeCloseTo(continent[1], 1);
    expect(
      data.zoneAtContinentPoint(
        data.continents.find((k) => k.instance === 0)!,
        c.continent!.x,
        c.continent!.y,
      )?.name,
    ).toBe(zone[0]);
  });

  it("names the grid's zone, and the zone maps' where the grid gives none", () => {
    // Row 8 of the tile, where the zone maps give Dun Morogh.
    expect(at([5092, 11525])?.zone.name).toBe("Loch Modan");
    expect(playerCoordinates(data, nativeToWorld(native, [5092, 11525]))?.zone.name).toBe("Dun Morogh");
    expect(at([5093, 11749])?.zone.name).toBe("Dun Morogh");
  });

  it("names Kalimdor on map 1", () => {
    const kalimdor = { scope: { ...native.scope, map: 1 }, frame: { ...native.frame, origin: [0, 0] as [number, number] } };
    const c = playerCoordinates(data, nativeToWorld(kalimdor, [20937, 16081]));
    expect([c?.zone.name, c?.continent?.name]).toEqual(["Durotar", "Kalimdor"]);
  });

  it("names Zephras Isle from the grid of map 2991, with no continent", () => {
    const frame = { ...native.frame, origin: [25, 22] as [number, number], size: [9, 8] as [number, number] };
    const zephras = {
      scope: { ...native.scope, map: 2991 },
      frame,
      zones: [0, 2521],
      tiles: Array.from({ length: 72 }, () => new Uint8Array(256).fill(1)),
    };
    const rorian = { instance: 2991, x: 1895, y: 4088.500078 };
    const c = playerCoordinates(data, rorian, [zephras])!;
    expect(c.zone.name).toBe("Zephras Isle");
    expect(c.zone.x).toBeCloseTo(42, 1);
    expect(c.zone.y).toBeCloseTo(23.4, 1);
    expect(c.continent).toBeUndefined();
    expect(playerCoordinates(data, rorian)).toBeUndefined();
  });

  it("has none outside every zone map", () => {
    expect(at([5092, 11516])?.zone.name).toBe("Dun Morogh");
    expect(at([100, 100])).toBeUndefined();
  });
});
