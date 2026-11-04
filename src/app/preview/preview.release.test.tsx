// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameData } from "../../data/index.ts";
import { releaseData } from "../../data/releaseInputs.ts";
import { extractGuides } from "../../guide/index.ts";
import { guideMeta } from "../../rules/registration.ts";
import { loadLibrary, saveLibrary, saveSetting } from "../../storage/index.ts";
import { renderPlanner } from "../renderPlanner.tsx";
import { DEFAULT_LAYOUT } from "../layout.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";

const root = join(import.meta.dirname, "../../..");
const bundledGuides = (...files: string[]) =>
  files.flatMap((file) => extractGuides(readFileSync(join(root, "guides/rxp-forever", file), "utf8")).map((g) => g.text));

// jsdom's Blob has no stream(), which built-in guide decoding needs.
globalThis.Blob = NodeBlob as typeof Blob;

beforeEach(async () => {
  localStorage.clear();
  await saveSetting("preview", DEFAULT_SETTINGS);
  await saveSetting("layout", DEFAULT_LAYOUT);
});

afterEach(() => cleanup());

async function mount(texts: string[], open: string, builtins: null, loaded: undefined, game: GameData) {
  const guides = texts.map((text, i) => ({ id: `g${i}`, text, order: i }));
  const guideId = guides.find((g) => guideMeta(g).name === open)!.id;
  await saveLibrary(guides, [], { guideId, step: 0, line: null });
  const { user } = await renderPlanner({ initial: await loadLibrary(), builtins, loadGameData: () => Promise.resolve(loaded ?? game) });
  return { user };
}

function shownText(el: Element) {
  const copy = el.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent.replace(/\s+/g, " ").trim();
}

describe("warnings", () => {
  async function openWarnings(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await within(screen.getByRole("banner")).findByRole("button", { name: /^Warnings, \d+$/, expanded: false }));
    const panel = screen.getByRole("region", { name: "Warnings" });
    await within(panel).findAllByText("Completed before accepted");
    return panel;
  }

  it("selects a warning's guide, step, and line", async () => {
    const { user } = await mount(bundledGuides("Alliance-11-20.lua"), "19-20 Redridge", null, undefined, releaseData());
    const panel = await openWarnings(user);
    const guide = [...panel.querySelectorAll<HTMLElement>(".warn-guide")]
      .slice(1)
      .find((g) => within(g).queryAllByRole("button", { name: /^Step \d+, line \d+/ }).length > 0)!;
    const [, name] = /^(.+) \d+$/.exec(shownText(guide.querySelector("summary")!))!;
    expect(name).toBe("20-21 Darkshore/Ashenvale");
    const item = within(guide).getAllByRole("button", { name: /^Step \d+, line \d+/ })[0]!;
    const [, step, line] = /^Step (\d+), line (\d+)/.exec(item.textContent)!;

    await user.click(item);
    expect(screen.getByRole("listbox", { name: `Steps of ${name}` })).toBeTruthy();
    expect(document.getElementById(`step-${Number(step) - 1}`)!.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".line-row")!.getAttribute("data-line")).toBe(String(Number(line) - 1));
    expect(screen.queryByRole("region", { name: "Warnings" })).toBeNull();
    await openWarnings(user);
    expect(item.getAttribute("aria-current")).toBe("location");
  });
});
