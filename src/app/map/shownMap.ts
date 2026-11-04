import type { UiMapId } from "../../data/index.ts";
import type { ResolvedMapFocus } from "./lineFocus.ts";

type Held = { kind: "picked"; map: UiMapId } | { kind: "focused"; id: string; focus: ResolvedMapFocus };

export interface ViewState {
  anchor: { guide: string; jumps: number; map: UiMapId | undefined } | null;
  held: Held | null;
}

export const NO_VIEW: ViewState = { anchor: null, held: null };

// No dataset map has this ID. The guide map shows the whole terrain for it.
export const AZEROTH: UiMapId = 0;

export interface MapNavigation {
  guide: string;
  jumps: number;
  step: number | null;
}

export function follow(state: ViewState, at: MapNavigation, followed: () => UiMapId | undefined): ViewState {
  const { anchor } = state;
  const opened = !anchor || anchor.guide !== at.guide;
  if (!opened && anchor.jumps === at.jumps) return state;
  if (opened || at.step !== null) return { anchor: { guide: at.guide, jumps: at.jumps, map: followed() }, held: null };
  return { ...state, anchor: { ...anchor, jumps: at.jumps } };
}

export const pickMap = (state: ViewState, map: UiMapId): ViewState => ({ ...state, held: { kind: "picked", map } });

export const holdFocus = (state: ViewState, id: string, focus: ResolvedMapFocus): ViewState => ({
  ...state,
  held: { kind: "focused", id, focus },
});

export const endFocus = (state: ViewState): ViewState => (state.held?.kind === "focused" ? { ...state, held: null } : state);

export function shownMap({ anchor, held }: ViewState): UiMapId {
  if (held?.kind === "picked") return held.map;
  return (held?.kind === "focused" ? held.focus.map : undefined) ?? anchor?.map ?? AZEROTH;
}
