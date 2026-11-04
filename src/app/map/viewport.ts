import type { CanvasPoint, WorldMapData } from "../../data/index.ts";
import type { ViewPoint } from "./points.ts";

export interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type Fit = (Frame | { x: number; y: number; width?: number }) & {
  inset?: Inset | ((box: Box, maxZoom: number) => Inset);
};

export interface Zoom {
  s: number;
  tx: number;
  ty: number;
}

export interface Box {
  vw: number;
  vh: number;
  w: number;
  h: number;
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function mapCover(el: Element): number {
  return parseFloat(getComputedStyle(el).getPropertyValue("--panel-cover")) || 0;
}

function stopEdgesAtMiddles(offset: number, viewport: number, size: number, coveredBefore = 0, coveredAfter = 0): number {
  const viewportMiddle = viewport / 2;
  const clearMiddle = clamp((viewport + coveredBefore - coveredAfter) / 2, 0, viewport);
  return clamp(offset, Math.min(viewportMiddle, clearMiddle) - size, Math.max(viewportMiddle, clearMiddle));
}

export function panLimit(zoom: Zoom, box: Box, cover?: Inset): Zoom {
  if (zoom.s === 1) return { s: 1, tx: 0, ty: 0 };
  const { top = 0, right = 0, bottom = 0, left = 0 } = cover ?? {};
  return {
    s: zoom.s,
    tx: stopEdgesAtMiddles(zoom.tx, box.vw, box.w * zoom.s, left, right),
    ty: stopEdgesAtMiddles(zoom.ty, box.vh, box.h * zoom.s, top, bottom),
  };
}

export function frameZoom(frame: Frame, box: Box, maxZoom: number): Zoom {
  const { vw, vh, w, h } = box;
  const s = Math.min(vw / ((w * frame.width) / 100), maxZoom);
  const [cx, cy] = [(frame.left + frame.width / 2) / 100, (frame.top + frame.height / 2) / 100];
  return { s, tx: vw / 2 - cx * w * s, ty: vh / 2 - cy * h * s };
}

export function zoomTo(fit: Fit | undefined, box: Box, maxZoom: number, s = 1): Zoom {
  if (!fit) return { s: 1, tx: 0, ty: 0 };
  const { vw, vh, w, h } = box;
  const inset = typeof fit.inset === "function" ? fit.inset(box, maxZoom) : fit.inset;
  const { top = 0, right = 0, bottom = 0, left = 0 } = inset ?? {};
  const [cw, ch] = [Math.max(1, vw - left - right), Math.max(1, vh - top - bottom)];
  s = clamp(
    "left" in fit
      ? Math.min(cw / ((w * fit.width) / 100), ch / ((h * fit.height) / 100))
      : fit.width === undefined
        ? s
        : cw / ((w * fit.width) / 100),
    1,
    maxZoom,
  );
  const cx = "left" in fit ? fit.left + fit.width / 2 : fit.x;
  const cy = "left" in fit ? fit.top + fit.height / 2 : fit.y;
  return panLimit({ s, tx: left + cw / 2 - (cx / 100) * w * s, ty: top + ch / 2 - (cy / 100) * h * s }, box, inset);
}

export function frameOf(zoom: Zoom, box: Box): Frame {
  const { vw, vh, w, h } = box;
  return {
    left: (-zoom.tx / (w * zoom.s)) * 100,
    top: (-zoom.ty / (h * zoom.s)) * 100,
    width: (vw / (w * zoom.s)) * 100,
    height: (vh / (h * zoom.s)) * 100,
  };
}

export function resizeZoom(zoom: Zoom, from: Box, to: Box, maxZoom: number, cover?: Inset): Zoom {
  const cx = (from.vw / 2 - zoom.tx) / (from.w * zoom.s);
  const cy = (from.vh / 2 - zoom.ty) / (from.h * zoom.s);
  const s = Math.min((from.w * zoom.s) / to.w, maxZoom);
  const kept = { s, tx: to.vw / 2 - cx * to.w * s, ty: to.vh / 2 - cy * to.h * s };
  return s > 1 ? panLimit(kept, to, cover) : kept;
}

export function lineInFrame(line: readonly { x: number; y: number }[], f: Frame): boolean {
  return line.some((a, i) => {
    const b = line[i + 1] ?? a;
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    let [enter, leave] = [0, 1];
    for (const [p, q] of [
      [-dx, a.x - f.left],
      [dx, f.left + f.width - a.x],
      [-dy, a.y - f.top],
      [dy, f.top + f.height - a.y],
    ] as const) {
      if (p === 0) {
        if (q < 0) return false;
      } else if (p < 0) enter = Math.max(enter, q / p);
      else leave = Math.min(leave, q / p);
      if (enter > leave) return false;
    }
    return true;
  });
}

export const TERRAIN_ASPECT_ZOOM = 2 * 1.5 ** 2;

export function canvasSize(map: WorldMapData): { left: number; width: number; height: number } {
  return { left: map.canvas.left, width: map.canvas.width - map.canvas.left, height: map.canvas.height };
}

export function canvasToView(map: WorldMapData, at: CanvasPoint): ViewPoint {
  const { left, width, height } = canvasSize(map);
  return { x: ((at.x - left) / width) * 100, y: (at.y / height) * 100 };
}

export function viewToCanvas(map: WorldMapData, at: ViewPoint): CanvasPoint {
  const { left, width, height } = canvasSize(map);
  return { x: left + (at.x / 100) * width, y: (at.y / 100) * height };
}
