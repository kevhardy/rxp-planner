import { useEffect, useState } from "react";
import { canvasToWorld, type WorldLocation, type WorldMapData } from "../../data/index.ts";
import { playerCoordinates, type MapCoordinates } from "../../routing/coordinates.ts";
import type { ZoneGrid } from "../../routing/zones.ts";
import { useGameData } from "../context.ts";
import type { ViewPoint } from "../map/points.ts";
import type { MapView } from "../map/view.ts";
import { viewToCanvas } from "../map/viewport.ts";
import "./CoordinateReadout.css";

export interface ReadoutPoint {
  label: string;
  at: WorldLocation;
}

export function CoordinateReadout(props: {
  pointer: Pick<MapView, "watchPointer">;
  map: WorldMapData;
  selection?: readonly ReadoutPoint[] | undefined;
  zones: readonly ZoneGrid[];
}) {
  const { map } = props;
  const data = useGameData();
  const [cursor, setCursor] = useState<ViewPoint | null>(null);
  useEffect(() => {
    let frame = 0;
    let next: ViewPoint | null = null;
    const stop = props.pointer.watchPointer((at) => {
      next = at;
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        setCursor(next);
      });
    });
    return () => {
      stop();
      cancelAnimationFrame(frame);
    };
  }, [props.pointer]);
  if (!data) return null;

  const selection = props.selection ?? [];
  const rows = [...selection, { label: "Cursor", at: cursor && canvasToWorld(map, viewToCanvas(map, cursor)) }];
  const className = ["coord-readout", !props.selection && "unlabeled", !cursor && !selection.length && "idle"].filter(Boolean).join(" ");
  return (
    <dl className={className}>
      {rows.map(({ label, at }) => {
        const c = at && playerCoordinates(data, at, props.zones);
        return (
          <div key={label} data-off-map={c ? undefined : ""}>
            <dt className={props.selection ? undefined : "sr-only"}>{label}</dt>
            <Coordinates of={c?.zone} />
            <Coordinates of={c?.continent} />
          </div>
        );
      })}
    </dl>
  );
}

function Coordinates({ of }: { of: MapCoordinates | undefined }) {
  return (
    <dd data-empty={of ? undefined : ""}>
      <span className="coord-x">{of ? `${of.x.toFixed(2)},` : "—"}</span>
      <span className="coord-y">{of?.y.toFixed(2)}</span>
      <span className="coord-name">{of?.name}</span>
    </dd>
  );
}
