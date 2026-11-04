export interface SkipRun {
  last: number;
  folded: boolean;
}

/**
 * The runs of `count` steps where `skipped` holds, by first step. A run
 * folds unless `open` holds its first step or `selected` is inside it past
 * its first step.
 */
export function skipRuns(
  count: number,
  skipped: (step: number) => boolean,
  selected: number | null,
  open: ReadonlySet<number>,
): Map<number, SkipRun> {
  const runs = new Map<number, SkipRun>();
  for (let i = 0; i < count; i++) {
    if (!skipped(i)) continue;
    const first = i;
    while (i + 1 < count && skipped(i + 1)) i++;
    const inside = selected !== null && selected > first && selected <= i;
    if (i > first) runs.set(first, { last: i, folded: !open.has(first) && !inside });
  }
  return runs;
}

/** The steps that the arrow keys select, in order. A folded run counts as its first step. */
export function keyOptions(count: number, runs: ReadonlyMap<number, SkipRun>): number[] {
  const options: number[] = [];
  for (let i = 0; i < count; i++) {
    options.push(i);
    const run = runs.get(i);
    if (run?.folded) i = run.last;
  }
  return options;
}
