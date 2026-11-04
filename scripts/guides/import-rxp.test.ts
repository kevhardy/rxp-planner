import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { foreverPaths, importRxp } from "./import-rxp.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeRxp(xml: string, files: string[]): string {
  const rxp = mkdtempSync(join(tmpdir(), "rxp-"));
  dirs.push(rxp);
  mkdirSync(join(rxp, "Guides/forever"), { recursive: true });
  writeFileSync(join(rxp, "RXPGuides.toc"), "## Title: RXP\r\n## Version: v9.9.9\r\n");
  writeFileSync(join(rxp, "Guides/GuideList-forever.xml"), xml);
  for (const name of files) writeFileSync(join(rxp, "Guides/forever", name), `RXPGuides.RegisterGuide([[#name ${name}]])`);
  return rxp;
}

describe("foreverPaths", () => {
  it("reads Script elements in order and skips comments and other files", () => {
    const xml = `<Ui>
      <Script file="Guides/Import.lua"/>
      <Script file="Guides/forever/B.lua" />
      <!-- <Script file="Guides/forever/Old.lua"/> -->
      <Script
        file = 'Guides\\forever\\A.lua'></Script>
      <Script file="Guides/SurvivalGuide/S.lua"/>
    </Ui>`;
    expect(foreverPaths(xml)).toEqual(["Guides/forever/B.lua", "Guides/forever/A.lua"]);
  });
});

describe("importRxp", () => {
  it("prunes guides the list no longer loads and keeps LICENSE", () => {
    const rxp = fakeRxp(`<Script file="Guides/forever/A.lua"/>`, ["A.lua"]);
    const root = mkdtempSync(join(tmpdir(), "planner-"));
    dirs.push(root);
    mkdirSync(join(root, "guides/rxp-forever"), { recursive: true });
    for (const name of ["LICENSE", "Removed.lua"]) writeFileSync(join(root, "guides/rxp-forever", name), "");

    expect(importRxp(rxp, root)).toMatchObject({ version: "v9.9.9", files: [{ name: "A.lua" }] });
    expect(readdirSync(join(root, "guides/rxp-forever")).toSorted()).toEqual(["A.lua", "LICENSE"]);
  });

  it("imports Skyborne from the release's capitalized Forever directory", () => {
    const rxp = fakeRxp('<Script file="Guides/forever/RestedXP-Skyborne.lua"/>', []);
    mkdirSync(join(rxp, "Guides/Forever"));
    const source = "RXPGuides.RegisterGuide([[#forever\r\n#name Skyborne]])";
    writeFileSync(join(rxp, "Guides/Forever/RestedXP-Skyborne.lua"), source);
    const root = mkdtempSync(join(tmpdir(), "planner-"));
    dirs.push(root);
    expect(importRxp(rxp, root).files).toEqual([{ name: "RestedXP-Skyborne.lua", source }]);
  });

  it("names dungeon guides by their path, apart from the main guides", () => {
    const rxp = fakeRxp('<Script file="Guides/forever/A.lua"/><Script file="Guides/forever/dungeon/A.lua"/>', ["A.lua"]);
    mkdirSync(join(rxp, "Guides/Forever/dungeon"), { recursive: true });
    writeFileSync(join(rxp, "Guides/Forever/dungeon/A.lua"), "RXPGuides.RegisterGuide([[#name Dungeon A]])");
    const root = mkdtempSync(join(tmpdir(), "planner-"));
    dirs.push(root);
    mkdirSync(join(root, "guides/rxp-forever/dungeon"), { recursive: true });
    writeFileSync(join(root, "guides/rxp-forever/dungeon/Removed.lua"), "");

    expect(importRxp(rxp, root).files).toEqual([
      { name: "A.lua", source: "RXPGuides.RegisterGuide([[#name A.lua]])" },
      { name: "dungeon/A.lua", source: "RXPGuides.RegisterGuide([[#name Dungeon A]])" },
    ]);
    expect(readdirSync(join(root, "guides/rxp-forever"), { recursive: true, encoding: "utf8" }).toSorted()).toEqual([
      "A.lua",
      "dungeon",
      "dungeon/A.lua",
    ]);
  });

  it("fails before writing when the list is empty or names a missing file", () => {
    const root = mkdtempSync(join(tmpdir(), "planner-"));
    dirs.push(root);
    expect(() => importRxp(fakeRxp(`<Script file="Guides/Import.lua"/>`, []), root)).toThrow(/lists no/);
    expect(() => importRxp(fakeRxp(`<Script file="Guides/forever/A.lua"/>`, []), root)).toThrow(
      /Guides\/forever\/A.lua, which does not exist/,
    );
    expect(readdirSync(root)).toEqual([]);
  });
});
