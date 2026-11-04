// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Interior } from "../../../packages/data-contract/interiors.ts";
import type { HeightMap } from "../../data/heightMap.ts";
import { fromSurfaces, type SurfaceMap } from "../../data/surfaces.ts";
import { fixture, groundSurfaces, interiorsFixture } from "../../data/manifestFixture.ts";
import type { LoadedInteriors, LoadedWorldMap } from "../../data/index.ts";
import { InteriorImage, placeInteriors, type InteriorStyle } from "./InteriorLayer.tsx";

// jsdom has no Worker to trace an outline in.
vi.mock("./outline.ts", async (original) => {
  const actual = await original<typeof import("./outline.ts")>();
  return {
    ...actual,
    outline: async (interiors: LoadedInteriors, interior: Interior) => {
      const surfaces = await interiors.surfaces(interior);
      const { width, height } = surfaces.ground;
      return { width, height, path: actual.groundPath(surfaces.ground), masks: { two: "", more: "", twoEdge: "", moreEdge: "" } };
    },
  };
});

afterEach(cleanup);

const floorWithSmallPart: HeightMap = {
  width: 32,
  height: 32,
  values: Uint16Array.from({ length: 32 * 32 }, (_, i) => {
    const [x, y] = [i % 32, Math.floor(i / 32)];
    return x < 24 || (x >= 28 && y < 4) ? 1 : 0;
  }),
};

