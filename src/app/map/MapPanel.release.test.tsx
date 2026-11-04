// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseData } from "../../data/releaseInputs.ts";
import { worldToCanvas, type GameData, type WorldLocation } from "../../data/index.ts";
import { worldMap } from "../../data/terrainFixture.ts";
import { extractGuides } from "../../guide/index.ts";
import { saveSetting, type StoredLibrary } from "../../storage/index.ts";
import { renderPlanner } from "../renderPlanner.tsx";
import { DEFAULT_SETTINGS } from "../preview/settings.ts";
import { DEFAULT_LAYOUT } from "../layout.ts";
import { DEFAULT_MAP_SETTINGS } from "./mapSettings.ts";
import { canvasToView } from "./viewport.ts";

// jsdom has no Worker to trace an outline in.
const outline = vi.hoisted(() =>
  vi.fn<typeof import("./outline.ts").outline>(async () => ({
    width: 1,
    height: 1,
    path: "M0,0L1,0L1,1L0,1Z",
    masks: { two: "", more: "", twoEdge: "", moreEdge: "" },
  })),
);
vi.mock("./outline.ts", () => ({ outline }));

const root = join(import.meta.dirname, "../../..");

// jsdom's Blob has no stream(), which game data decoding needs.
globalThis.Blob = NodeBlob as typeof Blob;

const viewOf = (world: WorldLocation) => canvasToView(worldMap, worldToCanvas(worldMap, world)!);

// jsdom does no layout: every element is a 1000px square at the origin.
beforeEach(async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 1000 }));
  await saveSetting("preview", DEFAULT_SETTINGS);
  await saveSetting("map", DEFAULT_MAP_SETTINGS);
  await saveSetting("layout", DEFAULT_LAYOUT);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mountWith(options: { data: GameData }, ...texts: string[]) {
  const initial: StoredLibrary = {
    guides: texts.map((text, i) => ({ id: `g${i}`, text, order: i })),
    session: { guideId: "g0", step: 0, line: null },
  };
  await renderPlanner({ initial, builtins: null, loadGameData: () => Promise.resolve(options.data) });
  await screen.findByRole("combobox", { name: "Map shown" });
}

const mapShown = () => screen.getByRole("combobox", { name: "Map shown" }) as HTMLSelectElement;
const mapArea = () => screen.getByRole("group", { name: /^Map of / });

describe("map panel", () => {
  it("places a world-coordinate .goto from a bundled guide in its zone", async () => {
    const data = releaseData();
    const source = readFileSync(join(root, "guides/rxp-forever/Horde-Mage-12-21.lua"), "utf8");
    const { text } = extractGuides(source).find((g) => g.text.includes("#name 17-21 Stonetalon/Barrens AoE"))!;
    await mountWith({ data }, text);
    const line = text.split("\n").find((l) => /^\s*\.goto \d+\/\d,/.test(l))!;
    const placed = data.locateGoto(line.trim().slice(".goto ".length).split(","));
    if (!placed.ok) throw new Error(placed.message);
    expect(placed.form).toBe("world");
    expect(mapShown().value).toBe(`t${placed.uiMapId}`);
    const label = `.goto ${data.mapName(placed.uiMapId)} ${placed.x.toFixed(2)}, ${placed.y.toFixed(2)}`;
    const pin = within(mapArea()).getByRole("button", { name: `Selected step 1, line 1: ${label} (optional)` });
    expect(parseFloat(pin.style.getPropertyValue("--at-x"))).toBeCloseTo(viewOf(placed.world).x, 6);
  });
});
