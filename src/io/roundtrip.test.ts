import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractGuides } from "../guide/index.ts";
import { exportAddon, registerArgs, type AddonGuide } from "./addon.ts";
import { importGuides } from "./import.ts";
import { deflatedZip } from "./testing.ts";

const guidesDir = join(import.meta.dirname, "../../guides/rxp-forever");
const guideFiles = readdirSync(guidesDir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".lua"));
const lf = (text: string) => text.replace(/\r\n?/g, "\n");
const exported = (guides: Awaited<ReturnType<typeof importGuides>>["guides"]) =>
  guides.map(({ text, registerArgs }) => ({ text, registerArgs }));

describe("export and import of an addon zip", () => {
  it.each(guideFiles)("keeps the guides of %s", async (file) => {
    const guides = extractGuides(readFileSync(join(guidesDir, file), "utf8")).map(({ text, group, defaultFor }) => {
      const guide: AddonGuide = { text };
      if (group !== undefined) guide.registerArgs = registerArgs(group, defaultFor);
      return guide;
    });
    expect(guides.length).toBeGreaterThan(0);
    const addon = exportAddon(file, guides);

    const result = await importGuides(addon.zip);
    expect(result.source).toEqual({ kind: "zip" });
    expect(exported(result.guides)).toEqual(guides.map(({ text, registerArgs }) => ({ text: lf(text), registerArgs })));
    expect(exportAddon(file, result.guides).files[1]!.content).toBe(addon.files[1]!.content);
  });

  it("reads a zip that a zip tool compressed again, with RegisterGuide arguments", async () => {
    const texts = guideFiles.flatMap((file) => extractGuides(readFileSync(join(guidesDir, file), "utf8")).map((g) => g.text));
    const args = [{ group: "My Group", defaultFor: "Human" }, { group: "Other" }];
    const guides = texts.map((text, i) => ({ text: lf(text), ...(args[i] && { registerArgs: args[i] }) }));
    const addon = exportAddon("Forever", guides);
    const encoder = new TextEncoder();
    const zip = deflatedZip(addon.files.map((f) => ({ path: f.path, data: encoder.encode(f.content) })));
    expect(zip.length).toBeLessThan(addon.zip.length / 2);
    expect(exported((await importGuides(zip)).guides)).toEqual(guides);
  });
});
