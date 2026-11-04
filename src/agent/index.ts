import { GUIDE_TOOLS } from "./guides.ts";
import { MEASURE_TOOLS } from "./measure.ts";
import { QUEST_TOOLS } from "./quests.ts";
import { STEP_TOOLS } from "./questSteps.ts";
import { rxpReference } from "./reference.ts";
import type { Tool } from "./tool.ts";

export * from "./tool.ts";

/** Every agent tool by name, in the order hosts list them. */
export const TOOLS: ReadonlyMap<string, Tool> = new Map(
  ([rxpReference, ...QUEST_TOOLS, ...STEP_TOOLS, ...GUIDE_TOOLS, ...MEASURE_TOOLS] as Tool[]).map((tool) => [tool.name, tool]),
);
