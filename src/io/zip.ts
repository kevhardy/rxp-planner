export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZip(entries: ZipEntry[], modified = new Date()): Uint8Array<ArrayBuffer> {
  const year = Math.max(modified.getFullYear(), 1980);
  const time = (modified.getHours() << 11) | (modified.getMinutes() << 5) | (modified.getSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((modified.getMonth() + 1) << 5) | modified.getDate();
  const files = entries.map((e) => ({ ...e, name: new TextEncoder().encode(e.path), crc: crc32(e.data) }));

  const localSize = files.reduce((n, f) => n + 30 + f.name.length + f.data.length, 0);
  const centralSize = files.reduce((n, f) => n + 46 + f.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (v: number) => (view.setUint16(at, v, true), (at += 2));
  const u32 = (v: number) => (view.setUint32(at, v, true), (at += 4));
  const bytes = (b: Uint8Array) => (out.set(b, at), (at += b.length));

  // Fields shared by local and central headers, from "version needed" on.
  const common = (f: (typeof files)[number]) => {
    u16(20); // version needed: 2.0
    u16(0x0800); // flags: UTF-8 names
    u16(0); // method: stored
    u16(time);
    u16(date);
    u32(f.crc);
    u32(f.data.length);
    u32(f.data.length);
    u16(f.name.length);
    u16(0); // extra length
  };

  const offsets: number[] = [];
  for (const f of files) {
    offsets.push(at);
    u32(0x04034b50);
    common(f);
    bytes(f.name);
    bytes(f.data);
  }
  files.forEach((f, i) => {
    u32(0x02014b50);
    u16(20); // version made by: 2.0, MS-DOS attributes
    common(f);
    u16(0); // comment length
    u16(0); // disk number
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]!);
    bytes(f.name);
  });
  u32(0x06054b50);
  u16(0); // this disk
  u16(0); // disk with central directory
  u16(files.length);
  u16(files.length);
  u32(centralSize);
  u32(localSize);
  u16(0); // comment length
  return out;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

/** Bounds the memory that an untrusted zip can take. An export of every built-in guide is far smaller. */
const MAX_UNZIPPED_BYTES = 32 * 1024 * 1024;

const damaged = (detail: string) => new Error(`The zip is damaged. ${detail}`);
const tooLarge = () =>
  new Error(`The zip unzips to more than ${MAX_UNZIPPED_BYTES / 1024 / 1024} MB of guide files, which is more than the planner reads.`);

/**
 * Reads the files of a zip that `include` accepts, in central directory order.
 * Sizes and offsets come from the central directory, so entries that put
 * their sizes in a data descriptor read too. The files may unzip to at most
 * `MAX_UNZIPPED_BYTES` in total, counted as they inflate, because a small zip
 * can declare false sizes and inflate to gigabytes. Files must not overlap.
 */
export async function readZip(bytes: Uint8Array, include: (path: string) => boolean = () => true): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const within = (at: number, length: number, what: string) => {
    if (at + length > bytes.length) throw damaged(`${what} goes past the end of the file.`);
  };
  // The end record is 22 bytes and may carry a comment of up to 65535 bytes.
  let end = bytes.length - 22;
  const stop = Math.max(0, end - 0xffff);
  while (end >= stop && view.getUint32(end, true) !== END) end--;
  if (end < stop) throw new Error("The file is not a zip. It has no end of central directory record.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new Error("The zip uses zip64, which the reader does not support.");

  const decoder = new TextDecoder();
  const found: { path: string; method: number; crc: number; offset: number; start: number; end: number }[] = [];
  for (let i = 0; i < count; i++) {
    within(at, 46, "The central directory");
    if (view.getUint32(at, true) !== CENTRAL) throw damaged("Its central directory is incomplete.");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const next = at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    within(at, next - at, "The central directory");
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at = next;
    if (path.endsWith("/") || !include(path)) continue;
    if (flags & 1) throw new Error(`${path} is encrypted.`);
    if (size === 0xffffffff || offset === 0xffffffff) throw new Error("The zip uses zip64, which the reader does not support.");
    if (method !== 0 && method !== 8)
      throw new Error(`${path} uses compression method ${method}. The reader supports only stored and deflated files.`);
    within(offset, 30, `The local header of ${path}`);
    if (view.getUint32(offset, true) !== LOCAL) throw damaged(`${path} has no local header.`);
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    within(start, size, `The data of ${path}`);
    found.push({ path, method, crc, offset, start, end: start + size });
  }

  // Many entries can point at one compressed range, so overlaps could make the reader inflate far more than the file holds.
  const byOffset = found.toSorted((a, b) => a.offset - b.offset);
  byOffset.forEach((entry, i) => {
    const before = byOffset[i - 1];
    if (before && entry.offset < before.end) throw damaged(`${entry.path} overlaps ${before.path}.`);
  });

  const entries: ZipEntry[] = [];
  let budget = MAX_UNZIPPED_BYTES;
  for (const { path, method, crc, start, end } of found) {
    const raw = bytes.subarray(start, end);
    const data = method === 0 ? raw : await inflate(raw, budget).catch(() => null);
    if (data === null) throw damaged(`${path} does not inflate.`);
    if (data === "too large" || data.length > budget) throw tooLarge();
    budget -= data.length;
    if (crc32(data) !== crc) throw damaged(`${path} does not match its CRC-32.`);
    entries.push({ path, data });
  }
  return entries;
}

/** Inflates raw deflate data, and stops once the output passes `limit` bytes. */
async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array | "too large"> {
  const reader = new Response(data.slice()).body!.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    length += chunk.value.length;
    if (length > limit) {
      await reader.cancel();
      return "too large";
    }
    chunks.push(chunk.value);
  }
  const out = new Uint8Array(length);
  chunks.reduce((offset, chunk) => (out.set(chunk, offset), offset + chunk.length), 0);
  return out;
}
