import type { RoutePlan } from "../routing/plan.ts";
import { fail, fields, list, readPlanParts } from "../routing/records.ts";
import { done, openDb, result, ROUTE_PLANS } from "./db.ts";

function readSavedPlan(value: unknown, path: string): RoutePlan {
  const root = fields(value, path, ["id", "stops", "legs", "settings"]);
  if (typeof root.id !== "string") fail(`${path}.id`, "expected a string");
  return { id: root.id, ...readPlanParts(root, path, Infinity) };
}

/** The saved plans in ID order. Throws at the first record that is not a plan. */
export async function loadPlans(): Promise<RoutePlan[]> {
  const db = await openDb();
  const plans: unknown = await result(db.transaction(ROUTE_PLANS, "readonly").objectStore(ROUTE_PLANS).getAll());
  return list(plans, "route plans", Infinity).map((plan, i) => readSavedPlan(plan, `route plans[${i}]`));
}

/**
 * Saves only the fields of `plan`, and replaces a saved plan with the same ID. Throws for a plan that `loadPlans`
 * could not read, so every saved plan loads.
 */
export async function savePlan(plan: RoutePlan): Promise<void> {
  const record = readSavedPlan(plan, "route plan");
  const db = await openDb();
  const tx = db.transaction(ROUTE_PLANS, "readwrite");
  tx.objectStore(ROUTE_PLANS).put(record);
  await done(tx);
}

export async function deletePlan(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(ROUTE_PLANS, "readwrite");
  tx.objectStore(ROUTE_PLANS).delete(id);
  await done(tx);
}
