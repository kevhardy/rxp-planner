/** The view of a searched region that smoothing reads. Nodes and cells are the search's (terrain.ts `RegionFloor`). */
export interface SmoothGrid {
  width: number;
  /** World units to a cell side. */
  spacing: number;
  cellOf(node: number): number;
  /** The height of a node, in world units. */
  level(node: number): number;
  /** Visits each node of cell `cell`, a side or diagonal cell of the cell of `from`, that one walk step of the search reaches from `from`. */
  walk(from: number, cell: number, visit: (node: number) => void): void;
}

/**
 * A route as positions: `nodes[i]` is the node of position `i`, `lengths[i]`
 * the 3D length of the step into it, and `plain[i]` whether that step is a
 * walk step that smoothing may replace. Position 0 has no step.
 */
export interface RouteSteps {
  nodes: readonly number[];
  lengths: readonly number[];
  plain: readonly boolean[];
}

/**
 * The positions of a smoothed route, in order, and the 3D length of the step
 * or straight segment into each. Each step that is not plain stays, with its
 * two positions. The first and the last position always stay.
 */
export interface Smoothed {
  keep: number[];
  lengths: number[];
}

/** Smooths each run of plain steps of `route` on its own. */
export function smoothRoute(grid: SmoothGrid, route: RouteSteps): Smoothed {
  const { nodes, lengths, plain } = route;
  const out: Smoothed = { keep: [0], lengths: [0] };
  for (let start = 0; start < nodes.length - 1;) {
    let end = start + 1;
    if (plain[end]) {
      while (plain[end + 1]) end++;
      smoothRun(grid, nodes, lengths, start, end, out);
    } else {
      out.keep.push(end);
      out.lengths.push(lengths[end] ?? 0);
    }
    start = end;
  }
  return out;
}

function smoothRun(grid: SmoothGrid, nodes: readonly number[], lengths: readonly number[], start: number, end: number, out: Smoothed) {
  const along = [0];
  for (let i = start + 1; i <= end; i++) along.push((along.at(-1) ?? 0) + (lengths[i] ?? 0));
  const fits = (a: number, b: number) => {
    const length = segment(grid, nodes[a] ?? -1, nodes[b] ?? -1);
    return length <= (along[b - start] ?? 0) - (along[a - start] ?? 0) + 1e-9 ? length : undefined;
  };
  for (let a = start; a < end;) {
    const { best, length } = farFit(a, end, lengths[a + 1] ?? 0, (b) => fits(a, b));
    out.keep.push(best);
    out.lengths.push(length);
    a = best;
  }
}

/**
 * A far `b` in `(a, end]` that `fits`, with its length: the reach doubles until a fit fails, then halves back. Fits are
 * not monotonic along a run, so a farther `b` can fit too. `a + 1` always fits, with length `next`.
 */
function farFit(a: number, end: number, next: number, fits: (b: number) => number | undefined): { best: number; length: number } {
  let best = a + 1,
    bestLength = next,
    failed = end + 1;
  for (let reach = 2; a + reach <= end; reach *= 2) {
    const length = fits(a + reach);
    if (length === undefined) {
      failed = a + reach;
      break;
    }
    [best, bestLength] = [a + reach, length];
  }
  if (failed > end && best < end) {
    const length = fits(end);
    if (length === undefined) failed = end;
    else [best, bestLength] = [end, length];
  }
  while (failed - best > 1) {
    const mid = (best + failed) >> 1;
    const length = fits(mid);
    if (length === undefined) failed = mid;
    else [best, bestLength] = [mid, length];
  }
  return { best, length: bestLength };
}

function segment(grid: SmoothGrid, a: number, b: number): number {
  const { width, spacing } = grid;
  const from = grid.cellOf(a),
    to = grid.cellOf(b);
  let x = from % width,
    y = Math.floor(from / width);
  const dx = Math.abs((to % width) - x),
    dy = Math.abs(Math.floor(to / width) - y);
  const sx = Math.sign((to % width) - x),
    sy = Math.sign(Math.floor(to / width) - y);
  const flat = Math.hypot(dx, dy);
  const hx = (spacing * dx) / flat,
    hy = (spacing * dy) / flat;
  let reached = new Map([[a, 0]]);
  for (let i = 0, j = 0; i < dx || j < dy;) {
    const tx = (2 * i + 1) * dy,
      ty = (2 * j + 1) * dx;
    let h = 0;
    if (tx <= ty) {
      x += sx;
      i++;
      h += hx;
    }
    if (ty <= tx) {
      y += sy;
      j++;
      h += hy;
    }
    const cell = y * width + x;
    const next = new Map<number, number>();
    for (const [node, length] of reached)
      grid.walk(node, cell, (n) => {
        const total = length + Math.hypot(h, grid.level(n) - grid.level(node));
        if (!(total >= (next.get(n) ?? Infinity))) next.set(n, total);
      });
    if (!next.size) return Infinity;
    reached = next;
  }
  return reached.get(b) ?? Infinity;
}
