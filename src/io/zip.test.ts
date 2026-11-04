import { describe, expect, it } from "vitest";
import { deflatedZip } from "./testing.ts";
import { createZip, readZip, type ZipEntry } from "./zip.ts";

const encoder = new TextEncoder();
const entries: ZipEntry[] = [
  { path: "Élan/Élan.toc", data: encoder.encode("## Title: Élan\nguides.lua\n") },
  { path: "Élan/guides.lua", data: encoder.encode("RXPGuides.RegisterGuide([[\n#name A\nstep\n]])\n".repeat(50)) },
  { path: "Élan/empty.txt", data: new Uint8Array() },
];
const read = async (zip: Uint8Array, include?: (path: string) => boolean) =>
  (await readZip(zip, include)).map(({ path, data }) => ({ path, text: new TextDecoder().decode(data) }));
const expected = entries.map(({ path, data }) => ({ path, text: new TextDecoder().decode(data) }));
/** Where an entry's data starts in a zip that begins with it: after the 30-byte local header and the path. */
const dataStart = (entry: ZipEntry) => 30 + encoder.encode(entry.path).length;

describe("readZip", () => {
  it("reads stored entries", async () => {
    expect(await read(createZip(entries))).toEqual(expected);
  });

  it.each([false, true])("reads deflated entries, with data descriptors: %s", async (descriptor) => {
    const zip = deflatedZip(entries, descriptor);
    expect(zip.length).toBeLessThan(createZip(entries).length);
    expect(await read(zip)).toEqual(expected);
  });

  it("skips directories and reads past a comment", async () => {
    const zip = createZip([{ path: "Élan/", data: new Uint8Array() }, ...entries]);
    const commented = new Uint8Array([...zip, ...encoder.encode("comment")]);
    new DataView(commented.buffer).setUint16(zip.length - 2, 7, true);
    expect(await read(commented)).toEqual(expected);
  });

  it("rejects a bad CRC-32, an unknown method, encryption, zip64, and a file that is not a zip", async () => {
    const zip = createZip(entries.slice(0, 1));
    const corrupt = zip.slice();
    corrupt[dataStart(entries[0]!) + 4]! ^= 1;
    await expect(readZip(corrupt)).rejects.toThrow("The zip is damaged. Élan/Élan.toc does not match its CRC-32.");

    const central = dataStart(entries[0]!) + entries[0]!.data.length;
    const bzip2 = zip.slice();
    new DataView(bzip2.buffer).setUint16(central + 10, 12, true);
    await expect(readZip(bzip2)).rejects.toThrow(
      "Élan/Élan.toc uses compression method 12. The reader supports only stored and deflated files.",
    );
    const encrypted = zip.slice();
    new DataView(encrypted.buffer).setUint16(central + 8, 0x0801, true);
    await expect(readZip(encrypted)).rejects.toThrow("Élan/Élan.toc is encrypted.");

    const zip64 = zip.slice();
    new DataView(zip64.buffer).setUint32(zip.length - 6, 0xffffffff, true);
    await expect(readZip(zip64)).rejects.toThrow("The zip uses zip64, which the reader does not support.");

    await expect(readZip(encoder.encode("#name A\n"))).rejects.toThrow("The file is not a zip. It has no end of central directory record.");
  });

  it("rejects deflated data that does not inflate", async () => {
    const zip = deflatedZip(entries.slice(1, 2));
    zip.fill(0xff, dataStart(entries[1]!), dataStart(entries[1]!) + 10);
    await expect(readZip(zip)).rejects.toThrow("The zip is damaged. Élan/guides.lua does not inflate.");
  });

  it("reads only the files that the filter accepts, and inflates no other file", async () => {
    const zip = deflatedZip(entries);
    zip.fill(0xff, dataStart(entries[0]!), dataStart(entries[0]!) + 10);
    expect(await read(zip, (path) => path !== entries[0]!.path)).toEqual(expected.slice(1));
  });

  it("rejects offsets and lengths that point past the end of the file", async () => {
    const zip = createZip(entries.slice(0, 1));
    const central = dataStart(entries[0]!) + entries[0]!.data.length;
    const damaged = (at: number, value: number, size: 2 | 4) => {
      const copy = zip.slice();
      const view = new DataView(copy.buffer);
      if (size === 4) view.setUint32(at, value, true);
      else view.setUint16(at, value, true);
      return readZip(copy);
    };
    await expect(damaged(zip.length - 6, 0xfffffff0, 4)).rejects.toThrow(
      "The zip is damaged. The central directory goes past the end of the file.",
    );
    await expect(damaged(zip.length - 12, 2, 2)).rejects.toThrow(
      "The zip is damaged. The central directory goes past the end of the file.",
    );
    await expect(damaged(central + 28, 0xffff, 2)).rejects.toThrow(
      "The zip is damaged. The central directory goes past the end of the file.",
    );
    await expect(damaged(central + 42, 0xfffffff0, 4)).rejects.toThrow(
      "The zip is damaged. The local header of Élan/Élan.toc goes past the end of the file.",
    );
    await expect(damaged(central + 20, 0xfffffff0, 4)).rejects.toThrow(
      "The zip is damaged. The data of Élan/Élan.toc goes past the end of the file.",
    );
  });

  it("stops inflating past the size limit, in one file or in all files together", async () => {
    const limit = 32 * 1024 * 1024;
    const tooLarge = "The zip unzips to more than 32 MB of guide files, which is more than the planner reads.";
    const one = deflatedZip([{ path: "guides.lua", data: new Uint8Array(limit + 1) }]);
    expect(one.length).toBeLessThan(64 * 1024);
    await expect(readZip(one)).rejects.toThrow(tooLarge);
    const half = new Uint8Array(limit / 2 + 1);
    const two = deflatedZip([
      { path: "a.lua", data: half },
      { path: "b.lua", data: half },
    ]);
    await expect(readZip(two)).rejects.toThrow(tooLarge);
    await expect(readZip(two, (path) => path === "a.lua")).resolves.toHaveLength(1);
    const stored = createZip([{ path: "guides.lua", data: new Uint8Array(limit + 1) }]);
    await expect(readZip(stored)).rejects.toThrow(tooLarge);
  });

  it("rejects files that share data, before it inflates any of them", async () => {
    const zip = deflatedZip(entries.slice(1, 2));
    const central = zip.length - 22 - (46 + encoder.encode(entries[1]!.path).length);
    const copies = 1000;
    const shared = new Uint8Array([
      ...zip.subarray(0, central),
      ...Array.from({ length: copies }, () => [...zip.subarray(central, -22)]).flat(),
      ...zip.subarray(-22),
    ]);
    const end = new DataView(shared.buffer, shared.length - 22);
    end.setUint16(8, copies, true);
    end.setUint16(10, copies, true);
    end.setUint32(12, shared.length - 22 - central, true);
    await expect(readZip(shared)).rejects.toThrow("The zip is damaged. Élan/guides.lua overlaps Élan/guides.lua.");
  });
});
