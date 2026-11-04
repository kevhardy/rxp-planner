import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { guideTextures, parseGuide } from "../guide/index.ts";
import { decodeBuiltins } from "../io/builtin.ts";
import { markTextureKeys } from "../rules/row/marks.ts";
import { guideIconCatalog } from "./guideIcons.ts";
import { releaseGuideIcons } from "./releaseInputs.ts";

it("has an icon for each texture key of the bundled guides", async () => {
  const { guides } = await decodeBuiltins(
    new Uint8Array(await readFile(new URL("../../public/data/rxp-forever.json.gz", import.meta.url))),
  );
  const icons = guideIconCatalog(releaseGuideIcons());
  const keys = new Set(guides.flatMap(({ text }) => guideTextures(parseGuide(text)).keys));
  expect(keys).toContain("134414");
  expect([...keys].filter((key) => !icons.get(key))).toEqual([]);
});

it("has an icon for each line mark texture", () => {
  const icons = guideIconCatalog(releaseGuideIcons());
  expect(markTextureKeys().filter((key) => !icons.get(key))).toEqual([]);
});
