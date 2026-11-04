import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractGuides, hasRegisterGuideCall } from "../guide/index.ts";
import { LuaExtractError } from "../guide/lua.ts";
import { importGuides } from "./import.ts";
import { splitGuideText } from "./text.ts";
import { createZip } from "./zip.ts";

const root = join(import.meta.dirname, "../..");
const bundledDir = join(root, "guides/rxp-forever");
const bundledFiles = readdirSync(bundledDir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".lua"));
const bundledGuides = bundledFiles.flatMap((f) => extractGuides(readFileSync(join(bundledDir, f), "utf8")));

describe("importGuides", () => {
  it("reads RegisterGuide calls from Lua", async () => {
    const file = "Alliance-11-20.lua";
    const result = await importGuides(readFileSync(join(bundledDir, file), "utf8"), { fileName: file });
    expect(result.source).toEqual({ kind: "lua" });
    expect(result.guides[0]).toMatchObject({ name: "13-15 Westfall", line: 6, errors: [] });
    await expect(importGuides("RegisterGuide(text)")).rejects.toBeInstanceOf(LuaExtractError);
  });

  it("reads the bytes of a Lua or text file as its UTF-8 text", async () => {
    const file = "Alliance-11-20.lua";
    const lua = readFileSync(join(bundledDir, file));
    expect(await importGuides(lua, { fileName: file })).toEqual(await importGuides(lua.toString("utf8"), { fileName: file }));
    const text = new TextEncoder().encode("\uFEFF#group G\n#name Élan\nstep\n");
    expect(await importGuides(text, { fileName: "a.txt" })).toEqual({
      source: { kind: "text" },
      fileName: "a.txt",
      guides: [{ text: "#group G\n#name Élan\nstep\n", line: 1, name: "Élan", errors: [] }],
    });
  });

  it("refuses a zip with no .lua file", async () => {
    const zip = createZip([{ path: "Guides/Guides.toc", data: new TextEncoder().encode("guides.lua\n") }]);
    await expect(importGuides(zip)).rejects.toThrow("The zip holds no .lua file.");
    await expect(importGuides(createZip([]))).rejects.toThrow("The zip holds no .lua file.");
  });

  it("keeps the group and default arguments of a Lua call", async () => {
    const result = await importGuides('RXPGuides.RegisterGuide("My Group", "#name A\\nstep\\n", "Human")');
    expect(result.guides).toEqual([
      { text: "#name A\nstep\n", name: "A", line: 1, registerArgs: { group: "My Group", defaultFor: "Human" }, errors: [] },
    ]);
  });

  it("finds RegisterGuide calls only outside comments and strings", async () => {
    const mention = "-- RXPGuides.RegisterGuide([[example]])\n#group G\n#name A\nstep\n";
    expect(await importGuides(mention)).toMatchObject({ source: { kind: "text" }, guides: [{ text: mention, name: "A" }] });
    const quoted = '#group G\n#name A\nstep\n  >>Talk to Thun\'grim\n  >>Type "RegisterGuide(x)"\n';
    expect((await importGuides(quoted)).source).toEqual({ kind: "text" });

    const call = 'RXPGuides.RegisterGuide -- comment\n("G", "#name A\\nstep\\n")';
    expect(await importGuides(call)).toMatchObject({
      source: { kind: "lua" },
      guides: [{ text: "#name A\nstep\n", registerArgs: { group: "G" } }],
    });
    expect((await importGuides("RXPGuides.RegisterGuide--[[x]]'#name A'")).source).toEqual({ kind: "lua" });
  });

  it("reads an escaped line break in a quoted string as one line ending", async () => {
    for (const eol of ["\r\n", "\n\r"]) {
      const source = `local note = "a\\${eol}b"; RXPGuides.RegisterGuide("G", "#name A\\nstep\\n")`;
      expect(await importGuides(source)).toMatchObject({
        source: { kind: "lua" },
        guides: [{ text: "#name A\nstep\n", registerArgs: { group: "G" }, errors: [] }],
      });
    }
  });

  it("reads plain text with escapes Lua could not decode", async () => {
    const text = '#group G\n#name A\nstep\n>>Type "\\u{110000}" or "\\x" or "\\q"\n';
    expect(hasRegisterGuideCall(text)).toBe(false);
    expect(await importGuides(text)).toEqual({ source: { kind: "text" }, guides: [{ text, line: 1, name: "A", errors: [] }] });
    expect(hasRegisterGuideCall('x = "\\x" RegisterGuide(y)')).toBe(true);
  });

  it("reports an unfinished long-string call", async () => {
    for (const source of ["RXPGuides.RegisterGuide[[#name A\nstep\n", "RXPGuides.RegisterGuide([==[#name A]=]\n"]) {
      await expect(importGuides(source)).rejects.toThrow("Unfinished long string (line 1)");
    }
  });

  it("reads plain text and reports header errors per guide", async () => {
    const result = await importGuides("#group G\n#name A\nstep\n.goto Elwynn Forest,1,2\n#name B\nstep\n\nstep\n");
    expect(result.source).toEqual({ kind: "text" });
    expect(result.guides).toEqual([
      { text: "#group G\n#name A\nstep\n.goto Elwynn Forest,1,2\n", name: "A", line: 1, errors: [] },
      { text: "#name B\nstep\n\nstep\n", name: "B", line: 5, errors: ["Missing #group."] },
    ]);
    expect((await importGuides("step\n")).guides[0]!.errors).toEqual(["Missing #name.", "Missing #group."]);
    expect((await importGuides(" \n")).guides).toEqual([]);
  });

  it("keeps the #include in a last step with its guide", async () => {
    const source = readFileSync(join(bundledDir, "dungeon/Alliance-1-13_Human.lua"), "utf8");
    const [northshire, elwynn] = extractGuides(source).map((g) => g.text);
    const { guides } = await importGuides(`${northshire}\n${elwynn}`);
    expect(guides.map((g) => [g.name, g.line, g.errors, g.text.trim().split("\r\n").at(0), g.text.trim().split("\r\n").at(-1)])).toEqual([
      ["1-6 Northshire", 1, [], "#forever", "#include RestedXP Forever Guide (A)\\1-6 Northshire"],
      ["6-11 Elwynn Forest", 15, [], "#forever", "#include RestedXP Forever Guide (A)\\6-11 Elwynn Forest"],
    ]);
  });

  it("refuses a #beta that either guide may own, and gives it to the next guide below a blank line", async () => {
    await expect(
      importGuides("#group User\n#name Empty A\nstep\n#beta\n#group User\n#name Header B\nstep\n.goto Elwynn Forest,50,50\n"),
    ).rejects.toThrow(
      "Line 4 (#beta) can belong to the guide above it or to the next guide. Add a blank line where the guide above ends, or import the Lua file.",
    );
    const { guides } = await importGuides(
      "#group User\n#name Empty A\nstep\n\n#beta\n#group User\n#name Header B\nstep\n.goto Elwynn Forest,50,50\n",
    );
    expect(guides.map((g) => g.text)).toEqual([
      "#group User\n#name Empty A\nstep\n\n",
      "#beta\n#group User\n#name Header B\nstep\n.goto Elwynn Forest,50,50\n",
    ]);
  });

  it("keeps a bare condition above a blank line with the guide above, and refuses one with no blank line", async () => {
    const { guides } = await importGuides("#group User\n#name Empty A\nstep\n<< Horde\n\n#group User\n#name Header B\nstep\n");
    expect(guides.map((g) => g.text)).toEqual(["#group User\n#name Empty A\nstep\n<< Horde\n\n", "#group User\n#name Header B\nstep\n"]);
    expect(guides.map((g) => g.name)).toEqual(["Empty A", "Header B"]);
    await expect(importGuides("#group User\n#name Empty A\nstep\n<< Horde\n#group User\n#name Header B\nstep\n")).rejects.toThrow(
      "Line 4 (<< Horde) can belong to the guide above it or to the next guide. Add a blank line where the guide above ends, or import the Lua file.",
    );
  });

  it("keeps a condition directly above #group or #name with the next guide", async () => {
    const aboveGroup = await importGuides("#group User\n#name Empty A\nstep\n\n<< Horde\n#group User\n#name Header B\nstep\n");
    expect(aboveGroup.guides.map((g) => g.text)).toEqual([
      "#group User\n#name Empty A\nstep\n\n",
      "<< Horde\n#group User\n#name Header B\nstep\n",
    ]);
    const aboveName = await importGuides("#group User\n#name Empty A\nstep\n#group User\n<< Alliance\n#name Header B\nstep\n");
    expect(aboveName.source).toEqual({ kind: "text" });
    expect(aboveName.guides.map((g) => g.text)).toEqual([
      "#group User\n#name Empty A\nstep\n",
      "#group User\n<< Alliance\n#name Header B\nstep\n",
    ]);
  });

  it("leaves a bare condition in the Lua guide that contains it", async () => {
    const source = [
      "RXPGuides.RegisterGuide([[",
      "#group User",
      "#name Empty A",
      "step",
      "<< Horde",
      "]])",
      "RXPGuides.RegisterGuide([[",
      "<< Horde",
      "#group User",
      "#name Header B",
      "step",
      "]])",
      "",
    ].join("\n");
    const result = await importGuides(source);
    expect(result.source).toEqual({ kind: "lua" });
    expect(result.guides.map((g) => g.text)).toEqual([
      "#group User\n#name Empty A\nstep\n<< Horde\n",
      "<< Horde\n#group User\n#name Header B\nstep\n",
    ]);
  });

  it("refuses an #include that either guide may own, and gives it to the next guide below a blank line", async () => {
    await expect(
      importGuides("#group User\n#name Empty A\nstep\n#include User\\Shared\n#group User\n#name Header B\nstep\n"),
    ).rejects.toThrow(
      "Line 4 (#include User\\Shared) can belong to the guide above it or to the next guide. Add a blank line where the guide above ends, or import the Lua file.",
    );
    const { guides } = await importGuides("#group User\n#name Empty A\nstep\n\n#include User\\Shared\n#group User\n#name Header B\nstep\n");
    expect(guides.map((g) => g.text)).toEqual([
      "#group User\n#name Empty A\nstep\n\n",
      "#include User\\Shared\n#group User\n#name Header B\nstep\n",
    ]);
  });
});

