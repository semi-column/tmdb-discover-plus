export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';

  const sorted = Object.keys(value as Record<string, unknown>).sort();
  const pairs = sorted.map(
    (k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]),
  );
  return '{' + pairs.join(',') + '}';
}
