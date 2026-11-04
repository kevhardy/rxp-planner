import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lauxlib, lua, lualib, to_luastring } from "fengari";
import { describe, expect, it } from "vitest";
import { extractGuides, parseGuide, parseLine, replaceLine, serializeGuide, type BodyLine } from "../guide/index.ts";
import { addonFolderName, exportAddon, type AddonGuide } from "./addon.ts";
import { importGuides } from "./import.ts";
import { readZip } from "./zip.ts";

const root = join(import.meta.dirname, "../..");
const bundledDir = join(root, "guides/rxp-forever");
const bundledGuides = readdirSync(bundledDir, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".lua"))
  .flatMap((f) => extractGuides(readFileSync(join(bundledDir, f), "utf8")).map((g) => g.text));

const tricky = [
  "",
  "\n",
  "\nstarts with a newline",
  "\n\nstarts with two",
  "\r\nstarts with CRLF",
  "\rstarts with CR",
  "a\n\rb\r\rc\r\n",
  "ends with ]",
  "ends with ]=",
  "holds ]] and ]=] and [[ and [=[",
  "]==]]=]]",
];

function runInLua(source: string): string[][] {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const stub = "captured = {}; RXPGuides = { RegisterGuide = function(...) captured[#captured + 1] = {...} end }";
  for (const chunk of [stub, source]) {
    if (lauxlib.luaL_loadstring(L, to_luastring(chunk)) || lua.lua_pcall(L, 0, 0, 0)) {
      throw new Error(lua.lua_tojsstring(L, -1));
    }
  }
  lua.lua_getglobal(L, "captured");
  const count = lua.lua_rawlen(L, -1);
  const calls: string[][] = [];
  for (let i = 1; i <= count; i++) {
    lua.lua_rawgeti(L, -1, i);
    const args: string[] = [];
    for (let k = 1; k <= lua.lua_rawlen(L, -1); k++) {
      lua.lua_rawgeti(L, -1, k);
      args.push(lua.lua_tojsstring(L, -1));
      lua.lua_pop(L, 1);
    }
    calls.push(args);
    lua.lua_pop(L, 1);
  }
  return calls;
}

const luaOf = (guides: (string | AddonGuide)[]) => exportAddon("Test", guides).files[1]!.content;
const lf = (text: string) => text.replace(/\r\n?/g, "\n");

