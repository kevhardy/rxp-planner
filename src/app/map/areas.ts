import type { InstanceId, WorldLocation, WorldPoint } from "../../data/index.ts";

const SPAWN_REACH_YARDS = 45;
const OUTLINE_LEVEL = 0.3;
const GRID_YARDS = 4;
const TOUCHING_YARDS = 2 * SPAWN_REACH_YARDS;

export interface AreaRing {
  instance: InstanceId;
  points: WorldPoint[];
}

export function spawnAreas(spawns: readonly WorldLocation[]): AreaRing[] {
  return clusters(spawns).flatMap((cluster) => trace(cluster).map((points) => ({ instance: cluster[0]!.instance, points })));
}

function clusters(spawns: readonly WorldLocation[]): WorldLocation[][] {
  const unique = [...new Map(spawns.map((s) => [`${s.instance}:${s.x}:${s.y}`, s])).values()];
  const parent = unique.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  const bucketOf = (s: WorldLocation, dx = 0, dy = 0) =>
    `${s.instance}:${Math.floor(s.x / TOUCHING_YARDS) + dx}:${Math.floor(s.y / TOUCHING_YARDS) + dy}`;
  const buckets = new Map<string, number[]>();
  unique.forEach((s, i) => {
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1])
        for (const j of buckets.get(bucketOf(s, dx, dy)) ?? []) {
          const o = unique[j]!;
          if (Math.hypot(s.x - o.x, s.y - o.y) < TOUCHING_YARDS) parent[root(i)] = root(j);
        }
    const own = bucketOf(s);
    buckets.set(own, [...(buckets.get(own) ?? []), i]);
  });
  const groups = new Map<number, WorldLocation[]>();
  unique.forEach((s, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), s]));
  return [...groups.values()];
}

function spawnShare(yardsSquared: number): number {
  const reachSquared = SPAWN_REACH_YARDS ** 2;
  return yardsSquared < reachSquared ? (1 - yardsSquared / reachSquared) ** 2 : 0;
}

function trace(spawns: readonly WorldPoint[]): WorldPoint[][] {
  const pad = SPAWN_REACH_YARDS + GRID_YARDS;
  const x0 = Math.min(...spawns.map((s) => s.x)) - pad;
  const y0 = Math.min(...spawns.map((s) => s.y)) - pad;
  const nx = Math.ceil((Math.max(...spawns.map((s) => s.x)) + pad - x0) / GRID_YARDS) + 1;
  const ny = Math.ceil((Math.max(...spawns.map((s) => s.y)) + pad - y0) / GRID_YARDS) + 1;
  const field = new Float64Array(nx * ny);
  const reach = SPAWN_REACH_YARDS / GRID_YARDS;
  for (const s of spawns) {
    const [ci, cj] = [(s.x - x0) / GRID_YARDS, (s.y - y0) / GRID_YARDS];
    for (let j = Math.ceil(cj - reach); j <= cj + reach; j++)
      for (let i = Math.ceil(ci - reach); i <= ci + reach; i++)
        field[j * nx + i]! += spawnShare(((i - ci) ** 2 + (j - cj) ** 2) * GRID_YARDS ** 2);
  }
  const at = (i: number, j: number) => field[j * nx + i]!;

  const horizontal = (i: number, j: number) => 2 * (j * nx + i);
  const vertical = (i: number, j: number) => 2 * (j * nx + i) + 1;
  const next = new Map<number, number>();
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      const edges = [horizontal(i, j), vertical(i + 1, j), horizontal(i, j + 1), vertical(i, j)];
      const inside = v.map((value) => value >= OUTLINE_LEVEL);
      const count = inside.filter(Boolean).length;
      if (count === 0 || count === 4) continue;
      if (count === 2 && inside[0] === inside[2]) {
        const joined = (v[0]! + v[1]! + v[2]! + v[3]!) / 4 >= OUTLINE_LEVEL;
        for (let k = 0; k < 4; k++) {
          if (inside[k] === joined) continue;
          const [before, after] = [edges[(k + 3) % 4]!, edges[k]!];
          if (joined) next.set(before, after);
          else next.set(after, before);
        }
        continue;
      }
      const end = inside.findIndex((on, k) => on && !inside[(k + 1) % 4]);
      const start = inside.findIndex((on, k) => !on && inside[(k + 1) % 4]);
      next.set(edges[end]!, edges[start]!);
    }

  const crossing = (edge: number): WorldPoint => {
    const cell = edge >> 1;
    const [i, j] = [cell % nx, Math.floor(cell / nx)];
    const [i2, j2] = edge & 1 ? [i, j + 1] : [i + 1, j];
    const [a, b] = [at(i, j), at(i2, j2)];
    const t = (OUTLINE_LEVEL - a) / (b - a);
    return { x: x0 + (i + (i2 - i) * t) * GRID_YARDS, y: y0 + (j + (j2 - j) * t) * GRID_YARDS };
  };
  const rings: WorldPoint[][] = [];
  for (const first of next.keys()) {
    if (!next.has(first)) continue;
    const ring: WorldPoint[] = [];
    for (let edge = first; next.has(edge);) {
      ring.push(crossing(edge));
      const to = next.get(edge)!;
      next.delete(edge);
      edge = to;
    }
    rings.push(ring);
  }
  return rings;
}
