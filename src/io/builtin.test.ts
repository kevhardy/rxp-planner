import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractGuides } from "../guide/index.ts";
import { BUILTIN_PATH, decodeBuiltins, fetchBuiltins, type BuiltinFile } from "./builtin.ts";

const root = join(import.meta.dirname, "../..");
const guidesDir = join(root, "guides/rxp-forever");
const bytes = new Uint8Array(readFileSync(join(root, "public", BUILTIN_PATH)));
const packed = JSON.parse(gunzipSync(bytes).toString("utf8")) as BuiltinFile;

const json = (data: unknown) => async () => new Response(JSON.stringify(data));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("built-in guide file", () => {
  it("packs the guide files byte for byte, in RXP's load order", () => {
    const onDisk = readdirSync(guidesDir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".lua"));
    expect(packed.files.map((f) => f.name).toSorted()).toEqual(onDisk.toSorted());
    expect(packed.files[0]!.name).toBe("RestedXP-Skyborne.lua");
    for (const { name, source } of packed.files) {
      expect(Buffer.from(source, "utf8").equals(readFileSync(join(guidesDir, name))), name).toBe(true);
    }
  });
});

describe("decodeBuiltins", () => {
  it("returns the RXP version and a record per guide with stable IDs", async () => {
    const { version, guides } = await decodeBuiltins(bytes);
    expect(version).toBe("v4.11.30");
    expect(guides).toHaveLength(80);
    expect(new Set(guides.map((g) => g.id)).size).toBe(80);
    expect(guides.map((g) => g.order)).toEqual([...guides.keys()]);
    expect(guides[0]).toEqual({
      id: "rxp:RestedXP-Skyborne.lua#1",
      text: extractGuides(packed.files[0]!.source)[0]!.text,
      order: 0,
      fileName: "RestedXP-Skyborne.lua",
    });
    expect(guides.at(-1)!.id).toBe("rxp:dungeon/Horde-12-22_Barrens.lua#5");
    expect((await decodeBuiltins(bytes)).guides).toEqual(guides);
  });
});

describe("fetchBuiltins", () => {
  it("fetches the file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes)),
    );
    expect((await fetchBuiltins())?.guides).toHaveLength(80);
    expect(fetch).toHaveBeenCalledWith(`/${BUILTIN_PATH}`);
  });

  it.each([
    ["an HTTP error", async () => new Response("", { status: 404 })],
    ["a network error", async () => Promise.reject(new TypeError("Failed to fetch"))],
    ["an undecodable file", async () => new Response("not json")],
    ["a file without a version", json({ files: [] })],
    ["a file entry without a name", json({ version: "v1", files: [{ source: "" }] })],
    ["a file entry without a source", json({ version: "v1", files: [{ name: "a.lua" }] })],
    [
      "a repeated file name",
      json({
        version: "v1",
        files: [
          { name: "a.lua", source: "" },
          { name: "a.lua", source: "" },
        ],
      }),
    ],
  ])("returns null and warns once on %s", async (_, response) => {
    vi.stubGlobal("fetch", vi.fn(response));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchBuiltins()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});
