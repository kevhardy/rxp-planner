/** Sets `key` in `map`, then deletes the oldest entries until at most `limit` remain. A key that is present keeps its age. */
export function keepNewest<K, V>(map: Map<K, V>, key: K, value: V, limit: number): void {
  map.set(key, value);
  for (const old of map.keys()) {
    if (map.size <= limit) break;
    map.delete(old);
  }
}
