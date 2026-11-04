// `pnpm guides:textures --output FILE` writes the texture keys that the bundled guides show, and the
// textures of the planner's line marks, as `{"version": 1, "keys": [...]}`. The data producer copies the
// file and builds a guide icon for each key. It holds no guide text, so a key is the only fact that
// leaves the guides.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { TextureKey } from "../../packages/data-contract/guideIcons.ts";
import { extractGuides, guideTextures, parseGuide } from "../../src/guide/index.ts";
import { markTextureKeys } from "../../src/rules/row/marks.ts";

const { values } = parseArgs({ options: { output: { type: "string" } } });
if (!values.output) throw new Error("Usage: pnpm guides:textures --output FILE");

const dir = join(import.meta.dirname, "../../guides/rxp-forever");
const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".lua"));
const shown = new Set<TextureKey>();
const macros = new Set<TextureKey>();
const invalid = new Set<string>();
for (const file of files)
  for (const { text } of extractGuides(readFileSync(join(dir, file), "utf8"))) {
    const textures = guideTextures(parseGuide(text));
    for (const key of textures.invalidKeys) invalid.add(key);
    for (const [key, uses] of textures.uses) (uses.escapes > 0 ? shown : macros).add(key);
  }
if (invalid.size > 0) throw new Error(`The bundled guides name textures with invalid keys: ${[...invalid].join(", ")}`);

const marks = markTextureKeys();
const keys = [...new Set([...shown, ...macros, ...marks])].sort();
writeFileSync(values.output, JSON.stringify({ version: 1, keys }, null, 2) + "\n");
const onlyMacros = new Set([...macros].filter((key) => !shown.has(key))).size;
console.log(`${keys.length} keys: ${shown.size} in texture escapes, ${onlyMacros} only in .macro icons, ${marks.length} for line marks.`);
