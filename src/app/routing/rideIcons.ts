import type { IconName } from "../icons.tsx";

// Stroke icons, because the dataset's map icons have a ship and a zeppelin but no portal, tram, or elevator.
const RIDE_ICONS: Readonly<Record<string, IconName>> = {
  ship: "ship",
  zeppelin: "zeppelin",
  tram: "tram",
  portal: "portal",
  transition: "portal",
  access: "door",
  "druid-flight": "bird",
  elevator: "elevator",
  flight: "flight",
};

export const rideIcon = (mode: string): IconName => (Object.hasOwn(RIDE_ICONS, mode) ? RIDE_ICONS[mode]! : "route");
