import { useMemo } from "react";
import { previewRoute, type GuidePreview, type GuideSimulation, type Profile } from "../../rules/index.ts";
import { useEditor } from "../context.ts";
import { useRoute, useSimData } from "./route.ts";
import { previewDoc } from "../../rules/index.ts";
import { profileOf, usePreviewSettings } from "./settings.ts";
import { guideMeta } from "../../rules/registration.ts";

export interface StepFilter {
  guide: GuidePreview;
  profile: Profile;
  stepProfiles: readonly Profile[];
  showAll: boolean;
  simulation?: GuideSimulation;
}

export function useStepFilter(): StepFilter | null {
  const { current } = useEditor();
  const record = current?.record;
  const doc = current?.doc;
  const settings = usePreviewSettings();
  const sim = useSimData(settings);
  const route = useRoute(sim !== undefined);
  return useMemo(() => {
    if (!record || !doc) return null;
    const base = profileOf(settings, guideMeta(record).range);
    const simulation = route?.simulation?.guides.find((g) => g.source === route.open);
    if (simulation) {
      const profiles = new Map<number, Profile>();
      const at = (level: number) => {
        let profile = profiles.get(level);
        if (!profile) profiles.set(level, (profile = { ...base, level }));
        return profile;
      };
      const { steps } = simulation;
      return {
        guide: simulation.preview,
        profile: at(simulation.start.level),
        stepProfiles: steps.map((step) => at(step.before.level)),
        showAll: settings.showAll,
        simulation,
      };
    }
    const guide = previewRoute([previewDoc(record, doc)], 0, base, false).guides[0]!;
    return { guide, profile: base, stepProfiles: guide.steps.map(() => base), showAll: settings.showAll };
  }, [record, doc, route, settings]);
}
