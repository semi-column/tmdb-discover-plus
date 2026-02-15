import { describe, it, expect } from 'vitest';
import { sanitizeImdbFilters } from '../../src/utils/validation.ts';

describe('sanitizeImdbFilters', () => {
  it('returns empty object for null/undefined', () => {
    expect(sanitizeImdbFilters(null)).toEqual({});
    expect(sanitizeImdbFilters(undefined)).toEqual({});
  });

  it('returns empty object for non-object', () => {
    expect(sanitizeImdbFilters('string')).toEqual({});
    expect(sanitizeImdbFilters(42)).toEqual({});
  });

  it('preserves allowed string keys', () => {
    const result = sanitizeImdbFilters({ sortBy: 'POPULARITY', sortOrder: 'ASC' });
    expect(result.sortBy).toBe('POPULARITY');
    expect(result.sortOrder).toBe('ASC');
  });

  it('strips unknown keys', () => {
    const result = sanitizeImdbFilters({ sortBy: 'POPULARITY', evil: 'DROP TABLE', __proto__: {} });
    expect(result).toHaveProperty('sortBy');
    expect(result).not.toHaveProperty('evil');
    expect(result).not.toHaveProperty('__proto__');
  });

  it('preserves genre arrays', () => {
    const result = sanitizeImdbFilters({ genres: ['Action', 'Comedy'] });
    expect(result.genres).toEqual(['Action', 'Comedy']);
  });

  it('truncates arrays to 50 items', () => {
    const big = Array.from({ length: 60 }, (_, i) => `genre_${i}`);
    const result = sanitizeImdbFilters({ genres: big });
    expect((result.genres as string[]).length).toBe(50);
  });

  it('preserves number values', () => {
    const result = sanitizeImdbFilters({ imdbRatingMin: 7, totalVotesMin: 1000 });
    expect(result.imdbRatingMin).toBe(7);
    expect(result.totalVotesMin).toBe(1000);
  });

  it('preserves boolean values', () => {
    const result = sanitizeImdbFilters({ someFlag: true });
    expect(sanitizeImdbFilters({ genres: [] })).toHaveProperty('genres');
  });

  it('sanitizes string values by trimming', () => {
    const result = sanitizeImdbFilters({ sortBy: '  POPULARITY\x00  ' });
    expect(result.sortBy).toBe('POPULARITY');
  });

  it('validates imdbListId format', () => {
    const valid = sanitizeImdbFilters({ imdbListId: 'ls597789139' });
    expect(valid.imdbListId).toBe('ls597789139');

    const invalid = sanitizeImdbFilters({ imdbListId: 'notAValidId' });
    expect(invalid.imdbListId).toBeUndefined();
  });

  it('rejects imdbListId with injection attempt', () => {
    const result = sanitizeImdbFilters({ imdbListId: "ls123'; DROP TABLE--" });
    expect(result.imdbListId).toBeUndefined();
  });

  it('preserves keyword and award arrays', () => {
    const result = sanitizeImdbFilters({
      keywords: ['superhero', 'time-travel'],
      awardsWon: ['oscar_winner'],
      awardsNominated: ['golden_globe_nominated'],
    });
    expect(result.keywords).toEqual(['superhero', 'time-travel']);
    expect(result.awardsWon).toEqual(['oscar_winner']);
    expect(result.awardsNominated).toEqual(['golden_globe_nominated']);
  });

  it('preserves date strings', () => {
    const result = sanitizeImdbFilters({
      releaseDateStart: '2020-01-01',
      releaseDateEnd: '2024-12-31',
    });
    expect(result.releaseDateStart).toBe('2020-01-01');
    expect(result.releaseDateEnd).toBe('2024-12-31');
  });

  it('preserves types array', () => {
    const result = sanitizeImdbFilters({ types: ['movie', 'tvSeries'] });
    expect(result.types).toEqual(['movie', 'tvSeries']);
  });
});
