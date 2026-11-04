import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { MAP_BOUNDS, plannerContext } from "../data/plannerFixture.ts";

import { GameData, type RuntimeDatasetContext, type TerrainGeometry, type WorldBounds, type QuestPoint } from "../data/index.ts";
import { questRow } from "../data/plannerFixture.ts";
import { testRules } from "../rules/testing.ts";
import { restoreRxpSelection } from "./rxpTextDom.ts";

export function withHyjalQuest(forever: GameData): GameData {
  const giver: QuestPoint = {
    kind: "start",
    sourceType: "npc",
    sourceId: 9116,
    sourceName: "Eridan Bluewind",
    zoneId: 361,
    uiMapId: 2482,
    x: 11.17,
    y: 99.17,
    world: { instance: 1, x: -1310.94, y: 4008.81 },
  };
  return new GameData(
    {
      source: forever.source,
      maxLevel: forever.maxLevel,
      zones: [...forever.zones],
      continents: [...forever.continents],
      npcNames: {},
      sources: [...forever.sources],
      quests: [questRow(4005, "Aquementas", { requiredLevel: 47, questLevel: 54, zoneIds: [490], startPoints: [giver] })],
    },
    plannerContext,
  );
}

/** A quest row with these fields; the rest default to a level 1 quest open to all, with no points, objectives, or sources. */
export { questRow } from "../data/plannerFixture.ts";

export { EASTERN_KINGDOMS, zoneData, zonePoint, ZONES } from "../data/plannerFixture.ts";

export function questNames(rows: [id: number, name: string][]): GameData {
  return new GameData(
    {
      source: { name: "test", version: "0", pack: "test" },
      maxLevel: 60,
      zones: [],
      continents: [],
      npcNames: {},
      quests: rows.map(([id, name]) => questRow(id, name)),
    },
    plannerContext,
  );
}

/** Reads the files of a stored (uncompressed) zip. */
export function unzip(zip: Uint8Array): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const files = new Map<string, string>();
  for (let at = 0; view.getUint32(at, true) === 0x04034b50;) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const start = at + 30 + nameLength + view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLength));
    files.set(name, new TextDecoder().decode(zip.subarray(start, start + size)));
    at = start + size;
  }
  return files;
}

export function datasetContext(terrain: TerrainGeometry): RuntimeDatasetContext {
  return {
    rules: testRules,
    geometry: {
      version: 2,
      sources: [{ source: "local", pins: { revision: "test" } }],
      bounds: JSON.parse(JSON.stringify(Object.fromEntries(MAP_BOUNDS))) as Record<number, WorldBounds>,
      source: "local",
    },
    terrain,
  };
}

/** The text an `RxpTextField` shows, with each chip as the markup it stands for. Named color delimiters do not show. */
export function shownText(field: HTMLElement): string {
  return [...field.children]
    .map((el) => (el instanceof HTMLElement && el.classList.contains("rxp-chip") ? el.title : el.textContent))
    .join("");
}

/** Focuses an `RxpTextField` and selects source offsets `start` to `end`. */
export function selectText(field: HTMLElement, start: number, end = start): void {
  field.focus();
  restoreRxpSelection(field, [start, end]);
}

/** Selects line `n` (from 1) of the shown step by its outline row, and returns the editor that shows it. */
export async function showLine(user: UserEvent, n: number): Promise<HTMLElement> {
  await user.click(document.querySelectorAll<HTMLElement>(".outline-row")[n - 1]!);
  return screen.getByRole("group", { name: new RegExp(`^Line ${n}, `) });
}

export async function undo(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("banner"));
  await user.keyboard("{Control>}z{/Control}");
}

export async function redo(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("banner"));
  await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
}

export function slowFile(text: string, name: string): { file: File; arrive: () => void } {
  const file = new File([text], name, { type: "text/plain" });
  let arrive!: () => void;
  const bytes = new Promise<ArrayBuffer>((resolve) => (arrive = () => resolve(new TextEncoder().encode(text).buffer)));
  file.arrayBuffer = () => bytes;
  return { file, arrive };
}
