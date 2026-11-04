import { describe, expect, it, vi } from "vitest";
import type { GuideRecord } from "../guide/index.ts";
import { createZip } from "../io/zip.ts";
import { ImportReader } from "./importReader.ts";
import { slowFile } from "./testing.ts";

const NO_BUILTINS = new Map<string, GuideRecord>();
const textFile = (text: string, name: string) => new File([text], name, { type: "text/plain" });
const zipFile = (path: string, text: string, name: string) =>
  new File([createZip([{ path, data: new TextEncoder().encode(text) }])], name, { type: "application/zip" });
const readAll = (reader: ImportReader) => vi.waitFor(() => expect(reader.getState().done).toBe(reader.getState().sources.length));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const found = (reader: ImportReader) => reader.getState().found.map((f) => [f.key, f.fileName, f.guide.text]);

describe("ImportReader", () => {
  it("keeps the exact text of Lua, plain text, zip, and pasted guides", async () => {
    const reader = new ImportReader(NO_BUILTINS);
    reader.add([
      textFile('RXPGuides.RegisterGuide("L", [[\n#name Lua\nstep\n    .xp 2 -- kept\n]])\n', "guides.lua"),
      textFile("#group P\r\n#name Plain\r\nstep\r\n  .unknown  x\r\n\0#group P\n#name Two\nstep", "plain.txt"),
      zipFile("Z/guides.lua", "RXPGuides.RegisterGuide([[#group Z\n#name Zip\nstep]])", "Z.zip"),
      { text: "#group T\n#name Pasted\nstep\n\n" },
    ]);
    await readAll(reader);
    expect(found(reader)).toEqual([
      ["0:0", "guides.lua", "#name Lua\nstep\n    .xp 2 -- kept\n"],
      ["1:0", "plain.txt", "#group P\r\n#name Plain\r\nstep\r\n  .unknown  x\r\n"],
      ["1:1", "plain.txt", "#group P\n#name Two\nstep"],
      ["2:0", "Z.zip", "#group Z\n#name Zip\nstep"],
      ["3:0", undefined, "#group T\n#name Pasted\nstep\n\n"],
    ]);
    expect(reader.getState().errors).toEqual([]);
  });

  it("reads a source added during a read after it, once each", async () => {
    const first = slowFile("#group G\n#name First\nstep\n", "first.txt");
    const reads = vi.spyOn(first.file, "arrayBuffer");
    const reader = new ImportReader(NO_BUILTINS);
    reader.add([first.file]);
    reader.add([{ text: "#group G\n#name Second\nstep\n" }]);
    await settle();
    expect(reader.getState().done).toBe(0);
    first.arrive();
    await readAll(reader);
    expect(found(reader)).toEqual([
      ["0:0", "first.txt", "#group G\n#name First\nstep\n"],
      ["1:0", undefined, "#group G\n#name Second\nstep\n"],
    ]);
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("reports each source's error and reads the next", async () => {
    const gone = textFile("", "gone.txt");
    gone.arrayBuffer = () => Promise.reject(new Error("The file was moved."));
    const reader = new ImportReader(NO_BUILTINS);
    reader.add([gone, { text: "" }, zipFile("Z/Z.toc", "guides.lua\n", "Z.zip"), textFile("#group G\n#name A\nstep\n", "a.txt")]);
    await readAll(reader);
    expect(reader.getState().errors).toEqual([
      { source: 0, label: "gone.txt", message: "The file was moved." },
      { source: 1, label: "Pasted text", message: "No guides found." },
      { source: 2, label: "Z.zip", message: "The zip holds no .lua file." },
    ]);
    expect(found(reader)).toEqual([["3:0", "a.txt", "#group G\n#name A\nstep\n"]]);
  });

  it("marks a guide whose group and name RXP keeps for a built-in", async () => {
    const builtin: GuideRecord = { id: "rxp:a", order: 0, text: "#group Shown\n#name A\nstep\n", registerArgs: { group: "Real" } };
    const reader = new ImportReader(new Map([[builtin.id, builtin]]));
    reader.add([{ text: "#group Real\n#name A\nstep\n\0#group Shown\n#name A\nstep\n" }]);
    await readAll(reader);
    expect(reader.getState().found.map((f) => f.matchesBuiltin)).toEqual([true, false]);
  });

  it("drops a read that finishes after close, and reads nothing added after it", async () => {
    const late = slowFile("#group G\n#name Late\nstep\n", "late.txt");
    const reader = new ImportReader(NO_BUILTINS);
    reader.add([late.file]);
    reader.close();
    late.arrive();
    reader.add([{ text: "#group G\n#name After\nstep\n" }]);
    await settle();
    expect(reader.getState()).toEqual({ sources: [late.file], done: 0, found: [], errors: [] });
  });
});
