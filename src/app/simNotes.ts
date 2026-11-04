import { useMemo } from "react";
import type { NoteNames } from "../rules/index.ts";
import { useEntities, useGameData } from "./context.ts";
import { useRoute } from "./preview/route.ts";

export function useNoteNames(): NoteNames {
  const data = useGameData();
  const entities = useEntities();
  const route = useRoute();
  return useMemo(
    () => ({
      npc: (id) => entities?.lookup("npc", id)?.name ?? `NPC #${id}`,
      item: (id) => entities?.lookup("item", id)?.name ?? `item #${id}`,
      quest: (id) => data?.quest(id)?.name ?? `quest #${id}`,
      guide: (source) => route?.names[source] ?? "(no #name)",
      objective: (ref) => data?.quest(ref.questId)?.objectives[ref.row]?.name ?? data?.quest(ref.questId)?.name ?? `quest #${ref.questId}`,
    }),
    [entities, data, route],
  );
}
