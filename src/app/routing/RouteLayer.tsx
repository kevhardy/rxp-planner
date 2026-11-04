import { memo, type RefObject } from "react";
import { Icon } from "../icons.tsx";
import type { ViewPoint } from "../map/points.ts";
import { useFrame, useMapView } from "../map/view.ts";
import { lineInFrame } from "../map/viewport.ts";
import { along, arrows, round, type LegLook } from "./lines.ts";
import { rideIcon } from "./rideIcons.ts";

interface RideView {
  mode: string;
  view: ViewPoint[];
  ends: (ViewPoint | undefined)[];
}

export const RouteLayer = memo(function RouteLayer(props: {
  layer: RefObject<SVGSVGElement | null>;
  lines: { look: LegLook; label?: string; view: ViewPoint[]; indoorViews?: ViewPoint[][]; rideViews?: RideView[] }[];
  names: string[];
  selected: number | null;
  onSelect: (leg: number | null) => void;
  pxPerPercent: number;
  aspect: number;
}) {
  const { lines, selected, onSelect, pxPerPercent, aspect } = props;
  const frame = useFrame(useMapView());
  const points = (view: ViewPoint[]) => view.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
  const chosen = selected === null ? undefined : lines[selected];
  return (
    <>
      <svg ref={props.layer} className="route-lines" viewBox="0 0 100 100" preserveAspectRatio="none" role="group" aria-label="Route legs">
        {chosen && (
          <g className="leg-chosen">
            <polyline className="leg-edge" points={points(chosen.view)} />
            <polyline className="leg-halo" points={points(chosen.view)} />
          </g>
        )}
        {lines.map((line, i) => {
          const activate = () => onSelect(i);
          return (
            <g
              key={i}
              role="button"
              className={`route-leg leg-${line.look}${selected === i ? " chosen" : ""}`}
              data-leg={i}
              tabIndex={-1}
              data-in-view={(frame && lineInFrame(line.view, frame)) || undefined}
              aria-label={props.names[i]}
              aria-pressed={selected === i}
              onClick={activate}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                activate();
              }}
            >
              <polyline className="leg-edge" points={points(line.view)} />
              <polyline className="leg-halo" points={points(line.view)} />
              <polyline className="leg-outline" points={points(line.view)} />
              <polyline className="leg-line" points={points(line.view)} />
              {line.indoorViews?.map((view, k) => (
                <polyline key={k} className="leg-indoor" points={points(view)} />
              ))}
              {line.rideViews?.map(({ view }, k) => (
                <polyline key={k} className="leg-ride" points={points(view)} />
              ))}
              <path className="leg-arrows" d={arrows(line.view, pxPerPercent, aspect)} />
            </g>
          );
        })}
      </svg>
      {lines.flatMap(
        (line, i) =>
          line.rideViews?.flatMap(({ mode, ends }, k) =>
            ends.map(
              (at, end) =>
                at && (
                  <span
                    key={`${i}-${k}-${end}`}
                    className={`ride-stop${end ? " ride-leave" : ""}`}
                    data-mode={mode}
                    style={{ "--at-x": `${at.x}%`, "--at-y": `${at.y}%` }}
                    aria-hidden="true"
                  >
                    <Icon name={rideIcon(mode)} size={12} />
                  </span>
                ),
            ),
          ) ?? [],
      )}
      {lines.map((line, i) => {
        const at = line.label && along(line.view, pxPerPercent, aspect);
        return (
          at && (
            <span key={i} className={`route-label leg-${line.look}`} style={{ "--at-x": `${at.x}%`, "--at-y": `${at.y}%` }}>
              {line.label}
            </span>
          )
        );
      })}
    </>
  );
});
