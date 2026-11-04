import { describe, expect, it } from "vitest";
import { advance, type Effect } from "./character.ts";
import type { QuestProgress, SimState } from "./simulate.ts";

const here = { instance: 0, x: 1, y: 2 };
const wolves: QuestProgress = {
  status: "partial",
  objectives: [
    { count: 1, complete: false },
    { count: 3, complete: true },
  ],
};
const start: SimState = {
  level: 2,
  xp: 100,
  position: null,
  log: new Map([[1, wolves]]),
  done: new Set([7]),
  bind: null,
  flightPaths: new Set(),
};

describe("advance", () => {
  it.each<[string, Effect, Partial<SimState>]>([
    [
      "accept",
      { kind: "accept", questId: 2, progress: { status: "complete", objectives: [] } },
      {
        log: new Map([
          [1, wolves],
          [2, { status: "complete", objectives: [] }],
        ]),
      },
    ],
    [
      "objective that completes the quest",
      { kind: "objective", ref: { questId: 1, row: 0 }, progress: { count: 2, complete: true } },
      {
        log: new Map([
          [
            1,
            {
              status: "complete",
              objectives: [
                { count: 2, complete: true },
                { count: 3, complete: true },
              ],
            },
          ],
        ]),
      },
    ],
    ["objective of a quest not in the log", { kind: "objective", ref: { questId: 9, row: 0 }, progress: { count: 2, complete: true } }, {}],
    ["turnin", { kind: "turnin", questId: 1 }, { log: new Map(), done: new Set([7, 1]) }],
    ["abandon", { kind: "abandon", questId: 1 }, { log: new Map() }],
    ["xp", { kind: "xp", level: 3, xp: 40 }, { level: 3, xp: 40 }],
    ["bind", { kind: "bind", at: here }, { bind: here }],
    ["flightPath", { kind: "flightPath", node: 4 }, { flightPaths: new Set([4]) }],
    ["done", { kind: "done", questIds: [7, 8] }, { done: new Set([7, 8]) }],
    ["position", { kind: "position", at: here }, { position: here }],
  ])("applies %s once, however often it runs", (_, effect, changed) => {
    const once = advance(start, effect);
    expect(once).toEqual({ ...start, ...changed });
    expect(advance(once, effect)).toEqual(once);
  });

  it("leaves the state it was given unchanged", () => {
    const after = advance(start, { kind: "turnin", questId: 1 });
    expect([after.log.has(1), after.done.has(1), start.log.has(1), start.done.has(1)]).toEqual([false, true, true, false]);
  });

  it("rewrites only the text row an objective effect names, and keeps the other row", () => {
    const first = { count: 0, complete: false };
    const state = { ...start, log: new Map([[1581, { status: "incomplete" as const, objectives: [first, first] }]]) };
    const after = advance(state, { kind: "objective", ref: { questId: 1581, row: 1 }, progress: { count: 2, complete: true } });
    expect(after.log.get(1581)).toEqual({ status: "partial", objectives: [first, { count: 2, complete: true }] });
    expect(after.log.get(1581)!.objectives[0]).toBe(first);
  });
});
