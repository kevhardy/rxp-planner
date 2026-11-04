// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Interior } from "../../../packages/data-contract/interiors.ts";
import { interiorsFixture } from "../../data/manifestFixture.ts";
import { fromSurfaces, type SurfaceMap } from "../../data/surfaces.ts";
import type { LoadedInteriors } from "../../data/worldMap.ts";
import type { WorldStop } from "../../routing/plan.ts";
import { levelOf, useSurfaces } from "./Interiors.tsx";

afterEach(cleanup);
const { interiors: file, surfaces } = interiorsFixture();
const cave = file.interiors[0]!;
const STORMWIND_PLACES = [
  "Cathedral Square",
  "Cathedral of Light",
  "Champion's Hall",
  "Command Center",
  "Cut-Throat Alley",
  "Dwarven District",
  "Mage Quarter",
  "Old Town",
  "Petitioner's Chamber",
  "Royal Gallery",
  "Royal Library",
  "SI:7",
  "Stormwind City",
  "Stormwind Harbor",
  "Stormwind Keep",
  "The Canals",
  "The Park",
  "The Slaughtered Lamb",
  "Trade District",
  "Valley of Heroes",
  "War Room",
  "Wizard's Sanctum",
];
const at = (id: string, bounds: Interior["bounds"], extra: Partial<Interior>): Interior => ({ ...cave, id, bounds, ...extra });
const city = at(
  "stormwind",
  { north: -8081.93, south: -9344.89, west: 1438.14, east: 208.17 },
  { kind: "city", label: "Stormwind City", heightBase: 30, places: STORMWIND_PLACES },
);
const hall = at(
  "stormwind-harbor-66885945",
  { north: -8490.09, south: -8526.35, west: 1338.16, east: 1292.05 },
  { kind: "building", label: "Stormwind Harbor", heightBase: 5, places: [] },
);
const built = new Map([city, hall].map((interior) => [interior.id, fromSurfaces(interior, surfaces)]));
const loaded: LoadedInteriors = {
  list: [city, hall],
  image: async (path) => `blob:${path}`,
  surfaces: async (interior) => built.get(interior.id)!,
  loadedSurfaces: (interior) => built.get(interior.id),
};
const pixel = ({ bounds: b }: Interior, col: number, row: number, width = 4, height = 2) => ({
  instance: 0,
  x: b.west - ((col + 0.5) * (b.west - b.east)) / width,
  y: b.north - ((row + 0.5) * (b.north - b.south)) / height,
});
const inCity = pixel(city, 0, 1);
const outside = { instance: 0, x: 62, y: -9464 };

describe("the level of a stop", () => {
  it("is the surface nearest its height among the surfaces at its point, counted from the bottom", () => {
    const surfaces = [
      { height: 54.875, place: "Cathedral Square", rank: 0, of: 2 },
      { height: 61.125, place: "Cathedral of Light", rank: 1, of: 2 },
    ];
    expect([
      levelOf(loaded, { ...pixel(city, 2, 0), height: 61.125 }),
      levelOf(loaded, { ...pixel(city, 2, 0), height: null }),
      levelOf(loaded, { ...outside, height: 61.125 }),
    ]).toEqual([
      { interior: city, surfaces, onWorldMap: false, level: surfaces[1] },
      { interior: city, surfaces, onWorldMap: true, level: undefined },
      undefined,
    ]);
  });
});

describe("the surfaces to load", () => {
  it("loads the interior in view and each stop's interior once, and renders again when one loads", async () => {
    const memory = new Map<string, SurfaceMap>();
    const surfaces = vi.fn(async (interior: Interior) => {
      await Promise.resolve();
      memory.set(interior.id, built.get(interior.id)!);
      return built.get(interior.id)!;
    });
    const interiors = { ...loaded, surfaces, loadedSurfaces: (interior: Interior) => memory.get(interior.id) };
    const stops = [{ ...inCity, height: 38 }];
    const { result, rerender } = renderHook(
      ({ inView }: { inView: Interior | undefined }) => {
        useSurfaces(interiors, stops, inView);
        return levelOf(interiors, stops[0]!)?.level;
      },
      { initialProps: { inView: hall } },
    );
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toEqual({ height: 38, place: "Cathedral Square", rank: 0, of: 2 }));
    rerender({ inView: city });
    expect(surfaces.mock.calls.map(([interior]) => interior.id)).toEqual(["stormwind-harbor-66885945", "stormwind"]);
  });

  it("asks again for surfaces that failed once they are needed again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = new Error("Invalid height map checksum");
    const memory = new Map<string, SurfaceMap>();
    const answers = [
      () => Promise.reject(failed),
      async () => {
        memory.set(city.id, built.get(city.id)!);
        return built.get(city.id)!;
      },
    ];
    const interiors = { ...loaded, surfaces: () => answers.shift()!(), loadedSurfaces: (interior: Interior) => memory.get(interior.id) };
    const none: WorldStop[] = [];
    let inView: Interior | undefined = city;
    const { result, rerender } = renderHook(() => {
      useSurfaces(interiors, none, inView);
      return levelOf(interiors, { ...inCity, height: 38 })?.level;
    });
    await waitFor(() => expect(warn.mock.calls).toEqual([["Height map did not load", failed]]));
    inView = undefined;
    await act(async () => rerender());
    inView = city;
    await act(async () => rerender());
    await waitFor(() => expect(result.current).toEqual({ height: 38, place: "Cathedral Square", rank: 0, of: 2 }));
    warn.mockRestore();
  });
});
