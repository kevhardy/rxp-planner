import { canvasToWorld, worldToCanvas, type InstanceId, type WorldLocation, type WorldMapData } from "../../data/index.ts";
import { frameOf, insideFrame, nativeToCanvas, type NativeFrame, type Point } from "../../routing/frame.ts";
import type { Journey, JourneyLeg } from "../../routing/journey.ts";
import type { RoutePlan } from "../../routing/plan.ts";
import { routeOf } from "../../routing/result.ts";
import type { TerrainRoute } from "../../routing/search.ts";
import { transportSteps, type TransportLink } from "../../routing/transport.ts";
import type { ViewPoint } from "../map/points.ts";
import { canvasToView, viewToCanvas, zoomTo, type Box, type Fit, type Frame, type Inset } from "../map/viewport.ts";

export const ATLAS = "atlas";
type LineMap = InstanceId | typeof ATLAS | { world: InstanceId };

export interface Projection {
  toView(p: Point, map: LineMap): ViewPoint | undefined;
  stopView(stop: WorldLocation): ViewPoint | undefined;
  toStop(at: ViewPoint): WorldLocation | undefined;
}

export function projection(map: WorldMapData, frames: readonly NativeFrame[]): Projection {
  const stopView = (stop: WorldLocation) => {
    const at = worldToCanvas(map, stop);
    return at && canvasToView(map, at);
  };
  return {
    toView: (p, m) => {
      if (m === ATLAS) return canvasToView(map, { x: p[0], y: p[1] });
      if (typeof m === "object") return stopView({ instance: m.world, x: p[0], y: p[1] });
      const native = frameOf(frames, m);
      const at = native && nativeToCanvas(map, native, p);
      return at && canvasToView(map, at);
    },
    stopView,
    toStop: (at) => {
      const world = canvasToWorld(map, viewToCanvas(map, at));
      const native = world && frameOf(frames, world.instance);
      return native && insideFrame(native, world) ? world : undefined;
    },
  };
}

export type LegLook = "route" | "straight" | "provisional" | "failed" | "pending" | "preview" | "crossing";

export interface LegLine {
  points: Point[];
  maps: LineMap[];
  look: LegLook;
  indoor?: Pick<LegLine, "points" | "maps">[];
  rides?: (Pick<LegLine, "points" | "maps"> & { mode: string })[];
  steps?: Pick<LegLine, "points" | "maps">[];
  label?: string;
}

export function legLines(
  plan: RoutePlan,
  journey: Journey | undefined,
  dragged: number | null,
  pending: ReadonlyMap<number, string> = new Map(),
  atlas?: AtlasPaths,
): LegLine[] {
  return plan.legs.map((_, i) => {
    const [from, to] = [plan.stops[i]!, plan.stops[i + 1]!];
    const straight = {
      points: [
        [from.x, from.y],
        [to.x, to.y],
      ] as Point[],
      maps: [{ world: from.instance }, { world: to.instance }],
    };
    const along = (points: Point[]) => ({ points, maps: points.map(() => from.instance) });
    const routed = ({ points, paths }: TerrainRoute) => ({
      ...along(points),
      ...(paths && { indoor: paths.map(({ start, end }) => along(points.slice(start, end + 1))) }),
    });
    if (dragged === i || dragged === i + 1) return { ...straight, look: "preview" };
    const result = journey?.legs[i];
    if (!result) {
      const label = pending.get(i);
      return { ...straight, look: "pending", ...(label && { label }) };
    }
    switch (result.kind) {
      case "route":
        return { ...routed(result), look: "route" };
      case "missing-coverage":
        if (result.route) return { ...routed(result.route), look: "route" };
        break;
      case "straight":
        return { ...straight, look: "straight", label: "straight-line estimate" };
      case "crossing":
        return { ...straight, look: "crossing", label: "no ground route between continents" };
      case "transport": {
        const line: Required<Pick<LegLine, "points" | "maps" | "indoor" | "rides" | "steps">> = {
          points: [],
          maps: [],
          indoor: [],
          rides: [],
          steps: [],
        };
        for (const part of transportSteps(result.parts)) {
          if (part.kind === "ride") {
            const ride = ridePoints(part.links, atlas);
            line.rides.push({ ...ride, mode: part.links[0]!.mode });
            line.steps.push(ride);
            line.points.push(...ride.points);
            line.maps.push(...ride.maps);
            continue;
          }
          const route = routeOf(part.result);
          const points = route?.points ?? [part.from, part.to];
          for (const { start, end } of route?.paths ?? [])
            line.indoor.push({ points: points.slice(start, end + 1), maps: points.slice(start, end + 1).map(() => part.map) });
          line.steps.push({ points, maps: points.map(() => part.map) });
          line.points.push(...points);
          line.maps.push(...points.map(() => part.map));
        }
        return { ...line, look: "route" };
      }
      case "no-path":
      case "no-terrain":
      case "limit":
        break;
      default:
        result satisfies never;
    }
    const route = routeOf(result);
    const endpoint = "endpoint" in result && result.endpoint ? ` at the leg's ${result.endpoint}` : "";
    return route
      ? { ...routed(route), look: "provisional", label: `${result.kind}, provisional route` }
      : { ...straight, look: "failed", label: result.kind + endpoint };
  });
}

