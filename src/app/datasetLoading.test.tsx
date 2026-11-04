// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { URL as NodeURL } from "node:url";
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as datasetLoader from "../data/dataset.ts";
import { plannerRelease } from "../data/manifestFixture.ts";
import * as storage from "../storage/index.ts";
import { renderApp } from "./renderPlanner.tsx";
import { loadSettings } from "./stores.ts";
import { showLine, undo } from "./testing.ts";

const fetchBlob = globalThis.fetch;
beforeEach(() => {
  vi.spyOn(storage, "startAutosave");
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("URL", NodeURL);
});

afterEach(async () => {
  cleanup();
  for (const result of vi.mocked(storage.startAutosave).mock.results) {
    if (result.type === "return") await result.value.settled();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const stolenBooty = (f: ReturnType<typeof plannerRelease>) => ({
  ...structuredClone(f.quests.quests[0]!),
  id: 888,
  name: "Stolen Booty",
  questLevel: 16,
  baseXp: 1150,
});

it("retries a whole selected artifact and keeps recovered edits and saves", async () => {
  const loads = vi.spyOn(datasetLoader, "fetchDatasetArtifact");
  const f = plannerRelease();
  const requests: { resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
  const fetch = vi.fn((url: string, _init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/fixture/manifest.json") return new Promise<Response>((resolve, reject) => requests.push({ resolve, reject }));
    const bytes = f.files.get(path.slice("/fixture/".length));
    return Promise.resolve(new Response(bytes ?? null, { status: bytes ? 200 : 404 }));
  });
  vi.stubGlobal("fetch", fetch);
  const finish = async (index: number) => {
    await act(async () => {
      requests[index]!.resolve(new Response(JSON.stringify(f.manifest)));
      await Promise.allSettled([loads.mock.results[index]!.value]);
    });
  };
  localStorage.clear();
  const old = await storage.loadLibrary();
  const saved = { id: "saved", text: "#group Test\n#name Saved\nstep\n.xp 5\n", order: 0 };
  await storage.saveLibrary(
    [saved],
    old.guides.map((g) => g.id),
  );
  const recovered = { id: "recovered", text: "#group Test\n#name Recovered\nstep\n.xp 10\n.accept 887\n", order: 1 };
  localStorage.setItem(
    "restedxp-planner:unsaved",
    JSON.stringify({ put: [recovered], remove: [], session: { guideId: "recovered", step: 0, line: null } }),
  );
  const initial = await storage.loadLibrary();
  renderApp({ initial, settings: await loadSettings(), dataset: { manifest: "/fixture/manifest.json", base: "/fixture/" } });
  const user = userEvent.setup();
  const step = document.getElementById("step-0");
  const sticky = () => screen.getByRole("checkbox", { name: "Sticky" });
  const openTab = (name: string) => user.click(screen.getByRole("tab", { name }));
  await user.click(screen.getByRole("button", { name: "Warnings" }));
  const warnings = within(screen.getByRole("region", { name: "Warnings" }));
  await user.keyboard("{Escape}");
  const questId = () => screen.getByRole("combobox", { name: "questId" });
  expect(screen.getAllByText("Loading game data…")).toHaveLength(2);
  expect(warnings.getByText("Loading quest data…")).toBeTruthy();
  await showLine(user, 2);
  await user.click(questId());
  await user.keyboard("{ArrowDown}");
  expect(screen.getAllByText("Loading quest data…")).toHaveLength(2);
  await openTab("Step settings");
  // Hold the autosave until unload, so the edit stays unsaved however slow the run. Fake timers start only now
  // because user-event hangs on fake timers outside Jest.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.click(sticky());
  await act(async () => requests[0]!.reject(new Error("offline fixture")));
  expect(screen.getByRole("alert").textContent).toMatch(/offline fixture/);
  expect(screen.getAllByText("Game data unavailable.")).toHaveLength(2);
  expect(screen.queryByText("Loading game data…")).toBeNull();
  expect.soft(warnings.queryByText("Quest data unavailable.")).not.toBeNull();
  expect(sticky()).toHaveProperty("checked", true);
  act(() => {
    window.dispatchEvent(new Event("beforeunload"));
  });
  const tabKey = Object.keys(localStorage).find((key) => key.startsWith("restedxp-planner:unsaved:tab:"));
  expect(JSON.parse(localStorage.getItem(tabKey!)!).put[0].text).toContain("#sticky");
  act(() => void vi.runOnlyPendingTimers());
  vi.useRealTimers();
  await openTab("Lines");
  await user.click(questId());
  await user.keyboard("{ArrowDown}");
  expect(screen.getByText("Quest data unavailable. Enter an ID.")).toBeTruthy();
  expect(screen.queryByText("Loading quest data…")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry dataset" }));
  expect(screen.getAllByText("Loading game data…")).toHaveLength(2);
  expect(screen.queryByText("Game data unavailable.")).toBeNull();
  expect(warnings.getByText("Loading quest data…")).toBeTruthy();
  await user.click(questId());
  await user.keyboard("{ArrowDown}");
  expect(screen.getAllByText("Loading quest data…")).toHaveLength(2);
  expect(screen.queryByText("Quest data unavailable. Enter an ID.")).toBeNull();
  const core = "quests.json";
  const originalCore = f.files.get(core)!;
  f.files.set(core, new Uint8Array(originalCore.length));
  await finish(1);
  expect(screen.getByRole("alert").textContent).toMatch(/checksum/);
  expect(screen.getAllByText("Game data unavailable.")).toHaveLength(2);
  expect(warnings.getByText("Quest data unavailable.")).toBeTruthy();
  expect(screen.getByText("Quest data unavailable. Enter an ID.")).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Map shown" })).toBeNull();
  await openTab("Step settings");
  expect(sticky()).toHaveProperty("checked", true);
  f.files.set(core, originalCore);
  f.quests.quests.push(stolenBooty(f));
  f.replace("quests.json", f.quests);
  await user.click(screen.getByRole("button", { name: "Retry dataset" }));
  await finish(2);
  expect(screen.queryByText("Game data unavailable.")).toBeNull();
  expect(screen.queryByText("Loading game data…")).toBeNull();
  expect(warnings.queryByText("Quest data unavailable.")).toBeNull();
  await openTab("Lines");
  await user.click(questId());
  await user.keyboard("{ArrowDown}");
  expect(screen.queryByText("Loading quest data…")).toBeNull();
  expect(screen.queryByText("Quest data unavailable. Enter an ID.")).toBeNull();
  expect(within(screen.getByRole("listbox", { name: "questId" })).getByRole("option", { name: /Southsea Freebooters/ })).toBeTruthy();
  const search = () => screen.getByRole("searchbox", { name: "Search quests, NPCs, items, and places" });
  await user.click(screen.getByRole("button", { name: "Search" }));
  await user.type(search(), "booty");
  expect(await within(screen.getByRole("region", { name: "Search" })).findByRole("button", { name: /Stolen Booty/ })).toBeTruthy();
  await waitFor(() => expect(document.querySelector<HTMLImageElement>("img.tile")?.src).toMatch(/^blob:/));
  const renderedTile = document.querySelector<HTMLImageElement>("img.tile")!;
  const original = f.files.get("world/tiles/kalimdor/2/1/1.webp")!;
  expect(renderedTile.src).toMatch(/^blob:/);
  expect(new Uint8Array(await (await fetchBlob(renderedTile.src)).arrayBuffer())).toEqual(original);
  const markerIcon = [...document.querySelectorAll<HTMLElement>(".map-icon")].find((icon) =>
    icon.style.getPropertyValue("--image").includes("blob:"),
  );
  const iconUrl = /url\("(.*)"\)/.exec(markerIcon!.style.getPropertyValue("--image"))![1]!;
  expect(new Uint8Array(await (await fetchBlob(iconUrl)).arrayBuffer())).toEqual(f.files.get("art/map.webp"));
  expect([markerIcon!.style.getPropertyValue("--image-x"), markerIcon!.style.getPropertyValue("--image-y")]).toEqual(["-18px", "-36px"]);
  const previousTile = renderedTile.src;
  fireEvent.error(renderedTile);
  await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
  await user.click(screen.getByRole("button", { name: "Search" }));
  expect(search()).toHaveProperty("value", "booty");
  await waitFor(() => expect(document.querySelector<HTMLImageElement>("img.tile")?.src).toBe(previousTile));
  const repairedTile = document.querySelector<HTMLImageElement>("img.tile")!;
  expect(repairedTile).not.toBe(renderedTile);
  expect(requests).toHaveLength(3);
  expect(fetch.mock.calls.every(([, init]) => init?.cache === "no-cache")).toBe(true);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(document.getElementById("step-0")).toBe(step);
  await openTab("Step settings");
  expect(sticky()).toHaveProperty("checked", true);
  await waitFor(async () => {
    const library = await storage.loadLibrary();
    expect(library.guides.find((g) => g.id === "saved")).toEqual(saved);
    expect(library.guides.find((g) => g.id === "recovered")?.text).toContain("#sticky");
  });
  await undo(user);
  expect(sticky()).toHaveProperty("checked", false);
  expect(fetch.mock.calls.every(([url]) => new URL(url).pathname.startsWith("/fixture/"))).toBe(true);
});

it("shows the latest dataset, and keeps it when a replaced one's responses arrive late", async () => {
  const old = plannerRelease();
  const fresh = plannerRelease();
  fresh.quests.quests.push(stolenBooty(fresh));
  fresh.replace("quests.json", fresh.quests);
  const loads = vi.spyOn(datasetLoader, "fetchDatasetArtifact");
  const pending: { path: string; release: (response: Response) => void }[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    const [, owner, path] = new URL(url).pathname.match(/^\/(old|fresh)\/(.*)$/)!;
    const f = owner === "fresh" ? fresh : old;
    if (path === "manifest.json") return Promise.resolve(new Response(JSON.stringify(f.manifest)));
    if (owner === "fresh") return Promise.resolve(new Response(f.files.get(path!)));
    return new Promise<Response>((release) => pending.push({ path: path!, release }));
  });
  const at = (owner: string) => ({ manifest: `/${owner}/manifest.json`, base: `/${owner}/` });
  const { stores } = renderApp({ initial: { guides: [] }, dataset: at("old") });
  await waitFor(() => expect(pending).toHaveLength(6));
  act(() => stores.dataset.select(at("fresh")));
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Search" }));
  await user.type(screen.getByRole("searchbox", { name: "Search quests, NPCs, items, and places" }), "booty");
  expect(await screen.findByRole("button", { name: /Stolen Booty/ })).toBeTruthy();
  await act(async () => {
    for (const { path, release } of pending) release(new Response(old.files.get(path)));
    await Promise.allSettled([loads.mock.results[0]!.value]);
  });
  expect(screen.getByRole("button", { name: /Stolen Booty/ })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("fetches the dataset once in StrictMode, and keeps that fetch live", () => {
  const loads = vi.spyOn(datasetLoader, "fetchDatasetArtifact").mockReturnValue(new Promise(() => {}));
  const dataset = { manifest: "/fixture/manifest.json", base: "/fixture/" };
  renderApp({ initial: { guides: [] }, dataset, strict: true });
  expect(loads.mock.calls.map(([location, signal]) => [location, signal.aborted])).toEqual([[dataset, false]]);
});

it("returns Search from a chosen quest to its results when another dataset loads", async () => {
  const releases = { old: plannerRelease(), fresh: plannerRelease() };
  vi.stubGlobal("fetch", (url: string) => {
    const [, owner, path] = new URL(url).pathname.match(/^\/(old|fresh)\/(.*)$/)!;
    const f = releases[owner as keyof typeof releases];
    return Promise.resolve(new Response(path === "manifest.json" ? JSON.stringify(f.manifest) : f.files.get(path!)));
  });
  const at = (owner: string) => ({ manifest: `/${owner}/manifest.json`, base: `/${owner}/` });
  const { stores } = renderApp({ initial: { guides: [] }, dataset: at("old") });
  const user = userEvent.setup();
  const panel = () => within(screen.getByRole("region", { name: "Search" }));
  await user.click(await screen.findByRole("button", { name: "Search" }));
  await user.type(screen.getByRole("searchbox", { name: "Search quests, NPCs, items, and places" }), "southsea");
  await user.click(await panel().findByRole("button", { name: /Southsea Freebooters/ }));
  expect(panel().getByRole("button", { name: "Back to results" })).toBeTruthy();
  act(() => stores.dataset.select(at("fresh")));
  expect(await panel().findByRole("button", { name: /Southsea Freebooters/ })).toBeTruthy();
  expect(panel().queryByRole("button", { name: "Back to results" })).toBeNull();
});

it("retries only a corrupt terrain tile and keeps guide edits and quest search", async () => {
  const f = plannerRelease();
  const path = "world/tiles/kalimdor/2/1/1.webp";
  const good = f.files.get(path)!;
  f.files.set(path, new Uint8Array(good.length));
  const loads = vi.spyOn(datasetLoader, "fetchDatasetArtifact");
  const fetch = vi.fn(async (url: string) => {
    const name = new URL(url).pathname.slice("/lazy/".length);
    const bytes = name === "manifest.json" ? new TextEncoder().encode(JSON.stringify(f.manifest)) : f.files.get(name);
    return new Response(bytes ?? null, { status: bytes ? 200 : 404 });
  });
  vi.stubGlobal("fetch", fetch);
  localStorage.clear();
  const guide = { id: "lazy", text: "#group Test\n#name Lazy tiles\nstep\n.accept 887\n", order: 0 };
  renderApp({ initial: { guides: [guide] }, dataset: { manifest: "/lazy/manifest.json", base: "/lazy/" } });
  const user = userEvent.setup();
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Some terrain tiles did not load.");
  const search = () => screen.getByRole("searchbox", { name: "Search quests, NPCs, items, and places" });
  await user.click(screen.getByRole("button", { name: "Search" }));
  await user.type(search(), "southsea");
  expect(await within(screen.getByRole("region", { name: "Search" })).findByRole("button", { name: /Southsea Freebooters/ })).toBeTruthy();
  await user.click(screen.getByRole("tab", { name: "Step settings" }));
  const sticky = screen.getByRole("checkbox", { name: "Sticky" });
  await user.click(sticky);
  const step = document.getElementById("step-0");
  const before = fetch.mock.calls.length;
  expect(fetch.mock.calls.filter(([url]) => url.endsWith(path))).toHaveLength(1);
  await waitFor(() => expect(document.querySelectorAll("img.tile")).toHaveLength(2));
  f.files.set(path, good);
  await user.click(within(alert).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(document.querySelectorAll("img.tile")).toHaveLength(3));
  expect(fetch.mock.calls.slice(before).map(([url]) => new URL(url).pathname)).toEqual([`/lazy/${path}`]);
  expect(loads).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Search" }));
  expect(search()).toHaveProperty("value", "southsea");
  expect(sticky).toHaveProperty("checked", true);
  expect(document.getElementById("step-0")).toBe(step);
  const image = document.querySelector<HTMLImageElement>("img.tile")!;
  expect(image.src).toMatch(/^blob:/);
  expect(new Uint8Array(await (await fetchBlob(image.src)).arrayBuffer())).toEqual(good);
  expect(screen.queryByRole("alert")).toBeNull();
});
