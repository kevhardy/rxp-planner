// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Interior } from "../../../packages/data-contract/interiors.ts";
import type { InteriorSurfaces } from "../../../packages/data-contract/interiorSurfaces.ts";
import type { HeightMap } from "../../data/heightMap.ts";
import { worldToCanvas, type LoadedInteriors, type LoadedWorldMap } from "../../data/index.ts";
import { fixture, groundSurfaces, interiorsFixture } from "../../data/manifestFixture.ts";
import { fromSurfaces } from "../../data/surfaces.ts";
import { InsideMapBox, InteriorImage, interiorInView, placeInteriors, useInteriorView } from "./InteriorLayer.tsx";
import type { MapViewSource } from "./view.ts";
import { canvasSize, canvasToView, type Frame } from "./viewport.ts";

// jsdom has no Worker to trace an outline in.
vi.mock("./outline.ts", async (original) => {
  const actual = await original<typeof import("./outline.ts")>();
  return {
    ...actual,
    outline: async (interiors: LoadedInteriors, interior: Interior) => {
      const surfaces = await interiors.surfaces(interior);
      const { width, height } = surfaces.ground;
      return {
        width,
        height,
        path: actual.groundPath(surfaces.ground),
        masks: { two: "two", more: "more", twoEdge: "twoEdge", moreEdge: "moreEdge" },
      };
    },
  };
});

const base = fixture().terrain;
const map = {
  ...base,
  canvas: { ...base.canvas, height: 1800 },
  areas: base.areas.map((a) => (a.map === 0 ? { ...a, originCol: 29, originRow: 47, width: 1536, height: 1536 } : a)),
};
const { interiors, surfaces } = interiorsFixture();
const cave = interiors.interiors[0]!;
const at = (id: string, bounds: Interior["bounds"], extra: Partial<Interior>): Interior => ({
  ...cave,
  id,
  bounds,
  ground: { minimap: `interiors/${id}/ground.minimap.webp`, plan: `interiors/${id}/ground.plan.webp` },
  surfaces: `interiors/${id}/surfaces.bin.gz`,
  ...extra,
});
const city = at(
  "stormwind",
  { north: -8081.93, south: -9344.89, west: 1438.14, east: 208.17 },
  { kind: "city", label: "Stormwind City", heightBase: 30, places: [] },
);
const hall = at(
  "stormwind-harbor-66885945",
  { north: -8490.09, south: -8526.35, west: 1338.16, east: 1292.05 },
  { kind: "building", label: "Stormwind Harbor", heightBase: 5, places: [] },
);
const placed = placeInteriors(map, [city, hall]);
const HARBOR = [1315.1, -8508.22] as const;
const TRADE_DISTRICT = [640, -8840] as const;
const GOLDSHIRE = [62, -9464] as const;

const pxPerPercentAt = (level: number) => (2 ** (level - map.nativeZoom) * canvasSize(map).width) / 100;
const viewAt = (x: number, y: number) => {
  const middle = canvasToView(map, worldToCanvas(map, { instance: 0, x, y })!);
  return { left: middle.x - 1, top: middle.y - 1, width: 2, height: 2 };
};
const inView = ([x, y]: readonly [number, number], level: number) =>
  interiorInView(map, placed, viewAt(x, y), pxPerPercentAt(level))?.interior.id;

