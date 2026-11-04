// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as loader from "../data/dataset.ts";
import { renderApp } from "./renderPlanner.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps the page running through StrictMode's simulated unmount, and stops it at cleanup", () => {
  const loads = vi.spyOn(loader, "fetchDatasetArtifact").mockReturnValue(new Promise(() => {}));
  const fetching = () => loads.mock.calls.map(([, signal]) => !signal.aborted);
  const undoPrevented = () => !fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  renderApp({ initial: { guides: [] }, dataset: { manifest: "/fixture/manifest.json", base: "/fixture/" }, strict: true });
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(undoPrevented()).toBe(true);
  expect(fetching()).toEqual([true]);

  cleanup();
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(undoPrevented()).toBe(false);
  expect(fetching()).toEqual([false]);
});
