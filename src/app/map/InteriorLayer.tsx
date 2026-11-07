import { useId, useMemo, useState, useSyncExternalStore } from "react";
import type { Interior } from "../../../packages/data-contract/interiors.ts";
import { interiorAt } from "../../data/heightMap.ts";
import { canvasToWorld, worldToCanvas, type LoadedWorldMap, type WorldMapData } from "../../data/index.ts";
import type { Status } from "../async.ts";
import { useAssets } from "../effects.ts";
import { MIN_LEVEL } from "./labels.ts";
import { interiorAssets } from "./mapAssets.ts";
import { zoomLevel } from "./terrain.ts";
import type { MapViewSource } from "./view.ts";
import { canvasSize, canvasToView, viewToCanvas, type Frame } from "./viewport.ts";
import { Card } from "../ui/Card.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";

export interface PlacedInterior {
  interior: Interior;
  rect: Frame;
}

export type InteriorStyle = "minimap" | "plan";

const MIN_INTERIOR_PIXELS = 160;

export function placeInteriors(map: WorldMapData, interiors: readonly Interior[]): PlacedInterior[] {
  return interiors.flatMap((interior) => {
    const { north, south, west, east } = interior.bounds;
    const a = worldToCanvas(map, { instance: interior.map, x: west, y: north });
    const b = worldToCanvas(map, { instance: interior.map, x: east, y: south });
    if (!a || !b) return [];
    const [va, vb] = [canvasToView(map, a), canvasToView(map, b)];
    return [{ interior, rect: { left: va.x, top: va.y, width: vb.x - va.x, height: vb.y - va.y } }];
  });
}

export function interiorInView(
  map: WorldMapData,
  placed: readonly PlacedInterior[],
  frame: Frame,
  pxPerPercent: number,
): PlacedInterior | undefined {
  const k = (pxPerPercent * 100) / canvasSize(map).width;
  if (zoomLevel(map, k) < MIN_LEVEL.landmark) return undefined;
  const middle = canvasToWorld(map, viewToCanvas(map, { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 }));
  if (!middle) return undefined;
  const pixelsPerYard = (k * map.pxPerChunk) / map.yardsPerChunk;
  const large = placed.filter(
    ({ interior: { bounds: b } }) => Math.max(b.north - b.south, b.west - b.east) * pixelsPerYard >= MIN_INTERIOR_PIXELS,
  );
  const inside = interiorAt(
    large.map((p) => p.interior),
    middle,
  );
  return large.find((p) => p.interior === inside);
}

export function useInteriorView(map: LoadedWorldMap | undefined, mapView: MapViewSource, fallback?: Interior) {
  const placed = useMemo(() => (map ? placeInteriors(map, map.interiors?.list ?? []) : []), [map]);
  const inView = useSyncExternalStore(mapView.subscribe, () => {
    const shown = mapView.getSnapshot().shown;
    return map && shown ? interiorInView(map, placed, shown.frame, shown.pxPerPercent) : undefined;
  });
  const [inside, setInside] = useState(true);
  return {
    placed: inView ?? (fallback && placed.find((p) => p.interior === fallback)),
    inside,
    setInside,
  };
}

const ready = <V,>(status: Status<V> | undefined) => (status?.kind === "ready" ? status.value : undefined);

export function InteriorImage(props: { map: LoadedWorldMap; placed: PlacedInterior; look: InteriorStyle; pxPerPercent: number }) {
  const { map, placed, look } = props;
  const { interior, rect } = placed;
  const id = useId();
  const path = interior.ground[look];
  const { indoor } = interior.ground;
  const { images, outlines } = interiorAssets(map.interiors);
  const [url, indoorUrl] = useAssets(
    images,
    useMemo(() => (indoor ? [path, indoor] : [path]), [path, indoor]),
  ).map(ready);
  const [edge] = useAssets(
    outlines,
    useMemo(() => [interior], [interior]),
  ).map(ready);
  if (!url || !edge || (indoor && !indoorUrl)) return null;
  const { width, height, masks } = edge;
  const px = width / (props.pxPerPercent * rect.width);
  const stripes = (kind: "two" | "more") => (
    <pattern id={`${id}${kind}-stripes`} patternUnits="userSpaceOnUse" width={6 * px} height={6 * px} patternTransform="rotate(45)">
      <rect className={`interior-stack-${kind}`} width={2 * px} height={6 * px} />
    </pattern>
  );
  const patch = (kind: "two" | "more") => (
    <g key={kind} className={`interior-stack-${kind}`}>
      <path className="interior-stack-pixels" d={masks[kind]} fill={`url(#${id}${kind}-stripes)`} />
      <path className="interior-stack-pixels" d={masks[`${kind}Edge`]} />
    </g>
  );
  return (
    <svg
      className="interior-outline"
      style={{ "--at-x": `${rect.left}%`, "--at-y": `${rect.top}%`, "--size-w": `${rect.width}%`, "--size-h": `${rect.height}%` }}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        {edge.path && (
          <clipPath id={`${id}clip`}>
            <path d={edge.path} />
          </clipPath>
        )}
        {indoorUrl && (
          <mask id={`${id}indoor`} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
            <image href={indoorUrl} width={width} height={height} preserveAspectRatio="none" />
          </mask>
        )}
        {stripes("two")}
        {stripes("more")}
      </defs>
      {edge.path && <path className="interior-fill" d={edge.path} {...(indoorUrl && { mask: `url(#${id}indoor)` })} />}
      <image
        className="interior-layer"
        href={url}
        width={width}
        height={height}
        preserveAspectRatio="none"
        {...(edge.path && { clipPath: `url(#${id}clip)` })}
      />
      {patch("two")}
      {patch("more")}
      <path className="interior-outline-border" d={edge.path} />
      <path className="interior-outline-line" d={edge.path} />
    </svg>
  );
}

export function InsideMapBox(props: {
  interior: Interior;
  inside: boolean;
  onInside: (on: boolean) => void;
  plans: { on: boolean; onChange: (on: boolean) => void };
}) {
  const { plans } = props;
  const title = useId();
  return (
    <Card className="inside-box" role="group" aria-labelledby={title}>
      <p id={title} className="inside-box-title">
        {props.interior.label}
      </p>
      <Checkbox label="Inside map" checked={props.inside} onChange={(e) => props.onInside(e.target.checked)} />
      <Checkbox label="Floor plans" checked={plans.on} onChange={(e) => plans.onChange(e.target.checked)} />
    </Card>
  );
}