describe("the interior in view", () => {
  it("places each interior's images on its world bounds", () => {
    const { rect } = placed.find((p) => p.interior.id === "stormwind-harbor-66885945")!;
    const corner = canvasToView(map, worldToCanvas(map, { instance: 0, x: hall.bounds.west, y: hall.bounds.north })!);
    expect(rect.left).toBeCloseTo(corner.x);
    expect(rect.top).toBeCloseTo(corner.y);
    const far = canvasToView(map, worldToCanvas(map, { instance: 0, x: hall.bounds.east, y: hall.bounds.south })!);
    expect(rect.width).toBeCloseTo(far.x - corner.x);
    expect(rect.height).toBeCloseTo(far.y - corner.y);
  });

  it("is the smallest interior that holds the middle of the view", () => {
    expect(inView(HARBOR, 5)).toBe("stormwind-harbor-66885945");
    expect(inView(TRADE_DISTRICT, 5)).toBe("stormwind");
    expect(inView(GOLDSHIRE, 5)).toBeUndefined();
  });

  it("shows from the landmark-label level, once the interior is 160 pixels across", () => {
    expect(inView(HARBOR, 3.9)).toBeUndefined();
    expect(inView(HARBOR, 4)).toBe("stormwind-harbor-66885945");
    const small = at(
      "elwynn-forest-125746",
      { north: -9253.89, south: -9276.43, west: 369.26, east: 346.72 },
      { kind: "building", label: "Elwynn Forest", heightBase: 75, places: [] },
    );
    const both = placeInteriors(map, [city, small]);
    const middle = viewAt(357.99, -9265.16);
    expect(interiorInView(map, both, middle, pxPerPercentAt(4))?.interior.id).toBe("stormwind");
    expect(interiorInView(map, both, middle, pxPerPercentAt(5))?.interior.id).toBe("elwynn-forest-125746");
  });

  it("skips an interior of another map", () => {
    const other = placeInteriors(map, [
      at(
        "thendal-cave-65486681",
        { north: 4223.85, south: 3863.48, west: 2348.26, east: 1987.88 },
        { map: 2991, label: "Thendal Cave", heightBase: 982, places: ["Thendal Cave"] },
      ),
    ]);
    expect(interiorInView(map, other, viewAt(...HARBOR), pxPerPercentAt(5))).toBeUndefined();
  });
});

const withSurfaces = (list: Interior[], data: InteriorSurfaces = surfaces): LoadedWorldMap => ({
  ...map,
  tileBase: "/data/world/",
  interiors: {
    list,
    image: async (path) => `blob:${path}`,
    surfaces: async (interior) => fromSurfaces(interior, data),
    loadedSurfaces: () => undefined,
  },
});
const loaded = withSurfaces([city, hall]);

function mapViewAt(frame: Frame, pxPerPercent: number): MapViewSource {
  const whole = { left: 0, top: 0, width: 100, height: 100 };
  const snapshot = {
    zoom: { s: 1, tx: 0, ty: 0 },
    box: null,
    frame: whole,
    pxPerPercent: 1,
    maxZoom: 1,
    shown: { frame, pxPerPercent },
    viewport: null,
  };
  return { subscribe: () => () => {}, getSnapshot: () => snapshot };
}

function MapPart({ map = loaded, frame, pxPerPercent = pxPerPercentAt(5) }: { frame: Frame; map?: LoadedWorldMap; pxPerPercent?: number }) {
  const mapView = useMemo(() => mapViewAt(frame, pxPerPercent), [frame, pxPerPercent]);
  const interiors = useInteriorView(map, mapView);
  const [plans, setPlans] = useState(false);
  return (
    <>
      {interiors.placed && interiors.inside && (
        <InteriorImage map={map} placed={interiors.placed} look={plans ? "plan" : "minimap"} pxPerPercent={pxPerPercent} />
      )}
      {interiors.placed && (
        <InsideMapBox
          interior={interiors.placed.interior}
          inside={interiors.inside}
          onInside={interiors.setInside}
          plans={{ on: plans, onChange: setPlans }}
        />
      )}
    </>
  );
}