describe("splitGuideText", () => {
  const bundledTexts = () => bundledGuides.map((g) => g.text.replace(/(?<!\n)$/, "\n"));

  it.each(["\n", "\0"])("splits guides with separator %j", (separator) => {
    const texts = bundledTexts().filter((text) => /^#name /m.test(text));
    const input = texts.join(separator);
    const split = splitGuideText(input).map((g) => g.text);
    expect(split.join("")).toBe(input.replaceAll("\0", ""));
    expect(split.map((t) => t.trim())).toEqual(texts.map((t) => t.trim()));
  });

  it("refuses guides with no blank line between them at the first tag either guide may own", () => {
    const input = bundledTexts().join("");
    expect(() => splitGuideText(input)).toThrow(
      "Line 10169 (#xprate <1.5) can belong to the guide above it or to the next guide. Add a blank line where the guide above ends, or import the Lua file.",
    );
  });

  it("moves header lines above #name to the next guide", () => {
    const text = "#name A\nstep\n  .accept 1\n  #label end\n\n-- end\n#classic\n--comment\n<< Alliance\n#name B\nstep\n";
    expect(splitGuideText(text)).toEqual([
      { text: "#name A\nstep\n  .accept 1\n  #label end\n\n-- end\n", line: 1 },
      { text: "#classic\n--comment\n<< Alliance\n#name B\nstep\n", line: 7 },
    ]);
  });

  it("keeps conditional #name lines in one header", () => {
    const text = "#group G\n#name A << Alliance\n#name B << Horde\nstep\n";
    expect(splitGuideText(text)).toEqual([{ text, line: 1 }]);
  });

  it("splits and counts CR and CRLF line endings", () => {
    expect(splitGuideText("#group G\r#name A\rstep\r#group H\r\n#name B\r\nstep\r\n#name C\nstep\n")).toEqual([
      { text: "#group G\r#name A\rstep\r", line: 1 },
      { text: "#group H\r\n#name B\r\nstep\r\n", line: 4 },
      { text: "#name C\nstep\n", line: 7 },
    ]);
  });

  it("splits on NUL", () => {
    expect(splitGuideText("#name A\nstep\n\0#name B\n\0\n")).toEqual([
      { text: "#name A\nstep\n", line: 1 },
      { text: "#name B\n", line: 3 },
    ]);
  });
});
