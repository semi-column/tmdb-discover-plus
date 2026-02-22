import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatRuntime, generateSlug, toStremioMeta } from '../../src/services/tmdb/stremioMeta.ts';

vi.mock('../../src/services/posterService.ts', () => ({
  generatePosterUrl: () => null,
  isValidPosterConfig: () => false,
}));
vi.mock('../../src/services/rpdb.ts', () => ({
  getRpdbRating: () => Promise.resolve(null),
}));
vi.mock('../../src/services/imdbRatings/index.ts', () => ({
  getImdbRatingString: () => Promise.resolve(null),
}));
vi.mock('../../src/config.ts', () => ({
  config: {
    rpdb: { apiKey: '' },
    logging: { level: 'error', format: 'text' },
    tmdb: { disableTlsVerify: false, debug: false, apiKey: '', rateLimit: 35 },
    nodeEnv: 'test',
    imdbRatings: { disabled: true, updateIntervalHours: 24, minVotes: 100 },
    cache: { driver: '', redisUrl: '', maxKeys: 1000, versionOverride: '', warmRegions: [] },
  },
}));

describe('formatRuntime', () => {
  it('formats hours and minutes', () => {
    expect(formatRuntime(150)).toBe('2h30min');
  });
  it('formats hours only when no remainder', () => {
    expect(formatRuntime(120)).toBe('2h');
  });
  it('formats minutes only when less than 60', () => {
    expect(formatRuntime(45)).toBe('45min');
  });
  it('returns undefined for null/0/undefined', () => {
    expect(formatRuntime(null)).toBeUndefined();
    expect(formatRuntime(0)).toBeUndefined();
    expect(formatRuntime(undefined)).toBeUndefined();
  });
  it('handles edge case of exactly 60 minutes', () => {
    expect(formatRuntime(60)).toBe('1h');
  });
  it('handles single-digit remainder', () => {
    expect(formatRuntime(61)).toBe('1h1min');
  });
});

describe('generateSlug', () => {
  it('creates type/title-id slug', () => {
    expect(generateSlug('movie', 'The Matrix', 'tt0133093')).toBe('movie/the-matrix-tt0133093');
  });
  it('handles empty title', () => {
    expect(generateSlug('series', '', 'tt123')).toBe('series/-tt123');
  });
  it('handles null title', () => {
    expect(generateSlug('movie', null, 'id')).toBe('movie/-id');
  });
});

describe('toStremioMeta — null safety', () => {
  it('handles TV show with undefined name', () => {
    const item = { id: 1, overview: 'test', genre_ids: [] } as any;
    const result = toStremioMeta(item, 'series');
    expect(result).toBeDefined();
    expect(result.name).toBe('');
  });

  it('handles movie with undefined title', () => {
    const item = { id: 2, overview: 'test', genre_ids: [] } as any;
    const result = toStremioMeta(item, 'movie');
    expect(result).toBeDefined();
    expect(result.name).toBe('');
  });

  it('uses title for movies and name for series', () => {
    const movie = { id: 3, title: 'Inception', overview: '', genre_ids: [] } as any;
    const series = { id: 4, name: 'Breaking Bad', overview: '', genre_ids: [] } as any;
    expect(toStremioMeta(movie, 'movie').name).toBe('Inception');
    expect(toStremioMeta(series, 'series').name).toBe('Breaking Bad');
  });
});
