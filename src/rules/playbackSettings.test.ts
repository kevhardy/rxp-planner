import { describe, expect, it } from "vitest";
import { PLAYBACK_SETTING_ENTRIES, readPlaybackChoices, resolvePlaybackSettings } from "./playbackSettings.ts";

describe("readPlaybackChoices", () => {
  it("reads choices that browsers saved under each setting key, which never changes, and drops unknown keys, invalid values, and defaults", () => {
    expect(readPlaybackChoices({ respawn: 30, ignoreDeathskip: "yes", killTime: 2 })).toEqual({ respawn: 30 });
    expect(readPlaybackChoices({ respawn: 300, ignoreDeathskip: true })).toEqual({ ignoreDeathskip: true });
    expect(readPlaybackChoices({ respawn: 0 })).toEqual({});
    expect(readPlaybackChoices({ respawn: 1801 })).toEqual({});
    expect(readPlaybackChoices({ respawn: Number.NaN })).toEqual({});
    expect(readPlaybackChoices({ respawn: "30" })).toEqual({});
    expect(readPlaybackChoices({ area: 150 })).toEqual({ area: 150 });
    expect(readPlaybackChoices({ area: 500 })).toEqual({});
    expect(readPlaybackChoices({ area: 0 })).toEqual({});
    expect(readPlaybackChoices({ area: 5001 })).toEqual({});
    expect(readPlaybackChoices({ ignoreDeathskip: false })).toEqual({});
    expect(readPlaybackChoices([30])).toEqual({});
    expect(readPlaybackChoices(null)).toEqual({});
  });

  it("gives the same choices when it reads its own result", () => {
    const once = readPlaybackChoices({ respawn: 1800, ignoreDeathskip: true, extra: 1 });
    expect(once).toEqual({ respawn: 1800, ignoreDeathskip: true });
    expect(readPlaybackChoices(once)).toEqual(once);
  });

  it("gives every setting a default inside its range and keeps its other edge values", () => {
    for (const [key, spec] of PLAYBACK_SETTING_ENTRIES) {
      if (spec.kind === "toggle") {
        expect(readPlaybackChoices({ [key]: !spec.default }), key).toEqual({ [key]: !spec.default });
        continue;
      }
      expect(spec.default, key).toBeGreaterThanOrEqual(spec.min);
      expect(spec.default, key).toBeLessThanOrEqual(spec.max);
      for (const edge of [spec.min, spec.max].filter((v) => v !== spec.default))
        expect(readPlaybackChoices({ [key]: edge }), key).toEqual({ [key]: edge });
    }
  });
});

describe("resolvePlaybackSettings", () => {
  it("fills unchosen settings with the defaults, with the model's 300 s respawn and 500 yd kill area", () => {
    expect(resolvePlaybackSettings({})).toEqual({ respawn: 300, area: 500, ignoreDeathskip: false });
    expect(resolvePlaybackSettings({ ignoreDeathskip: true })).toEqual({ respawn: 300, area: 500, ignoreDeathskip: true });
  });
});
