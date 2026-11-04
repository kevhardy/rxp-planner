// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { DEFAULT_LEG, DEFAULT_MAX_SLOPE, setLeg } from "../../routing/plan.ts";
import { writeRoute } from "../../routing/share.ts";
import { loadPlans } from "../../storage/routing.ts";
import { saveNewLegs } from "./newLegs.tsx";
import {
  manifest,
  A,
  W,
  B,
  world,
  route,
  lastRouted,
  mount,
  plan,
  looks,
  type User,
  fromMenu,
  savedStores,
} from "./routeWorkspaceFixture.tsx";

describe("route text", () => {
  const routeText = () => within(screen.getByRole("dialog")).getByRole<HTMLTextAreaElement>("textbox", { name: "Route text" });
  const importText = async (user: User, text: string) => {
    await user.click(routeText());
    if (text) await user.paste(text);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Import" }));
  };

  it("copies a route with its results, and imports the text as a new route that routes the same legs", async () => {
    saveNewLegs({ ...DEFAULT_LEG, otherFaction: true });
    onTestFinished(() => saveNewLegs(DEFAULT_LEG));
    const original = setLeg(plan(A, W, B), 1, { followTerrain: false });
    const user = await mount(original, undefined, await savedStores());
    await waitFor(() => expect(looks()).toEqual(["leg-route", "leg-straight"]));
    await fromMenu(user, "Copy route as text");
    await screen.findByText("Copied the route as text");
    const text = await navigator.clipboard.readText();
    const { context } = JSON.parse(text);
    expect(context).toMatchObject({ artifacts: { 0: manifest.id }, maxSlope: DEFAULT_MAX_SLOPE, mode: "Run" });
    expect(context.results.map((r: { status: string }) => r.status)).toEqual(["route", "straight"]);

    await fromMenu(user, "Import route text…");
    await importText(user, text);
    await waitFor(() => expect(lastRouted().id).not.toBe(original.id));
    const imported = lastRouted();
    expect(imported).toEqual({ ...original, id: imported.id });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Route plan" })).toHaveProperty("value", imported.id);
    await waitFor(() => expect(looks()).toEqual(["leg-route", "leg-straight"]));
    await waitFor(async () => expect(await loadPlans()).toEqual([original, imported]));
  });

  it("shows why text does not import, and adds no route", async () => {
    const user = await mount(plan(A, B));
    const calls = route.mock.calls.length;
    await fromMenu(user, "Import route text…");
    await importText(user, "");
    expect(screen.getByRole("alert").textContent).toBe("Paste the text of a copied route.");
    await importText(user, '{"format":"restedxp-route","version":1}');
    expect(screen.getByRole("alert").textContent).toBe(
      "route.version: this planner no longer reads version 1 route text. It reads version 3",
    );
    expect(routeText().getAttribute("aria-invalid")).toBe("true");
    expect(routeText().getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    const offMap = JSON.parse(writeRoute(plan(A, B), { artifacts: {}, maxSlope: DEFAULT_MAX_SLOPE, results: [{ status: "calculating" }] }));
    offMap.stops[1] = { instance: 0, x: 1000000, y: -1000000, height: null };
    fireEvent.change(routeText(), { target: { value: JSON.stringify(offMap) } });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Import" }));
    expect(screen.getByRole("alert").textContent).toBe("1000000.00, -1000000.00 on map 0 is outside the routing area.");

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(within(screen.getByRole("combobox", { name: "Route plan" })).getAllByRole("option")).toHaveLength(1);
    expect(await loadPlans()).toHaveLength(1);
    expect(route).toHaveBeenCalledTimes(calls);
  });

  it("shows the text to copy by hand when the clipboard fails", async () => {
    const user = await mount(plan(A, B));
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Write permission denied."));
    await fromMenu(user, "Copy route as text");
    await screen.findByRole("dialog", { name: "Copy route text" });
    expect(JSON.parse(routeText().value).stops).toEqual([world(A), world(B)]);
  });
});
