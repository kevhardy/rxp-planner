import { crc32, deflateRawSync } from "node:zlib";
import type { ZipEntry } from "./zip.ts";

export function deflatedZip(entries: ZipEntry[], descriptor = false): Uint8Array<ArrayBuffer> {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    const data = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const header = (signature: number, size: number) => {
      const b = Buffer.alloc(size);
      b.writeUInt32LE(signature, 0);
      return b;
    };
    const head = header(0x04034b50, 30);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800 | (descriptor ? 8 : 0), 6);
    head.writeUInt16LE(8, 8);
    if (!descriptor) {
      head.writeUInt32LE(crc, 14);
      head.writeUInt32LE(data.length, 18);
      head.writeUInt32LE(entry.data.length, 22);
    }
    head.writeUInt16LE(name.length, 26);
    const tail = descriptor ? header(0x08074b50, 16) : Buffer.alloc(0);
    if (descriptor) {
      tail.writeUInt32LE(crc, 4);
      tail.writeUInt32LE(data.length, 8);
      tail.writeUInt32LE(entry.data.length, 12);
    }
    local.push(head, name, data, tail);

    const dir = header(0x02014b50, 46);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    head.copy(dir, 8, 6, 30);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(entry.data.length, 24);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + data.length + tail.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}
