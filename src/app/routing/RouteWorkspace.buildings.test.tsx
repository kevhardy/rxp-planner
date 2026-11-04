// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Point } from "../../routing/frame.ts";
import type { LegResult } from "../../routing/search.ts";
import {
  A,
  B,
  terrainRoute,
  type Outcome,
  defaultOutcome,
  controlRoute,
  mount,
  plan,
  stop,
  looks,
  popover,
  selectLeg,
  viewAt,
} from "./routeWorkspaceFixture.tsx";

let outcome: Outcome;
beforeEach(() => {
  outcome = defaultOutcome;
});
controlRoute({ outcome: () => outcome });

describe("route workspace", () => {
  describe("stops in buildings", () => {
    const floors = () =>
      [...popover()!.querySelectorAll(".route-floors li")].map((li) => {
        const icon = within(li as HTMLElement).queryByRole("img");
        return icon ? `${icon.getAttribute("aria-label")}: ${li.textContent}` : li.textContent;
      });

    it("shows the floor of a stop and no warning", async () => {
      outcome = (from, to) => ({
        ...terrainRoute([from, to]),
        stops: [{ class: "ground" }, { class: "target", floor: { index: 0, ground: 1, confirmed: true } }],
      });
      const user = await mount(plan(A, B));
      await waitFor(() => expect(looks()).toEqual(["leg-route"]));
      await selectLeg(user, 1);
      expect(floors()).toEqual(["Inside: lower level"]);
      await user.click(stop("Destination"));
      expect(floors()).toEqual(["Inside: lower level"]);
      await user.click(stop("Start"));
      expect(popover()!.querySelector(".route-floors")).toBeNull();
    });

    it("warns on the leg and on the stop when a route meets a stop at its door", async () => {
      outcome = (from, to) => ({
        ...terrainRoute([from, to]),
        stops: [
          { class: "building", floor: "door" },
          { class: "target", floor: "door" },
        ],
      });
      const user = await mount(plan(A, B));
      await waitFor(() => expect(looks()).toEqual(["leg-route"]));
      const start = "Warning: Start inside: floor not known. The route starts at the door.";
      const end = "Warning: Inside: floor not known. The route stops at the door.";
      await selectLeg(user, 1);
      expect(floors()).toEqual([start, end]);
      await user.click(stop("Start"));
      expect(floors()).toEqual([start]);
      await user.click(stop("Destination"));
      expect(floors()).toEqual([end]);
    });

    describe("falls", () => {
      const withFalls = (...heights: number[]) =>
        (outcome = (from, to) => ({ ...terrainRoute([from, to]), falls: heights.map((height, point) => ({ point, height })) }));
      const rows = () =>
        [...popover()!.querySelectorAll(".route-falls li")].map((li) => [...li.children].map((c) => c.textContent).join(" "));
      const list = () => within(popover()!).getByRole("list", { name: "Falls" });
      const info = () => within(popover()!).queryByRole("button", { name: "About falls" });

      it("shows each damaging fall as its height and damage, with one note on how falls are taken", async () => {
        withFalls(32.8, 54.4, 40.9, 64.4, 32.3);
        const user = await mount(plan(A, B));
        await waitFor(() => expect(looks()).toEqual(["leg-route"]));
        await selectLeg(user, 1);
        expect(rows()).toEqual(["32.8 yd ~35% HP", "54.4 yd ~74% HP", "40.9 yd ~49% HP", "64.4 yd ~92% HP", "32.3 yd ~34% HP"]);
        expect(popover()!.textContent).not.toContain("Walk off");
        expect(list().hasAttribute("tabindex")).toBe(false);
        act(() => info()!.focus());
        expect(screen.getByRole("tooltip").textContent).toBe("Assumes walking off, not jumping");
        expect(info()!.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
      });

      it("marks a fatal fall, and lets keyboard users scroll more than five", async () => {
        withFalls(80, 20, 20, 20, 20, 20);
        const user = await mount(plan(A, B));
        await waitFor(() => expect(looks()).toEqual(["leg-route"]));
        await selectLeg(user, 1);
        expect(rows()[0]).toBe("80.0 yd Fatal");
        expect(popover()!.querySelector(".route-falls li .route-error")!.textContent).toBe("Fatal");
        expect(list().getAttribute("tabindex")).toBe("0");
      });

      it("gives more than five falls no focus stop of their own when the card's body clips, since the body then scrolls them", async () => {
        vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
          return this.matches(".map-popover-body") ? 400 : 0;
        });
        withFalls(80, 20, 20, 20, 20, 20);
        const user = await mount(plan(A, B));
        await waitFor(() => expect(looks()).toEqual(["leg-route"]));
        await selectLeg(user, 1);
        expect(list().hasAttribute("tabindex")).toBe(false);
      });

      it("shows a damaging fall in a ride leg's ground part in the step of that part", async () => {
        const dock: Point = [2500, 3000];
        const at = (id: string, point: Point) => ({ id, name: id, map: 0, point });
        const ship = {
          service: "ship-southshore-loop",
          mode: "ship",
          from: at("Menethil Harbor", dock),
          to: at("Southshore Harbor", [3000, 3000] as Point),
        };
        outcome = (from, to) =>
          ({
            kind: "transport",
            parts: [
              { kind: "ground", map: 0, from, to: dock, result: { ...terrainRoute([from, dock]), falls: [{ point: 0, height: 31.5 }] } },
              { kind: "ride", link: { ...ship, requires: { faction: "Alliance" }, seconds: { min: 10, average: 10, max: 10 } } },
              { kind: "ground", map: 0, from: ship.to.point, to, result: terrainRoute([ship.to.point, to]) },
            ],
            seconds: 50,
          }) as unknown as LegResult;
        const user = await mount(plan(A, B));
        await selectLeg(user, 1);
        const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
        expect(steps[0]!.querySelector(".route-note-line")?.textContent).toBe("Fall: 31.5 yd, ~32% HP");
        expect(steps[2]!.querySelector(".route-note-line")).toBeNull();
      });
    });

    it("draws each stored indoor path of a route as a part of its line", async () => {
      const M: Point = [3000, 3000];
      outcome = (from, to) => ({ ...terrainRoute([from, M, to]), paths: [{ kind: "door", start: 1, end: 2 }] });
      await mount(plan(A, B));
      await waitFor(() => expect(looks()).toEqual(["leg-route"]));
      const indoor = [...document.querySelectorAll(".route-lines .leg-indoor")].map((l) => l.getAttribute("points"));
      expect(indoor).toEqual([`${viewAt(M)} ${viewAt(B)}`]);
    });
  });
});