describe("the inside map", () => {
  afterEach(cleanup);
  const image = () => document.querySelector("image.interior-layer")?.getAttribute("href")?.replace("blob:interiors/", "");
  it.each([
    ["outline", "blob:ground.webp"],
    ["image", "blob:constructor"],
    ["indoor", "blob:ground.webp"],
  ])("waits for the %s with an inherited property key", async (pending, expected) => {
    const interior = {
      ...hall,
      id: pending === "outline" ? "toString" : "cave",
      ground: {
        minimap: pending === "image" ? "constructor" : "ground.webp",
        plan: "ground.webp",
        indoor: pending === "indoor" ? "__proto__" : "indoor.webp",
      },
    };
    let ready!: () => void;
    const loaded = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const source = withSurfaces([interior]);
    const map: LoadedWorldMap = {
      ...source,
      interiors: {
        ...source.interiors!,
        image: async (path) => {
          if (pending === (path === interior.ground.indoor ? "indoor" : "image")) await loaded;
          return `blob:${path}`;
        },
        surfaces: async (value) => {
          if (pending === "outline") await loaded;
          return fromSurfaces(value, surfaces);
        },
      },
    };
    await act(async () => {
      render(<MapPart map={map} frame={viewAt(...HARBOR)} />);
    });
    expect(document.querySelector("image.interior-layer")).toBeNull();
    await act(async () => {
      ready();
    });
    expect(document.querySelector("image.interior-layer")?.getAttribute("href")).toBe(expected);
  });

  const boxes = () =>
    screen
      .getAllByRole<HTMLInputElement>("checkbox")
      .map((box) => [box.getAttribute("aria-label") ?? box.labels![0]!.textContent, box.checked]);

  it("shows the ground's art of the interior in view, as floor plans with Floor plans checked", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MapPart frame={viewAt(...HARBOR)} />);
    expect(boxes()).toEqual([
      ["Inside map", true],
      ["Floor plans", false],
    ]);
    screen.getByRole("group", { name: "Stormwind Harbor" });
    await waitFor(() => expect(image()).toBe("stormwind-harbor-66885945/ground.minimap.webp"));
    await user.click(screen.getByRole("checkbox", { name: "Floor plans" }));
    await waitFor(() => expect(image()).toBe("stormwind-harbor-66885945/ground.plan.webp"));
    rerender(<MapPart frame={viewAt(...TRADE_DISTRICT)} />);
    screen.getByRole("group", { name: "Stormwind City" });
    rerender(<MapPart frame={viewAt(...GOLDSHIRE)} />);
    expect([image(), screen.queryByRole("group")]).toEqual([undefined, null]);
  });

  it("hides the art and the stripes with Inside map unchecked, in every interior, and shows them again once it is checked", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MapPart frame={viewAt(...HARBOR)} />);
    await waitFor(() => expect(image()).toBe("stormwind-harbor-66885945/ground.minimap.webp"));
    await user.click(screen.getByRole("checkbox", { name: "Inside map" }));
    expect([image(), document.querySelector("svg.interior-outline")]).toEqual([undefined, null]);
    rerender(<MapPart frame={viewAt(...TRADE_DISTRICT)} />);
    expect([screen.getByRole("checkbox", { name: "Inside map" }).matches(":checked"), image()]).toEqual([false, undefined]);
    await user.click(screen.getByRole("checkbox", { name: "Inside map" }));
    await waitFor(() => expect(image()).toBe("stormwind/ground.minimap.webp"));
  });

  it("draws the outer edge of the ground, and stripes through the masks of stacked surfaces at 6 screen pixels at every zoom", async () => {
    const map = withSurfaces([hall], groundSurfaces({ width: 32, height: 32, values: new Uint16Array(32 * 32).fill(1) }));
    const { rect } = placeInteriors(map, [hall])[0]!;
    const { rerender } = render(<MapPart map={map} frame={viewAt(...HARBOR)} pxPerPercent={pxPerPercentAt(5)} />);
    const edge = () =>
      [...document.querySelectorAll("svg.interior-outline .interior-outline-border, svg.interior-outline .interior-outline-line")].map(
        (path) => path.getAttribute("d"),
      );
    await waitFor(() => expect(edge()).toEqual(["M0,0L32,0L32,32L0,32Z", "M0,0L32,0L32,32L0,32Z"]));
    const masks = [...document.querySelectorAll("svg.interior-outline g path")].map((path) => [
      path.getAttribute("d"),
      document.querySelector(`${path.getAttribute("fill")?.slice(4, -1)} rect`)?.getAttribute("class"),
    ]);
    const period = (pxPerPercent: number) =>
      (Number(document.querySelector("pattern")!.getAttribute("width")) * pxPerPercent * rect.width) / 32;
    expect([masks, period(pxPerPercentAt(5))]).toEqual([
      [
        ["two", "interior-stack-two"],
        ["twoEdge", undefined],
        ["more", "interior-stack-more"],
        ["moreEdge", undefined],
      ],
      6,
    ]);
    rerender(<MapPart map={map} frame={viewAt(...HARBOR)} pxPerPercent={pxPerPercentAt(8)} />);
    expect(period(pxPerPercentAt(8))).toBeCloseTo(6);
  });

  it("shows the whole image when the ground is too small to outline", async () => {
    const small: HeightMap = {
      width: 32,
      height: 32,
      values: Uint16Array.from({ length: 32 * 32 }, (_, i) => (i % 32 < 4 && Math.floor(i / 32) < 4 ? 1 : 0)),
    };
    render(<MapPart map={withSurfaces([hall], groundSurfaces(small))} frame={viewAt(...HARBOR)} />);
    await waitFor(() => expect(image()).toBe("stormwind-harbor-66885945/ground.minimap.webp"));
    expect([
      document.querySelector("image.interior-layer")?.getAttribute("clip-path"),
      document.querySelector("svg.interior-outline clipPath"),
      document.querySelector("path.interior-outline-line")?.getAttribute("d"),
    ]).toEqual([null, null, ""]);
  });

  it("shows no inside map for an image that fails its check", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = new Error("Invalid asset checksum");
    const map = { ...loaded, interiors: { ...loaded.interiors!, list: [hall], image: () => Promise.reject(failed) } };
    render(<MapPart map={map} frame={viewAt(...HARBOR)} />);
    await waitFor(() => expect(warn.mock.calls).toEqual([["Interior image did not load", failed]]));
    expect([screen.getByRole("group", { name: "Stormwind Harbor" }).tagName, image()]).toEqual(["DIV", undefined]);
  });
});

