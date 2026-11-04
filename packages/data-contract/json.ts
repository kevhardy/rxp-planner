/**
 * A static data file's content: gzip bytes decompressed, or the bytes as they
 * are when a server has already removed the gzip layer.
 */
export async function withoutGzip(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const data = new Uint8Array(bytes);
  if (data[0] !== 0x1f || data[1] !== 0x8b) return data;
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodeJson(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await withoutGzip(bytes)));
}
