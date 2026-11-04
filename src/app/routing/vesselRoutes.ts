import type { WorldMapData, WorldMapRoute } from "../../data/index.ts";
import { frameOf, nativeToCanvas, type NativeFrame, type Point } from "../../routing/frame.ts";
import type { TransportLink, TransportStop } from "../../routing/transport.ts";
import type { AtlasPaths } from "./lines.ts";

const DOCK_REACH_YARDS = 25;

interface Hop {
  route: WorldMapRoute;
  reversed: boolean;
}

function vesselHops(map: WorldMapData, frames: readonly NativeFrame[], links: readonly TransportLink[]) {
  const yards = map.yardsPerChunk / map.pxPerChunk;
  const near = (stop: TransportStop, [x, y]: readonly [number, number]) => {
    const frame = frameOf(frames, stop.map);
    const at = frame && nativeToCanvas(map, frame, stop.point);
    return !!at && Math.hypot(at.x - x, at.y - y) * yards <= DOCK_REACH_YARDS;
  };
  const carries = (a: TransportStop, b: TransportStop): Hop[] =>
    map.routes.flatMap((route) => {
      const [first, last] = [route.points[0]!, route.points.at(-1)!];
      return [
        ...(near(a, first) && near(b, last) ? [{ route, reversed: false }] : []),
        ...(!route.oneWay && near(a, last) && near(b, first) ? [{ route, reversed: true }] : []),
      ];
    });
  const vessels = links.filter((l) => l.mode === "ship" || l.mode === "zeppelin");
  const graphs = new Map<string, Map<string, { to: string; hop: Hop }[]>>();
  for (const service of new Set(vessels.map((l) => l.service))) {
    const docks = new Map(vessels.filter((l) => l.service === service).flatMap((l) => [l.from, l.to].map((s) => [s.id, s] as const)));
    const edges = new Map<string, { to: string; hop: Hop }[]>();
    for (const a of docks.values())
      for (const b of docks.values()) {
        const carried = a === b ? [] : carries(a, b);
        if (carried.length === 1) edges.set(a.id, [...(edges.get(a.id) ?? []), { to: b.id, hop: carried[0]! }]);
      }
    graphs.set(service, edges);
  }
  return vessels.map((link) => {
    const edges = graphs.get(link.service)!;
    const seen = new Set([link.from.id]);
    let chains = [{ at: link.from.id, hops: [] as Hop[] }];
    while (chains.length > 0) {
      const done = chains.filter((c) => c.at === link.to.id);
      if (done.length > 0) return { link, ...(done.length === 1 && { hops: done[0]!.hops }) };
      chains = chains.flatMap((c) =>
        (edges.get(c.at) ?? []).filter((e) => !seen.has(e.to)).map((e) => ({ at: e.to, hops: [...c.hops, e.hop] })),
      );
      for (const c of chains) seen.add(c.at);
    }
    return { link };
  });
}

export function vesselPaths(map: WorldMapData, frames: readonly NativeFrame[], links: readonly TransportLink[]): AtlasPaths {
  const key = (l: TransportLink) => `${l.service} ${l.from.id} ${l.to.id}`;
  const along = ({ route, reversed }: Hop) => (reversed ? route.points.toReversed() : route.points).map(([x, y]): Point => [x, y]);
  const paths = new Map(
    vesselHops(map, frames, links).flatMap(({ link, hops }) => (hops ? [[key(link), hops.flatMap(along)] as const] : [])),
  );
  return (link) => paths.get(key(link));
}