describe("the inside map's loads", () => {
  afterEach(cleanup);
  const image = () => document.querySelector("image.interior-layer")?.getAttribute("href");

  it("asks again for an image that failed once the inside map shows again", async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = new Error("Invalid asset checksum");
    const answers = [() => Promise.reject(failed), async () => "blob:second"];
    const map = { ...loaded, interiors: { ...loaded.interiors!, list: [hall], image: () => answers.shift()!() } };
    render(<MapPart map={map} frame={viewAt(...HARBOR)} />);
    await waitFor(() => expect(warn.mock.calls).toEqual([["Interior image did not load", failed]]));
    await user.click(screen.getByRole("checkbox", { name: "Inside map" }));
    await user.click(screen.getByRole("checkbox", { name: "Inside map" }));
    await waitFor(() => expect(image()).toBe("blob:second"));
    warn.mockRestore();
  });

  it("shows the image of a replaced map, not a late image of the old one", async () => {
    let late!: (url: string) => void;
    const old = {
      ...loaded,
      interiors: { ...loaded.interiors!, list: [hall], image: () => new Promise<string>((resolve) => (late = resolve)) },
    };
    const fresh = { ...loaded, interiors: { ...loaded.interiors!, list: [hall], image: async () => "blob:fresh" } };
    const { rerender } = render(<MapPart map={old} frame={viewAt(...HARBOR)} />);
    rerender(<MapPart map={fresh} frame={viewAt(...HARBOR)} />);
    await waitFor(() => expect(image()).toBe("blob:fresh"));
    await act(async () => late("blob:old"));
    expect(image()).toBe("blob:fresh");
  });
});
