// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { URL as NodeURL } from "node:url";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as datasetLoader from "../data/dataset.ts";
import { plannerRelease } from "../data/manifestFixture.ts";
import { DatasetStore } from "./datasetStore.ts";

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("URL", NodeURL);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const at = (owner: string) => ({ manifest: `/${owner}/manifest.json`, base: `/${owner}/` });

it("aborts replaced and cleared artifacts, stops queued reads, and disposes the shown one", async () => {
  const old = plannerRelease();
  const fresh = plannerRelease();
  const loads = vi.spyOn(datasetLoader, "fetchDatasetArtifact");
  const created = vi.spyOn(URL, "createObjectURL");
  const revoked = vi.spyOn(URL, "revokeObjectURL");
  const pending: { path: string; signal: AbortSignal; release: (response: Response) => void }[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const [, owner, path] = new URL(url).pathname.match(/^\/(old|fresh|cleared)\/(.*)$/)!;
    const f = owner === "fresh" ? fresh : old;
    if (path === "manifest.json") return Promise.resolve(new Response(JSON.stringify(f.manifest)));
    if (owner === "fresh") return Promise.resolve(new Response(f.files.get(path!)));
    return new Promise<Response>((release) => pending.push({ path: path!, signal: init!.signal!, release }));
  });
  const answerAfterAbort = async (from: number, load: number) => {
    for (const { path, release } of pending.slice(from)) release(new Response(old.files.get(path)));
    await Promise.allSettled([loads.mock.results[load]!.value]);
  };
  const store = new DatasetStore();

  store.select(at("old"));
  await vi.waitFor(() => expect(pending).toHaveLength(6));
  store.select(at("fresh"));
  expect(pending.every(({ signal }) => signal.aborted)).toBe(true);
  await vi.waitFor(() => expect(store.getState().data?.base).toBe("http://localhost:3000/fresh/"));
  await answerAfterAbort(0, 0);
  expect(pending).toHaveLength(6);
  expect(created).toHaveBeenCalledTimes(1);
  expect(store.getState()).toEqual({ data: expect.objectContaining({ base: "http://localhost:3000/fresh/" }) });

  store.select(at("cleared"));
  expect(revoked).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(pending).toHaveLength(12));
  store.clear();
  expect(pending.every(({ signal }) => signal.aborted)).toBe(true);
  await answerAfterAbort(6, 2);
  expect(pending).toHaveLength(12);
  expect(created).toHaveBeenCalledTimes(1);
  expect(store.getState()).toEqual({ data: null });
});

it("shows a failure's text, and loads the same location again on retry", async () => {
  const loads = vi.spyOn(datasetLoader, "fetchDatasetArtifact").mockRejectedValueOnce(new Error("offline"));
  const store = new DatasetStore();
  store.select(at("old"));
  await vi.waitFor(() => expect(store.getState()).toEqual({ data: null, error: "offline" }));
  loads.mockReturnValueOnce(new Promise(() => {}));
  store.retry();
  expect(store.getState()).toEqual({ data: null });
  expect(loads.mock.calls.map(([location]) => location)).toEqual([at("old"), at("old")]);
});
