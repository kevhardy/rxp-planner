import { useCallback } from "react";
import type { RouteEditor } from "../../routing/editor.ts";
import type { Leg } from "../../routing/plan.ts";
import type { LayerChoices } from "./MapLayers.tsx";
import { useRouteSettings, useRouteSettingsStore } from "./settings.ts";

export function useRouteChoices(editor: RouteEditor) {
  const store = useRouteSettingsStore();
  const { maxSlope, newLegs, mode: modeName, layers } = useRouteSettings();
  const changeSlope = useCallback(
    (slope: number) => {
      if (!editor.busy) store.set("maxSlope", slope);
    },
    [editor, store],
  );
  const changeMode = useCallback(
    (mode: string) => {
      if (!editor.busy) store.set("mode", mode);
    },
    [editor, store],
  );
  const changeNewLegs = (leg: Leg) => store.set("newLegs", leg);
  const changeLayers = (choices: LayerChoices) => store.set("layers", choices);
  return { maxSlope, changeSlope, newLegs, changeNewLegs, modeName, changeMode, layers, changeLayers };
}
