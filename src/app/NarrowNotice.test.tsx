// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { loadLibrary } from "../storage/index.ts";
import { NarrowNotice } from "./NarrowNotice.tsx";
import { renderPlanner } from "./renderPlanner.tsx";

const TEXT = "RXP Planner needs a window at least 1080px wide. Until then, the page scrolls sideways.";

function stubWindow(width: number) {
  const lists: { query: string; matches: boolean; listeners: Set<() => void> }[] = [];
  const test = (query: string) => {
    const least = /^\(width < (\d+)px\)$/.exec(query)?.[1];
    return least !== undefined && width < Number(least);
  };
  vi.stubGlobal("matchMedia", (query: string) => {
    const list = { query, matches: test(query), listeners: new Set<() => void>() };
    lists.push(list);
    return {
      get matches() {
        return list.matches;
      },
      addEventListener: (_type: "change", listener: () => void) => list.listeners.add(listener),
      removeEventListener: (_type: "change", listener: () => void) => list.listeners.delete(listener),
    };
  });
  return (next: number) => {
    width = next;
    for (const list of lists) {
      if (test(list.query) === list.matches) continue;
      list.matches = !list.matches;
      for (const listener of list.listeners) listener();
    }
  };
}

const notice = () => screen.getByRole("status");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("puts its text in the live region after the region mounts, so a screen reader announces it", async () => {
  stubWindow(1000);
  render(<NarrowNotice />);
  expect(notice().textContent).toBe("");
  await vi.waitFor(() => expect(notice().textContent).toBe(TEXT));
});

it("shows below 1080px and not at 1080px, across a resize both ways", async () => {
  const resize = stubWindow(1080);
  render(<NarrowNotice />);
  await act(() => new Promise(requestAnimationFrame));
  expect(notice().textContent).toBe("");
  act(() => resize(1079));
  expect(notice().textContent).toBe(TEXT);
  act(() => resize(1080));
  expect(notice().textContent).toBe("");
});

it("shows in the planner", async () => {
  stubWindow(1000);
  await renderPlanner({ initial: await loadLibrary(), builtins: null, loadGameData: () => new Promise(() => {}) });
  expect(await screen.findByText(TEXT)).toBeTruthy();
});
