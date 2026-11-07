// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PopoverMenu } from "./PopoverMenu.tsx";

/** jsdom has no layout. These values fake the window, the button, the popover's CSS width, and its content's height. */
let view = { width: 1024, height: 768 };
let button = { left: 180, top: 20 };
let cssWidth = 320;
let content = 200;
let resized: () => void;
let observing = false;

const px = (value: string) => (value ? parseFloat(value) : Infinity);
const at = (el: HTMLElement, name: "x" | "y" | "bottom" | "w" | "h") =>
  px(el.style.getPropertyValue(name === "w" || name === "h" ? `--size-${name}` : `--at-${name}`));
const size = (el: HTMLElement) => ({ width: Math.min(cssWidth, at(el, "w")), height: Math.min(content, at(el, "h")) });

async function open(align: "start" | "end" = "end", beside?: string) {
  vi.spyOn(window, "innerWidth", "get").mockImplementation(() => view.width);
  vi.spyOn(window, "innerHeight", "get").mockImplementation(() => view.height);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.matches(".popover") ? size(this).width : 0;
  });
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
    return this.matches(".popover") ? content : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches(".popover")) {
      const el = this as HTMLElement;
      const { width, height } = size(el);
      const top = at(el, "y") === Infinity ? view.height - at(el, "bottom") - height : at(el, "y");
      return DOMRect.fromRect({ x: at(el, "x"), y: top, width, height });
    }
    if (this.matches("button")) return DOMRect.fromRect({ x: button.left, y: button.top, width: 70, height: 30 });
    return DOMRect.fromRect({ x: 200, y: 0, width: 400, height: 100 });
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {
        observing = true;
      }
      disconnect() {
        observing = false;
      }
    },
  );
  const user = userEvent.setup();
  render(
    <div className="clip" style={{ overflow: "hidden" }}>
      <PopoverMenu className="menu" label="Menu" description="A menu" align={align} {...(beside && { beside })}>
        <p>Items</p>
      </PopoverMenu>
    </div>,
  );
  await user.click(screen.getByRole("button", { name: "Menu" }));
  return user;
}

const bounds = () => {
  const r = screen.getByRole("region", { name: "Menu" }).getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
};
const grow = (height: number) => {
  content = height;
  act(() => resized());
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  view = { width: 1024, height: 768 };
  button = { left: 180, top: 20 };
  cssWidth = 320;
  content = 200;
});

describe("PopoverMenu placement", () => {
  it("hangs below its button from the button's right edge, or from its left edge with align start", async () => {
    button = { left: 600, top: 20 };
    await open();
    expect(bounds()).toEqual({ left: 350, right: 670, top: 58, bottom: 258 });
    cleanup();
    await open("start");
    expect(bounds()).toEqual({ left: 600, right: 920, top: 58, bottom: 258 });
  });

  it("opens right of its beside ancestor in line with the button, or below the button when the window has no room there", async () => {
    await open("end", ".clip");
    expect(bounds()).toEqual({ left: 608, right: 928, top: 20, bottom: 220 });
    cleanup();
    view = { width: 900, height: 768 };
    await open("end", ".clip");
    expect(bounds()).toEqual({ left: 8, right: 328, top: 58, bottom: 258 });
  });

  it("moves inside the window's left and right edges, and is no wider than the window less its margins", async () => {
    view = { width: 400, height: 768 };
    await open();
    expect(bounds()).toMatchObject({ left: 8, right: 328 });
    cleanup();
    await open("start");
    expect(bounds()).toMatchObject({ left: 72, right: 392 });
    cleanup();
    view = { width: 300, height: 768 };
    await open();
    expect(bounds()).toMatchObject({ left: 8, right: 292 });
  });

  it("limits its height to the space below, with no minimum, and opens upward when there is more space above", async () => {
    view = { width: 1024, height: 300 };
    button = { left: 180, top: 220 };
    content = 30;
    await open();
    expect(bounds()).toMatchObject({ top: 258, bottom: 288 });
    cleanup();
    content = 600;
    await open();
    expect(bounds()).toMatchObject({ top: 8, bottom: 212 });
  });

  it("stays in the window when its content grows or shrinks while it is open", async () => {
    view = { width: 1024, height: 300 };
    button = { left: 180, top: 220 };
    content = 60;
    await open();
    expect(bounds()).toMatchObject({ top: 152, bottom: 212 });
    grow(600);
    expect(bounds()).toMatchObject({ top: 8, bottom: 212 });
    grow(20);
    expect(bounds()).toMatchObject({ top: 258, bottom: 278 });
    grow(300);
    expect(bounds()).toMatchObject({ top: 8, bottom: 212 });
  });

  it("fits again when the window resizes or anything scrolls while it is open, and stops when it closes", async () => {
    const user = await open("start");
    expect(bounds()).toMatchObject({ left: 180, right: 500 });
    view = { width: 400, height: 768 };
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(bounds()).toMatchObject({ left: 72, right: 392 });

    button = { ...button, top: 600 };
    act(() => void fireEvent.scroll(document.body));
    expect(bounds()).toMatchObject({ top: 392, bottom: 592 });

    expect(observing).toBe(true);
    const removed = vi.spyOn(window, "removeEventListener");
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(removed.mock.calls.map(([type]) => type).sort()).toEqual(["resize", "scroll"]);
    expect(observing).toBe(false);
  });

  it("closes when a scroll or resize moves its button out of the window, and does not focus the button", async () => {
    const user = await open();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const expanded = () => screen.getByRole("button", { name: "Menu", hidden: true }).getAttribute("aria-expanded");
    button = { ...button, top: -20 };
    act(() => void fireEvent.scroll(document.body));
    expect(expanded()).toBe("true");

    button = { ...button, top: -40 };
    act(() => void fireEvent.scroll(document.body));
    expect(expanded()).toBe("false");
    expect(focus).not.toHaveBeenCalled();

    button = { left: 600, top: 20 };
    await user.click(screen.getByRole("button", { name: "Menu" }));
    focus.mockClear();
    view = { width: 500, height: 768 };
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(expanded()).toBe("false");
    expect(focus).not.toHaveBeenCalled();
  });

  it("is fixed to the window, so an ancestor that clips its overflow does not clip it", async () => {
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = readFileSync(join(import.meta.dirname, "../styles.css"), "utf8");
    try {
      await open();
      const menu = screen.getByRole("region", { name: "Menu" });
      expect(getComputedStyle(menu).position).toBe("fixed");
      expect(bounds()).toEqual({ left: 8, right: 328, top: 58, bottom: 258 });
    } finally {
      style.remove();
    }
  });
});

