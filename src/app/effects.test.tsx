// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDisclosure, useEachFrame, useEventListener, useOutsidePress, usePendingAction, useTimeout } from "./effects.ts";
import userEvent from "@testing-library/user-event";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useEventListener", () => {
  it("calls the latest listener without adding it again, and removes it on unmount", () => {
    const add = vi.spyOn(window, "addEventListener");
    const heard: string[] = [];
    const { rerender, unmount } = renderHook(
      ({ name }) =>
        useEventListener(
          () => window,
          "keydown",
          () => heard.push(name),
        ),
      {
        initialProps: { name: "first" },
      },
    );
    rerender({ name: "second" });
    fireEvent.keyDown(window);
    unmount();
    fireEvent.keyDown(window);
    expect(heard).toEqual(["second"]);
    expect(add.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
    add.mockRestore();
  });

  it("listens on a ref's element once it mounts, and stops while disabled", () => {
    const heard: string[] = [];
    function Box(props: { shown: boolean; enabled: boolean }) {
      const box = useRef<HTMLDivElement>(null);
      useEventListener(
        () => box.current,
        "click",
        () => heard.push("click"),
        { enabled: props.enabled },
      );
      return props.shown ? <div ref={box} data-testid="box" /> : null;
    }
    const { rerender, getByTestId } = render(<Box shown={false} enabled />);
    rerender(<Box shown enabled />);
    fireEvent.click(getByTestId("box"));
    rerender(<Box shown enabled={false} />);
    fireEvent.click(getByTestId("box"));
    expect(heard).toEqual(["click"]);
  });
});

describe("useOutsidePress", () => {
  function Menu(props: { onOutside: () => void }) {
    const [open, setOpen] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);
    const first = useRef<HTMLButtonElement>(null);
    useOutsidePress(open, wrap, props.onOutside, () => first.current);
    return (
      <>
        <div ref={wrap}>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <button ref={first} type="button">
            First
          </button>
        </div>
        <p>Outside</p>
      </>
    );
  }

  it("focuses the named control when it opens, and hears only presses outside", () => {
    const onOutside = vi.fn();
    const { getByText } = render(<Menu onOutside={onOutside} />);
    fireEvent.pointerDown(getByText("Outside"));
    expect(onOutside).not.toHaveBeenCalled();
    fireEvent.click(getByText("Open"));
    expect(document.activeElement).toBe(getByText("First"));
    fireEvent.pointerDown(getByText("First"));
    expect(onOutside).not.toHaveBeenCalled();
    fireEvent.pointerDown(getByText("Outside"));
    expect(onOutside).toHaveBeenCalledOnce();
  });
});

describe("useDisclosure", () => {
  function Popover(props: { lightDismiss?: boolean; buttonWhileOpen?: boolean }) {
    const { open, toggle, close, button, wrap } = useDisclosure({
      focus: (wrap) => wrap.querySelector("input"),
      lightDismiss: props.lightDismiss ?? true,
    });
    const outside = useRef<HTMLButtonElement>(null);
    return (
      <>
        <span {...wrap}>
          {(props.buttonWhileOpen ?? true) || !open ? (
            <button ref={button} type="button" onClick={toggle}>
              Toggle
            </button>
          ) : null}
          {open && (
            <button
              type="button"
              onClick={() => {
                close();
                outside.current?.focus();
              }}
            >
              Done
            </button>
          )}
          {open && <input aria-label="Field" />}
        </span>
        <button ref={outside} type="button">
          Outside
        </button>
      </>
    );
  }

  it("stays open on a press or focus outside without light dismiss, and still closes on Escape", async () => {
    const user = userEvent.setup();
    const { getByRole, queryByRole } = render(<Popover lightDismiss={false} />);
    await user.click(getByRole("button", { name: "Toggle" }));
    await user.click(getByRole("button", { name: "Outside" }));
    await user.click(getByRole("textbox", { name: "Field" }));
    await user.tab();
    expect(document.activeElement).toBe(getByRole("button", { name: "Outside" }));
    await user.click(getByRole("textbox", { name: "Field" }));
    await user.keyboard("{Escape}");
    expect([queryByRole("textbox"), document.activeElement]).toEqual([null, getByRole("button", { name: "Toggle" })]);
  });

  it("leaves focus where a handler moves it after close", async () => {
    const user = userEvent.setup();
    const { getByRole, queryByRole } = render(<Popover />);
    await user.click(getByRole("button", { name: "Toggle" }));
    await user.click(getByRole("button", { name: "Done" }));
    expect([queryByRole("textbox"), document.activeElement]).toEqual([null, getByRole("button", { name: "Outside" })]);
  });

  it("focuses a button that shows only while closed once Escape closes the popover", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<Popover buttonWhileOpen={false} />);
    await user.click(getByRole("button", { name: "Toggle" }));
    expect(document.activeElement).toBe(getByRole("textbox", { name: "Field" }));
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(getByRole("button", { name: "Toggle" }));
  });
});

describe("useTimeout", () => {
  it("fires once the delay passes with the key unchanged, and waits again after a change", () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const { rerender } = renderHook<void, { value: string; delay: number | null }>(
      ({ value, delay }) => useTimeout(() => fired.push(value), delay, value),
      { initialProps: { value: "a", delay: 100 } },
    );
    act(() => void vi.advanceTimersByTime(60));
    rerender({ value: "b", delay: 100 });
    act(() => void vi.advanceTimersByTime(60));
    expect(fired).toEqual([]);
    act(() => void vi.advanceTimersByTime(40));
    expect(fired).toEqual(["b"]);
    rerender({ value: "c", delay: null });
    act(() => void vi.advanceTimersByTime(1000));
    expect(fired).toEqual(["b"]);
  });
});

describe("useEachFrame", () => {
  it("runs before paint after each render, then each frame until it returns false", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((frame) => frames.push(frame));
    let runs = 0;
    const { rerender } = renderHook(() => useEachFrame(() => ++runs % 3 !== 0));
    expect(runs).toBe(1);
    frames.shift()!(0);
    frames.shift()!(0);
    expect(runs).toBe(3);
    expect(frames).toHaveLength(0);
    rerender();
    expect(runs).toBe(4);
    vi.restoreAllMocks();
  });

  it("cancels its next frame on unmount", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((frame) => frames.push(frame) + 100);
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    const { unmount } = renderHook(() => useEachFrame(() => true));
    frames.shift()!(0);
    unmount();
    expect(cancel).toHaveBeenCalledWith(101);
    vi.restoreAllMocks();
  });
});

describe("usePendingAction", () => {
  it("performs each pending value once after its commit, zero included", () => {
    const performed: number[] = [];
    let leave = (_at: number) => {};
    function Field() {
      const pending = useRef<number | null>(null);
      const [, rerender] = useState(0);
      leave = (at) => {
        pending.current = at;
        rerender((n) => n + 1);
      };
      usePendingAction(pending, (at) => performed.push(at));
      return null;
    }
    const { rerender } = render(<Field />);
    act(() => leave(0));
    rerender(<Field />);
    act(() => leave(4));
    expect(performed).toEqual([0, 4]);
  });
});
