import { useCallback, useState } from "react";
import { interiorAt } from "../../data/heightMap.ts";
import type { LoadedWorldMap } from "../../data/index.ts";
import type { RouteEditor } from "../../routing/editor.ts";

export type Selected = { stop: number } | { leg: number } | { ride: string } | null;
const sameSelected = (a: Selected, b: Selected) => JSON.stringify(a) === JSON.stringify(b);

export function useSelection(editor: RouteEditor, map: LoadedWorldMap, setInside: (inside: boolean) => void) {
  const [selected, setSelected] = useState<Selected>(null);
  const select = useCallback(
    (next: Selected) => {
      setSelected(next);
      const now = editor.get().history?.plan;
      const stop = next && "stop" in next && now?.stops[next.stop];
      if (stop && stop.height !== null && map.interiors && interiorAt(map.interiors.list, stop)) setInside(true);
    },
    [editor, map, setInside],
  );
  const selectLeg = useCallback((i: number | null) => select(i === null ? null : { leg: i }), [select]);
  const selectRide = useCallback((id: string | null) => select(id === null ? null : { ride: id }), [select]);
  const selectAfterEdit = useCallback((next: Selected) => setSelected((s) => (sameSelected(s, next) ? s : next)), []);
  const dropRide = useCallback(() => setSelected((s) => (s && "ride" in s ? null : s)), []);
  return { selected, select, selectLeg, selectRide, selectAfterEdit, dropRide };
}
