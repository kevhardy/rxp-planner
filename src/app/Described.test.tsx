// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Described } from "./Described.tsx";

beforeEach(() => {
  fireEvent.pointerDown(document);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tip = () => screen.getByRole("tooltip", { hidden: true });
const frame = () => act(() => new Promise((resolve) => requestAnimationFrame(resolve)));

describe("Described", () => {
  it("shows on hover, links the control, and renders no title", async () => {
    const user = userEvent.setup();
    render(
      <Described text="Add a step after the selected one">
        <button type="button">Add step</button>
      </Described>,
    );
    const button = screen.getByRole("button", { name: "Add step", description: "Add a step after the selected one" });
    expect(button.getAttribute("aria-describedby")).toBe(tip().id);
    expect(tip().hidden).toBe(true);
    expect(document.querySelector("[title]")).toBeNull();

    await user.hover(button);
    expect(screen.getByRole("tooltip").textContent).toBe("Add a step after the selected one");
    await user.unhover(button);
    expect(tip().hidden).toBe(true);
  });

  it("shows on focus, hides while typing, and returns when focus comes back", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Described text="Minimum level">
          <label>
            Level <input />
          </label>
        </Described>
        <button type="button">Next</button>
      </>,
    );
    const input = screen.getByRole("textbox", { name: "Level" });
    expect(input.getAttribute("aria-describedby")).toBe(tip().id);

    await user.tab();
    expect(tip().hidden).toBe(false);
    await user.keyboard("2");
    expect(tip().hidden).toBe(true);
    await user.tab();
    expect(tip().hidden).toBe(true);
    await user.tab({ shift: true });
    expect(input).toHaveProperty("value", "2");
    expect(tip().hidden).toBe(false);
  });

  it("shows for focus after a key press but not after a pointer press", () => {
    render(
      <Described text="Race of the preview character">
        <select aria-label="Race" />
      </Described>,
    );
    const select = screen.getByRole("combobox");
    fireEvent.pointerDown(document.body);
    act(() => select.focus());
    expect(tip().hidden).toBe(true);
    act(() => select.blur());
    fireEvent.keyDown(document.body, { key: "Enter" });
    act(() => select.focus());
    expect(tip().hidden).toBe(false);
  });

  it("stays hidden after typing when the pointer leaves and returns", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Described text="Minimum level">
          <input aria-label="Level" />
        </Described>
        <button type="button">Next</button>
      </>,
    );
    const input = screen.getByRole("textbox");
    await user.tab();
    await user.keyboard("2");
    await user.hover(input);
    await user.unhover(input);
    await user.hover(input);
    expect(tip().hidden).toBe(true);
    await user.tab();
    await user.tab({ shift: true });
    expect(tip().hidden).toBe(false);
  });

  it("stays shown for focus when the pointer leaves", async () => {
    const user = userEvent.setup();
    render(
      <Described text="Add a step">
        <button type="button">Add step</button>
      </Described>,
    );
    await user.tab();
    await user.hover(screen.getByRole("button"));
    await user.unhover(screen.getByRole("button"));
    expect(tip().hidden).toBe(false);
  });

  it("hides on Escape until the pointer or focus leaves", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Described text="Add a step">
          <button type="button">Add step</button>
        </Described>
        <button type="button">Next</button>
      </>,
    );
    const button = screen.getByRole("button", { name: "Add step" });
    await user.hover(button);
    await user.keyboard("{Escape}");
    expect(tip().hidden).toBe(true);
    await user.unhover(button);
    await user.tab();
    expect(tip().hidden).toBe(false);
    await user.keyboard("{Escape}");
    expect(tip().hidden).toBe(true);
    await user.tab();
    await user.tab({ shift: true });
    expect(tip().hidden).toBe(false);
  });

  it("shows for open again after Escape when open goes off and back on", async () => {
    const user = userEvent.setup();
    const ring = (open: boolean) => (
      <Described text="Level 2, 40% xp" open={open}>
        <button type="button" tabIndex={-1}>
          2
        </button>
      </Described>
    );
    const { rerender } = render(ring(true));
    expect(tip().hidden).toBe(false);
    await user.keyboard("{Escape}");
    expect(tip().hidden).toBe(true);
    rerender(ring(false));
    rerender(ring(true));
    expect(tip().hidden).toBe(false);
  });

  it("leaves a link inside the child to its own description", async () => {
    const user = userEvent.setup();
    render(
      <Described text="Quest ID">
        <span>
          <input aria-label="Quest" />
          <a href="https://example.com/">Hogger</a>
        </span>
      </Described>,
    );
    const input = screen.getByRole("textbox");
    expect(screen.getByRole("link").hasAttribute("aria-describedby")).toBe(false);
    await user.hover(screen.getByRole("link"));
    expect(tip().hidden).toBe(true);
    await user.hover(input);
    expect(tip().hidden).toBe(false);
    await user.unhover(input);
    await user.tab();
    expect(tip().hidden).toBe(false);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link"));
    expect(tip().hidden).toBe(true);
  });

  it("shows only for keyboard focus when hover is off", async () => {
    const user = userEvent.setup();
    render(
      <Described text="Item 6948" hover={false}>
        <a href="https://example.com/">Hearthstone</a>
      </Described>,
    );
    await user.hover(screen.getByRole("link"));
    expect(tip().hidden).toBe(true);
    await user.tab();
    expect(tip().hidden).toBe(false);
  });

  it("hides when a dialog makes the app inert", async () => {
    const user = userEvent.setup();
    render(
      <div id="app">
        <Described text="Import guides">
          <button type="button">Import</button>
        </Described>
      </div>,
    );
    await user.hover(screen.getByRole("button"));
    expect(tip().hidden).toBe(false);
    document.getElementById("app")!.setAttribute("inert", "");
    await frame();
    expect(tip().hidden).toBe(true);
  });

  it("shows again when focus returns after a press", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Described text="Add a step">
          <button type="button">Add step</button>
        </Described>
        <button type="button">Next</button>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Add step" }));
    expect(tip().hidden).toBe(true);
    await user.tab();
    await user.tab({ shift: true });
    expect(tip().hidden).toBe(false);
  });

  it("pins on a click, and unpins on a second click, Escape, or a press elsewhere", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Described text="Line 2: Quest 999 is not in the quest data" pin>
          <button type="button">1 warning</button>
        </Described>
        <button type="button">Next</button>
      </>,
    );
    const badge = screen.getByRole("button", { name: "1 warning" });
    const pin = async () => {
      await user.click(badge);
      await user.unhover(badge);
      expect(tip().hidden).toBe(false);
    };

    await pin();
    await user.click(badge);
    expect(tip().hidden).toBe(true);
    await user.unhover(badge);

    await pin();
    await user.keyboard("{Escape}");
    expect(tip().hidden).toBe(true);

    await pin();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(tip().hidden).toBe(true);
  });

  it("stays hidden while the control's popover is open", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Described text="Preview as" popoverOpen>
        <button type="button">Human Warrior</button>
      </Described>,
    );
    await user.hover(screen.getByRole("button"));
    expect(tip().hidden).toBe(true);
    rerender(
      <Described text="Preview as">
        <button type="button">Human Warrior</button>
      </Described>,
    );
    expect(tip().hidden).toBe(false);
  });

  it("keeps the control mounted and focused when the text goes away", () => {
    const { rerender } = render(
      <Described text="Updating after the edit">
        <button type="button">Warning</button>
      </Described>,
    );
    const button = screen.getByRole("button");
    button.focus();
    rerender(
      <Described>
        <button type="button">Warning</button>
      </Described>,
    );
    expect(document.activeElement).toBe(button);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
  });

  it("shows a clipped child's own text only while it is cut off, and links no description", async () => {
    const user = userEvent.setup();
    render(
      <Described text="Elwynn Forest and Westfall" clipped>
        <button type="button">
          <span className="icon" style={{ overflow: "hidden" }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>Elwynn Forest and Westfall</span>
        </button>
      </Described>,
    );
    const button = screen.getByRole("button");
    const [icon, name] = button.children;
    Object.defineProperty(icon, "scrollWidth", { value: 18 });
    Object.defineProperty(icon, "clientWidth", { value: 16 });
    const width = (scroll: number) => Object.defineProperty(name, "scrollWidth", { value: scroll, configurable: true });
    Object.defineProperty(name, "clientWidth", { value: 100 });

    width(100);
    await user.hover(button);
    expect(tip().hidden).toBe(true);
    await user.unhover(button);

    width(180);
    await user.hover(button);
    expect(tip().hidden).toBe(false);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });

  it("goes above and left-aligned, flips at the right edge, and drops at the top", async () => {
    const user = userEvent.setup();
    let control = new DOMRect(50, 200, 60, 30);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute("data-tip-bounds")) return new DOMRect(0, 100, 400, 500);
      if (this.getAttribute("role") === "tooltip") return new DOMRect(0, 0, 200, 40);
      return control;
    });
    render(
      <div data-tip-bounds>
        <Described text="Zoom in">
          <button type="button">+</button>
        </Described>
      </div>,
    );
    const button = screen.getByRole("button");
    const place = async () => {
      await user.hover(button);
      const { left, top } = tip().style;
      await user.unhover(button);
      return [left, top];
    };

    expect(await place()).toEqual(["50px", "154px"]);
    control = new DOMRect(300, 200, 60, 30);
    expect(await place()).toEqual(["160px", "154px"]);
    control = new DOMRect(50, 120, 60, 30);
    expect(await place()).toEqual(["50px", "156px"]);
  });

  it("drops below the ruler band and the banner's rule under a banner control", async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute("data-tip-bounds")) return new DOMRect(0, 100, 400, 500);
      if (this.getAttribute("role") === "tooltip") return new DOMRect(0, 0, 200, 40);
      return new DOMRect(50, 120, 60, 30);
    });
    render(
      <div data-tip-bounds style={{ "--ruler-band": "6px" }}>
        <Described text="Library">
          <button type="button">Library</button>
        </Described>
      </div>,
    );
    await user.hover(screen.getByRole("button"));
    expect(tip().style.top).toBe("163px");
  });

  it("clears a map mark's ring above and below while it has keyboard focus", async () => {
    const user = userEvent.setup();
    let mark = new DOMRect(50, 200, 20, 20);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute("data-tip-bounds")) return new DOMRect(0, 100, 400, 500);
      if (this.getAttribute("role") === "tooltip") return new DOMRect(0, 0, 200, 40);
      return mark;
    });
    render(
      <div data-tip-bounds>
        <Described text="Ariena Stormfeather">
          <button type="button" style={{ "--mark-reach": "8px" }}>
            A
          </button>
        </Described>
      </div>,
    );
    const button = screen.getByRole("button");
    const place = async () => {
      await user.tab();
      const { top } = tip().style;
      await user.tab({ shift: true });
      return top;
    };

    expect(await place()).toBe("146px");
    mark = new DOMRect(50, 120, 20, 20);
    expect(await place()).toBe("154px");
    await user.hover(button);
    expect(tip().style.top).toBe("146px");
  });

  it("stays inside its bounds and the window when it is larger than the room beside the child", async () => {
    const user = userEvent.setup();
    let control = new DOMRect(100, 200, 60, 30);
    let bounds = new DOMRect(0, 100, 400, 500);
    let size = new DOMRect(0, 0, 320, 40);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute("data-tip-bounds")) return bounds;
      if (this.getAttribute("role") === "tooltip") return size;
      return control;
    });
    render(
      <div data-tip-bounds>
        <Described text="Kill card">
          <button type="button">1 kill</button>
        </Described>
      </div>,
    );
    const button = screen.getByRole("button");
    await user.hover(button);
    expect(tip().style.left).toBe("4px");
    await user.unhover(button);

    control = new DOMRect(900, 200, 60, 30);
    bounds = new DOMRect(0, 100, innerWidth + 200, 500);
    await user.hover(button);
    expect(tip().style.left).toBe(`${innerWidth - 4 - 320}px`);
    await user.unhover(button);

    control = new DOMRect(50, 300, 60, 30);
    bounds = new DOMRect(0, 100, 400, 500);
    size = new DOMRect(0, 0, 200, 400);
    await user.hover(button);
    expect(tip().style.top).toBe("196px");
    await user.unhover(button);

    size = new DOMRect(0, 0, 200, 700);
    await user.hover(button);
    expect(tip().style.top).toBe(`${innerHeight - 4 - 700}px`);
    await user.unhover(button);

    control = new DOMRect(50, 100, 60, 30);
    bounds = new DOMRect(0, 0, 400, innerHeight + 200);
    size = new DOMRect(0, 0, 200, 700);
    await user.hover(button);
    expect(tip().style.top).toBe(`${innerHeight - 4 - 700}px`);
  });

  it("follows the child when it moves while shown", async () => {
    const user = userEvent.setup();
    let control = new DOMRect(50, 200, 60, 30);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute("data-tip-bounds")) return new DOMRect(0, 100, 400, 500);
      if (this.getAttribute("role") === "tooltip") return new DOMRect(0, 0, 200, 40);
      return control;
    });
    render(
      <div data-tip-bounds>
        <Described text="Pin">
          <button type="button">Pin</button>
        </Described>
      </div>,
    );
    await user.tab();
    expect([tip().style.left, tip().style.top]).toEqual(["50px", "154px"]);
    control = new DOMRect(80, 300, 60, 30);
    await frame();
    expect([tip().style.left, tip().style.top]).toEqual(["80px", "254px"]);
  });

  it("is dismissed and stops measuring when its pane scrolls it out of view", async () => {
    const user = userEvent.setup();
    let control = new DOMRect(50, 200, 60, 30);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute("data-tip-bounds")) return new DOMRect(0, 100, 400, 500);
      if (this.getAttribute("role") === "tooltip") return new DOMRect(0, 0, 200, 40);
      return control;
    });
    render(
      <div data-tip-bounds>
        <Described text="Pin">
          <button type="button">Pin</button>
        </Described>
      </div>,
    );
    await user.tab();
    expect(tip().hidden).toBe(false);
    control = new DOMRect(50, 40, 60, 30);
    await frame();
    expect(tip().hidden).toBe(true);
    const request = vi.spyOn(window, "requestAnimationFrame");
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(request).not.toHaveBeenCalled();
  });
});
