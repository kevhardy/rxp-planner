/** The key of a search node, the same in each region of a terrain: its cell in the frame and its layer, 0 for a terrain node. */
export const encodeNodeKey = (column: number, row: number, layer: number): number => (row * 65536 + column) * 16 + layer;

export function decodeNodeKey(key: number): { column: number; row: number; layer: number } {
  const cell = Math.floor(key / 16);
  return { column: cell % 65536, row: Math.floor(cell / 65536), layer: key % 16 };
}
