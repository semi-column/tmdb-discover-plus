import { describe, it, expect } from 'vitest';
import { isValidContentType } from '../../src/utils/validation.ts';

describe('Addon type parameter validation', () => {
  it('accepts "movie"', () => {
    expect(isValidContentType('movie')).toBe(true);
  });

  it('accepts "series"', () => {
    expect(isValidContentType('series')).toBe(true);
  });

  it('rejects invalid types', () => {
    expect(isValidContentType('invalid')).toBe(false);
    expect(isValidContentType('../../etc/passwd')).toBe(false);
    expect(isValidContentType('')).toBe(false);
  });

  it('accepts "tv" as alias for series', () => {
    expect(isValidContentType('tv')).toBe(true);
  });
});
