// Packs RestedXP's bundled Forever guides into the app's built-in guide file
// and copies the same files into guides/rxp-forever/.
//
//   pnpm import:rxp /absolute/path/to/RXPGuides
//
// Give an extracted packaged release, not a Git checkout. pnpm runs the script
// in the repository root, so a relative path starts there. A new release can
// change RXP's behavior as well as its guides. Diff the upstream files that the
// planner's code cites, and port each change with a focused test.
//
// Reads the version from RXPGuides.toc and the `Guides/forever/` files, in load
// order, from Guides/GuideList-forever.xml. Names each file by its path under
// `Guides/forever/`, such as `dungeon/Horde-1-12_Mulgore.lua`. Copies them into
// guides/rxp-forever/, removes Lua files there that the list no longer names,
// and writes public/data/rxp-forever.json.gz as
// `{ version, files: [{ name, source }] }`
// (see src/io/builtin.ts). The Lua is packed as text; the app extracts the
// guides when it loads the file. It does not copy LICENSE, so compare the
// release's LICENSE with guides/rxp-forever/LICENSE.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { BuiltinFile } from "../../src/io/builtin.ts";

const FOREVER = "Guides/forever/";

export function foreverPaths(xml: string): string[] {
  const paths: string[] = [];
  for (const [, attrs] of xml.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<Script\b([^>]*)>/g)) {
    const file = attrs!.match(/\bfile\s*=\s*(?:"([^"]*)"|'([^']*)')/);
    const path = (file?.[1] ?? file?.[2])?.replaceAll("\\", "/");
    if (path?.startsWith(FOREVER) && path.endsWith(".lua")) paths.push(path);
  }
  return paths;
}

export function importRxp(rxp: string, root: string): BuiltinFile {
  // A git checkout's toc holds @project-version@ in place of a version, so use a packaged release.
  const version = readFileSync(join(rxp, "RXPGuides.toc"), "utf8").match(/^## Version:\s*(\S+)/m)?.[1];
  if (!version) throw new Error("Could not find the version in RXPGuides.toc.");

  const paths = foreverPaths(readFileSync(join(rxp, "Guides/GuideList-forever.xml"), "utf8"));
  if (paths.length === 0) throw new Error("GuideList-forever.xml lists no Guides/forever/*.lua files.");
  const files = paths.map((path) => {
    const name = path.slice(FOREVER.length);
    // Releases list Skyborne and `dungeon/` under `forever` but ship them under
    // `Forever`, which the game finds on a case-insensitive file system.
    const full = existsSync(join(rxp, path)) ? join(rxp, path) : join(rxp, "Guides/Forever", name);
    if (!existsSync(full)) throw new Error(`GuideList-forever.xml lists ${path}, which does not exist.`);
    const bytes = readFileSync(full);
    const source = bytes.toString("utf8");
    if (!Buffer.from(source, "utf8").equals(bytes)) throw new Error(`${path} is not valid UTF-8.`);
    return { name, source };
  });
  const names = new Set(files.map((f) => f.name));
  if (names.size !== files.length) throw new Error("GuideList-forever.xml lists a file name twice.");

  const guidesDir = join(root, "guides/rxp-forever");
  mkdirSync(guidesDir, { recursive: true });
  for (const { name, source } of files) {
    mkdirSync(dirname(join(guidesDir, name)), { recursive: true });
    writeFileSync(join(guidesDir, name), source);
  }
  for (const name of readdirSync(guidesDir, { recursive: true, encoding: "utf8" })) {
    if (name.endsWith(".lua") && !names.has(name)) rmSync(join(guidesDir, name));
  }

  const file: BuiltinFile = { version, files };
  const gz = gzipSync(JSON.stringify(file), { level: 9 });
  // Node writes a zero mtime; also fix the OS byte, which zlib sets per platform.
  gz[9] = 0xff;
  const out = join(root, "public/data/rxp-forever.json.gz");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, gz);
  return file;
}

if (import.meta.main) {
  const rxp = process.argv[2];
  if (!rxp) {
    console.error("usage: node scripts/guides/import-rxp.ts <path to RXPGuides>");
    process.exit(1);
  }
  const { version, files } = importRxp(rxp, join(import.meta.dirname, "../.."));
  console.log(`Wrote ${files.length} guide files from RestedXP Guides ${version}.`);
}
