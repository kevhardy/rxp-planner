import { extractGuides, hasRegisterGuideCall, parseGuide } from "../guide/index.ts";
import { registerArgs, type AddonGuide } from "./addon.ts";
import { readZip } from "./zip.ts";
import { splitGuideText } from "./text.ts";

type ImportSource = { kind: "zip" } | { kind: "lua" } | { kind: "text" };

/**
 * An imported guide. `registerArgs` holds the group and default arguments of
 * a Lua `RegisterGuide(group, text, defaultFor)` call; pass the guide to
 * `exportAddon` as is to keep them.
 */
export interface ImportedGuide extends AddonGuide {
  name?: string;
  /** 1-based line where the guide text starts in its Lua or text file. */
  line?: number;
  /** Problems that make this guide unusable in RXP; empty when none. */
  errors: string[];
}

export interface ImportResult {
  source: ImportSource;
  fileName?: string;
  guides: ImportedGuide[];
}

export interface ImportOptions {
  fileName?: string;
}

/**
 * Detects the source type and returns its guide texts. Bytes that start like
 * a zip read as one, taking the guides of every `.lua` file in it; other
 * bytes read as UTF-8 text.
 *
 * Throws `LuaExtractError` when Lua `RegisterGuide` calls cannot be read, and
 * an `Error` for a zip that cannot be read or holds no `.lua` file, or when
 * plain text does not show which guide owns a tag or a bare condition.
 */
export async function importGuides(input: string | Uint8Array, options: ImportOptions = {}): Promise<ImportResult> {
  const { fileName } = options;
  let source: ImportSource;
  let found: Omit<ImportedGuide, "errors">[];

  const decoder = new TextDecoder();
  if (typeof input !== "string" && isZip(input)) {
    const files = await readZip(input, (path) => /\.lua$/i.test(path));
    if (files.length === 0) throw new Error("The zip holds no .lua file.");
    source = { kind: "zip" };
    found = files.flatMap((entry) => luaGuides(decoder.decode(entry.data)));
  } else {
    const text = typeof input === "string" ? input : decoder.decode(input);
    if (hasRegisterGuideCall(text)) {
      source = { kind: "lua" };
      found = luaGuides(text);
    } else {
      source = { kind: "text" };
      found = splitGuideText(text);
    }
  }

  const guides = found.map((guide): ImportedGuide => {
    const { header } = parseGuide(guide.text);
    const tagValue = (name: string) => {
      const line = header.find((l) => l.kind === "tag" && l.name === name);
      return line?.kind === "tag" ? line.value.trim() : "";
    };
    const name = tagValue("name");
    const errors: string[] = [];
    if (!name) errors.push("Missing #name.");
    if (!tagValue("group") && !guide.registerArgs) errors.push("Missing #group.");
    const imported: ImportedGuide = { ...guide, errors };
    if (name) imported.name = name;
    return imported;
  });
  const result: ImportResult = { source, guides };
  if (fileName !== undefined) result.fileName = fileName;
  return result;
}

// A zip starts with a local header, or with the end record when it is empty.
const isZip = (bytes: Uint8Array) =>
  bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06));

const luaGuides = (source: string) =>
  extractGuides(source).map(({ text, line, group, defaultFor }) => {
    const guide: AddonGuide & { line: number } = { text, line };
    if (group !== undefined) guide.registerArgs = registerArgs(group, defaultFor);
    return guide;
  });