describe("exportAddon", () => {
  const all = bundledGuides;

  it("writes LF-only Lua that extractGuides reads back as the LF texts", () => {
    expect(all).toHaveLength(80);
    expect(all.some((text) => text.includes("\r\n"))).toBe(true);
    for (const texts of [all, tricky]) {
      const source = luaOf(texts);
      expect(source).not.toContain("\r");
      expect(extractGuides(source).map((g) => g.text)).toEqual(texts.map(lf));
    }
  });

  it("registers the same texts when run by Lua", () => {
    expect(runInLua(luaOf(all))).toEqual(all.map((text) => [lf(text)]));
    expect(runInLua(luaOf(tricky))).toEqual(tricky.map((text) => [lf(text)]));
  });

  // Lua 5.1 rejects `[[` inside `[[...]]`. Fengari runs Lua 5.3, so it cannot catch a level-zero bracket.
  it("quotes [[ in a long bracket that Lua 5.1 accepts", () => {
    const source = luaOf(["a [[ b"]);
    expect(source).toMatch(/^RXPGuides\.RegisterGuide\(\[=+\[/);
    expect(runInLua(source)).toEqual([["a [[ b"]]);
  });

  it("keeps RegisterGuide group and default arguments", async () => {
    const imported = await importGuides('RXPGuides.RegisterGuide("G", "#name A\\nstep\\n", "Human")\nRegisterGuide("H", [[#name B]])');
    const source = luaOf([...imported.guides, "#group I\n#name C\n"]);
    expect(runInLua(source)).toEqual([["G", "#name A\nstep\n", "Human"], ["H", "#name B"], ["#group I\n#name C\n"]]);
    const again = await importGuides(source);
    expect(again.guides.map(({ text, registerArgs, errors }) => ({ text, registerArgs, errors }))).toEqual([
      { text: "#name A\nstep\n", registerArgs: { group: "G", defaultFor: "Human" }, errors: [] },
      { text: "#name B", registerArgs: { group: "H" }, errors: [] },
      { text: "#group I\n#name C\n", registerArgs: undefined, errors: [] },
    ]);
  });

  it("keeps a step's @sim state= comment through import, edit, save, and export", async () => {
    const state = `-- @sim state={"level": 5, "hearth": 600, "log": {"313": {"1": 2}}, "position": "Dun Morogh,46.7,53.6"}`;
    const text = `#group G\r\n#name A\r\nstep ${state}\r\n    ${state}\r\n    .accept 313\r\nstep\r\n    .turnin 313\r\n`;
    const [imported] = (await importGuides(`RXPGuides.RegisterGuide([[${text}]])`)).guides;
    const edited = replaceLine(parseGuide(imported!.text), { step: 1, index: 0 }, parseLine("    .turnin 314") as BodyLine);
    const saved = serializeGuide(edited);
    expect(saved).toBe(text.replace(".turnin 313", ".turnin 314"));
    expect(runInLua(luaOf([saved]))).toEqual([[lf(text).replace(".turnin 313", ".turnin 314")]]);
  });

  it("writes the toc", () => {
    const addon = exportAddon("My Guides: Élan\n", ["#name x\n"]);
    expect(addon.folder).toBe("My_Guides_Elan");
    expect(addon.files.map((f) => f.path)).toEqual(["My_Guides_Elan/My_Guides_Elan.toc", "My_Guides_Elan/guides.lua"]);
    expect(addon.files[0]!.content).toBe("## Interface: 11509, 16001\n## Title: My Guides: Élan\n## Dependencies: RXPGuides\nguides.lua\n");
  });

  it.each([
    ["a name that differs from the title", "Forever Guides", "My Addon", "My_Addon", "Forever Guides"],
    ["a blank name", "Forever Guides", "  ", "Forever_Guides", "Forever Guides"],
    ["a blank title with a name", "", "CON", "Custom_CON", "RXPPlannerGuides"],
    ["a name that RXP reserves", "Forever Guides", "RXPGuides", "Custom_RXPGuides", "Forever Guides"],
  ])("names the folder and the toc for %s", async (_, title, name, folder, tocTitle) => {
    const addon = exportAddon(title, ["#name A\n"], { name });
    const files = [
      {
        path: `${folder}/${folder}.toc`,
        content: `## Interface: 11509, 16001\n## Title: ${tocTitle}\n## Dependencies: RXPGuides\nguides.lua\n`,
      },
      { path: `${folder}/guides.lua`, content: "RXPGuides.RegisterGuide([=[\n#name A\n]=])\n" },
    ];
    expect(addon.folder).toBe(folder);
    expect(addon.files).toEqual(files);
    const unzipped = (await readZip(addon.zip)).map((e) => ({ path: e.path, content: new TextDecoder().decode(e.data) }));
    expect(unzipped).toEqual(files);
  });

  it("builds a zip that unzip reads", () => {
    expect(
      () => execFileSync("unzip", ["-v"], { stdio: "ignore" }),
      "Install unzip, for example: sudo apt-get install -y unzip",
    ).not.toThrow();
    const addon = exportAddon("Forever Guides", all, { modified: new Date(2026, 8, 23, 12, 30, 10) });
    const dir = mkdtempSync(join(tmpdir(), "rxp-addon-"));
    try {
      const file = join(dir, "addon.zip");
      writeFileSync(file, addon.zip);
      expect(execFileSync("unzip", ["-t", file], { encoding: "utf8" })).toContain("No errors detected");
      expect(execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }).trim().split("\n")).toEqual([
        "Forever_Guides/Forever_Guides.toc",
        "Forever_Guides/guides.lua",
      ]);
      const lua = execFileSync("unzip", ["-p", file, "Forever_Guides/guides.lua"], {
        encoding: "utf8",
        maxBuffer: 1 << 26,
      });
      expect(lua).toBe(addon.files[1]!.content);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("addonFolderName", () => {
  it("sanitizes titles", () => {
    expect(addonFolderName("  --Speed run!! ")).toBe("Speed_run");
    expect(addonFolderName("日本")).toBe("RXPPlannerGuides");
    expect(addonFolderName("RXPGuides")).toBe("Custom_RXPGuides");
    expect(addonFolderName("Blizzard_UI")).toBe("Custom_Blizzard_UI");
    for (const name of ["CON", "nul", "aux", "Com1", "LPT9", "COM¹", " prn "]) {
      expect(addonFolderName(name)).toMatch(/^Custom_/);
    }
    expect(addonFolderName("con.txt")).toBe("con_txt");
    expect(addonFolderName("Console")).toBe("Console");
    expect(exportAddon("CON", []).files.map((f) => f.path)).toEqual(["Custom_CON/Custom_CON.toc", "Custom_CON/guides.lua"]);
    expect(addonFolderName("x".repeat(100))).toHaveLength(64);
  });
});
