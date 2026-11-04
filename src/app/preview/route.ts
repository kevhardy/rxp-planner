import { useState } from "react";
import { RACE_FACTION } from "../../data/index.ts";
import type { GuideRecord } from "../../guide/index.ts";
import { factionData, openRoute, playbackRoute, startOf, type PlaybackChoices, type RouteView, type SimData } from "../../rules/index.ts";
import { useEditor, useEntities, useGameData, type Stores } from "../context.ts";
import { useTimeout } from "../effects.ts";
import { useLayout } from "../layout.ts";
import { usePlaybackChoices } from "../playback/settings.ts";
import type { CurrentGuide, EditorState, Selection } from "../store.ts";
import { profileOf, usePreviewSettings, type PreviewSettings } from "./settings.ts";

const cache: { key: unknown[]; route: RouteView | null }[] = [];

function buildRoute(
  guides: ReadonlyMap<string, GuideRecord>,
  builtins: ReadonlyMap<string, GuideRecord>,
  current: Pick<CurrentGuide, "id" | "copyOf"> | null,
  settings: PreviewSettings,
  sim: SimData | undefined,
): RouteView | null {
  const { showAll: _, ...character } = settings;
  const key = [guides, builtins, current?.id, current?.copyOf, sim, ...Object.values(character)];
  const hit = cache.findIndex((c) => key.every((k, i) => k === c.key[i]));
  if (hit >= 0) {
    const [entry] = cache.splice(hit, 1);
    cache.unshift(entry!);
    return entry!.route;
  }
  const route = current && openRoute({ guides, builtins }, current, profileOf(settings, undefined), settings, sim);
  cache.unshift({ key, route });
  cache.length = Math.min(cache.length, 2);
  return route;
}

export function useSimData(settings: PreviewSettings): SimData | undefined {
  const data = useGameData();
  const entities = useEntities();
  return data && entities ? factionData(data, entities, RACE_FACTION[settings.race]).sim : undefined;
}

function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useTimeout(() => setSettled(value), delay, value);
  return settled;
}

const SETTLE_MS = 300;

export function useRoute(live = false): RouteView | null {
  const { guides, builtins, current } = useEditor();
  const settings = usePreviewSettings();
  const sim = useSimData(settings);
  const settled = useSettled(guides, SETTLE_MS);
  const used = live ? guides : settled;
  return buildRoute(used, builtins, current, settings, sim);
}

const played = new WeakMap<RouteView, { choices: PlaybackChoices; route: RouteView }>();

function usePlayedRoute(playing: boolean): RouteView | null {
  const route = useRoute();
  const settings = usePreviewSettings();
  const sim = useSimData(settings);
  const choices = usePlaybackChoices();
  if (!playing || !route?.simulation || !sim) return route;
  const hit = played.get(route);
  if (hit?.choices === choices) return hit.route;
  const replay = playbackRoute(route, sim, choices, settings.startLevel);
  played.set(route, { choices, route: replay });
  return replay;
}

export function usePlaybackRoute(): RouteView | null {
  return usePlayedRoute(true);
}

export function useShownRoute(): RouteView | null {
  return usePlayedRoute(useLayout().mode === "playback");
}

export function isCurrent(route: RouteView, source: number, state: Pick<EditorState, "guides" | "builtins">): boolean {
  const record = route.records[source]!;
  return (state.guides.get(record.id) ?? state.builtins.get(record.id)) === record;
}

export function openOnRoute(stores: Pick<Stores, "editor" | "preview">, route: RouteView, source: number): void {
  const start = startOf(route);
  if (route.preview.guides.some((g) => g.source === source))
    stores.preview.update({ start: start === source ? null : route.records[start]!.id });
  stores.editor.open(route.records[source]!.id);
}

export function jumpTo(
  stores: Pick<Stores, "editor" | "layout" | "preview">,
  route: RouteView,
  source: number,
  selection: Selection,
): void {
  const { editor, layout } = stores;
  if (!isCurrent(route, source, editor.getState())) return;
  openOnRoute(stores, route, source);
  editor.select(selection);
  const current = editor.getState().current;
  if (current) layout.revealEditor({ guide: current.viewId, selection: editor.getState().selection, destination: "outline" });
}
