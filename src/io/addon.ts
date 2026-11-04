// Exports guides as a WoW Classic addon that registers them with RXP.
// `<Folder>/<Folder>.toc` loads `guides.lua`, which calls
// `RXPGuides.RegisterGuide([[...]])` once per guide.
//
// Line endings: Lua reads every line ending inside a long string as LF, so
// RXP receives LF text whatever the file holds. The exported Lua therefore
// uses LF only; each guide registers its text with CRLF and CR turned into
// LF, and is otherwise unchanged.

import type { RegisterArgs } from "../guide/index.ts";
import { createZip } from "./zip.ts";

/**
 * Client interface versions: Classic Era and its seasons (11509), and Forever
 * (16001), as the toc of the bundled RXPGuides lists them. A client skips an
 * addon that does not list its version, unless out-of-date addons are allowed.
 */
const ADDON_INTERFACE = "11509, 16001";

export interface AddonFile {
  /** Path inside the zip, starting with the addon folder. */
  path: string;
  content: string;
}

export interface ExportedAddon {
  folder: string;
  files: AddonFile[];
  zip: Uint8Array<ArrayBuffer>;
}

export function registerArgs(group: string, defaultFor: string | undefined): RegisterArgs {
  const args: RegisterArgs = { group };
  if (defaultFor !== undefined) args.defaultFor = defaultFor;
  return args;
}

export interface AddonGuide {
  text: string;
  registerArgs?: RegisterArgs;
}

export interface ExportOptions {
  /** The addon name, which names the folder and its `.toc`. A blank name gives the folder that the title makes. */
  name?: string;
  modified?: Date;
}

export function exportAddon(title: string, guides: (string | AddonGuide)[], { name, modified }: ExportOptions = {}): ExportedAddon {
  const titleFolder = addonFolderName(title);
  const folder = name?.trim() ? addonFolderName(name) : titleFolder;
  const toc = [
    `## Interface: ${ADDON_INTERFACE}`,
    `## Title: ${title.replace(/[\x00-\x1f\x7f]+/g, " ").trim() || titleFolder}`,
    "## Dependencies: RXPGuides",
    "guides.lua",
    "",
  ].join("\n");
  const lua = guides
    .map((guide) => {
      const { text, registerArgs } = typeof guide === "string" ? { text: guide } : guide;
      const args = registerArgs
        ? [registerArgs.group, text, ...(registerArgs.defaultFor === undefined ? [] : [registerArgs.defaultFor])]
        : [text];
      return `RXPGuides.RegisterGuide(${args.map(luaLongString).join(", ")})\n`;
    })
    .join("");
  const files = [
    { path: `${folder}/${folder}.toc`, content: toc },
    { path: `${folder}/guides.lua`, content: lua },
  ];
  const encoder = new TextEncoder();
  const zip = createZip(
    files.map((f) => ({ path: f.path, data: encoder.encode(f.content) })),
    modified,
  );
  return { folder, files, zip };
}

/**
 * Turns a title into a folder name of ASCII letters, digits, `_`, and `-`.
 * Names that could replace RXP's or Blizzard's folders, or that Windows
 * reserves for devices, get a `Custom_` prefix.
 */
export function addonFolderName(title: string): string {
  const name = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .slice(0, 64)
    .replace(/^[_-]+|[_-]+$/g, "");
  if (!name) return "RXPPlannerGuides";
  return /^(rxp|blizzard)|^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? `Custom_${name}` : name;
}

/**
 * Quotes text as a Lua long string that reads back as `text` with CRLF and CR
 * turned into LF. The result holds no CR.
 *
 * Uses the lowest level from 1 whose closing bracket does not occur in the
 * text; level 0 is skipped because Lua 5.1 rejects `[[` inside `[[...]]`.
 * Lua drops one line ending right after the opening bracket, so one is
 * always written.
 */
function luaLongString(value: string): string {
  const text = value.replace(/\r\n?/g, "\n");
  let level = 1;
  const close = () => `]${"=".repeat(level)}]`;
  while ((text + close()).indexOf(close()) < text.length) level++;
  const eq = "=".repeat(level);
  return `[${eq}[\n${text}]${eq}]`;
}
