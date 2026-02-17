export function stableStringify(value: unknown, seen: WeakSet<object> = new WeakSet()): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);

  if (seen.has(value as object)) return '"[Circular]"';
  seen.add(value as object);

  if (Array.isArray(value)) return '[' + value.map((v) => stableStringify(v, seen)).join(',') + ']';

  const sorted = Object.keys(value as Record<string, unknown>).sort();
  const pairs = sorted.map(
    (k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k], seen)
  );
  return '{' + pairs.join(',') + '}';
}
