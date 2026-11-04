// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, onTestFinished } from "vitest";
import type { WorldMapData } from "../../data/index.ts";
import { plannerData } from "../../data/plannerFixture.ts";
import { syntheticScope } from "../../routing/fixtures/synthetic.ts";
import type { ZoneGrid } from "../../routing/zones.ts";
import { GameDataContext } from "../context.ts";
import { CoordinateReadout } from "./CoordinateReadout.tsx";

const styles = readFileSync(join(import.meta.dirname, "CoordinateReadout.css"), "utf8");

afterEach(() => cleanup());

it("keeps the continent cell of a point on a map off every continent, and shows one dash for the cursor off the map", () => {
  const zephras: ZoneGrid = {
    scope: syntheticScope(2991),
    frame: { origin: [25, 22], size: [9, 8], tilePixels: 512, cellsPerTile: 128, tileWorldUnits: 1600 / 3 },
    zones: [0, 2521],
    tiles: Array.from({ length: 72 }, () => new Uint8Array(256).fill(1)),
  };
  const rorian = { instance: 2991, x: 1895, y: 4088.500078 };
  render(
    <GameDataContext.Provider value={plannerData()}>
      <CoordinateReadout
        pointer={{ watchPointer: () => () => {} }}
        map={{} as WorldMapData}
        selection={[{ label: "Point", at: rorian }]}
        zones={[zephras]}
      />
    </GameDataContext.Provider>,
  );
  const style = document.head.appendChild(document.createElement("style"));
  style.textContent = styles;
  onTestFinished(() => style.remove());
  const shown = [...document.querySelectorAll(".coord-readout > div")].map((row) =>
    [...row.children].flatMap((cell) => (getComputedStyle(cell).visibility === "hidden" ? [] : [cell.textContent])),
  );
  expect(shown).toEqual([
    ["Point", "42.00,23.40Zephras Isle", "—"],
    ["Cursor", "—"],
  ]);
});
