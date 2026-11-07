import { createContext, useContext, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { ViewPoint } from "./points.ts";
import {
  clamp,
  frameOf,
  frameZoom,
  panLimit,
  resizeZoom,
  zoomTo,
  type Box,
  type Fit,
  type Frame,
  type Inset,
  type Zoom,
} from "./viewport.ts";

export interface ViewRequest {
  fit?: Fit | undefined;
  id?: string;
  hold?: boolean;
  zoomKeepsPoint?: boolean;
}

type ViewMove = { frame: Frame } | { fit: Fit | undefined };

function sameFit(a: Fit | undefined, b: Fit | undefined): boolean {
  if (!a || !b) return a === b;
  if ("left" in a) return "left" in b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
  return !("left" in b) && a.x === b.x && a.y === b.y && a.width === b.width;
}

function same(a: ViewRequest, b: ViewRequest): boolean {
  if (a.fit && b.fit && (a.id !== undefined || b.id !== undefined)) return a.id === b.id;
  return sameFit(a.fit, b.fit);
}

export class CanvasView {
  #start: Frame | undefined;
  #last: ViewRequest | undefined;

  constructor(start?: Frame) {
    this.#start = start;
  }

  move(request: ViewRequest): ViewMove | null {
    const [start, last] = [this.#start, this.#last];
    this.#start = undefined;
    this.#last = request;
    if (start) return { frame: start };
    if (last && (request.hold || same(last, request))) return null;
    return { fit: request.fit };
  }
}

export interface KeptFrame {
  readonly request: ViewRequest;
  readonly frame: Frame;
}

export type UserMove = "pan" | "zoom" | "reset";

interface Shown {
  readonly frame: Frame;
  readonly pxPerPercent: number;
}

export interface ViewSnapshot {
  readonly zoom: Zoom;
  readonly box: Box | null;
  readonly frame: Frame;
  readonly pxPerPercent: number;
  readonly maxZoom: number;
  readonly shown: Shown | null;
  readonly viewport: HTMLDivElement | null;
}

export interface MapViewSource {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ViewSnapshot;
}

export const MapViewContext = createContext<MapView | null>(null);

export function useMapView(): MapView {
  const mapView = useContext(MapViewContext);
  if (!mapView) throw new Error("useMapView needs a MapCanvas");
  return mapView;
}

export const useFrame = (mapView: MapViewSource): Frame | null =>
  useSyncExternalStore(mapView.subscribe, () => mapView.getSnapshot().shown?.frame ?? null);

export interface CanvasProps {
  readonly aspect: number;
  readonly maxZoom: (w: number) => number;
  readonly request: ViewRequest;
  readonly cover: (() => Inset) | undefined;
  readonly onClick: ((at: ViewPoint, pxPerPercent: number) => void) | undefined;
  readonly onUserMove: ((move: UserMove) => void) | undefined;
  readonly closeMenu: () => void;
  readonly openPointMenu: (opened: { x: number; y: number; at: ViewPoint }) => void;
}

interface ClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

interface Attachment {
  readonly viewport: HTMLDivElement;
  readonly stage: HTMLDivElement;
}

const FULL: Frame = { left: 0, top: 0, width: 100, height: 100 };
const DETACHED: ViewSnapshot = {
  zoom: { s: 1, tx: 0, ty: 0 },
  box: null,
  frame: FULL,
  pxPerPercent: 1,
  maxZoom: 1,
  shown: null,
  viewport: null,
};

function sizeOf(viewport: HTMLElement, aspect: number): Box | null {
  const r = viewport.getBoundingClientRect();
  const w = Math.min(r.width, r.height * aspect);
  return w > 0 ? { vw: r.width, vh: r.height, w, h: w / aspect } : null;
}
const sameOr = (box: Box | null, next: Box | null) =>
  box && next && box.vw === next.vw && box.vh === next.vh && box.w === next.w ? box : next;

const onStage = (at: ViewPoint) => at.x >= 0 && at.x <= 100 && at.y >= 0 && at.y <= 100;

export class MapView implements MapViewSource {
  #snapshot = DETACHED;
  readonly #listeners = new Set<() => void>();
  readonly #pointerListeners = new Set<(at: ViewPoint | null) => void>();
  #kept: KeptFrame | undefined;
  #attachment: Attachment | null = null;
  #props: CanvasProps | null = null;
  #requests: CanvasView | null = null;
  #measured: Box | null = null;
  #pan: { x: number; y: number; pointerId: number; grabbed: ViewPoint; moved: boolean } | null = null;
  #pointer: ClientPoint | null = null;
  #reported: ViewSnapshot | null = null;
  #centered: { at: ViewPoint; zoom: Zoom } | null = null;

  constructor(kept?: KeptFrame) {
    this.#kept = kept;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): ViewSnapshot => this.#snapshot;

  readonly watchPointer = (listener: (at: ViewPoint | null) => void): (() => void) => {
    this.#pointerListeners.add(listener);
    return () => this.#pointerListeners.delete(listener);
  };

  kept(): KeptFrame | undefined {
    return this.#kept;
  }

  readonly attach = (viewport: HTMLDivElement): (() => void) => {
    this.#attachment = { viewport, stage: viewport.querySelector<HTMLDivElement>(":scope > .map-stage")! };
    this.#requests = null;
    this.#measured = null;
    const listening = new AbortController();
    const { signal } = listening;
    viewport.addEventListener("pointerdown", (e) => this.#pointerDown(e), { signal });
    viewport.addEventListener("pointermove", (e) => this.#pointerMove(e), { signal });
    viewport.addEventListener("pointerup", (e) => this.#pointerUp(e), { signal });
    viewport.addEventListener("pointercancel", () => this.#endPan(), { signal });
    viewport.addEventListener(
      "lostpointercapture",
      (e) => {
        if (e.target === viewport) this.#endPan();
      },
      { signal },
    );
    viewport.addEventListener("pointerleave", () => this.#pointerLeave(), { signal });
    viewport.addEventListener("wheel", (e) => this.#wheel(e), { signal, passive: false });
    // On the document, so it runs after React's root listener and a pin's or marker's stopPropagation stops it.
    viewport.ownerDocument.addEventListener("contextmenu", (e) => this.#contextMenu(e), { signal });
    // Observers run between layout and paint; committing there keeps the
    // browser from painting the resized stage under the old offsets.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => flushSync(() => this.#measure()));
    observer?.observe(viewport);
    this.#publish({ ...this.#snapshot, viewport });
    return () => {
      listening.abort();
      observer?.disconnect();
      this.#detach();
    };
  };

  committed(rendered: ViewSnapshot, props: CanvasProps): void {
    const aspect = this.#props?.aspect;
    this.#props = props;
    if (!this.#requests) {
      const kept = this.#kept;
      this.#requests = new CanvasView(kept && same(kept.request, props.request) ? kept.frame : undefined);
      return this.#set(this.#snapshot.zoom, sizeOf(this.#attachment!.viewport, props.aspect));
    }
    if (aspect !== props.aspect) this.#measure();
    else this.#settle(this.#snapshot.box);
    const now = this.#snapshot;
    if (now.box) this.#kept = { request: props.request, frame: now.frame };
    if (rendered === now && (now.zoom !== this.#reported?.zoom || now.box !== this.#reported?.box)) {
      this.#reported = now;
      this.#report();
    }
  }

  toStage(at: ClientPoint): ViewPoint {
    const r = this.#attachment!.stage.getBoundingClientRect();
    return { x: ((at.clientX - r.left) / r.width) * 100, y: ((at.clientY - r.top) / r.height) * 100 };
  }

  zoomBy(factor: number, at?: { x: number; y: number }): void {
    const { viewport, stage } = this.#attachment!;
    const props = this.#props!;
    const v = viewport.getBoundingClientRect();
    const [left, top] = [v.left + stage.offsetLeft, v.top + stage.offsetTop];
    const w = Math.min(v.width, v.height * props.aspect);
    const h = w / props.aspect;
    const cx = (at?.x ?? v.left + v.width / 2) - left;
    const cy = (at?.y ?? v.top + v.height / 2) - top;
    const cover = props.cover?.();
    const lock = this.#lock();
    props.onUserMove?.("zoom");
    const { zoom: z, box, maxZoom } = this.#snapshot;
    const s = clamp(z.s * factor, 1, maxZoom);
    const k = s / z.s;
    const [x, y] = lock ? [z.tx + (lock.x / 100) * w * z.s, z.ty + (lock.y / 100) * h * z.s] : [cx, cy];
    this.#set(panLimit({ s, tx: x - (x - z.tx) * k, ty: y - (y - z.ty) * k }, { vw: v.width, vh: v.height, w, h }, cover), box);
  }

  /** Moves the camera to put `at` in the middle of the uncovered view at the current zoom. Until a request moves the camera, a zoom keeps `at` in place. */
  center(at: ViewPoint): void {
    const { zoom, box, maxZoom } = this.#snapshot;
    const was = this.#centered;
    if (!box || (was?.zoom === zoom && was.at.x === at.x && was.at.y === at.y)) return;
    const cover = this.#props?.cover;
    this.#set(zoomTo({ ...at, ...(cover && { inset: cover }) }, box, maxZoom, zoom.s), box);
    this.#centered = { at, zoom: this.#snapshot.zoom };
  }

  reset(): void {
    this.#props!.onUserMove?.("reset");
    this.#set({ s: 1, tx: 0, ty: 0 }, this.#snapshot.box);
  }

  #lock(): ViewPoint | null {
    const { fit, hold, zoomKeepsPoint } = this.#props!.request;
    return fit && !hold && !("left" in fit) && (zoomKeepsPoint || fit.width === undefined) ? (this.#centered?.at ?? fit) : null;
  }

  #measure(): void {
    const { viewport } = this.#attachment!;
    this.#settle(sameOr(this.#snapshot.box, sizeOf(viewport, this.#props!.aspect)));
  }

  #settle(box: Box | null): void {
    const props = this.#props!;
    const { zoom } = this.#snapshot;
    if (!box) return this.#set(zoom, null);
    const move = this.#requests!.move(props.request);
    if (move) {
      this.#centered = null;
      const now = sameOr(box, sizeOf(this.#attachment!.viewport, props.aspect)) ?? box;
      this.#measured = now;
      const max = Math.max(1, props.maxZoom(now.w));
      if ("frame" in move) return this.#set(frameZoom(move.frame, now, max), now);
      const fit = move.fit && !("left" in move.fit) ? { ...(props.cover && { inset: props.cover }), ...move.fit } : move.fit;
      return this.#set(zoomTo(fit, now, max, zoom.s), now);
    }
    const from = this.#measured;
    this.#measured = box;
    this.#set(from && from !== box ? resizeZoom(zoom, from, box, Math.max(1, props.maxZoom(box.w)), props.cover?.()) : zoom, box);
  }

  #set(zoom: Zoom, box: Box | null): void {
    const was = this.#snapshot;
    const maxZoom = box ? Math.max(1, this.#props!.maxZoom(box.w)) : 1;
    const { s, tx, ty } = was.zoom;
    if (zoom.s === s && zoom.tx === tx && zoom.ty === ty && box === was.box) {
      if (maxZoom !== was.maxZoom) this.#publish({ ...was, maxZoom });
      return;
    }
    if (!box) return this.#publish({ ...was, zoom, box, frame: FULL, pxPerPercent: 1, maxZoom });
    const frame = frameOf(zoom, box);
    const pxPerPercent = (box.w * zoom.s) / 100;
    this.#publish({ ...was, zoom, box, frame, pxPerPercent, maxZoom, shown: { frame, pxPerPercent } });
  }

  #publish(snapshot: ViewSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }

  #detach(): void {
    const { viewport } = this.#attachment!;
    const pan = this.#pan;
    if (pan && viewport.hasPointerCapture?.(pan.pointerId)) viewport.releasePointerCapture(pan.pointerId);
    viewport.classList.remove("panning");
    this.#attachment = null;
    this.#requests = null;
    this.#pan = null;
    this.#pointer = null;
    this.#publish({ ...DETACHED, shown: this.#snapshot.shown });
  }

  #report(): void {
    const e = this.#pointer;
    if (!e || !this.#pointerListeners.size) return;
    const v = this.#attachment!.viewport.getBoundingClientRect();
    const at = this.toStage(e);
    const inside = e.clientX >= v.left && e.clientX <= v.right && e.clientY >= v.top && e.clientY <= v.bottom;
    this.#tellPointer(inside && onStage(at) ? at : null);
  }

  #tellPointer(at: ViewPoint | null): void {
    for (const listener of this.#pointerListeners) listener(at);
  }

  #endPan() {
    const p = this.#pan;
    this.#pan = null;
    this.#attachment!.viewport.classList.remove("panning");
    return p;
  }

  #contextMenu(e: MouseEvent): void {
    const { viewport } = this.#attachment!;
    if (!(e.target instanceof Element) || !viewport.contains(e.target)) return;
    e.preventDefault();
    if (e.target.closest("[role=menu], .map-zoom")) return;
    const at = this.toStage(e);
    if (!onStage(at)) return;
    const v = viewport.getBoundingClientRect();
    this.#props!.openPointMenu({ x: e.clientX - v.left, y: e.clientY - v.top, at });
  }

  #pointerDown(e: PointerEvent): void {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest("button, [role=menu]"))) return;
    this.#endPan();
    this.#pan = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, grabbed: this.toStage(e), moved: false };
    this.#attachment!.viewport.setPointerCapture?.(e.pointerId);
  }

  #pointerMove(e: PointerEvent): void {
    this.#pointer = { clientX: e.clientX, clientY: e.clientY };
    this.#report();
    const p = this.#pan;
    const { zoom, box } = this.#snapshot;
    if (!p || !box) return;
    const [dx, dy] = [e.clientX - p.x, e.clientY - p.y];
    if (!p.moved && Math.hypot(dx, dy) < 4) return;
    const { viewport, stage } = this.#attachment!;
    if (!p.moved) viewport.classList.add("panning");
    p.moved = true;
    const props = this.#props!;
    props.onUserMove?.("pan");
    const cover = props.cover?.();
    const v = viewport.getBoundingClientRect();
    const [cx, cy] = [e.clientX - v.left - stage.offsetLeft, e.clientY - v.top - stage.offsetTop];
    this.#set(
      panLimit({ ...zoom, tx: cx - (p.grabbed.x / 100) * box.w * zoom.s, ty: cy - (p.grabbed.y / 100) * box.h * zoom.s }, box, cover),
      box,
    );
  }

  #pointerUp(e: PointerEvent): void {
    const p = this.#endPan();
    if (p && !p.moved) this.#props!.onClick?.(this.toStage(e), this.#snapshot.pxPerPercent);
  }

  #pointerLeave(): void {
    this.#pointer = null;
    this.#tellPointer(null);
  }

  #wheel(e: WheelEvent): void {
    if (e.target instanceof Element && e.target.closest("[role=menu]")) return;
    e.preventDefault();
    this.#props!.closeMenu();
    if (this.#pan) this.#pan.grabbed = this.toStage(e);
    this.zoomBy(e.deltaY < 0 ? 1.25 : 0.8, { x: e.clientX, y: e.clientY });
  }
}
