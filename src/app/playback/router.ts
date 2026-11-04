import { useMemo } from "react";
import { DEFAULT_MAX_SLOPE } from "../../routing/plan.ts";
import { useRouting } from "../routing/routingStore.ts";
import type { HostRouting } from "./store.ts";

export function usePlaybackRouter(): HostRouting | undefined {
  const { load, lane, rides } = useRouting("playback");
  return useMemo((): HostRouting | undefined => {
    if (load && !load.ok) return { router: null, unavailable: load.reason };
    if (!lane) return undefined;
    return {
      router: {
        frames: lane.maps.map((m) => m.manifest),
        rides,
        route: (plan, mode, signal, legRides) => lane.route(plan, DEFAULT_MAX_SLOPE, signal, undefined, legRides, mode),
      },
    };
  }, [load, lane, rides]);
}
