import { describe, it, expect } from 'vitest';
import { stableStringify } from '../../src/utils/stableStringify.ts';

describe('stableStringify', () => {
  it('serializes primitives', () => {
    expect(stableStringify('hello')).toBe('"hello"');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify(true)).toBe('true');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('undefined');
  });

  it('serializes arrays', () => {
    expect(stableStringify([1, 2, 3])).toBe('[1,2,3]');
    expect(stableStringify([])).toBe('[]');
  });

  it('serializes objects with sorted keys', () => {
    const a = stableStringify({ z: 1, a: 2 });
    const b = stableStringify({ a: 2, z: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"z":1}');
  });

  it('handles nested objects/arrays', () => {
    const result = stableStringify({ b: [3, 1], a: { y: 1, x: 2 } });
    expect(result).toBe('{"a":{"x":2,"y":1},"b":[3,1]}');
  });
});
