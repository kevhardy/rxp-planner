// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { worldMap } from "../../data/terrainFixture.ts";
import { fixture } from "../../data/manifestFixture.ts";
import type { LoadedWorldMap } from "../../data/worldMap.ts";
import { TerrainScene } from "./TerrainScene.tsx";

const frame = { left: 0, top: 0, width: 100, height: 100 };
afterEach(cleanup);

it("never renders unchecked tile URLs when the display capability is absent", async () => {
  const failed = vi.fn();
  const map: LoadedWorldMap = { ...fixture().terrain, tileBase: "/unchecked/" };
  const view = render(<TerrainScene map={map} frame={frame} pxPerPercent={1} attempt={0} onTileError={failed} />);
  await act(async () => {});
  expect(view.container.querySelectorAll("img")).toHaveLength(0);
  expect(failed).toHaveBeenCalledTimes(3);
  view.rerender(
    <TerrainScene map={{ ...map, tile: async () => "blob:checked" }} frame={frame} pxPerPercent={1} attempt={0} onTileError={failed} />,
  );
  await act(async () => {});
  expect([...view.container.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
    "blob:checked",
    "blob:checked",
    "blob:checked",
  ]);
});

it("discards old tile completions after map replacement and unmount", async () => {
  const pending: { resolve: (url: string) => void; reject: (error: Error) => void }[] = [];
  const failed = vi.fn();
  const map: LoadedWorldMap = {
    ...fixture().terrain,
    tileBase: "/same-base/",
    tile: () => new Promise<string>((resolve, reject) => pending.push({ resolve, reject })),
  };
  const view = render(<TerrainScene map={map} frame={frame} pxPerPercent={1} attempt={0} onTileError={failed} />);
  expect(view.container.querySelectorAll("img")).toHaveLength(0);
  view.rerender(
    <TerrainScene map={{ ...map, tile: async () => "blob:new" }} frame={frame} pxPerPercent={1} attempt={0} onTileError={failed} />,
  );
  await act(async () => {});
  await act(async () => pending.splice(0).forEach(({ resolve }) => resolve("blob:old")));
  expect([...view.container.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(["blob:new", "blob:new", "blob:new"]);
  view.rerender(<TerrainScene map={{ ...map }} frame={frame} pxPerPercent={1} attempt={0} onTileError={failed} />);
  expect(pending).toHaveLength(3);
  view.unmount();
  await act(async () => pending.splice(0).forEach(({ reject }) => reject(new Error("unmounted tile"))));
  expect(failed).not.toHaveBeenCalled();
});

it("keeps pending tile loads across callback changes and reports errors to the current handler", async () => {
  const pending: ((error: Error) => void)[] = [];
  const tile = vi.fn(() => new Promise<string>((_resolve, reject) => pending.push(reject)));
  const map: LoadedWorldMap = { ...fixture().terrain, tileBase: "/checked/", tile };
  const previous = vi.fn();
  const current = vi.fn();
  const view = render(<TerrainScene map={map} frame={frame} pxPerPercent={1} attempt={0} onTileError={previous} />);
  view.rerender(<TerrainScene map={map} frame={frame} pxPerPercent={1} attempt={0} onTileError={current} />);
  expect(tile).toHaveBeenCalledTimes(3);
  await act(async () => pending.splice(0).forEach((reject) => reject(new Error("tile unavailable"))));
  expect(current).toHaveBeenCalledTimes(3);
  expect(previous).not.toHaveBeenCalled();
  expect(view.container.querySelectorAll("img")).toHaveLength(0);
});

it("keeps failed detail tiles hidden after a pan until an explicit retry", async () => {
  let corrupt = true;
  const tile = vi.fn(async (path: string) => {
    if (corrupt && path.includes("/5/")) throw new Error("corrupt tile");
    return `blob:checked/${path}`;
  });
  const map = { ...worldMap, tile };
  const near = { left: 76, top: 59, width: 5, height: 5 };
  const far = { left: 0, top: 0, width: 5, height: 5 };
  const failed = vi.fn();
  const scene = (frame: typeof near, attempt: number) => (
    <TerrainScene map={map} frame={frame} pxPerPercent={70} attempt={attempt} onTileError={failed} />
  );
  const view = render(scene(near, 0));
  await act(async () => {});
  expect(tile.mock.calls.filter(([path]) => path.includes("/5/"))).toHaveLength(3);
  expect(view.container.querySelectorAll('img[src*="/5/"]')).toHaveLength(0);
  view.rerender(scene(far, 0));
  view.rerender(scene(near, 0));
  await act(async () => {});
  expect(tile.mock.calls.filter(([path]) => path.includes("/5/"))).toHaveLength(3);
  expect(view.container.querySelectorAll('img[src*="/5/"]')).toHaveLength(0);
  corrupt = false;
  view.rerender(scene(near, 1));
  await act(async () => {});
  expect(tile.mock.calls.filter(([path]) => path.includes("/5/"))).toHaveLength(6);
  expect(view.container.querySelectorAll('img[src*="/5/"]')).toHaveLength(3);
});
