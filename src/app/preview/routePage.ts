export interface PageInput {
  count: number;
  start: number;
  open: number;
  slots: number;
  first: number;
}

export interface RoutePage {
  shown: number[];
  from: number;
  to: number;
  earlier: number;
  later: number;
  previous?: number;
  next?: number;
}

export const fewestSlots = ({ count, start, open }: Pick<PageInput, "count" | "start" | "open">) =>
  Math.min(count, (start === open ? 1 : 2) + 3);

export function routePage(input: PageInput): RoutePage {
  const { count, start, open } = input;
  const pinned = start === open ? [start] : [start, open];
  const slots = Math.max(input.slots, fewestSlots(input));
  const run = (first: number) => {
    for (let size = Math.min(slots, count); ; size--) {
      const from = Math.max(0, Math.min(first, count - size));
      const to = from + size - 1;
      const earlier = from - pinned.filter((i) => i < from).length;
      const later = count - 1 - to - pinned.filter((i) => i > to).length;
      const cards = size + pinned.filter((i) => i < from || i > to).length;
      if (size <= 1 || cards + Number(earlier > 0) + Number(later > 0) <= slots) return { from, to, earlier, later };
    }
  };
  const { from, to, earlier, later } = run(input.first);
  const shown = [...new Set([...pinned, ...Array.from({ length: to - from + 1 }, (_, i) => from + i)])].sort((a, b) => a - b);
  const before = (reach: number) => {
    for (let first = 0; first < from; first++) if (run(first).to >= reach) return first;
  };
  const previous = earlier > 0 ? (before(from) ?? before(from - 1)) : undefined;
  const next = later > 0 ? (run(to).to > to ? to : to + 1) : undefined;
  return { shown, from, to, earlier, later, ...(previous !== undefined && { previous }), ...(next !== undefined && { next }) };
}

export function pageShowing(input: PageInput, index: number): number {
  let page = routePage(input);
  let { first } = input;
  while (!page.shown.includes(index)) {
    const step = index > page.to ? page.next : page.previous;
    if (step === undefined) break;
    first = step;
    page = routePage({ ...input, first });
  }
  return first;
}
