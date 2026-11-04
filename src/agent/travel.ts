import type { WorldLocation } from "../data/index.ts";
import { routeJourney } from "../routing/journey.ts";
import { createPlan, DEFAULT_MAX_SLOPE, withHeight } from "../routing/plan.ts";
import type { Terrain } from "../routing/terrain.ts";
import type { Travel } from "./tool.ts";

export async function groundTravel(terrain: Terrain, from: WorldLocation, to: WorldLocation): Promise<Travel | undefined> {
  const map = terrain.frame.scope.map;
  if (from.instance !== map || to.instance !== map) return undefined;
  const plan = createPlan(withHeight(from, null), withHeight(to, null), "agent");
  const journey = await routeJourney(terrain, plan, plan.settings.modes[0]!, { maxSlope: DEFAULT_MAX_SLOPE });
  const leg = journey.legs[0];
  return leg?.kind === "route" ? { seconds: leg.seconds, yards: leg.distance + leg.swimDistance } : undefined;
}
