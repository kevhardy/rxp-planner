import type { ViewPoint } from "../map/points.ts";
import { round } from "./lines.ts";

export function RouteFocus(props: { view: ViewPoint[] | undefined }) {
  if (!props.view?.length) return null;
  return (
    <svg className="route-focus" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={props.view.map((p) => `${round(p.x)},${round(p.y)}`).join(" ")} />
    </svg>
  );
}