export const lineView = (line: Pick<LegLine, "points" | "maps">, proj: Projection): ViewPoint[] =>
  line.points.flatMap((p, k) => proj.toView(p, line.maps[k]!) ?? []);

export interface TileOutlines {
  outlines: ViewPoint[][];
  labels: ViewPoint[];
}

export function skippedTiles(result: JourneyLeg | undefined, proj: Projection, map: InstanceId, tilePixels: number): TileOutlines {
  if (result?.kind !== "missing-coverage") return { outlines: [], labels: [] };
  const shown = result.tiles.flatMap(({ tile: [c, r] }) => {
    const corners = (
      [
        [c, r],
        [c + 1, r],
        [c + 1, r + 1],
        [c, r + 1],
      ] as Point[]
    ).map(([x, y]) => proj.toView([x * tilePixels, y * tilePixels], map));
    return corners.every((at) => at) ? [{ c, r, corners: corners as ViewPoint[] }] : [];
  });
  let groups: (typeof shown)[] = [];
  for (const t of shown) {
    const touching = groups.filter((g) => g.some((u) => Math.abs(u.c - t.c) <= 1 && Math.abs(u.r - t.r) <= 1));
    groups = [...groups.filter((g) => !touching.includes(g)), [t, ...touching.flat()]];
  }
  const labels = groups.map((g) => {
    const { corners } = g.sort((a, b) => a.r - b.r || a.c - b.c)[Math.floor(g.length / 2)]!;
    return { x: corners.reduce((s, p) => s + p.x, 0) / 4, y: corners.reduce((s, p) => s + p.y, 0) / 4 };
  });
  return { outlines: shown.map((t) => t.corners), labels };
}

export function insetsBeside(inset: Inset, panels: readonly Inset[], box: Box, margin = 12): Inset[] {
  return panels.reduce(
    (insets, panel) =>
      insets.flatMap((i) =>
        [
          { ...i, right: Math.max(i.right, box.vw - panel.left + margin) },
          { ...i, left: Math.max(i.left, panel.right + margin) },
          { ...i, top: Math.max(i.top, panel.bottom + margin) },
          { ...i, bottom: Math.max(i.bottom, box.vh - panel.top + margin) },
        ].filter((c) => clearArea(c, box) > 0),
      ),
    [inset],
  );
}

const clearArea = (i: Inset, box: Box) => Math.max(0, box.vw - i.left - i.right) * Math.max(0, box.vh - i.top - i.bottom);

export function insetBeside(
  inset: Inset,
  frame: Frame | Fit,
  shown: readonly ViewPoint[],
  box: Box,
  maxZoom: number,
  panels: readonly Inset[],
  margin = 12,
): Inset {
  const count = (i: Inset) => {
    const { s, tx, ty } = zoomTo({ ...frame, inset: i }, box, maxZoom);
    return shown.filter((p) => {
      const [x, y] = [tx + (p.x / 100) * box.w * s, ty + (p.y / 100) * box.h * s];
      return x >= i.left - 1 && y >= i.top - 1 && x <= box.vw - i.right + 1 && y <= box.vh - i.bottom + 1;
    }).length;
  };
  const choices = insetsBeside(inset, panels, box, margin).map((i) => ({ i, count: count(i), area: clearArea(i, box) }));
  const best = choices.sort((a, b) => b.count - a.count || b.area - a.area)[0];
  return best && best.count > 0 ? best.i : inset;
}

export const toScreen = (at: ViewPoint, pxPerPercent: number, aspect: number): [number, number] => [
  at.x * pxPerPercent,
  (at.y * pxPerPercent) / aspect,
];

