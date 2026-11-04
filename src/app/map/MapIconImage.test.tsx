// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { loadDataset } from "../../data/dataset.ts";
import { plannerRelease } from "../../data/manifestFixture.ts";
import { DatasetContext } from "../context.ts";
import { afterEach, expect, it, vi } from "vitest";
import { MapIconImage } from "./MapIconImage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("draws the manifest's icon by key in its 24 px units, sized by its prop or else by CSS, under a base containing parentheses, hidden from assistive technology", async () => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("crypto", webcrypto);
  const f = plannerRelease();
  const data = await loadDataset(f.manifest, async (path) => f.files.get(path)!, "/assets(copy)/");
  const { container } = render(
    <DatasetContext.Provider value={{ data }}>
      <MapIconImage icon="quest-turn-in" size={20} />
      <MapIconImage icon="banker" size={20} />
      <MapIconImage icon="banker" />
    </DatasetContext.Provider>,
  );
  const [icon, missing, unsized] = container.querySelectorAll<HTMLElement>(".map-icon");
  expect(icon!.getAttribute("aria-hidden")).toBe("true");
  const vars = (el: HTMLElement) => Object.fromEntries([...el.style].map((name) => [name, el.style.getPropertyValue(name)]));
  expect(vars(icon!)).toEqual({
    "--size": "20px",
    "--image": 'url("/assets(copy)/art/map.webp")',
    "--image-x": "-48",
    "--image-y": "-48",
    "--image-w": "192",
  });
  expect(vars(missing!)).toEqual({ "--size": "20px" });
  expect(vars(unsized!)).toEqual({});
});
