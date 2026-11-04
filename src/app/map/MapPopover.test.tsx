// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { MapPopover } from "./MapPopover.tsx";

const popoverHeight = 100;
const stepHeight = 30;
const stepSpacing = 40;
const narrowShift = 150;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

function renderSteps() {
  const layout = { scroll: 0, shift: 0 };
  const top = (step: Element) => Number(step.textContent) * stepSpacing + layout.shift - layout.scroll;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(popoverHeight);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return DOMRect.fromRect(
      this.matches(".map-popover-body") ? { y: 0, width: 300, height: popoverHeight } : { y: top(this), width: 300, height: stepHeight },
    );
  });
  Element.prototype.scrollIntoView = function (this: Element) {
    layout.scroll += Math.min(0, top(this)) + Math.max(0, top(this) + stepHeight - popoverHeight);
  };
  const resizes: (() => void)[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizes.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  const reports: (() => void)[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      readonly shown = new Map<Element, boolean | undefined>();
      constructor(callback: (entries: { target: Element; isIntersecting: boolean }[]) => void, options?: { root?: Element | null }) {
        reports.push(() => {
          const root = options?.root?.getBoundingClientRect() ?? DOMRect.fromRect({ height: innerHeight });
          const entries = [...this.shown].flatMap(([target, was]) => {
            const r = target.getBoundingClientRect();
            const isIntersecting = r.bottom > root.top && r.top < root.bottom;
            this.shown.set(target, isIntersecting);
            return isIntersecting === was ? [] : [{ target, isIntersecting }];
          });
          if (entries.length) callback(entries);
        });
      }
      observe(target: Element) {
        this.shown.set(target, undefined);
      }
      unobserve(target: Element) {
        this.shown.delete(target);
      }
      disconnect() {
        this.shown.clear();
      }
    },
  );
  render(
    <MapPopover title="Leg 2" facts={[]} onClose={() => {}} returnFocus={() => {}}>
      {[5, 6, 7].map((step) => (
        <button key={step}>{step}</button>
      ))}
    </MapPopover>,
  );
  const step = (n: number) => screen.getByRole("button", { name: String(n) });
  const scroll = (to: number) => {
    layout.scroll = to;
    act(() => {
      fireEvent.scroll(screen.getByRole("region", { name: "Leg 2" }).querySelector(".map-popover-body")!);
      for (const report of reports) report();
    });
  };
  const narrow = () => {
    layout.shift = narrowShift;
    act(() => {
      for (const resized of resizes) resized();
    });
  };
  return { layout, step, scroll, narrow };
}

it("leaves a focused control where the user scrolled it away when the map narrows", () => {
  const { step, scroll, narrow } = renderSteps();
  scroll(170);
  step(6).focus();
  scroll(0);
  narrow();
  expect(step(6).getBoundingClientRect().top).toBe(390);
});

it("keeps a control that Tab just showed in view when the map narrows before the observer reports it", () => {
  const { layout, step, narrow } = renderSteps();
  layout.scroll = 210;
  step(7).focus();
  narrow();
  expect(step(7).getBoundingClientRect().top).toBe(70);
});

it("ends a body that overflows on its last whole row, and keeps a body that fits at its full height without a rule", () => {
  const rows = 10;
  const scrollHeight = vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches(".map-popover-body")) return DOMRect.fromRect({ y: 40, width: 300, height: 200 });
    if (this.matches("dd")) return DOMRect.fromRect({ y: 48, width: 300, height: 20 });
    if (this.matches("li")) return DOMRect.fromRect({ y: 70 + 30 * (Number(this.textContent) - 1), width: 300, height: 30 });
    return DOMRect.fromRect({ y: 48, width: 300, height: 30 * rows + 22 });
  });
  const popover = () => (
    <MapPopover title="Route" facts={[{ label: "Stops", value: "A to B" }]} onClose={() => {}} returnFocus={() => {}}>
      <ol>
        {Array.from({ length: rows }, (_, i) => (
          <li key={i}>{i + 1}</li>
        ))}
      </ol>
    </MapPopover>
  );
  const { rerender } = render(popover());
  const body = screen.getByRole("region", { name: "Route" }).querySelector<HTMLElement>(".map-popover-body")!;
  expect(body.style.maxHeight).toBe("180px");
  expect(body.hasAttribute("data-clipped")).toBe(true);

  scrollHeight.mockReturnValue(200);
  rerender(popover());
  expect(body.style.maxHeight).toBe("");
  expect(body.hasAttribute("data-clipped")).toBe(false);
});

it("ends a body above a heading whose first row does not fit, not under the heading alone", () => {
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches(".map-popover-body")) return DOMRect.fromRect({ y: 40, width: 300, height: 60 });
    if (this.matches("dl, dd")) return DOMRect.fromRect({ y: 48, width: 300, height: 20 });
    if (this.matches("h4")) return DOMRect.fromRect({ y: 70, width: 300, height: 20 });
    if (this.matches("li")) return DOMRect.fromRect({ y: 90, width: 300, height: 30 });
    return DOMRect.fromRect({ y: 70, width: 300, height: 50 });
  });
  render(
    <MapPopover title="Route" facts={[{ label: "Stops", value: "A to B" }]} onClose={() => {}} returnFocus={() => {}}>
      <div>
        <h4>Legs</h4>
        <ol>
          <li>Start to B</li>
        </ol>
      </div>
    </MapPopover>,
  );
  const body = screen.getByRole("region", { name: "Route" }).querySelector<HTMLElement>(".map-popover-body")!;
  expect(body.style.maxHeight).toBe("28px");
});

