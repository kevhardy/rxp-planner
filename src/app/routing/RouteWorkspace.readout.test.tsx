// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { plannerData } from "../../data/plannerFixture.ts";
import type { Point } from "../../routing/frame.ts";
import { mount, mountRoutes, plan, client, mapArea, stop } from "./routeWorkspaceFixture.tsx";

describe("coordinate readout", () => {
  const kharanos: Point = [5092, 11516];
  const thelsamar: Point = [7504, 11324];
  const readout = () =>
    [...document.querySelectorAll(".coord-readout > div")].map((row) =>
      [...row.children]
        .slice(0, row.hasAttribute("data-off-map") ? 2 : undefined)
        .map((c) => [...(c.children.length ? c.children : [c])].flatMap((e) => e.textContent || []).join(" "))
        .join(" | "),
    );
  const NO_CURSOR = "Cursor | —";
  const frames: FrameRequestCallback[] = [];
  const draw = () => act(() => frames.splice(0).forEach((frame) => frame(0)));
  beforeEach(() => {
    frames.length = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => frames.push(frame));
  });

  it("follows the pointer once a frame, hides when it leaves the map, and shows the selected stop above the cursor", async () => {
    const user = await mount(plan(kharanos, thelsamar), undefined, undefined, plannerData());
    const idle = () => document.querySelector(".coord-readout")!.classList.contains("idle");
    expect([idle(), readout()]).toEqual([true, [NO_CURSOR]]);

    fireEvent.pointerMove(mapArea(), client(kharanos));
    fireEvent.pointerMove(mapArea(), client(thelsamar));
    expect(frames).toHaveLength(1);
    expect(readout()).toEqual([NO_CURSOR]);
    draw();
    expect([idle(), readout()]).toEqual([false, ["Cursor | 37.08, 49.38 Loch Modan | 54.02, 54.81 Eastern Kingdoms"]]);
    fireEvent.pointerLeave(mapArea());
    draw();
    expect([idle(), readout()]).toEqual([true, [NO_CURSOR]]);

    await user.click(stop("Start"));
    expect([idle(), readout()]).toEqual([false, ["Start | 46.83, 52.35 Dun Morogh | 46.89, 55.66 Eastern Kingdoms", NO_CURSOR]]);
    await user.keyboard("{Escape}");
    expect([idle(), readout()]).toEqual([true, [NO_CURSOR]]);
  });

  it("cancels a pending readout frame when the readout unmounts", async () => {
    const pending = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => (pending.set(++id, frame), id));
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frame) => pending.delete(frame));
    await mount(plan(kharanos, thelsamar), undefined, undefined, plannerData());
    pending.clear();

    fireEvent.pointerMove(mapArea(), client(kharanos));
    const drawn = [...pending.keys()];
    expect(drawn).toHaveLength(1);
    cleanup();
    expect(drawn.filter((frame) => pending.has(frame))).toEqual([]);
  });

  it("asks for one frame for two pointer moves under StrictMode, which subscribes the readout twice", async () => {
    await mountRoutes({ current: null });
    const map = await screen.findByRole("group", { name: /^Route map/ });
    frames.length = 0;

    fireEvent.pointerMove(map, client(kharanos));
    fireEvent.pointerMove(map, client(thelsamar));
    expect(frames).toHaveLength(1);
  });

  it("keeps the same elements and columns for a short zone name, a long one, and —", async () => {
    await mount(plan(kharanos, thelsamar), undefined, undefined, plannerData());
    const shown: { text: string; cells: string[] }[] = [];
    const show = () => {
      draw();
      const row = document.querySelector(".coord-readout > div:last-child")!;
      shown.push({ text: readout().at(-1)!, cells: [...row.querySelectorAll("*")].map((e) => `${e.tagName} ${e.className}`) });
    };
    fireEvent.pointerMove(mapArea(), client(kharanos));
    show();
    fireEvent.pointerMove(mapArea(), client([5500, 8000]));
    show();
    fireEvent.pointerLeave(mapArea());
    show();

    expect(shown.map((s) => s.text)).toEqual([
      "Cursor | 46.83, 52.35 Dun Morogh | 46.89, 55.66 Eastern Kingdoms",
      expect.stringMatching(/^Cursor \| \d+\.\d\d, \d+\.\d\d Arathi Highlands \| /),
      NO_CURSOR,
    ]);
    const columns = [
      "DT ",
      "DD ",
      "SPAN coord-x",
      "SPAN coord-y",
      "SPAN coord-name",
      "DD ",
      "SPAN coord-x",
      "SPAN coord-y",
      "SPAN coord-name",
    ];
    expect(shown.map((s) => s.cells)).toEqual([columns, columns, columns]);
  });
});
