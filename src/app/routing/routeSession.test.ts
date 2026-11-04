// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import * as storage from "../../storage/routing.ts";
import { createStores } from "../stores.ts";
import { RouteSession } from "./routeSession.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const settle = () => new Promise((resolve) => setTimeout(resolve));

// StrictMode makes a component's state twice and keeps one, and it releases and retains again in one task.
it("loads nothing until retained, and loads the plans once through a release and a retain in one task", async () => {
  const loads = vi.spyOn(storage, "loadPlans");
  const opened = vi.fn();
  const { routing, routeSettings } = createStores();
  const session = new RouteSession(routing, routeSettings, { reopen: null, opened, problem: () => {} });
  await settle();
  expect(loads).toHaveBeenCalledTimes(0);

  session.retain("open")();
  session.retain("open");
  await vi.waitFor(() => expect(opened).toHaveBeenCalledWith(null));
  expect([loads.mock.calls.length, session.editor.get().plans]).toEqual([1, []]);
});