it("ends a clipped body on its last whole row though a control in it is taller than that row", () => {
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches(".map-popover-body")) return DOMRect.fromRect({ y: 40, width: 300, height: 60 });
    if (this.matches("dl, dd")) return DOMRect.fromRect({ y: 48, width: 300, height: 20 });
    return DOMRect.fromRect({ y: 70, width: 300, height: 42 });
  });
  render(
    <MapPopover title="Route" facts={[{ label: "Stops", value: "A to B" }]} onClose={() => {}} returnFocus={() => {}}>
      <ol>
        <li>
          <button>Leg 1</button>
        </li>
      </ol>
    </MapPopover>,
  );
  const body = screen.getByRole("region", { name: "Route" }).querySelector<HTMLElement>(".map-popover-body")!;
  expect([body.style.maxHeight, body.style.minHeight]).toEqual(["28px", ""]);
});

it("ends a clipped body at its top, with no cut row, when no row fits in its room", () => {
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(15);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches(".map-popover-body")) return DOMRect.fromRect({ y: 40, width: 300, height: 15 });
    return DOMRect.fromRect({ y: 48, width: 300, height: 20 });
  });
  render(<MapPopover title="Route" facts={[{ label: "Stops", value: "A to B" }]} onClose={() => {}} returnFocus={() => {}} />);
  const body = screen.getByRole("region", { name: "Route" }).querySelector<HTMLElement>(".map-popover-body")!;
  expect(body.style.maxHeight).toBe("0px");
});

it("keeps a clipped body scrolled to its end there when the popover fits it again", () => {
  const [room, scrollHeight] = [200, 400];
  let scrolled = 0;
  const height = (el: HTMLElement) => (el.style.maxHeight ? parseFloat(el.style.maxHeight) : room);
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    if (!this.matches(".map-popover-body")) return 0;
    scrolled = Math.min(scrolled, scrollHeight - height(this));
    return height(this);
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches(".map-popover-body")) return DOMRect.fromRect({ y: 40, width: 300, height: height(this as HTMLElement) });
    if (this.matches("li")) return DOMRect.fromRect({ y: 40 + 30 * (Number(this.textContent) - 1) - scrolled, width: 300, height: 30 });
    return DOMRect.fromRect({ y: 40 - scrolled, width: 300, height: this.matches("ol") ? 300 : 0 });
  });
  const popover = () => (
    <MapPopover title="Route" facts={[]} onClose={() => {}} returnFocus={() => {}}>
      <ol>
        {Array.from({ length: 10 }, (_, i) => (
          <li key={i}>{i + 1}</li>
        ))}
      </ol>
    </MapPopover>
  );
  const { rerender } = render(popover());
  const body = screen.getByRole("region", { name: "Route" }).querySelector<HTMLElement>(".map-popover-body")!;
  Object.defineProperty(body, "scrollTop", {
    configurable: true,
    get: () => scrolled,
    set: (to: number) => {
      scrolled = Math.min(to, scrollHeight - height(body));
    },
  });
  body.scrollTop = scrollHeight;
  expect(body.scrollTop).toBe(220);

  rerender(popover());
  expect(body.scrollTop).toBe(220);
});

it.each([
  ["the strip around it grows", (strip: Element) => strip],
  ["the strip's bound grows, though the strip keeps its height", (strip: Element) => strip.querySelector(".map-top-bound")!],
])("grows a clipped body back to its full height when %s", (_, resized) => {
  let room = 100;
  const scrollHeight = 300;
  const height = (el: HTMLElement) => (el.style.maxHeight ? parseFloat(el.style.maxHeight) : Math.min(room, scrollHeight));
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.matches(".map-popover-body") ? height(this) : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches(".map-popover-body")) return DOMRect.fromRect({ y: 40, width: 300, height: height(this as HTMLElement) });
    if (this.matches("li")) return DOMRect.fromRect({ y: 40 + 30 * (Number(this.textContent) - 1), width: 300, height: 30 });
    return DOMRect.fromRect({ y: 40, width: 300, height: this.matches("ol") ? 300 : 0 });
  });
  const observed = new Map<Element, (() => void)[]>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe(target: Element) {
        observed.set(target, [...(observed.get(target) ?? []), this.callback]);
      }
      disconnect() {}
    },
  );
  const strip = document.body.appendChild(document.createElement("div"));
  onTestFinished(() => strip.remove());
  strip.className = "map-top";
  strip.appendChild(document.createElement("div")).className = "map-top-bound";
  render(
    <MapPopover title="Route" facts={[]} onClose={() => {}} returnFocus={() => {}}>
      <ol>
        {Array.from({ length: 10 }, (_, i) => (
          <li key={i}>{i + 1}</li>
        ))}
      </ol>
    </MapPopover>,
    { container: strip.appendChild(document.createElement("div")) },
  );
  const body = screen.getByRole("region", { name: "Route" }).querySelector<HTMLElement>(".map-popover-body")!;
  expect([body.style.maxHeight, body.hasAttribute("data-clipped")]).toEqual(["90px", true]);

  room = 500;
  act(() => observed.get(resized(strip))?.forEach((fit) => fit()));
  expect([body.style.maxHeight, body.hasAttribute("data-clipped")]).toEqual(["", false]);
});
