// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CopyTextButton } from "./GuideSource.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("shows Copied for two seconds after the latest copy", async () => {
  // jsdom has no clipboard, and userEvent.setup() gives it one.
  userEvent.setup();
  vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  render(<CopyTextButton text="#name G" />);
  const after = async (ms: number) => {
    await act(() => vi.advanceTimersByTimeAsync(ms));
    return screen.getByRole("status").textContent;
  };
  const copy = () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy guide text" }));
    return after(0);
  };
  await copy();
  expect(await after(1500)).toBe("Copied");
  await copy();
  expect([await after(1000), await after(1000)]).toEqual(["Copied", ""]);
});
