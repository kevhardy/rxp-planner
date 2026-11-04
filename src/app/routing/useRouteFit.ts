import { useCallback, useState, type RefObject } from "react";
import type { WorldLocation } from "../../data/index.ts";
import type { Fit, Frame } from "../map/MapCanvas.tsx";
import type { ViewPoint } from "../map/points.ts";
import type { KeptFrame, ViewRequest } from "../map/view.ts";
import { mapCover, type Box, type Inset } from "../map/viewport.ts";
import { frameAround, insetBeside } from "./lines.ts";

export interface ClosedRoute {
  plan: string | null;
  frame: Frame;
  hadFit: boolean;
}

const ZOOM_BUTTONS_SPACE = 48;
const FIT_INSET = { top: 12, right: ZOOM_BUTTONS_SPACE + 12, bottom: 12, left: 12 };
function coverIn(area: HTMLElement | null): { map: DOMRect; inset: Inset; panel?: Inset } | undefined {
  const viewport = area?.querySelector(".map-viewport");
  if (!viewport) return undefined;
  const map = viewport.getBoundingClientRect();
  const bar = Math.min(
    map.bottom - mapCover(viewport),
    ...[...area!.querySelectorAll(".route-corner, .coord-readout")].map((e) => e.getBoundingClientRect().top),
  );
  const inset = { ...FIT_INSET, bottom: map.bottom - bar + FIT_INSET.bottom };
  const panel = area!.querySelector(".map-popover")?.getBoundingClientRect();
  return {
    map,
    inset,
    ...(panel &&
      panel.top < bar && {
        panel: { top: panel.top - map.top, right: panel.right - map.left, bottom: panel.bottom - map.top, left: panel.left - map.left },
      }),
  };
}

export function useRouteFit(closed: RefObject<ClosedRoute | null> | undefined, mapArea: RefObject<HTMLElement | null>, aspect: number) {
  const [fitTo, setFitTo] = useState<{ stops: readonly WorldLocation[]; view?: Fit; again: number }>({ stops: [], again: 0 });
  const [reopened] = useState(() => {
    const at = closed?.current;
    if (!at) return null;
    const view: ViewRequest = { ...(at.hadFit && { fit: at.frame }), hold: true };
    return { plan: at.plan, view, kept: { request: view, frame: at.frame } };
  });
  const reopenedView = fitTo.again === 0 ? reopened?.view : undefined;
  const cover = (): Inset => {
    const covered = coverIn(mapArea.current);
    if (!covered?.panel) return covered?.inset ?? FIT_INSET;
    const { map, inset, panel } = covered;
    return { ...inset, top: Math.max(inset.top, panel.bottom), right: Math.max(inset.right, map.width - panel.left) };
  };
  const beside =
    (frame: Frame, shown: ViewPoint[]) =>
    (box: Box, maxZoom: number): Inset => {
      const covered = coverIn(mapArea.current);
      if (!covered?.panel) return covered?.inset ?? FIT_INSET;
      return insetBeside(covered.inset, frame, shown, box, maxZoom, [covered.panel]);
    };
  const fitStops = useCallback((stops: readonly WorldLocation[]) => setFitTo((f) => ({ stops, again: f.again + 1 })), []);
  const fitPoints = (points: ViewPoint[], min?: number) => {
    const around = frameAround(points, aspect, min);
    if (around) setFitTo((f) => ({ ...f, view: { ...around, inset: beside(around, points) }, again: f.again + 1 }));
  };
  const fitRequest = (stopViews: ViewPoint[]): ViewRequest => {
    const frame = frameAround(stopViews, aspect);
    return { id: `route ${fitTo.again}`, fit: fitTo.view ?? (frame && { ...frame, inset: beside(frame, stopViews) }) };
  };
  const keepClosed = (plan: string | null, kept: KeptFrame) => {
    if (closed) closed.current = { plan, frame: kept.frame, hadFit: !!kept.request.fit };
  };
  return { reopened, reopenedView, fitted: fitTo.stops, fitStops, fitPoints, fitRequest, cover, keepClosed };
}
