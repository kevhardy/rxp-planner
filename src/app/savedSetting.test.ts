// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSetting, saveSetting } from "../storage/index.ts";
import { loadSaved, saveSaved, type SavedSetting } from "./savedSetting.ts";

const storage = vi.hoisted(() => ({ failSave: false, held: null as (() => void)[] | null }));
vi.mock("../storage/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/index.ts")>();
  return {
    ...actual,
    saveSetting: (key: string, value: unknown) => {
      const save = () => (storage.failSave ? Promise.reject(new Error("storage is full")) : actual.saveSetting(key, value));
      const held = storage.held;
      if (!held) return save();
      return new Promise<void>((resolve, reject) => held.push(() => void save().then(resolve, reject)));
    },
  };
});

const KEY = "research-setting";
const UNSAVED_KEY = "restedxp-planner:research-unsaved";
const SETTING: SavedSetting<{ n: number }> = {
  key: KEY,
  unsavedKey: UNSAVED_KEY,
  read: (saved) => {
    const n = (saved as { n?: unknown } | undefined)?.n;
    return { n: typeof n === "number" ? n : 0 };
  },
  defaults: { n: 0 },
  name: "the research setting",
};

function hold(): (() => void)[] {
  const held: (() => void)[] = [];
  storage.held = held;
  return held;
}

beforeEach(async () => {
  storage.failSave = false;
  storage.held = null;
  localStorage.clear();
  await saveSetting(KEY, { n: 1 });
});

afterEach(() => vi.restoreAllMocks());

describe("saved settings", () => {
  it("loads the copy of a pending save, and removes the copy when the save finishes", async () => {
    const held = hold();
    saveSaved(SETTING, { n: 2 });
    expect(localStorage.getItem(UNSAVED_KEY)).toBe('{"n":2}');
    expect(await loadSaved(SETTING)).toEqual({ n: 2 });
    expect(await loadSetting(KEY)).toEqual({ n: 1 });

    storage.held = null;
    for (const release of held) release();
    await vi.waitFor(() => expect(localStorage.getItem(UNSAVED_KEY)).toBeNull());
    expect(await loadSetting(KEY)).toEqual({ n: 2 });
  });

  it("keeps a newer copy when an older save finishes", async () => {
    const held = hold();
    saveSaved(SETTING, { n: 2 });
    saveSaved(SETTING, { n: 3 });
    held[0]!();
    await vi.waitFor(async () => expect(await loadSetting(KEY)).toEqual({ n: 2 }));
    expect(localStorage.getItem(UNSAVED_KEY)).toBe('{"n":3}');
    expect(await loadSaved(SETTING)).toEqual({ n: 3 });

    storage.held = null;
    for (const release of held.slice(1)) release();
    await vi.waitFor(async () => expect(await loadSetting(KEY)).toEqual({ n: 3 }));
  });

  it("reports a failed save and keeps the copy for the next load", async () => {
    storage.failSave = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    saveSaved(SETTING, { n: 2 });
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("Could not save the research setting", expect.any(Error)));
    expect(localStorage.getItem(UNSAVED_KEY)).toBe('{"n":2}');
    expect(await loadSetting(KEY)).toEqual({ n: 1 });

    storage.failSave = false;
    expect(await loadSaved(SETTING)).toEqual({ n: 2 });
    await vi.waitFor(async () => expect(await loadSetting(KEY)).toEqual({ n: 2 }));
  });

  it("loads the saved value over an unreadable copy and keeps the copy, but reads the fields of an object copy", async () => {
    await saveSetting(KEY, { n: 4 });
    for (const copy of ["{", "null", "7"]) {
      localStorage.setItem(UNSAVED_KEY, copy);
      expect(await loadSaved(SETTING)).toEqual({ n: 4 });
      expect(localStorage.getItem(UNSAVED_KEY)).toBe(copy);
    }

    localStorage.setItem(UNSAVED_KEY, '{"n":"bad"}');
    expect(await loadSaved(SETTING)).toEqual({ n: 0 });
    await vi.waitFor(async () => expect(await loadSetting(KEY)).toEqual({ n: 0 }));
  });

  it("finishes a save when localStorage refuses the cleanup", async () => {
    const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage is locked");
    });
    const error = vi.spyOn(console, "error");
    saveSaved(SETTING, { n: 2 });
    await vi.waitFor(() => expect(removeItem).toHaveBeenCalledWith(UNSAVED_KEY));
    expect(await loadSetting(KEY)).toEqual({ n: 2 });
    expect(localStorage.getItem(UNSAVED_KEY)).toBe('{"n":2}');
    expect(error).not.toHaveBeenCalled();
  });
});