describe("PopoverMenu closing", () => {
  let heard = new AbortController();
  afterEach(() => heard.abort());

  function mount() {
    const escapes: string[] = [];
    heard = new AbortController();
    document.body.addEventListener("keydown", (e) => e.key === "Escape" && escapes.push(e.key), { signal: heard.signal });
    render(
      <>
        <PopoverMenu className="menu" label="Menu" description="A menu">
          {(close) => (
            <button type="button" onClick={close}>
              Done
            </button>
          )}
        </PopoverMenu>
        <button type="button">Outside</button>
        <p>Outside text</p>
      </>,
    );
    const toggle = screen.getByRole("button", { name: "Menu" });
    const shown = () => screen.queryByRole("region", { name: "Menu" }) !== null;
    return { user: userEvent.setup(), toggle, shown, escapes };
  }

  it("closes on Escape or its close function and focuses its button, and keeps Escape from its parent only while open", async () => {
    const { user, toggle, shown, escapes } = mount();
    await user.click(toggle);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));
    await user.keyboard("{Escape}");
    expect([shown(), document.activeElement, escapes]).toEqual([false, toggle, []]);
    await user.keyboard("{Escape}");
    expect(escapes).toEqual(["Escape"]);

    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect([shown(), document.activeElement]).toEqual([false, toggle]);

    await user.click(toggle);
    await user.click(toggle);
    expect(shown()).toBe(false);
  });

  it("closes without focusing its button on a press outside or on focus moving outside", async () => {
    const { user, toggle, shown } = mount();
    const outside = screen.getByRole("button", { name: "Outside" });
    await user.click(toggle);
    await user.tab();
    const done = document.activeElement;
    fireEvent.pointerDown(screen.getByText("Outside text"));
    expect([shown(), document.activeElement]).toEqual([false, done]);

    await user.click(toggle);
    await user.tab();
    await user.tab();
    expect([shown(), document.activeElement]).toEqual([false, outside]);
  });

  it("stays open when focus leaves for no element, as when the window loses focus", async () => {
    const { user, toggle, shown } = mount();
    await user.click(toggle);
    fireEvent.blur(toggle, { relatedTarget: null });
    expect(shown()).toBe(true);
  });

  it("cancels the Escape that closes it, so a dialog that holds it stays open", async () => {
    const { user, toggle } = mount();
    await user.click(toggle);
    expect(fireEvent.keyDown(screen.getByRole("button", { name: "Done" }), { key: "Escape" })).toBe(false);
  });
});
