// @vitest-environment jsdom
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import * as loader from "../data/dataset.ts";
import { EntityIndex } from "../data/entities.ts";
import type { GameData } from "../data/index.ts";
import { plannerData, plannerNames, questRow, zoneData } from "../data/plannerFixture.ts";
import { startAgentTools } from "./agentTools.ts";
import { fixtureArtifact } from "./renderPlanner.tsx";
import { createStores } from "./stores.ts";

type Registered = { name: string; execute: (input: unknown) => Promise<unknown> };

const GUIDE = "#group Mine\n#name 1-2 Test\nstep\n    .goto Elwynn Forest,48.2,42.8\nstep\n    .goto Elwynn Forest,48.9,41.6\n";

async function start(stores = createStores()) {
  const tools = new Map<string, Registered>();
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool(tool: Registered, options: { signal: AbortSignal }) {
        tools.set(tool.name, tool);
        options.signal.addEventListener("abort", () => tools.delete(tool.name));
        return Promise.resolve();
      },
    },
  });
  const [id] = stores.editor.addGuides([{ text: GUIDE }]);
  const stop = startAgentTools(stores);
  onTestFinished(stop);
  const show = async (game: GameData) => {
    vi.spyOn(loader, "fetchDatasetArtifact").mockResolvedValueOnce(fixtureArtifact(game, new EntityIndex(plannerNames)));
    stores.dataset.select({ manifest: "/fixture/manifest.json", base: "/fixture/" });
    expect(tools.size).toBe(0);
    await vi.waitFor(() => expect(stores.dataset.getState().data?.game).toBe(game));
  };
  await show(plannerData());
  const call = (name: string, input: unknown) => tools.get(name)!.execute(input);
  return { tools, editor: stores.editor, id: id!, stop, show, call };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (document as { modelContext?: unknown }).modelContext;
});

describe("startAgentTools", () => {
  it("registers the agent tools and the editor tools, and removes them on stop", async () => {
    const { tools, stop } = await start();
    expect([...tools.keys()]).toEqual([
      "rxp_reference",
      "quest_search",
      "quest_details",
      "quests_available",
      "npc_find",
      "travel_time",
      "quest_steps",
      "guide_check",
      "guide_simulate",
      "guide_example",
      "guide_timeline",
      "guide_compare",
      "guide_opportunities",
      "floor_hint",
      "editor_state",
      "editor_replace_guide",
      "editor_select_step",
    ]);
    stop();
    expect(tools.size).toBe(0);
  });

  it("replaces the open guide as one undo step", async () => {
    const { editor, id, call } = await start();
    const edited = GUIDE.replace("48.2,42.8", "50.0,40.0");
    expect(await call("editor_replace_guide", { text: edited })).toEqual({
      name: "1-2 Test",
      group: "Mine",
      steps: 2,
      copiedBuiltin: false,
    });
    expect(editor.getState().guides.get(id)!.text).toBe(edited);
    editor.undo();
    expect(editor.getState().guides.get(id)!.text).toBe(GUIDE);
  });

  it("reports the copy that an edit of a built-in opened instead, and changes nothing", async () => {
    const copy = "#group T (custom)\n#name One\nstep\n";
    const stores = createStores(
      { guides: [{ id: "c", text: copy, order: 0 }], session: { guideId: "rxp:t.lua#1", step: 0, line: null } },
      { version: "v9.9.9", guides: [{ id: "rxp:t.lua#1", text: "#group T\n#name One\nstep\n", order: 0, fileName: "t.lua" }] },
    );
    const { editor, call } = await start(stores);
    expect(await call("editor_replace_guide", { text: "#group T\n#name One\nstep\n    .xp 2\n" })).toEqual({
      error: "Opened your copy in “T (custom)”. Make the change there.",
    });
    expect(editor.getState().current!.record.text).toBe(copy);
  });

  it("selects a step and reports the selection in the editor state", async () => {
    const { call } = await start();
    expect(await call("editor_select_step", { step: 2, line: 1 })).toEqual({ step: 2, line: 1 });
    expect(await call("editor_state", {})).toEqual({
      name: "1-2 Test",
      group: "Mine",
      builtin: false,
      steps: 2,
      selection: { step: 2, line: 1 },
      previewAs: { race: "Human", class: "WARRIOR", level: 1, xp: 0, soloSelfFound: false, xpRate: null },
      text: GUIDE,
    });
    expect(await call("editor_select_step", { step: 3 })).toEqual({ error: "The guide has 2 steps." });
    expect(await call("editor_select_step", { step: "2" })).toEqual({ error: "Invalid input: input.step must be a number." });
  });

  it("removes the tools while the next dataset loads, and registers them again on it", async () => {
    const { call, show } = await start();
    await show(zoneData([questRow(77, "Fresh Quest")]));
    expect(await call("quest_details", { id: 77 })).toMatchObject({ id: 77, name: "Fresh Quest" });
  });

  it("serves the dataset tools on the loaded data", async () => {
    const { call } = await start();
    expect(await call("quest_details", { id: 9_999_999 })).toEqual({
      error: "No quest 9999999 in the data. Use quest_search to find IDs.",
    });
  });
});
