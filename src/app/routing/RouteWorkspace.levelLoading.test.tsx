// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_SLOPE } from "../../routing/plan.ts";
import { writeRoute } from "../../routing/share.ts";
import { loadPlans, savePlan } from "../../storage/routing.ts";
import {
  A,
  W,
  B,
  pixelsOf,
  heightsOf,
  withHeights,
  lastRouted,
  lastSlope,
  slopeField,
  mount,
  plan,
  client,
  saved,
  choose,
  popover,
  chip,
  fromMenu,
  selectLeg,
  interiorWorkspace,
  waypoint,
  startPin,
  stopEdits,
  results,
  prepareStopEdit,
  rectOf,
} from "./routeWorkspaceFixture.tsx";

describe("route workspace", () => {
  describe("stop edits while levels load", () => {
    const peers = ["remove", "insert", "undo or redo", "swap", "paste route text", "a second stop edit", "route switch"];
    const cases = [
      ...peers.map((peer) => ({ edit: stopEdits[0]!, peer })),
      ...stopEdits.slice(1).map((edit) => ({ edit, peer: "remove" })),
    ];
    it.each(cases)("blocks $peer during $edit", async ({ edit, peer }) => {
      const floors = await interiorWorkspace();
      const first = { ...withHeights(plan(A, W, B), [null, 37, null]), id: "first" };
      const other = { ...withHeights(plan(A, [3100, 3300], B), [null, 42, null]), id: "other" };
      await savePlan(other);
      const user = await mount(first, undefined, undefined, null, floors.map);
      await user.pointer({ keys: "[MouseRight]", target: startPin() });
      await choose(user, "Swap to destination");
      await user.pointer({ keys: "[MouseRight]", target: startPin() });
      await choose(user, "Swap to destination");
      const apply = await prepareStopEdit(user, edit);
      apply();
      expect(chip()).toBe("Loading the levels of The Deadmines…");
      expect(screen.getByRole("combobox", { name: "Route plan" }).matches(":disabled")).toBe(true);
      if (edit === "drag drop") expect(waypoint().getAttribute("aria-label")).toBe("Waypoint 1 at world yards 1362.50, 2858.33");
      if (peer === "remove") {
        await user.pointer({ keys: "[MouseRight]", target: waypoint() });
        await choose(user, "Remove");
      } else if (peer === "insert") {
        await user.click(startPin());
        await user.click(within(popover()!).getByRole("button", { name: "Add stop after the start…" }));
        expect(screen.queryByRole("dialog")).toBeNull();
      } else if (peer === "undo or redo") {
        await user.click(screen.getByRole("button", { name: "Undo" }));
      } else if (peer === "swap") {
        await user.pointer({ keys: "[MouseRight]", target: startPin() });
        await choose(user, "Swap to destination");
      } else if (peer === "paste route text") {
        await user.click(screen.getByRole("button", { name: "Route" }));
        expect(screen.queryByRole("button", { name: "Import route text…" })).toBeNull();
        expect(screen.queryByRole("dialog")).toBeNull();
      } else if (peer === "a second stop edit") {
        await user.pointer({ keys: "[MouseRight]", target: waypoint() });
        await choose(user, "Edit coordinates…");
        expect(screen.queryByRole("dialog")).toBeNull();
      } else {
        fireEvent.change(screen.getByRole("combobox", { name: "Route plan" }), { target: { value: "other" } });
      }
      expect([pixelsOf(lastRouted()), heightsOf(lastRouted())]).toEqual([
        [
          [2000, 3000],
          [3000, 3400],
          [4000, 3000],
        ],
        [null, 37, null],
      ]);
      await act(() => floors.release());
      await waitFor(() => expect({ stops: pixelsOf(lastRouted()), heights: heightsOf(lastRouted()) }).toEqual(results[edit]));
      await waitFor(async () => {
        const stored = await loadPlans();
        const [other, first] = ["other", "first"].map((id) => stored.find((p) => p.id === id)!);
        expect(pixelsOf(other!)).toEqual([
          [2000, 3000],
          [3100, 3300],
          [4000, 3000],
        ]);
        expect(heightsOf(other!)).toEqual([null, 42, null]);
        expect({ stops: pixelsOf(first!), heights: heightsOf(first!) }).toEqual(results[edit]);
      });
      if (peer !== "remove") return;
      expect(screen.getByRole("combobox", { name: "Route plan" }).matches(":disabled")).toBe(false);
      await user.selectOptions(screen.getByRole("combobox", { name: "Route plan" }), "other");
      await waitFor(() =>
        expect([lastRouted().id, pixelsOf(lastRouted()), heightsOf(lastRouted())]).toEqual([
          "other",
          [
            [2000, 3000],
            [3100, 3300],
            [4000, 3000],
          ],
          [null, 42, null],
        ]),
      );
      await user.pointer({ keys: "[MouseRight]", target: startPin() });
      await choose(user, "Swap to destination");
      await waitFor(() =>
        expect([pixelsOf(lastRouted()), heightsOf(lastRouted())]).toEqual([
          [
            [4000, 3000],
            [3100, 3300],
            [2000, 3000],
          ],
          [null, 42, null],
        ]),
      );
    });

    it("refuses retained controls and a second drag in the same tick as the block", async () => {
      const floors = await interiorWorkspace();
      const other = { ...withHeights(plan(A, [3100, 3300], B), [null, 42, null]), id: "other" };
      await savePlan(other);
      const user = await mount({ ...withHeights(plan(A, W, B), [null, 37, null]), id: "first" }, undefined, undefined, null, floors.map);
      await user.pointer({ keys: "[MouseRight]", target: startPin() });
      await choose(user, "Swap to destination");
      await user.pointer({ keys: "[MouseRight]", target: startPin() });
      await choose(user, "Swap to destination");
      await user.pointer({ keys: "[MouseRight]", target: waypoint() });
      const remove = screen.getByRole("menuitem", { name: "Remove" });
      const routes = screen.getByRole("combobox", { name: "Route plan" });
      const undo = screen.getByRole("button", { name: "Undo" });
      const pin = waypoint();
      act(() => {
        fireEvent.pointerDown(pin, { button: 0, ...client(W) });
        fireEvent.pointerMove(pin, client([3300, 3400]));
        fireEvent.pointerUp(pin, client([3300, 3400]));
        fireEvent.click(remove);
        fireEvent.change(routes, { target: { value: "other" } });
        fireEvent.click(undo);
        fireEvent.pointerDown(pin, { button: 0, ...client(W) });
        fireEvent.pointerMove(pin, client([3500, 3400]));
        fireEvent.pointerUp(pin, client([3500, 3400]));
      });
      expect([pixelsOf(lastRouted()), heightsOf(lastRouted())]).toEqual([
        [
          [2000, 3000],
          [3000, 3400],
          [4000, 3000],
        ],
        [null, 37, null],
      ]);
      expect(chip()).toBe("Loading the levels of The Deadmines…");
      await user.click(screen.getByRole("button", { name: "Route" }));
      expect(screen.queryByRole("button", { name: "New route" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Delete route…" })).toBeNull();
      const slope = slopeField();
      fireEvent.change(slope, { target: { value: "42" } });
      fireEvent.blur(slope);
      fireEvent.change(screen.getByRole("combobox", { name: "Mode" }), { target: { value: "Mount" } });
      await selectLeg(user, 1);
      const follow = within(popover()!).getByRole("checkbox", { name: "Follow terrain" });
      expect(follow).toHaveProperty("disabled", true);
      fireEvent.click(follow);
      await act(() => floors.release());
      await waitFor(() =>
        expect([pixelsOf(lastRouted()), heightsOf(lastRouted()), lastRouted().legs.map((l) => l.followTerrain), lastSlope()]).toEqual([
          [
            [2000, 3000],
            [3300, 3400],
            [4000, 3000],
          ],
          [null, 36.875, null],
          [true, true],
          DEFAULT_MAX_SLOPE,
        ]),
      );
      expect(screen.getByRole("combobox", { name: "Route plan" })).toHaveProperty("value", "first");
      expect(screen.getByRole("combobox", { name: "Mode" })).toHaveProperty("value", "Run");
    });

    it.each(stopEdits)("applies %s in the same event when its maps are in memory", async (edit) => {
      const floors = await interiorWorkspace(true);
      const user = await mount(withHeights(plan(A, W, B), [null, 37, null]), undefined, undefined, null, floors.map);
      const apply = await prepareStopEdit(user, edit);
      apply();
      expect({ stops: pixelsOf(lastRouted()), heights: heightsOf(lastRouted()) }).toEqual(results[edit]);
    });

    it.each(["new stop", "drag drop"] as const)("cancels %s after a failed height read and accepts the next edit", async (edit) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const floors = await interiorWorkspace();
      const user = await mount(withHeights(plan(A, W, B), [null, 37, null]), undefined, undefined, null, floors.map);
      const apply = await prepareStopEdit(user, edit);
      apply();
      await act(() => floors.release(new Error("Invalid height map checksum")));
      expect(screen.getByText("Invalid height map checksum").textContent).toBe("Invalid height map checksum");
      expect([pixelsOf(lastRouted()), heightsOf(lastRouted())]).toEqual([
        [
          [2000, 3000],
          [3000, 3400],
          [4000, 3000],
        ],
        [null, 37, null],
      ]);
      expect(waypoint().getAttribute("aria-label")).toMatch(/at world yards 1675.00, 2858.33$/);
      await user.pointer({ keys: "[MouseRight]", target: waypoint() });
      await choose(user, "Remove");
      await waitFor(() =>
        expect([pixelsOf(lastRouted()), heightsOf(lastRouted())]).toEqual([
          [
            [2000, 3000],
            [4000, 3000],
          ],
          [null, null],
        ]),
      );
      await waitFor(async () =>
        expect([pixelsOf(await saved()), heightsOf(await saved())]).toEqual([
          [
            [2000, 3000],
            [4000, 3000],
          ],
          [null, null],
        ]),
      );
    });

    it("loads the levels of an interior once an opened route has a stop in it, and none before", async () => {
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
        return this.matches(".map-viewport") ? DOMRect.fromRect({ width: 200, height: 200 }) : rectOf(this);
      });
      const floors = await interiorWorkspace();
      const user = await mount(plan(A, B), undefined, undefined, null, floors.map);
      expect(floors.read.mock.calls.map(([interior]) => interior.id)).toEqual([]);
      expect([pixelsOf(lastRouted()), heightsOf(lastRouted())]).toEqual([
        [
          [2000, 3000],
          [4000, 3000],
        ],
        [null, null],
      ]);
      await fromMenu(user, "Import route text…");
      fireEvent.change(screen.getByRole("textbox", { name: "Route text" }), {
        target: {
          value: writeRoute(plan(A, W, B), {
            artifacts: {},
            maxSlope: DEFAULT_MAX_SLOPE,
            results: [{ status: "calculating" }, { status: "calculating" }],
          }),
        },
      });
      await user.click(screen.getByRole("button", { name: "Import" }));
      await waitFor(() => expect(floors.read.mock.calls.map(([interior]) => interior.id)).toEqual(["the-deadmines-35530"]));
      expect([pixelsOf(lastRouted()), heightsOf(lastRouted())]).toEqual([
        [
          [2000, 3000],
          [3000, 3400],
          [4000, 3000],
        ],
        [null, null, null],
      ]);
      await act(() => floors.release());
    });
  });
});