function clipOf(el: Element): string | undefined {
  const ref = el.getAttribute("clip-path") ?? "";
  const id = /url\(["']?#([^"')]+)/.exec(ref)?.[1];
  return id ? (document.getElementById(id)?.querySelector("path")?.getAttribute("d") ?? undefined) : undefined;
}

function pending() {
  let resolve!: (map: HeightMap) => void;
  const promise = new Promise<HeightMap>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

const map = fixture().terrain;
const cave = { ...interiorsFixture().interiors.interiors[0]!, bounds: { north: 650, south: 550, west: 150, east: 50 } };
const other = { ...cave, id: "other" };

function groundMap(ground: (interior: Interior) => Promise<HeightMap>, image = async (path: string) => `blob:${path}`, first = cave) {
  const loaded: LoadedWorldMap = {
    ...map,
    tileBase: "/data/world/",
    interiors: {
      list: [first, other],
      image,
      surfaces: (interior): Promise<SurfaceMap> => ground(interior).then((heights) => fromSurfaces(interior, groundSurfaces(heights))),
      loadedSurfaces: () => undefined,
    },
  };
  const [placed, placedOther] = placeInteriors(map, [first, other]);
  return { map: loaded, placed: placed!, placedOther: placedOther! };
}

it.each<InteriorStyle>(["minimap", "plan"])(
  "shows %s only after its outline loads, clipped to that outline even where a part is too small to outline",
  async (look) => {
    const heights = pending();
    const { map, placed } = groundMap(() => heights.promise);
    render(<InteriorImage map={map} placed={placed} look={look} pxPerPercent={10} />);
    const picture = () =>
      [...document.querySelectorAll("image.interior-layer")].find((el) => el.getAttribute("href")?.endsWith(`ground-${look}.webp`));
    await act(() => Promise.resolve());
    expect(picture()).toBeUndefined();
    await act(async () => heights.resolve(floorWithSmallPart));
    const line = () => document.querySelector("path.interior-outline-line")?.getAttribute("d");
    await waitFor(() => expect(line()).toBe("M0,0L24,0L24,32L0,32Z"));
    expect(picture()?.getAttribute("href")).toBe(`blob:interiors/the-deadmines-35530/ground-${look}.webp`);
    expect(clipOf(picture()!)).toBe("M0,0L24,0L24,32L0,32Z");
  },
);

it("fills the whole outline under the ground art when the interior has no indoor mask", async () => {
  const { map, placed } = groundMap(async () => floorWithSmallPart);
  render(<InteriorImage map={map} placed={placed} look="minimap" pxPerPercent={10} />);
  await waitFor(() => expect(document.querySelector("path.interior-outline-line")?.getAttribute("d")).toBe("M0,0L24,0L24,32L0,32Z"));
  const fill = document.querySelector("path.interior-fill");
  expect(fill?.getAttribute("d")).toBe("M0,0L24,0L24,32L0,32Z");
  expect(fill?.getAttribute("mask")).toBeNull();
  expect(fill?.compareDocumentPosition(document.querySelector("image.interior-layer")!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

it("shows the ground art only after its indoor mask loads, and masks only the fill with it", async () => {
  const indoor = "interiors/the-deadmines-35530/ground-indoor.webp";
  let resolveMask!: (url: string) => void;
  const image = (path: string) =>
    path === indoor ? new Promise<string>((ready) => (resolveMask = ready)) : Promise.resolve(`blob:${path}`);
  const { map, placed } = groundMap(async () => floorWithSmallPart, image, { ...cave, ground: { ...cave.ground, indoor } });
  render(<InteriorImage map={map} placed={placed} look="minimap" pxPerPercent={10} />);
  await act(() => Promise.resolve());
  expect(document.querySelector("image.interior-layer")).toBeNull();
  await act(async () => resolveMask(`blob:${indoor}`));
  await waitFor(() => expect(document.querySelector("path.interior-fill")?.getAttribute("d")).toBe("M0,0L24,0L24,32L0,32Z"));
  const id = /url\(#([^)]+)\)/.exec(document.querySelector("path.interior-fill")?.getAttribute("mask") ?? "")?.[1] ?? "";
  const mask = document.getElementById(id)?.querySelector("image");
  expect(["href", "width", "height", "preserveAspectRatio"].map((a) => mask?.getAttribute(a))).toEqual([
    "blob:interiors/the-deadmines-35530/ground-indoor.webp",
    "32",
    "32",
    "none",
  ]);
  expect(document.querySelector("image.interior-layer")?.getAttribute("mask")).toBeNull();
});

it("shows ground too small to outline unclipped and without a fill", async () => {
  const tiny: HeightMap = {
    width: 32,
    height: 32,
    values: Uint16Array.from({ length: 32 * 32 }, (_, i) => (i % 32 < 4 && i < 32 * 4 ? 1 : 0)),
  };
  const { map, placed } = groundMap(async () => tiny);
  render(<InteriorImage map={map} placed={placed} look="minimap" pxPerPercent={10} />);
  await waitFor(() =>
    expect(document.querySelector("image.interior-layer")?.getAttribute("href")).toBe(
      "blob:interiors/the-deadmines-35530/ground-minimap.webp",
    ),
  );
  expect(document.querySelector("path.interior-outline-line")?.getAttribute("d")).toBe("");
  expect(document.querySelector("path.interior-fill")).toBeNull();
});

it("keeps the interior in view clipped to its own outline when the outline of an earlier one finishes late", async () => {
  const first = pending();
  const second = pending();
  const { map, placed, placedOther } = groundMap((interior) => (interior.id === "other" ? second.promise : first.promise));
  const { rerender } = render(<InteriorImage map={map} placed={placed} look="minimap" pxPerPercent={10} />);
  await act(() => Promise.resolve());
  rerender(<InteriorImage map={map} placed={placedOther} look="minimap" pxPerPercent={10} />);
  expect(document.querySelector("image.interior-layer")).toBeNull();
  await act(async () => second.resolve({ width: 32, height: 32, values: new Uint16Array(32 * 32).fill(1) }));
  const shown = () => {
    const picture = document.querySelector("image.interior-layer")!;
    return [clipOf(picture), document.querySelector(".interior-outline-line")?.getAttribute("d")];
  };
  expect(shown()).toEqual(["M0,0L32,0L32,32L0,32Z", "M0,0L32,0L32,32L0,32Z"]);
  await act(async () => first.resolve(floorWithSmallPart));
  expect(shown()).toEqual(["M0,0L32,0L32,32L0,32Z", "M0,0L32,0L32,32L0,32Z"]);
});

it("shows no image when its URL loads but its height maps reject", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const failed = new Error("Invalid height map checksum");
  const { map, placed } = groundMap(() => Promise.reject(failed));
  render(<InteriorImage map={map} placed={placed} look="minimap" pxPerPercent={10} />);
  await waitFor(() => expect(warn).toHaveBeenCalledWith("Interior outline did not load", failed));
  expect(document.querySelector("image.interior-layer")).toBeNull();
  warn.mockRestore();
});

it("asks again for an outline that failed once its interior comes back into view", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const failed = new Error("Invalid height map checksum");
  const answers = [() => Promise.reject(failed), async () => floorWithSmallPart];
  const full = { width: 32, height: 32, values: new Uint16Array(32 * 32).fill(1) };
  const { map, placed, placedOther } = groundMap((interior) => (interior.id === "other" ? Promise.resolve(full) : answers.shift()!()));
  const line = () => document.querySelector("path.interior-outline-line")?.getAttribute("d");
  const { rerender } = render(<InteriorImage map={map} placed={placed} look="minimap" pxPerPercent={10} />);
  await waitFor(() => expect(warn.mock.calls).toEqual([["Interior outline did not load", failed]]));
  rerender(<InteriorImage map={map} placed={placedOther} look="minimap" pxPerPercent={10} />);
  await waitFor(() => expect(line()).toBe("M0,0L32,0L32,32L0,32Z"));
  rerender(<InteriorImage map={map} placed={placed} look="minimap" pxPerPercent={10} />);
  await waitFor(() => expect(line()).toBe("M0,0L24,0L24,32L0,32Z"));
  warn.mockRestore();
});
