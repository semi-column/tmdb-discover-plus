import { describe, it, expect } from 'vitest';
import {
  shuffleArray,
  normalizeGenreName,
  parseIdArray,
  setNoCacheHeaders,
  getBaseUrl,
} from '../../src/utils/helpers.ts';

describe('shuffleArray', () => {
  it('returns a new array with same elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffleArray(arr);
    expect(result).toHaveLength(arr.length);
    expect(result.sort()).toEqual(arr.sort());
  });

  it('does not mutate the original array', () => {
    const arr = [1, 2, 3];
    shuffleArray(arr);
    expect(arr).toEqual([1, 2, 3]);
  });

  it('handles empty array', () => {
    expect(shuffleArray([])).toEqual([]);
  });

  it('handles single element', () => {
    expect(shuffleArray([42])).toEqual([42]);
  });
});

describe('normalizeGenreName', () => {
  it('lowercases and trims', () => {
    expect(normalizeGenreName('  Action  ')).toBe('action');
  });

  it('replaces & with and', () => {
    expect(normalizeGenreName('Sci-Fi & Fantasy')).toBe('scifi and fantasy');
  });

  it('replaces en-dash and em-dash with space', () => {
    expect(normalizeGenreName('Sci\u2013Fi')).toBe('sci fi');
  });

  it('strips special characters', () => {
    expect(normalizeGenreName("Rock'n'Roll!")).toBe('rocknroll');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeGenreName('War  &  Politics')).toBe('war and politics');
  });

  it('handles null/undefined/empty', () => {
    expect(normalizeGenreName(null)).toBe('');
    expect(normalizeGenreName(undefined)).toBe('');
    expect(normalizeGenreName('')).toBe('');
  });

  it('handles numbers', () => {
    expect(normalizeGenreName(28)).toBe('28');
  });
});

describe('parseIdArray', () => {
  it('parses comma-separated string', () => {
    expect(parseIdArray('1,2,3')).toEqual(['1', '2', '3']);
  });

  it('trims whitespace', () => {
    expect(parseIdArray(' 1 , 2 , 3 ')).toEqual(['1', '2', '3']);
  });

  it('filters empty segments', () => {
    expect(parseIdArray('1,,3,')).toEqual(['1', '3']);
  });

  it('handles arrays', () => {
    expect(parseIdArray([1, 2, 3])).toEqual(['1', '2', '3']);
  });

  it('returns empty array for falsy input', () => {
    expect(parseIdArray(null)).toEqual([]);
    expect(parseIdArray(undefined)).toEqual([]);
    expect(parseIdArray('')).toEqual([]);
  });
});

describe('setNoCacheHeaders', () => {
  it('sets no-cache headers', () => {
    const headers: Record<string, string> = {};
    const res = {
      set: (name: string, value: string) => {
        headers[name] = value;
      },
    };
    setNoCacheHeaders(res);
    expect(headers['Cache-Control']).toBe('no-cache, no-store, must-revalidate');
    expect(headers['Pragma']).toBe('no-cache');
    expect(headers['Expires']).toBe('0');
  });
});

describe('getBaseUrl', () => {
  it('returns a string', () => {
    const req = {
      get: (name: string) => (name === 'origin' ? 'https://example.com/' : undefined),
      protocol: 'http',
    };
    const url = getBaseUrl(req);
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });
});
