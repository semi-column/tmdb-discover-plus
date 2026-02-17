import { describe, it, expect } from 'vitest';
import { generateETag } from '../../src/utils/etag.ts';

describe('generateETag', () => {
  it('returns a weak ETag string', () => {
    const etag = generateETag({ foo: 'bar' });
    expect(etag).toMatch(/^W\/"[a-f0-9]{20}"$/);
  });

  it('returns same ETag for same data', () => {
    const a = generateETag({ x: 1 });
    const b = generateETag({ x: 1 });
    expect(a).toBe(b);
  });

  it('returns different ETag for different data', () => {
    const a = generateETag({ x: 1 });
    const b = generateETag({ x: 2 });
    expect(a).not.toBe(b);
  });

  it('incorporates extra string into hash', () => {
    const a = generateETag({ x: 1 }, 'user1');
    const b = generateETag({ x: 1 }, 'user2');
    expect(a).not.toBe(b);
  });

  it('handles string data', () => {
    const etag = generateETag('hello world');
    expect(etag).toMatch(/^W\/"[a-f0-9]{20}"$/);
  });

  it('handles null and undefined', () => {
    const a = generateETag(null);
    const b = generateETag(undefined);
    expect(a).toMatch(/^W\//);
    expect(b).toMatch(/^W\//);
    expect(a).not.toBe(b);
  });
});