function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function nearestLine(lines: ViewPoint[][], at: ViewPoint, pxPerPercent: number, aspect: number, tolerance = 8): number | undefined {
  const p = toScreen(at, pxPerPercent, aspect);
  let best: { i: number; d: number } | undefined;
  lines.forEach((line, i) => {
    const px = line.map((q) => toScreen(q, pxPerPercent, aspect));
    for (let k = 0; k < px.length; k++) {
      const d = segmentDistance(p, px[k]!, px[k + 1] ?? px[k]!);
      if (d <= tolerance && (!best || d < best.d)) best = { i, d };
    }
  });
  return best?.i;
}

export function frameAround(points: ViewPoint[], aspect: number, min = 2): Frame | undefined {
  if (points.length === 0) return undefined;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const width = Math.max(min, (right - left) * 1.4);
  const height = Math.max(min * aspect, (bottom - top) * 1.4);
  return { left: (left + right) / 2 - width / 2, top: (top + bottom) / 2 - height / 2, width, height };
}

export const round = (n: number) => Math.round(n * 1e4) / 1e4;

function measure(view: ViewPoint[], pxPerPercent: number, aspect: number) {
  const px = view.map((p) => toScreen(p, pxPerPercent, aspect));
  const lengths = [0];
  for (let i = 1; i < px.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(px[i]![0] - px[i - 1]![0], px[i]![1] - px[i - 1]![1]));
  const total = lengths.at(-1)!;
  const at = (s: number, from = 1): { point: [number, number]; segment: number } => {
    let i = Math.max(1, from);
    while (i < px.length - 1 && lengths[i]! < s) i++;
    const [a, b] = [px[i - 1] ?? px[0]!, px[i] ?? px[0]!];
    const t = Math.min(1, Math.max(0, (s - (lengths[i - 1] ?? 0)) / ((lengths[i] ?? 0) - (lengths[i - 1] ?? 0) || 1)));
    return { point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], segment: i };
  };
  const toStage = ([x, y]: [number, number]): ViewPoint => ({ x: x / pxPerPercent, y: (y * aspect) / pxPerPercent });
  return { total, at, toStage };
}

export function along(view: ViewPoint[], pxPerPercent: number, aspect: number): ViewPoint | undefined {
  if (view.length === 0) return undefined;
  const line = measure(view, pxPerPercent, aspect);
  return line.toStage(line.at(line.total / 2).point);
}

const ARROW_GAP = 90;

export function arrows(view: ViewPoint[], pxPerPercent: number, aspect: number): string {
  const line = measure(view, pxPerPercent, aspect);
  if (line.total < 24) return "";
  const count = Math.max(1, Math.floor(line.total / ARROW_GAP));
  const stage = (p: [number, number]) => {
    const at = line.toStage(p);
    return `${round(at.x)} ${round(at.y)}`;
  };
  let d = "";
  let segment = 1;
  for (let n = 0; n < count; n++) {
    const s = ((n + 0.5) * line.total) / count;
    const behind = line.at(s - 6, segment);
    const tip = line.at(s, behind.segment).point;
    const ahead = line.at(s + 6, behind.segment).point;
    segment = behind.segment;
    const angle = Math.atan2(ahead[1] - behind.point[1], ahead[0] - behind.point[0]);
    const arm = (turn: number) => stage([tip[0] - 5 * Math.cos(angle + turn), tip[1] - 5 * Math.sin(angle + turn)]);
    d += `M${arm(-0.6)}L${stage(tip)}L${arm(0.6)}`;
  }
  return d;
}

export type AtlasPaths = (link: TransportLink) => Point[] | undefined;

export function ridePoints(links: readonly TransportLink[], atlas?: AtlasPaths): Pick<LegLine, "points" | "maps"> {
  const line: Pick<LegLine, "points" | "maps"> = { points: [], maps: [] };
  const add = (p: Point, map: LineMap) => {
    const [q, m] = [line.points.at(-1), line.maps.at(-1)];
    if (q && m === map && q[0] === p[0] && q[1] === p[1]) return;
    line.points.push(p);
    line.maps.push(map);
  };
  add(links[0]!.from.point, links[0]!.from.map);
  for (const link of links) {
    const route = atlas?.(link);
    if (route) for (const p of route) add(p, ATLAS);
    else for (const p of link.path ?? []) add(p, link.from.map);
    add(link.to.point, link.to.map);
  }
  return line;
}
