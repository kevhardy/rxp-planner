import { datasetPath, fields, integer, object, positive, requireValid } from "./checks.ts";

/**
 * A texture key in the one form that the planner and the producer compare. A
 * FileDataID is its decimal digits without leading zeros, such as `134414`. A
 * path is ASCII lowercase, uses `/`, and has no `.blp` extension, such as
 * `interface/worldmap/chatbubble_64grey`. Only `textureKey` makes one.
 */
export type TextureKey = string & { readonly __textureKey: unique symbol };

/**
 * The key of a texture escape `|T<raw>:...|t`, as the game resolves it: a
 * number is a FileDataID, and a path ignores case, takes `/` or `\`, and can
 * leave out `.blp`. Gives `undefined` for a key that names no file, such as
 * `0`, or that the guide texture grammar does not accept: no characters other
 * than letters, digits, `_`, `.`, `-`, and slashes, at least one slash, and
 * no empty, `.`, or `..` segment. A missing `interface/icons/` stays missing.
 */
export function textureKey(raw: string): TextureKey | undefined {
  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    return positive(id) ? (String(id) as TextureKey) : undefined;
  }
  if (!/^[\w.\\/-]+$/.test(raw)) return undefined;
  return listfilePath(raw) as TextureKey | undefined;
}

function listfilePath(raw: string): string | undefined {
  if (/[^\x20-\x7e]/.test(raw)) return undefined;
  const path = raw
    .toLowerCase()
    .replaceAll("\\", "/")
    .replace(/\.blp$/, "");
  const segments = path.split("/");
  return segments.length > 1 && segments.every((s) => s !== "" && s !== "." && s !== "..") ? path : undefined;
}

/**
 * A part of a texture file, as the crop arguments of a texture escape
 * `|T<file>:0:0:0:0:<width>:<height>:<left>:<right>:<top>:<bottom>|t` give
 * it: the box from `left` to `right` and from `top` to `bottom` of the file
 * read as `width` × `height`. Each is a whole number, and the box is not
 * empty and lies inside the file.
 */
export interface TextureCrop {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const CROP_FIELDS = ["width", "height", "left", "right", "top", "bottom"] as const;

function validCrop(crop: unknown): crop is TextureCrop {
  if (!fields(crop, { width: integer, height: integer, left: integer, right: integer, top: integer, bottom: integer })) return false;
  const { width, height, left, right, top, bottom } = crop;
  return 0 <= left && left < right && right <= width && 0 <= top && top < bottom && bottom <= height;
}

/**
 * The key of a part of a file, such as `136441:128:128:63:72:0:4`: a
 * FileDataID and then its crop, in the order of a texture escape. Only
 * `cropKey` makes one.
 */
export type CropKey = string & { readonly __cropKey: unique symbol };

export type GuideIconKey = TextureKey | CropKey;

/** The crop key of `crop` of the file `fileDataId`, or `undefined` for an invalid crop. */
export function cropKey(fileDataId: number, crop: TextureCrop): CropKey | undefined {
  return positive(fileDataId) && validCrop(crop)
    ? (`${fileDataId}:${CROP_FIELDS.map((field) => crop[field]).join(":")}` as CropKey)
    : undefined;
}

/** The file and the crop that `raw` names, when `raw` is a crop key exactly as `cropKey` writes it. */
export function parseCropKey(raw: string): { fileDataId: number; crop: TextureCrop } | undefined {
  const [fileDataId, width, height, left, right, top, bottom] = raw.split(":").map(Number);
  const crop = { width, height, left, right, top, bottom };
  return fileDataId !== undefined && validCrop(crop) && cropKey(fileDataId, crop) === raw ? { fileDataId, crop } : undefined;
}

/** One file of the sheet, or one part of a file. A matching FileDataID key or path key names a whole-file row, and only its crop key names a part. */
export interface GuideIcon {
  fileDataId: number;
  /** The listfile path in ASCII lowercase, with `/` and no final `.blp`.
   * Only printable ASCII, including spaces. At least two segments, none empty, `.` or `..`.
   */
  path: string;
  /** The part of the file that the cell shows. Without it, the cell shows the whole file. */
  crop?: TextureCrop;
}

export function compareGuideIcons(a: GuideIcon, b: GuideIcon): number {
  if (a.fileDataId !== b.fileDataId) return a.fileDataId - b.fileDataId;
  if (!a.crop || !b.crop) return Number(a.crop !== undefined) - Number(b.crop !== undefined);
  const field = CROP_FIELDS.find((name) => a.crop![name] !== b.crop![name]);
  return field ? a.crop[field] - b.crop[field] : 0;
}

/** The `guide-icons` asset that the manifest's `guideIcons` field names. Row `i` draws from `guideIconCell(i, columns)` of `image`. */
export interface GuideIconsFile {
  version: 1;
  /** The PNG sheet, a dataset path. */
  image: string;
  columns: number;
  /** In the order of `compareGuideIcons`, each row once. */
  icons: GuideIcon[];
}

const CELL = 64;
// Transparent pixels on each side of a cell, so that a scaled draw does not sample its neighbor.
const GUTTER = 2;
const SLOT = CELL + 2 * GUTTER;

export function guideIconCell(index: number, columns: number): { x: number; y: number; width: number; height: number } {
  return { x: (index % columns) * SLOT + GUTTER, y: Math.floor(index / columns) * SLOT + GUTTER, width: CELL, height: CELL };
}

/** The exact pixel size of a sheet of `rowCount` rows in `columns` columns. */
export function guideIconSheetSize(rowCount: number, columns: number): { width: number; height: number } {
  return { width: columns * SLOT, height: Math.ceil(rowCount / columns) * SLOT };
}

/** Checks every guide icons rule that needs no other asset. Unknown keys survive. */
export function decodeGuideIconsFile(input: unknown): GuideIconsFile {
  requireValid(object(input), "guide icons file");
  requireValid(input.version === 1, `guide icons file version ${String(input.version)}, expected version 1`);
  const { image, columns, icons } = input;
  requireValid(typeof image === "string" && datasetPath(image) && Array.isArray(icons) && icons.length > 0, "guide icons file");
  requireValid(positive(columns) && columns <= icons.length, `guide icons columns ${String(columns)}`);
  const fileOfPath = new Map<string, number>();
  let last: GuideIcon | undefined;
  const rows = icons.map((icon: unknown, i): GuideIcon => {
    requireValid(object(icon), `guide icon ${i}`);
    const { fileDataId, crop } = icon;
    requireValid(positive(fileDataId), `guide icon ${i}`);
    requireValid(crop === undefined || validCrop(crop), `guide icon ${fileDataId} crop`);
    const name = crop === undefined ? String(fileDataId) : cropKey(fileDataId, crop)!;
    const path = typeof icon.path === "string" ? listfilePath(icon.path) : undefined;
    requireValid(path !== undefined && path === icon.path, `guide icon ${name} path`);
    const row: GuideIcon = { ...icon, fileDataId, path };
    const order = last ? compareGuideIcons(last, row) : -1;
    requireValid(order !== 0, `duplicate guide icon ${name}`);
    requireValid(order < 0, `guide icon ${name} order`);
    requireValid((fileOfPath.get(path) ?? fileDataId) === fileDataId, `duplicate guide icon path ${path}`);
    fileOfPath.set(path, fileDataId);
    last = row;
    return row;
  });
  return { ...input, version: 1, image, columns, icons: rows };
}
