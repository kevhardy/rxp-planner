// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { DEFAULT_LEG } from "../../routing/plan.ts";
import { saveSetting } from "../../storage/index.ts";
import { loadNewLegs } from "./newLegs.tsx";

it.each([
  ["nothing", undefined, DEFAULT_LEG],
  ["null", null, DEFAULT_LEG],
  ["a string", "x", DEFAULT_LEG],
  ["a list", [true], DEFAULT_LEG],
  ["a partial object", { downhill: "yes", hazards: true, extra: true }, { ...DEFAULT_LEG, hazards: true }],
])("keeps only the boolean leg fields of %s", async (_, saved, expected) => {
  await saveSetting("route-new-legs", saved);
  expect(await loadNewLegs()).toStrictEqual(expected);
});
