// Maps that may not grow without end: a Map keeps its keys in the order they
// went in, so the first key is the one used least recently when reads and
// writes both move a key to the back.

/** The value at `key`, moved to the back of the line, or undefined. */
export function touch<K, V>(map: Map<K, V>, key: K): V | undefined {
  if (!map.has(key)) return undefined;
  const value = map.get(key) as V;
  map.delete(key);
  map.set(key, value);
  return value;
}

/** Sets `key` at the back of the line, then drops from the front until at
 * most `max` are left; `evicted` hears of each one dropped. */
export function setCapped<K, V>(map: Map<K, V>, key: K, value: V, max: number, evicted?: (value: V, key: K) => void): void {
  map.delete(key);
  map.set(key, value);
  for (const [oldest, held] of map) {
    if (map.size <= max) break;
    map.delete(oldest);
    evicted?.(held, oldest);
  }
}
