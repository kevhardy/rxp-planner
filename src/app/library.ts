import { getLines, setTagValue, updateLine, type GuideDocument, type GuideRecord } from "../guide/index.ts";
import { describeReason, guideStatus, previewDoc, readHeader, type Profile } from "../rules/index.ts";
import { builtinIndex, guideKey, guideMeta, nextItems, resolvedGroup, type NextTarget } from "../rules/registration.ts";

export interface LibraryGroup {
  name: string;
  guides: GuideRecord[];
}

/**
 * Groups guides by first appearance, and orders each group's guides so every
 * guide comes after the guides whose `#next` lines lead to it. Guides that
 * share a `#name` go together, in import order, where the first of them
 * would go. Among names that are free to go next, import order wins. When a
 * cycle leaves no name free, the earliest imported one left goes next.
 */
export function libraryGroups(guides: Iterable<GuideRecord>): LibraryGroup[] {
  const byGroup = new Map<string, GuideRecord[]>();
  for (const guide of [...guides].sort((a, b) => a.order - b.order)) {
    const group = guideMeta(guide).group;
    byGroup.set(group, [...(byGroup.get(group) ?? []), guide]);
  }
  return [...byGroup].map(([name, members]) => ({ name, guides: chainOrder(name, members) }));
}

function chainOrder(group: string, guides: GuideRecord[]): GuideRecord[] {
  const byName = new Map<string, GuideRecord[]>();
  for (const g of guides) {
    const name = guideMeta(g).name;
    byName.set(name, [...(byName.get(name) ?? []), g]);
  }
  const successors = new Map(
    [...byName].map(([name, copies]) => {
      const local = copies.flatMap((g) => guideMeta(g).next).filter((t) => t.group === group && t.name !== name);
      return [name, new Set(local.map((t) => t.name).filter((n) => byName.has(n)))];
    }),
  );
  const incoming = new Map([...byName.keys()].map((name) => [name, 0]));
  for (const next of successors.values()) for (const s of next) incoming.set(s, incoming.get(s)! + 1);

  const out: GuideRecord[] = [];
  const left = new Set(byName.keys());
  while (left.size > 0) {
    let pick = [...left].find((name) => incoming.get(name) === 0);
    pick ??= left.values().next().value!;
    left.delete(pick);
    out.push(...byName.get(pick)!);
    for (const s of successors.get(pick)!) incoming.set(s, incoming.get(s)! - 1);
  }
  return out;
}

/**
 * Tells apart guides that share a `#name` in a group's `guides`: maps each
 * such guide to its place among them by import order, such as `copy 2 of 3`.
 * Guides with a name of their own have no entry.
 */
export function copyLabels(guides: readonly GuideRecord[]): Map<GuideRecord, string> {
  const byName = new Map<string, GuideRecord[]>();
  for (const g of [...guides].sort((a, b) => a.order - b.order)) {
    const name = guideMeta(g).name;
    byName.set(name, [...(byName.get(name) ?? []), g]);
  }
  const labels = new Map<GuideRecord, string>();
  for (const copies of byName.values()) {
    if (copies.length < 2) continue;
    copies.forEach((g, i) => labels.set(g, `copy ${i + 1} of ${copies.length}`));
  }
  return labels;
}

export function orderedGuides(guides: Iterable<GuideRecord>): GuideRecord[] {
  return libraryGroups(guides).flatMap((g) => g.guides);
}

export interface BuiltinEntry {
  guide: GuideRecord;
  name: string;
  /** Why RXP's guide menu leaves the guide out for the character. */
  reason?: string;
}

export interface BuiltinGroup {
  name: string;
  /** Guides without a `#subgroup` come first, under the name "". */
  subgroups: { name: string; guides: BuiltinEntry[] }[];
}

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The built-in guides for the character `profileFor` gives each, as RXP's
 * guide menu files them: under the `#group` and `#subgroup` that apply,
 * groups and subgroups by name (built-ins set no weights), and guides in
 * `#next` order. Where built-ins share a group and name, only the one RXP
 * keeps is listed. Guides that the menu leaves out, such as `#internal`
 * ones, are listed only with `all`.
 */
export function builtinTree(
  builtins: ReadonlyMap<string, GuideRecord>,
  profileFor: (guide: GuideRecord) => Profile,
  all: boolean,
): BuiltinGroup[] {
  const { kept } = builtinIndex(builtins.values());
  const groups = new Map<string, Map<string, BuiltinEntry[]>>();
  for (const guide of orderedGuides(builtins.values())) {
    const meta = guideMeta(guide);
    if (kept.get(guideKey(meta)) !== guide) continue;
    const profile = profileFor(guide);
    const header = readHeader(previewDoc(guide), profile);
    const { hidden, inactive } = guideStatus(header, profile);
    const why = hidden ?? inactive;
    if (why && !all) continue;
    const group = resolvedGroup(guide, profile);
    const subgroup = header.tags.get("subgroup")?.value.trim() ?? "";
    const subgroups = groups.get(group) ?? groups.set(group, new Map()).get(group)!;
    const entries = subgroups.get(subgroup) ?? subgroups.set(subgroup, []).get(subgroup)!;
    const entry: BuiltinEntry = { guide, name: meta.name };
    if (why) entry.reason = describeReason(why, profile);
    entries.push(entry);
  }
  return [...groups]
    .map(([name, subgroups]) => ({ name, subgroups: [...subgroups].map(([name, guides]) => ({ name, guides })).sort(byName) }))
    .sort(byName);
}

/**
 * Rewrites `#next` items. `map` receives each item's target, read as
 * `nextItems` does, and returns a new target, or undefined to keep it.
 * `group` is the guide's group now and `newGroup` its group after the change,
 * so items are qualified only where needed. Unchanged items and lines keep
 * their text.
 */
export function mapNext(
  doc: GuideDocument,
  group: string,
  newGroup: string,
  map: (target: NextTarget) => NextTarget | undefined,
): GuideDocument {
  let next = doc;
  getLines(doc, null).forEach((line, index) => {
    if (line.kind !== "tag" || line.name !== "next") return;
    let writeIn = newGroup;
    let changed = false;
    const value = nextItems(line.value, group)
      .map(({ part, item, qualified, target }) => {
        if (!item) return part;
        const to = map(target) ?? target;
        const qualify = qualified || to.group !== writeIn;
        if (qualify) writeIn = to.group;
        if (qualify === qualified && to.group === target.group && to.name === target.name) return part;
        changed = true;
        return part.replace(item, qualify ? `${to.group}\\${to.name}` : to.name);
      })
      .join(";");
    if (changed) next = updateLine(next, { step: null, index }, () => setTagValue(line, value));
  });
  return next;
}
