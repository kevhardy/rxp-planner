import {
  cropKey,
  guideIconCell,
  guideIconSheetSize,
  type GuideIconKey,
  type GuideIconsFile,
  type TextureKey,
} from "../../packages/data-contract/guideIcons.ts";

export interface GuideIconEntry {
  id: number;
  path: string;
  name: string;
  category: string;
  cell: { x: number; y: number; width: number; height: number };
}

export interface GuideIconCatalog {
  readonly all: readonly GuideIconEntry[];
  readonly categories: readonly string[];
  readonly sheet: { width: number; height: number };
  get(key: GuideIconKey | undefined): GuideIconEntry | undefined;
  iconNames(...names: ReadonlyMap<TextureKey, readonly string[]>[]): Map<GuideIconEntry, string[]>;
  search(query: string, names?: ReadonlyMap<GuideIconEntry, readonly string[]>): GuideIconEntry[];
}

export function guideIconCatalog(file: GuideIconsFile | undefined): GuideIconCatalog {
  const rows = file?.icons ?? [];
  const byKey = new Map<string, GuideIconEntry>();
  const all = rows
    .flatMap(({ fileDataId: id, path, crop }, i): GuideIconEntry[] => {
      const base = path.slice(path.lastIndexOf("/") + 1);
      const under = base.indexOf("_");
      const entry = {
        id,
        path,
        name: base.replace(/[_-]/g, " "),
        category: under > 0 ? base.slice(0, under) : "other",
        cell: guideIconCell(i, file!.columns),
      };
      if (crop) {
        byKey.set(cropKey(id, crop)!, entry);
        return [];
      }
      byKey.set(String(id), entry).set(path, entry);
      return [entry];
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id));
  const haystacks = new Map(all.map((entry) => [entry, `${entry.name} ${entry.path} ${entry.id}`]));
  return {
    all,
    categories: [...new Set(all.map((entry) => entry.category))].sort(),
    sheet: file ? guideIconSheetSize(rows.length, file.columns) : { width: 0, height: 0 },
    get: (key) => (key === undefined ? undefined : byKey.get(key)),
    iconNames: (...names) => {
      const byIcon = new Map<GuideIconEntry, Set<string>>();
      for (const [key, list] of names.flatMap((map) => [...map])) {
        const entry = byKey.get(key);
        if (entry) byIcon.set(entry, new Set([...(byIcon.get(entry) ?? []), ...list]));
      }
      return new Map([...byIcon].map(([entry, set]) => [entry, [...set]]));
    },
    search: (query, names) => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      return all.filter((entry) => {
        const haystack = `${haystacks.get(entry)!} ${names?.get(entry)?.join(" ").toLowerCase() ?? ""}`;
        return words.every((word) => haystack.includes(word));
      });
    },
  };
}

export const GUIDE_ICONS_PROPERTY = "--rxp-guide-icons";

export interface GuideIconSheet {
  readonly state: "loading" | "ready" | "failed";
  subscribe(listener: () => void): () => void;
  retry(): void;
}
