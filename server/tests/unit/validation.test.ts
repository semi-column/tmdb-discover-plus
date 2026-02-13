import { describe, it, expect } from 'vitest';
import {
  isValidApiKeyFormat,
  isValidUserId,
  isValidCatalogId,
  sanitizeString,
  sanitizePage,
  isValidContentType,
  normalizeContentType,
  sanitizeFilters,
} from '../../src/utils/validation.ts';

describe('isValidApiKeyFormat', () => {
  it('accepts valid 32-char hex key', () => {
    expect(isValidApiKeyFormat('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(true);
  });
  it('accepts uppercase hex', () => {
    expect(isValidApiKeyFormat('A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4')).toBe(true);
  });
  it('rejects too short', () => {
    expect(isValidApiKeyFormat('a1b2c3')).toBe(false);
  });
  it('rejects too long', () => {
    expect(isValidApiKeyFormat('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4ff')).toBe(false);
  });
  it('rejects non-hex chars', () => {
    expect(isValidApiKeyFormat('g1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(false);
  });
  it('rejects null/undefined/empty', () => {
    expect(isValidApiKeyFormat(null)).toBe(false);
    expect(isValidApiKeyFormat(undefined)).toBe(false);
    expect(isValidApiKeyFormat('')).toBe(false);
  });
  it('rejects non-string', () => {
    expect(isValidApiKeyFormat(12345)).toBe(false);
  });
});

describe('isValidUserId', () => {
  it('accepts valid userId', () => {
    expect(isValidUserId('user_123')).toBe(true);
    expect(isValidUserId('abc-XYZ_09')).toBe(true);
  });
  it('rejects too short (< 6)', () => {
    expect(isValidUserId('abc')).toBe(false);
  });
  it('rejects too long (> 30)', () => {
    expect(isValidUserId('a'.repeat(31))).toBe(false);
  });
  it('rejects special chars', () => {
    expect(isValidUserId('user@123')).toBe(false);
    expect(isValidUserId('user 123')).toBe(false);
  });
  it('rejects null/undefined', () => {
    expect(isValidUserId(null)).toBe(false);
    expect(isValidUserId(undefined)).toBe(false);
  });
});

describe('isValidCatalogId', () => {
  it('accepts valid catalog IDs', () => {
    expect(isValidCatalogId('my-catalog_01')).toBe(true);
    expect(isValidCatalogId('a')).toBe(true);
  });
  it('rejects empty string', () => {
    expect(isValidCatalogId('')).toBe(false);
  });
  it('rejects too long (> 64)', () => {
    expect(isValidCatalogId('a'.repeat(65))).toBe(false);
  });
  it('rejects special chars', () => {
    expect(isValidCatalogId('cat!log')).toBe(false);
  });
});

describe('sanitizeString', () => {
  it('strips control characters', () => {
    expect(sanitizeString('hello\x00world')).toBe('helloworld');
  });
  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });
  it('truncates to maxLength', () => {
    expect(sanitizeString('abcdefgh', 5)).toBe('abcde');
  });
  it('returns empty for non-string', () => {
    expect(sanitizeString(null)).toBe('');
    expect(sanitizeString(undefined)).toBe('');
    expect(sanitizeString(123)).toBe('');
  });
  it('preserves normal text', () => {
    expect(sanitizeString('The Matrix')).toBe('The Matrix');
  });
});

describe('sanitizePage', () => {
  it('returns valid page numbers', () => {
    expect(sanitizePage(1)).toBe(1);
    expect(sanitizePage(100)).toBe(100);
  });
  it('clamps to 1 for invalid/low values', () => {
    expect(sanitizePage(0)).toBe(1);
    expect(sanitizePage(-5)).toBe(1);
    expect(sanitizePage('abc')).toBe(1);
  });
  it('clamps to 500 max', () => {
    expect(sanitizePage(999)).toBe(500);
    expect(sanitizePage(500)).toBe(500);
  });
  it('parses string numbers', () => {
    expect(sanitizePage('42')).toBe(42);
  });
});

describe('isValidContentType', () => {
  it('accepts movie, series, tv', () => {
    expect(isValidContentType('movie')).toBe(true);
    expect(isValidContentType('series')).toBe(true);
    expect(isValidContentType('tv')).toBe(true);
  });
  it('rejects invalid types', () => {
    expect(isValidContentType('anime')).toBe(false);
    expect(isValidContentType('')).toBe(false);
  });
});

describe('normalizeContentType', () => {
  it('normalizes series to tv', () => {
    expect(normalizeContentType('series')).toBe('tv');
  });
  it('passes through movie', () => {
    expect(normalizeContentType('movie')).toBe('movie');
  });
  it('passes through tv', () => {
    expect(normalizeContentType('tv')).toBe('tv');
  });
});

describe('sanitizeFilters', () => {
  it('only allows known keys', () => {
    const result = sanitizeFilters({ sortBy: 'popularity.desc', evil: 'DROP TABLE', genres: ['28'] });
    expect(result).toHaveProperty('sortBy', 'popularity.desc');
    expect(result).toHaveProperty('genres');
    expect(result).not.toHaveProperty('evil');
  });

  it('sanitizes string values', () => {
    const result = sanitizeFilters({ sortBy: '  popularity.desc\x00  ' });
    expect(result.sortBy).toBe('popularity.desc');
  });

  it('preserves booleans and numbers', () => {
    const result = sanitizeFilters({ imdbOnly: true, voteCount: 100 });
    expect(result.imdbOnly).toBe(true);
    expect(result.voteCount).toBe(100);
  });

  it('truncates arrays to 50 items', () => {
    const bigArray = Array.from({ length: 60 }, (_, i) => String(i));
    const result = sanitizeFilters({ genres: bigArray });
    expect((result.genres as string[]).length).toBe(50);
  });

  it('returns empty object for invalid input', () => {
    expect(sanitizeFilters(null)).toEqual({});
    expect(sanitizeFilters(undefined)).toEqual({});
    expect(sanitizeFilters('string')).toEqual({});
  });
});
