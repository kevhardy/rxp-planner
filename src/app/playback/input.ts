import { useContext, useEffect, useMemo } from "react";
import type { PlaybackInput } from "../../routing/playback.ts";
import { timelineNpcs, type RouteView } from "../../rules/index.ts";
import { DatasetContext, useEditor, useGameData } from "../context.ts";
import { usePlaybackRoute, useSimData } from "../preview/route.ts";
import { usePreviewSettings } from "../preview/settings.ts";
import { usePlaybackStore, type HostRouting } from "./store.ts";

function usePlaybackInput(route: RouteView | null): PlaybackInput | null {
  const sim = useSimData(usePreviewSettings());
  const game = useGameData();
  const world = useContext(DatasetContext)?.data?.worldMap;
  return useMemo(() => {
    const simulation = route?.simulation;
    if (!route || !simulation || !sim || !game) return null;
    const { profile } = route;
    return { simulation, guides: route.docs, profile, data: sim, npcs: timelineNpcs(game, profile.faction, world) };
  }, [route, sim, game, world]);
}

export function useAttachPlayback(routing: HostRouting | undefined): void {
  const store = usePlaybackStore();
  const route = usePlaybackRoute();
  const input = usePlaybackInput(route);
  const { current, selection } = useEditor();
  const first = route?.preview.guides[0]?.source;
  const startId = first === undefined ? undefined : route!.records[first]!.id;
  const [view, start] = [current?.viewId, startId === current?.id ? current?.viewId : startId];
  useEffect(() => (routing ? store.attach(input, routing, { view, start }) : undefined), [store, input, routing, view, start]);
  const open = route?.open;
  useEffect(() => {
    if (open !== undefined) store.follow(open, selection.step);
  }, [store, open, selection.step]);
}
