// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, startTransition, StrictMode, Suspense, use, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkButton } from "../ui/ItemButton.tsx";
import { cascade } from "../ui/testing.ts";
import { MapCanvas, type Fit, type Frame, type Spawn } from "./MapCanvas.tsx";
import type { ViewPoint } from "./points.ts";
import { MapView, type ViewRequest } from "./view.ts";

describe("MapCanvas", () => {
  let size = { width: 400, height: 400 };
  let resized: () => void;
  let mapView: MapView;

  beforeEach(() => {
    size = { width: 400, height: 400 };
    mapView = new MapView();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect(this.classList.contains("map-viewport") ? size : { width: 0, height: 0 });
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const canvas = (view: ViewRequest, aspect = 1) => (
    <MapCanvas
      mapView={mapView}
      aspect={aspect}
      maxZoom={() => 40}
      scene={() => null}
      pins={[]}
      shapes={[]}
      areas={[]}
      spawns={[]}
      label="Map"
      describe={() => ""}
      menu={() => undefined}
      view={view}
    />
  );
  const resize = (width: number, height: number) => {
    size = { width, height };
    act(() => resized());
  };
  const transform = () => {
    const viewport = document.querySelector<HTMLElement>(".map-viewport")!;
    return `${viewport.querySelector<HTMLElement>(".map-stage")!.style.getPropertyValue("--pan")} scale(${viewport.style.getPropertyValue("--zoom")})`;
  };

  const placeStage = () =>
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains("map-stage")) return DOMRect.fromRect(size);
      const [x = 0, y = 0] = this.style
        .getPropertyValue("--pan")
        .match(/-?[\d.]+/g)!
        .map(Number);
      const s = Number(this.closest<HTMLElement>(".map-viewport")!.style.getPropertyValue("--zoom"));
      return DOMRect.fromRect({ x, y, width: 400 * s, height: 400 * s });
    });

  it("restores the kept frame below the interactive minimum zoom", () => {
    const view = { fit: { left: 25, top: 25, width: 50, height: 50 } };
    mapView = new MapView({ request: view, frame: { left: -25, top: -25, width: 150, height: 150 } });
    render(canvas(view));
    const [x, y, zoom] = transform()
      .match(/-?[\d.]+/g)!
      .map(Number);
    expect([Math.round(x! * 100) / 100, Math.round(y! * 100) / 100, Math.round(zoom! * 1e4) / 1e4]).toEqual([66.67, 66.67, 0.6667]);
  });

  it("keeps its view while hidden, and applies a fit from then once it has a size", () => {
    const view = render(canvas({ fit: { x: 50, y: 50, width: 50 } }));
    expect(transform()).toBe("translate(-200px, -200px) scale(2)");

    resize(0, 0);
    resize(400, 400);
    expect(transform()).toBe("translate(-200px, -200px) scale(2)");

    resize(0, 0);
    view.rerender(canvas({ fit: { x: 25, y: 25, width: 25 } }));
    expect(transform()).toBe("translate(-200px, -200px) scale(2)");
    resize(200, 200);
    expect(transform()).toBe("translate(-100px, -100px) scale(4)");
  });

  const area: Fit = { left: 25, top: 25, width: 50, height: 50 };

  it("keeps the view's center and its size on screen at a new size, after a fit and after a zoom", () => {
    render(canvas({ fit: area }));
    expect(transform()).toBe("translate(-200px, -200px) scale(2)");
    resize(400, 200);
    expect(transform()).toBe("translate(-200px, -300px) scale(4)");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(transform()).toBe("translate(-400px, -500px) scale(6)");
    resize(400, 400);
    expect(transform()).toBe("translate(-400px, -400px) scale(3)");
  });

  it("applies a new fit at the viewport's size when it renders, before the observer reports the size", () => {
    const view = render(canvas({ id: "0", fit: area }));
    expect(transform()).toBe("translate(-200px, -200px) scale(2)");
    size = { width: 400, height: 200 };
    view.rerender(canvas({ id: "1", fit: area }));
    expect(transform()).toBe("translate(0px, -100px) scale(2)");
    act(() => resized());
    expect(transform()).toBe("translate(0px, -100px) scale(2)");
  });

  it("renders the view that its first commit fits before the browser paints", async () => {
    const painted: string[] = [];
    function Paint() {
      useLayoutEffect(() => queueMicrotask(() => painted.push(transform())), []);
      return null;
    }
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    root.render(
      <>
        {canvas({ fit: area })}
        <Paint />
      </>,
    );
    await vi.waitFor(() => expect(painted).toEqual(["translate(-200px, -200px) scale(2)"]));
    root.unmount();
  });

  it("fits its first view clear of a panel that renders after it, as the map's panel row does", () => {
    const panel = createRef<HTMLDivElement>();
    const fit: Fit = { ...area, inset: () => ({ top: 0, right: 0, bottom: panel.current ? 100 : 0, left: 0 }) };
    render(
      <>
        {canvas({ fit })}
        <div ref={panel} />
      </>,
    );
    expect(transform()).toBe("translate(-100px, -150px) scale(1.5)");
  });

  it("holds a paused follow request across another request and a kept frame", () => {
    const follow = (x: number, again: number, on: boolean): ViewRequest => ({
      id: `follow ${again}`,
      fit: { x, y: 50, width: 50 },
      hold: !on,
    });
    const view = render(canvas(follow(50, 0, true)));
    view.rerender(canvas(follow(25, 1, true)));
    expect(transform()).toBe("translate(0px, -200px) scale(2)");
    view.rerender(canvas(follow(75, 2, false)));
    expect(transform()).toBe("translate(0px, -200px) scale(2)");
    view.rerender(canvas({ id: "reveal 1", fit: { x: 50, y: 50, width: 50 } }));
    expect(transform()).toBe("translate(-200px, -200px) scale(2)");
    view.rerender(canvas(follow(75, 2, false)));
    expect(transform()).toBe("translate(-200px, -200px) scale(2)");
    view.unmount();
    mapView = new MapView({ request: follow(75, 2, false), frame: { left: 25, top: 25, width: 50, height: 50 } });
    const restored = render(canvas(follow(75, 2, false)));
    expect(transform()).toBe("translate(-200px, -200px) scale(2)");
    restored.rerender(canvas(follow(75, 3, false)));
    expect(transform()).toBe("translate(-200px, -200px) scale(2)");
    restored.rerender(canvas(follow(75, 4, true)));
    expect(transform()).toBe("translate(-400px, -200px) scale(2)");
  });

  it("keeps a zoomed view for an equal fit in a new object, and shows the fit again for a new id", () => {
    const view = render(canvas({ id: "0", fit: area }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(transform()).toBe("translate(-400px, -400px) scale(3)");
    view.rerender(canvas({ id: "0", fit: { ...area } }));
    expect(transform()).toBe("translate(-400px, -400px) scale(3)");
    view.rerender(canvas({ id: "1", fit: area }));
    expect(transform()).toBe("translate(-200px, -200px) scale(2)");
  });

  it("keeps the view across a remount for the same request, and starts another request on a stage of another aspect at zoom 1", () => {
    const rounded = () =>
      transform()
        .match(/-?[\d.]+/g)!
        .map((n) => Math.round(Number(n) * 1e4) / 1e4);
    render(canvas({ fit: area }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(rounded()).toEqual([-400, -400, 3]);
    cleanup();
    render(canvas({ fit: { ...area } }));
    expect(rounded()).toEqual([-400, -400, 3]);
    cleanup();
    render(canvas({ fit: { x: 50, y: 50 } }, 2));
    expect(transform()).toBe("translate(0px, 0px) scale(1)");
  });

  it("keeps the whole map's size and center on screen after Reset zoom as the viewport shrinks", () => {
    render(canvas({ fit: area }));
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    resize(400, 200);
    expect(transform()).toBe("translate(0px, -100px) scale(2)");
  });

  it("reports the point under a still pointer after a pan, and none outside the viewport", () => {
    placeStage();
    const pointer = vi.fn();
    mapView.watchPointer(pointer);
    render(canvas({ fit: { x: 50, y: 50, width: 50 } }));
    const viewport = screen.getByRole("group", { name: "Map" });
    fireEvent.pointerMove(viewport, { clientX: 200, clientY: 200 });
    expect(pointer).toHaveBeenLastCalledWith({ x: 50, y: 50 });

    fireEvent.pointerDown(viewport, { clientX: 200, clientY: 200 });
    fireEvent.pointerMove(viewport, { clientX: 300, clientY: 200 });
    expect(transform()).toBe("translate(-100px, -200px) scale(2)");
    expect(pointer).toHaveBeenLastCalledWith({ x: 50, y: 50 });

    fireEvent.pointerMove(viewport, { clientX: 450, clientY: 200 });
    expect(pointer).toHaveBeenLastCalledWith(null);
  });

  it("reports the point under a still pointer after a new fit moves the stage", () => {
    placeStage();
    const pointer = vi.fn();
    mapView.watchPointer(pointer);
    const view = render(canvas({ fit: { x: 50, y: 50, width: 50 } }));
    fireEvent.pointerMove(screen.getByRole("group", { name: "Map" }), { clientX: 200, clientY: 200 });
    expect(pointer).toHaveBeenLastCalledWith({ x: 50, y: 50 });

    view.rerender(canvas({ fit: { x: 25, y: 25, width: 50 } }));
    expect(transform()).toBe("translate(0px, 0px) scale(2)");
    expect(pointer).toHaveBeenLastCalledWith({ x: 25, y: 25 });
  });

  it("keeps the grabbed point under the pointer when the wheel zooms during a pan", () => {
    placeStage();
    const pointer = vi.fn();
    mapView.watchPointer(pointer);
    render(canvas({ fit: { x: 50, y: 50, width: 50 } }));
    const viewport = screen.getByRole("group", { name: "Map" });
    fireEvent.pointerDown(viewport, { clientX: 200, clientY: 200 });
    fireEvent.pointerMove(viewport, { clientX: 300, clientY: 200 });
    expect(pointer).toHaveBeenLastCalledWith({ x: 50, y: 50 });

    fireEvent.wheel(viewport, { deltaY: -100, clientX: 300, clientY: 200 });
    expect(transform()).toBe("translate(-200px, -300px) scale(2.5)");
    expect(pointer).toHaveBeenLastCalledWith({ x: 50, y: 50 });

    fireEvent.pointerMove(viewport, { clientX: 320, clientY: 200 });
    expect(transform()).toBe("translate(-180px, -300px) scale(2.5)");
    expect(pointer).toHaveBeenLastCalledWith({ x: 50, y: 50 });
  });

  it.each(["pointerUp", "pointerCancel", "lostPointerCapture"] as const)(
    "promotes only accepted pans, ends on %s, and accepts the next click once",
    (end) => {
      placeStage();
      const onClick = vi.fn();
      render(<MapCanvas {...canvas({ fit: area }).props} onClick={onClick} />);
      const viewport = screen.getByRole("group", { name: "Map" });

      fireEvent.pointerDown(viewport, { clientX: 200, clientY: 200 });
      expect(viewport.classList.contains("panning")).toBe(false);
      fireEvent.pointerMove(viewport, { clientX: 203, clientY: 200 });
      expect(viewport.classList.contains("panning")).toBe(false);
      expect(transform()).toBe("translate(-200px, -200px) scale(2)");
      fireEvent.pointerMove(viewport, { clientX: 204, clientY: 200 });
      expect(viewport.classList.contains("panning")).toBe(true);
      expect(transform()).toBe("translate(-196px, -200px) scale(2)");
      fireEvent.pointerMove(viewport, { clientX: 300, clientY: 200 });
      expect(transform()).toBe("translate(-100px, -200px) scale(2)");
      expect(viewport.classList.contains("panning")).toBe(true);
      fireEvent[end](viewport, { clientX: 300, clientY: 200 });
      expect(viewport.classList.contains("panning")).toBe(false);
      fireEvent.pointerMove(viewport, { clientX: 320, clientY: 200 });
      fireEvent.pointerUp(viewport, { clientX: 320, clientY: 200 });
      expect(transform()).toBe("translate(-100px, -200px) scale(2)");
      expect(onClick.mock.calls).toEqual([]);

      fireEvent.pointerDown(viewport, { clientX: 300, clientY: 200 });
      expect(viewport.classList.contains("panning")).toBe(false);
      fireEvent.pointerUp(viewport, { clientX: 300, clientY: 200 });
      expect(viewport.classList.contains("panning")).toBe(false);
      fireEvent.lostPointerCapture(viewport);
      expect(onClick.mock.calls).toEqual([[{ x: 50, y: 50 }, 8]]);
    },
  );

  it("ends an accepted pan when another touch starts below the pan threshold", () => {
    placeStage();
    render(canvas({ fit: area }));
    const viewport = screen.getByRole("group", { name: "Map" });

    fireEvent.pointerDown(viewport, { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 200 });
    fireEvent.pointerMove(viewport, { pointerId: 1, pointerType: "touch", clientX: 300, clientY: 200 });
    expect(viewport.classList.contains("panning")).toBe(true);
    expect(transform()).toBe("translate(-100px, -200px) scale(2)");

    fireEvent.pointerDown(viewport, { pointerId: 2, pointerType: "touch", clientX: 200, clientY: 200 });
    expect(viewport.classList.contains("panning")).toBe(false);
    fireEvent.pointerMove(viewport, { pointerId: 2, pointerType: "touch", clientX: 203, clientY: 200 });
    expect(viewport.classList.contains("panning")).toBe(false);
    expect(transform()).toBe("translate(-100px, -200px) scale(2)");
    fireEvent.pointerMove(viewport, { pointerId: 2, pointerType: "touch", clientX: 204, clientY: 200 });
    expect(viewport.classList.contains("panning")).toBe(true);
    expect(transform()).toBe("translate(-96px, -200px) scale(2)");
    fireEvent.pointerUp(viewport, { pointerId: 2, pointerType: "touch", clientX: 204, clientY: 200 });
    expect(viewport.classList.contains("panning")).toBe(false);
  });

  it("grabs the point under the pointer again when the wheel zooms during a pan held past a pan limit", () => {
    placeStage();
    render(canvas({ fit: { x: 0, y: 50, width: 50 } }));
    const viewport = screen.getByRole("group", { name: "Map" });
    expect(transform()).toBe("translate(200px, -200px) scale(2)");
    fireEvent.pointerDown(viewport, { clientX: 300, clientY: 200 });
    fireEvent.pointerMove(viewport, { clientX: 350, clientY: 200 });
    expect(transform()).toBe("translate(200px, -200px) scale(2)");

    fireEvent.wheel(viewport, { deltaY: -100, clientX: 350, clientY: 200 });
    expect(transform()).toBe("translate(162.5px, -300px) scale(2.5)");

    fireEvent.pointerMove(viewport, { clientX: 351, clientY: 200 });
    expect(transform()).toBe("translate(163.5px, -300px) scale(2.5)");
  });

  it("keeps a shared spawn whose dot reaches into view, on both axes", () => {
    size = { width: 600, height: 400 };
    const shared = (key: string, x: number, y: number): Spawn => ({ key, at: { x, y }, colors: ["red", "blue"] });
    render(
      <MapCanvas
        mapView={mapView}
        aspect={1.5}
        maxZoom={() => 40}
        scene={() => null}
        pins={[]}
        shapes={[]}
        areas={[]}
        spawns={[
          shared("left", 25 - 3 / 12, 50),
          shared("above", 50, 25 - 3 / 8),
          shared("far left", 25 - 5 / 12, 50),
          shared("far above", 50, 25 - 5 / 8),
        ]}
        label="Map"
        describe={() => ""}
        menu={() => undefined}
        view={{ fit: { x: 50, y: 50, width: 50 } }}
      />,
    );
    expect(transform()).toBe("translate(-300px, -200px) scale(2)");
    const shown = [...document.querySelectorAll<HTMLElement>(".spawn")].map((d) => [
      d.style.getPropertyValue("--at-x"),
      d.style.getPropertyValue("--at-y"),
    ]);
    expect(shown).toEqual([
      [`${25 - 3 / 12}%`, "50%"],
      ["50%", `${25 - 3 / 8}%`],
    ]);
  });

  it("leaves every button in the marks' layer out of the press look, and presses the map's own controls", () => {
    render(
      <MapCanvas
        mapView={mapView}
        aspect={1}
        maxZoom={() => 40}
        scene={() => null}
        overlay={() => <MarkButton label="Quest" at={{ x: 20, y: 20 }} className="quest-marker" />}
        pins={[{ key: "pin", at: { x: 50, y: 50 }, kind: "goto", label: "Go to" }]}
        shapes={[]}
        areas={[]}
        spawns={[]}
        label="Map"
        describe={() => ""}
        menu={() => undefined}
        view={{ fit: area }}
      />,
    );
    const pressed = (name: string) => cascade(screen.getByRole("button", { name }), "background", { states: ["active"] })?.value;
    expect(["Go to", "Quest", "Zoom in"].map(pressed)).toEqual(["var(--pin)", "none", "var(--press)"]);
  });

  it("renders a resize inside the observer callback", () => {
    const scene = vi.fn<(frame: Frame, pxPerPercent: number) => null>(() => null);
    render(<MapCanvas {...canvas({ fit: area }).props} scene={scene} />);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
    size = { width: 400, height: 200 };
    resized();
    expect(transform()).toBe("translate(-200px, -300px) scale(4)");
    expect(scene).toHaveBeenLastCalledWith({ left: 25, top: 37.5, width: 50, height: 25 }, 8);
  });

  it("keeps the same snapshot for a wheel at the zoom limit, and gives a new one when the wheel moves the view", () => {
    placeStage();
    render(<MapCanvas {...canvas({ fit: area }).props} maxZoom={() => 2} />);
    expect(transform()).toBe("translate(-200px, -200px) scale(2)");
    const viewport = screen.getByRole("group", { name: "Map" });
    const before = mapView.getSnapshot();
    fireEvent.wheel(viewport, { deltaY: -100, clientX: 300, clientY: 100 });
    expect(mapView.getSnapshot()).toBe(before);
    fireEvent.wheel(viewport, { deltaY: 100, clientX: 300, clientY: 100 });
    expect(mapView.getSnapshot()).not.toBe(before);
    expect(transform()).toBe("translate(-100px, -140px) scale(1.6)");
  });

  it("prevents the page scroll for a wheel over the map, closes the open menu, and lets a long menu scroll", () => {
    placeStage();
    render(<MapCanvas {...canvas({ fit: area }).props} menu={() => ({ title: "Point here", items: [{ label: "Add", run: () => {} }] })} />);
    const viewport = screen.getByRole("group", { name: "Map" });
    fireEvent.contextMenu(viewport, { clientX: 200, clientY: 200 });
    const menu = screen.getByRole("menu", { name: "Point here" });

    expect(fireEvent.wheel(menu, { deltaY: -100, clientX: 200, clientY: 200 })).toBe(true);
    expect(screen.getByRole("menu")).toBe(menu);
    expect(transform()).toBe("translate(-200px, -200px) scale(2)");

    expect(fireEvent.wheel(viewport, { deltaY: -100, clientX: 200, clientY: 200 })).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(transform()).toBe("translate(-300px, -300px) scale(2.5)");
  });

  it("opens a pin's own menu on a right-click on the pin, and never the point's menu", () => {
    placeStage();
    render(
      <MapCanvas
        {...canvas({ fit: area }).props}
        pins={[
          {
            key: "a",
            at: { x: 40, y: 50 },
            kind: "goto",
            label: "Pin with a menu",
            menu: { title: "Pin here", items: [{ label: "Remove", run: () => {} }] },
          },
          { key: "b", at: { x: 60, y: 50 }, kind: "goto", label: "Pin with no menu" },
        ]}
        menu={() => ({ title: "Point here", items: [{ label: "Add", run: () => {} }] })}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Pin with no menu" }), { clientX: 200, clientY: 200 });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Pin with a menu" }), { clientX: 200, clientY: 200 });
    expect(screen.getByRole("menu").getAttribute("aria-labelledby")).toBe(screen.getByText("Pin here").id);
  });

  it("moves a pin by the arrow keys the same distance on screen at each zoom", () => {
    placeStage();
    const drag = vi.fn<(to: ViewPoint | null) => void>();
    render(
      <MapCanvas
        {...canvas({ fit: area }).props}
        pins={[{ key: "a", at: { x: 50, y: 50 }, kind: "goto", label: "Point", move: () => {}, drag }]}
      />,
    );
    const pin = screen.getByRole("button", { name: "Point" });
    pin.focus();
    fireEvent.keyDown(pin, { key: "ArrowRight" });
    expect(drag).toHaveBeenLastCalledWith({ x: 50.1, y: 50 });
    fireEvent.wheel(screen.getByRole("group", { name: "Map" }), { deltaY: -100, clientX: 200, clientY: 200 });
    expect(transform()).toBe("translate(-300px, -300px) scale(2.5)");
    fireEvent.keyDown(pin, { key: "ArrowRight" });
    expect(drag.mock.lastCall?.[0]?.x).toBeCloseTo(50.18, 10);
  });

  it("cancels a pointer drag on Escape, and neither moves nor opens the pin when the pointer moves on and lifts", () => {
    placeStage();
    const [move, drag, activate] = [vi.fn(), vi.fn(), vi.fn()];
    render(
      <MapCanvas
        {...canvas({ fit: area }).props}
        pins={[{ key: "a", at: { x: 50, y: 50 }, kind: "goto", label: "Point", move, drag, activate }]}
      />,
    );
    const pin = screen.getByRole("button", { name: "Point" });
    fireEvent.pointerDown(pin, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(pin, { clientX: 300, clientY: 200 });
    fireEvent.keyDown(pin, { key: "Escape" });
    fireEvent.pointerMove(pin, { clientX: 320, clientY: 200 });
    fireEvent.pointerUp(pin, { clientX: 320, clientY: 200 });
    fireEvent.click(pin, { detail: 1 });
    expect([drag.mock.calls, move.mock.calls, activate.mock.calls]).toEqual([[[{ x: 62.5, y: 50 }], [null]], [], []]);
    expect(pin.classList.contains("moving")).toBe(false);
  });

  it("places a pointer drag once on Enter, though the pin stops being movable before the pointer lifts", () => {
    placeStage();
    const [move, activate] = [vi.fn(), vi.fn()];
    function Loading() {
      const [movable, setMovable] = useState(true);
      const at = { x: 50, y: 50 };
      const pin = movable
        ? { key: "a", at, kind: "goto" as const, label: "Point", activate, move: (to: ViewPoint) => (move(to), setMovable(false)) }
        : { key: "a", at, kind: "goto" as const, label: "Point", activate };
      return <MapCanvas {...canvas({ fit: area }).props} pins={[pin]} />;
    }
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => (e.preventDefault(), errors.push(e.error));
    window.addEventListener("error", onError);
    render(<Loading />);
    const pin = screen.getByRole("button", { name: "Point" });
    fireEvent.pointerDown(pin, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(pin, { clientX: 300, clientY: 200 });
    fireEvent.keyDown(pin, { key: "Enter" });
    fireEvent.pointerMove(pin, { clientX: 320, clientY: 200 });
    fireEvent.pointerUp(pin, { clientX: 320, clientY: 200 });
    fireEvent.click(pin, { detail: 1 });
    fireEvent.blur(pin);
    window.removeEventListener("error", onError);
    expect([errors, move.mock.calls, activate.mock.calls]).toEqual([[], [[{ x: 62.5, y: 50 }]], []]);
  });

  it.each([false, true])(
    "places a keyboard move when the pointer presses another pin, then drags that pin unless the placement takes its move away (%s)",
    (loads) => {
      placeStage();
      const [moveA, moveB] = [vi.fn(), vi.fn()];
      function Pins() {
        const [movable, setMovable] = useState(true);
        const pin = (key: string, x: number, move: (to: ViewPoint) => void) => ({
          key,
          at: { x, y: 50 },
          kind: "goto" as const,
          label: key,
          ...(movable && { move: (to: ViewPoint) => (move(to), loads && setMovable(false)) }),
        });
        return <MapCanvas {...canvas({ fit: area }).props} pins={[pin("A", 40, moveA), pin("B", 50, moveB)]} />;
      }
      const errors: unknown[] = [];
      const onError = (e: ErrorEvent) => (e.preventDefault(), errors.push(e.error));
      window.addEventListener("error", onError);
      render(<Pins />);
      const [a, b] = [screen.getByRole("button", { name: "A" }), screen.getByRole("button", { name: "B" })];
      a.focus();
      fireEvent.keyDown(a, { key: "ArrowRight" });
      fireEvent.pointerDown(b, { button: 0, clientX: 200, clientY: 200 });
      fireEvent.blur(a);
      fireEvent.pointerMove(b, { clientX: 300, clientY: 200 });
      const dragsB = b.classList.contains("moving");
      fireEvent.pointerUp(b, { clientX: 300, clientY: 200 });
      window.removeEventListener("error", onError);
      expect([errors, moveA.mock.calls, dragsB, moveB.mock.calls]).toEqual([
        [],
        [[{ x: 40.1, y: 50 }]],
        !loads,
        loads ? [] : [[{ x: 62.5, y: 50 }]],
      ]);
    },
  );

  it("cancels a drag when a second pointer presses another pin, and drags that pin after the first pointer lifts", () => {
    placeStage();
    const [dragA, moveA, moveB] = [vi.fn(), vi.fn(), vi.fn()];
    render(
      <MapCanvas
        {...canvas({ fit: area }).props}
        pins={[
          { key: "A", at: { x: 40, y: 50 }, kind: "goto", label: "A", move: moveA, drag: dragA },
          { key: "B", at: { x: 50, y: 50 }, kind: "goto", label: "B", move: moveB },
        ]}
      />,
    );
    const [a, b] = [screen.getByRole("button", { name: "A" }), screen.getByRole("button", { name: "B" })];
    fireEvent.pointerDown(a, { button: 0, pointerId: 1, clientX: 120, clientY: 200 });
    fireEvent.pointerMove(a, { pointerId: 1, clientX: 220, clientY: 200 });
    fireEvent.pointerDown(b, { button: 0, pointerId: 2, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(a, { pointerId: 1, clientX: 220, clientY: 200 });
    fireEvent.pointerCancel(a, { pointerId: 1 });
    fireEvent.pointerMove(b, { pointerId: 2, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(b, { pointerId: 2, clientX: 300, clientY: 200 });
    expect([dragA.mock.calls, moveA.mock.calls, moveB.mock.calls]).toEqual([[[{ x: 52.5, y: 50 }], [null]], [], [[{ x: 62.5, y: 50 }]]]);
  });

  it("skips only the pointer click that ends a drag, through a keyboard move, and opens the pin on a later keyboard click or tap", () => {
    placeStage();
    const [move, activate] = [vi.fn(), vi.fn()];
    render(
      <MapCanvas
        {...canvas({ fit: area }).props}
        pins={[{ key: "a", at: { x: 50, y: 50 }, kind: "goto", label: "Point", move, activate }]}
      />,
    );
    const pin = screen.getByRole("button", { name: "Point" });
    fireEvent.pointerDown(pin, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(pin, { clientX: 300, clientY: 200 });
    fireEvent.keyDown(pin, { key: "Escape" });
    fireEvent.keyDown(pin, { key: "ArrowRight" });
    fireEvent.pointerUp(pin, { clientX: 300, clientY: 200 });
    fireEvent.click(pin, { detail: 1 });
    fireEvent.keyDown(pin, { key: "Enter" });
    expect([move.mock.calls, activate.mock.calls]).toEqual([[[{ x: 50.1, y: 50 }]], []]);

    // A touch drag ends with no click, so the next click comes from the keyboard.
    fireEvent.pointerDown(pin, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(pin, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(pin, { clientX: 300, clientY: 200 });
    fireEvent.click(pin, { detail: 0 });
    fireEvent.pointerDown(pin, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(pin, { clientX: 200, clientY: 200 });
    fireEvent.click(pin, { detail: 1 });
    expect(activate.mock.calls).toEqual([[], []]);
  });

  it("runs the input callbacks of the last commit while a transition that changes them is suspended", async () => {
    placeStage();
    const first = { onClick: vi.fn(), onUserMove: vi.fn() };
    const next = { onClick: vi.fn(), onUserMove: vi.fn() };
    let release = () => {};
    const data = new Promise<void>((resolve) => (release = resolve));
    let change = () => {};
    function Waits({ on }: { on: boolean }) {
      if (on) use(data);
      return on ? <span>Changed</span> : null;
    }
    function Host() {
      const [changed, setChanged] = useState(false);
      change = () => startTransition(() => setChanged(true));
      return (
        <>
          <MapCanvas {...canvas({ fit: area }).props} {...(changed ? next : first)} />
          <Suspense fallback={null}>
            <Waits on={changed} />
          </Suspense>
        </>
      );
    }
    render(<Host />);
    const viewport = screen.getByRole("group", { name: "Map" });
    const clickAndWheel = () =>
      act(async () => {
        fireEvent.pointerDown(viewport, { clientX: 200, clientY: 200 });
        fireEvent.pointerUp(viewport, { clientX: 200, clientY: 200 });
        fireEvent.wheel(viewport, { deltaY: 100, clientX: 200, clientY: 200 });
      });
    const calls = (callbacks: typeof first) => [callbacks.onClick.mock.calls.length, callbacks.onUserMove.mock.calls];

    await act(async () => change());
    await clickAndWheel();
    expect([calls(first), calls(next)]).toEqual([
      [1, [["zoom"]]],
      [0, []],
    ]);

    await act(async () => {
      release();
      await data;
    });
    expect(screen.getByText("Changed")).toBeTruthy();
    await clickAndWheel();
    expect([calls(first), calls(next)]).toEqual([
      [1, [["zoom"]]],
      [1, [["zoom"]]],
    ]);
  });

  it("shows a kept frame under StrictMode, which attaches the viewport twice", () => {
    const view = { fit: area };
    mapView = new MapView({ request: view, frame: { left: -25, top: -25, width: 150, height: 150 } });
    render(<StrictMode>{canvas(view)}</StrictMode>);
    const [x, y, zoom] = transform()
      .match(/-?[\d.]+/g)!
      .map(Number);
    expect([Math.round(x! * 100) / 100, Math.round(y! * 100) / 100, Math.round(zoom! * 1e4) / 1e4]).toEqual([66.67, 66.67, 0.6667]);
  });

  it("zooms once for each wheel under StrictMode", () => {
    placeStage();
    render(<StrictMode>{canvas({ fit: area })}</StrictMode>);
    fireEvent.wheel(screen.getByRole("group", { name: "Map" }), { deltaY: -100, clientX: 200, clientY: 200 });
    expect(transform()).toBe("translate(-300px, -300px) scale(2.5)");
  });

  it("releases a captured pan pointer and ends the pan when the map unmounts", () => {
    placeStage();
    const { unmount } = render(canvas({ fit: area }));
    const viewport = screen.getByRole("group", { name: "Map" });
    const captured = new Set<number>();
    viewport.setPointerCapture = (id) => void captured.add(id);
    viewport.hasPointerCapture = (id) => captured.has(id);
    viewport.releasePointerCapture = (id) => void captured.delete(id);
    fireEvent.pointerDown(viewport, { pointerId: 7, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(viewport, { pointerId: 7, clientX: 300, clientY: 200 });
    expect([[...captured], viewport.className]).toEqual([[7], "map-viewport panning"]);
    unmount();
    expect([[...captured], viewport.className]).toEqual([[], "map-viewport"]);
  });
});
