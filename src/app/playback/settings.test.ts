// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSetting, saveSetting } from "../../storage/index.ts";
import { createStores, loadSettings } from "../stores.ts";
import { PlaybackSettingsStore } from "./settings.ts";

beforeEach(async () => {
  localStorage.clear();
  await saveSetting("playback", {});
});

describe("PlaybackSettingsStore", () => {
  it("keeps only valid changed settings, and publishes only when they change", () => {
    const store = new PlaybackSettingsStore({});
    const published: unknown[] = [];
    store.subscribe(() => published.push(store.getState()));
    store.update({ respawn: 30 });
    store.update({ respawn: 30 });
    store.update({ respawn: 0, ignoreDeathskip: true });
    store.update({ respawn: 300 });
    store.update({ respawn: 300 });
    expect(published).toEqual([{ respawn: 30 }, { respawn: 30, ignoreDeathskip: true }, { ignoreDeathskip: true }]);
    store.reset();
    store.reset();
    expect([published.length, store.getState()]).toEqual([4, {}]);
  });

  it("loads the saved choices on the next visit without changing the other saved settings", async () => {
    await saveSetting("preview", { level: 7 });
    await saveSetting("map", { allFactions: true });
    const stores = createStores(undefined, undefined, await loadSettings());
    stores.playbackSettings.update({ respawn: 45, ignoreDeathskip: true });
    await vi.waitFor(async () => expect(await loadSetting("playback")).toEqual({ respawn: 45, ignoreDeathskip: true }));
    const next = await loadSettings();
    expect([next.playback, next.preview.startLevel, next.map.allFactions]).toEqual([
      { respawn: 45, ignoreDeathskip: true },
      { level: 7, xp: 0 },
      true,
    ]);
    expect([await loadSetting("preview"), await loadSetting("map")]).toEqual([{ level: 7 }, { allFactions: true }]);
  });

  it("keeps the valid saved choices and drops the rest", async () => {
    await saveSetting("playback", { respawn: "45", ignoreDeathskip: true, speed: 4 });
    expect((await loadSettings()).playback).toEqual({ ignoreDeathskip: true });
  });
});
