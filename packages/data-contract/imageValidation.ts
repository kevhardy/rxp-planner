import { requireValid } from "./checks.ts";

export interface ImageHeader {
  width: number;
  height: number;
}

export function validateImageContainer(format: string, bytes: Uint8Array, path: string): ImageHeader {
  const header = format === "png" ? png(bytes) : format === "jpeg" ? jpeg(bytes) : format === "webp" ? webp(bytes) : undefined;
  requireValid(header, `image container ${path}`);
  return header;
}

const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// PNG specification, sections 5 and 11: https://www.w3.org/TR/png/
function png(bytes: Uint8Array): ImageHeader | undefined {
  if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return;
  const view = viewOf(bytes);
  let header: ImageHeader | undefined,
    data = false,
    palette = false,
    indexed = false;
  for (let at = 8; at < bytes.length;) {
    if (at + 12 > bytes.length) return;
    const size = view.getUint32(at),
      type = ascii(bytes, at + 4, 4),
      end = at + 12 + size;
    if (size > 0x7fffffff || end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) return;
    if (!header && type !== "IHDR") return;
    if (type === "IHDR") {
      if (header || size !== 13) return;
      const width = view.getUint32(at + 8),
        height = view.getUint32(at + 12);
      const depth = bytes[at + 16]!,
        color = bytes[at + 17]!;
      const depths: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (
        !width ||
        !height ||
        width > 0x7fffffff ||
        height > 0x7fffffff ||
        !depths[color]?.includes(depth) ||
        bytes[at + 18] !== 0 ||
        bytes[at + 19] !== 0 ||
        bytes[at + 20]! > 1
      )
        return;
      indexed = color === 3;
      header = { width, height };
    } else if (type === "PLTE") {
      if (data || palette || !size || size > 768 || size % 3) return;
      palette = true;
    } else if (type === "IDAT") {
      if (indexed && !palette) return;
      data ||= size > 0;
    } else if (type === "IEND") return size === 0 && data && end === bytes.length ? header : undefined;
    at = end;
  }
}

// JPEG marker segments and entropy byte stuffing: ITU T.81, Annex B.
// https://www.w3.org/Graphics/JPEG/itu-t81.pdf
function jpeg(bytes: Uint8Array): ImageHeader | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  const view = viewOf(bytes);
  let at = 2,
    frame: ImageHeader | undefined,
    scan = false,
    data = false;
  while (at < bytes.length) {
    if (bytes[at++] !== 0xff) return;
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === 0xd9) return scan && data && at === bytes.length ? frame : undefined;
    if (marker === undefined || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return;
    if (marker === 1) continue; // TEM has no segment length.
    if (at + 2 > bytes.length) return;
    const size = view.getUint16(at),
      end = at + size;
    if (size < 2 || end > bytes.length) return;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (size < 8 || !view.getUint16(at + 3) || !view.getUint16(at + 5) || !bytes[at + 7] || size !== 8 + 3 * bytes[at + 7]!) return;
      frame = { width: view.getUint16(at + 5), height: view.getUint16(at + 3) };
    }
    if (marker === 0xda) {
      if (!frame || size < 6 || !bytes[at + 2] || size !== 6 + 2 * bytes[at + 2]!) return;
      scan = true;
      at = end;
      // Scan data ends at a marker, except stuffed FF bytes and restart markers.
      while (at < bytes.length) {
        if (bytes[at] !== 0xff) {
          data = true;
          at++;
          continue;
        }
        const next = bytes[at + 1];
        if (next === 0) {
          data = true;
          at += 2;
        } else if (next !== undefined && next >= 0xd0 && next <= 0xd7) at += 2;
        else break;
      }
    } else at = end;
  }
}

// RIFF chunk sizes exclude headers and include a separate zero pad for odd payloads.
// https://developers.google.com/speed/webp/docs/riff_container
function webp(bytes: Uint8Array): ImageHeader | undefined {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return;
  const view = viewOf(bytes);
  if (view.getUint32(4, true) + 8 !== bytes.length || !["VP8 ", "VP8L", "VP8X"].includes(ascii(bytes, 12, 4))) return;
  const uint24 = (at: number) => view.getUint16(at, true) | (bytes[at + 2]! << 16);
  let header: ImageHeader | undefined;
  // ANMF contains one level of frame chunks; never follow arbitrary nesting.
  const chunks = (start: number, limit: number, frame: boolean): boolean => {
    let image = false,
      extended = false,
      animated = false,
      animationHeader = false;
    for (let at = start; at < limit;) {
      if (at + 8 > limit) return false;
      const type = ascii(bytes, at, 4),
        size = view.getUint32(at + 4, true),
        payload = at + 8,
        end = payload + size;
      if (end + (size % 2) > limit || (size % 2 && bytes[end] !== 0)) return false;
      if (type === "VP8 " || type === "VP8L") {
        if (image || animated) return false;
        if (type === "VP8 ") {
          if (
            size <= 10 ||
            (bytes[payload]! & 1) !== 0 ||
            bytes[payload + 3] !== 0x9d ||
            bytes[payload + 4] !== 1 ||
            bytes[payload + 5] !== 0x2a ||
            !(view.getUint16(payload + 6, true) & 0x3fff) ||
            !(view.getUint16(payload + 8, true) & 0x3fff)
          )
            return false;
        } else if (size <= 5 || bytes[payload] !== 0x2f || (bytes[payload + 4]! & 0xe0) !== 0) return false;
        if (!frame && !extended) {
          const bits = view.getUint32(payload + 1, true);
          header =
            type === "VP8 "
              ? { width: view.getUint16(payload + 6, true) & 0x3fff, height: view.getUint16(payload + 8, true) & 0x3fff }
              : { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
        }
        image = true;
      } else if (type === "VP8X") {
        if (
          frame ||
          at !== start ||
          size !== 10 ||
          bytes[payload]! & 0xc1 ||
          bytes[payload + 1] ||
          bytes[payload + 2] ||
          bytes[payload + 3]
        )
          return false;
        extended = true;
        header = { width: uint24(payload + 4) + 1, height: uint24(payload + 7) + 1 };
        animated = (bytes[payload]! & 2) !== 0;
      } else if (type === "ANIM") {
        if (frame || !extended || !animated || animationHeader || size !== 6) return false;
        animationHeader = true;
      } else if (type === "ANMF") {
        if (frame || !animationHeader || size < 16 || !chunks(payload + 16, end, true)) return false;
        image = true;
      }
      at = end + (size % 2);
    }
    return image;
  };
  return chunks(12, bytes.length, false) ? header : undefined;
}
