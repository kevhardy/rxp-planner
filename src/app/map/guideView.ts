import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import type { UiMapId } from "../../data/index.ts";
import { insetBeside, insetsBeside } from "../routing/lines.ts";
import type { FocusResolution, MapFocusTarget, ResolvedMapFocus } from "./lineFocus.ts";
import { AZEROTH, endFocus, follow, holdFocus, NO_VIEW, pickMap, shownMap, type MapNavigation } from "./shownMap.ts";
import type { Surface } from "./surfaces.ts";
import { MapView, type ViewRequest } from "./view.ts";
import { mapCover, type Box, type Fit, type Inset } from "./viewport.ts";
import { useWorldMapStore, type FocusResult } from "./worldMapStore.ts";

export function useGuideView(options: {
  outside: ViewRequest | undefined;
  receives: boolean;
  resolve: (target: MapFocusTarget, preferredMap: UiMapId | undefined) => FocusResolution;
  onFocus: () => void;
}) {
  const { outside, receives } = options;
  const [state, setState] = useState(NO_VIEW);
  const [mapView] = useState(() => new MapView());
  const mapTop = useRef<HTMLDivElement>(null);
  const cards = useRef(0);
  const shown = shownMap(state);
  const focused = state.held?.kind === "focused" ? state.held : null;
  const focusOn = (id: string, target: MapFocusTarget): FocusResult => {
    const resolved = options.resolve(target, shown);
    if (resolved.kind === "unavailable") return resolved;
    options.onFocus();
    setState((s) => holdFocus(s, id, resolved.focus));
    return { kind: "focused" };
  };
  const receive = useEffectEvent(focusOn);
  const worldMap = useWorldMapStore();
  useEffect(
    () => (receives ? worldMap.connectFocus((request) => receive(`focus ${request.id}`, request.target)) : undefined),
    [receives, worldMap],
  );
  if (outside && !outside.hold && focused) setState(endFocus);
  return {
    shown,
    focus: focused?.focus ?? null,
    mapView,
    mapTop,
    follow(at: MapNavigation, followed: () => UiMapId | undefined) {
      const next = follow(state, at, followed);
      if (next !== state) setState(next);
    },
    pick: (map: UiMapId) => setState((s) => pickMap(s, map)),
    show: (target: MapFocusTarget) => focusOn(`card ${++cards.current}`, target),
    canvas(surface: Surface): { view: ViewRequest; mapView: MapView; cover: () => Inset } {
      const view: ViewRequest = focused
        ? { id: focused.id, fit: { ...focused.focus.fit, inset: clearOf(mapTop, focused.focus) } }
        : (outside ?? { fit: shown === AZEROTH ? undefined : fitAbove(mapTop, surface.fitMap(shown)) });
      return { view, mapView, cover: () => coverOf(mapTop) };
    },
  };
}

const ZOOM_BUTTONS_SPACE = 48;
const CLEAR = { top: 12, right: ZOOM_BUTTONS_SPACE + 12, bottom: 12, left: 12 };

function clearAbove(top: HTMLElement): Inset {
  return { ...CLEAR, bottom: CLEAR.bottom + mapCover(top) };
}

function controlsOf({ current: top }: RefObject<HTMLElement | null>): { box: Box; clear: Inset; panels: Inset[] } | undefined {
  const viewport = top?.closest(".map-body")?.querySelector(".map-viewport")?.getBoundingClientRect();
  if (!viewport) return undefined;
  const panels = [...top!.children].flatMap((e) => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return [];
    return [{ top: r.top - viewport.top, right: r.right - viewport.left, bottom: r.bottom - viewport.top, left: r.left - viewport.left }];
  });
  return { box: { vw: viewport.width, vh: viewport.height, w: viewport.width, h: viewport.height }, clear: clearAbove(top!), panels };
}

function coverOf(top: RefObject<HTMLElement | null>): Inset {
  const controls = controlsOf(top);
  if (!controls) return CLEAR;
  const area = (i: Inset) => (controls.box.vw - i.left - i.right) * (controls.box.vh - i.top - i.bottom);
  return insetsBeside(controls.clear, controls.panels, controls.box, 0).sort((a, b) => area(b) - area(a))[0] ?? controls.clear;
}

const clearOf =
  (top: RefObject<HTMLElement | null>, focus: ResolvedMapFocus) =>
  (box: Box, maxZoom: number): Inset => {
    const controls = controlsOf(top);
    const shown = [...focus.marks.map((m) => m.at), ...focus.paths.flatMap((p) => p.points)];
    return insetBeside(controls?.clear ?? CLEAR, focus.fit, shown, box, maxZoom, controls?.panels ?? []);
  };

function fitAbove(top: RefObject<HTMLElement | null>, fit: Fit | undefined): Fit | undefined {
  return fit && { ...fit, inset: () => ({ top: 0, right: 0, bottom: top.current ? mapCover(top.current) : 0, left: 0 }) };
}
