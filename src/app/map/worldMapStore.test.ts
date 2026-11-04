import { describe, expect, it } from "vitest";
import { parseGuide } from "../../guide/index.ts";
import type { MapFocusTarget } from "./lineFocus.ts";
import { WorldMapStore, type MapFocusRequest } from "./worldMapStore.ts";

const target: MapFocusTarget = { kind: "line", doc: parseGuide("#name T\nstep\n.goto Elwynn Forest,42,65\n"), at: { step: 0, index: 0 } };

function receiver(name: string, taken: string[]) {
  return (request: MapFocusRequest) => {
    taken.push(`${name} ${request.id}`);
    return { kind: "focused" } as const;
  };
}

describe("WorldMapStore focus lease", () => {
  it("sends a request only to the map that took the lease last, and keeps that lease when an older map ends its own", () => {
    const store = new WorldMapStore();
    const taken: string[] = [];
    const endEdit = store.connectFocus(receiver("edit", taken));
    expect(store.focus(target)).toEqual({ kind: "focused" });
    store.connectFocus(receiver("other", taken));
    endEdit();
    expect(store.focus(target)).toEqual({ kind: "focused" });
    expect(taken).toEqual(["edit 1", "other 2"]);
  });

  it("refuses a request while no map is mounted, and never replays it to a map that mounts later", () => {
    const store = new WorldMapStore();
    const taken: string[] = [];
    store.connectFocus(receiver("edit", taken))();
    expect(store.focus(target)).toEqual({ kind: "unavailable", message: "Open the Edit map to focus on a place." });
    store.connectFocus(receiver("later", taken));
    expect(taken).toEqual([]);
    expect(store.focus(target)).toEqual({ kind: "focused" });
    expect(taken).toEqual(["later 1"]);
  });
});

describe("WorldMapStore highlights", () => {
  it("clears a highlight only while its owner and key still match, and any of the owner's highlights with no key", () => {
    const store = new WorldMapStore();
    store.highlight("hovered", "g0:0", "90:1");
    store.highlight("focused", "g0:0", "226:1");
    store.unhighlight("hovered", "g0:0", "226:1");
    store.unhighlight("hovered", "g0:1", "90:1");
    expect(store.getState()).toEqual({ hovered: { owner: "g0:0", key: "90:1" }, focused: { owner: "g0:0", key: "226:1" } });
    store.unhighlight("hovered", "g0:0", "90:1");
    expect(store.getState()).toEqual({ hovered: null, focused: { owner: "g0:0", key: "226:1" } });
    store.unhighlight("focused", "g0:1");
    expect(store.getState().focused).toEqual({ owner: "g0:0", key: "226:1" });
    store.unhighlight("focused", "g0:0");
    expect(store.getState()).toEqual({ hovered: null, focused: null });
  });
});
