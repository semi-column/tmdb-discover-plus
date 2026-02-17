import { describe, it, expect } from 'vitest';
import {
  generatePosterUrl,
  generateBackdropUrl,
  isValidPosterConfig,
  createPosterOptions,
} from '../../src/services/posterService.ts';

describe('generatePosterUrl', () => {
  it('returns RPDB URL using imdbId when available', () => {
    const url = generatePosterUrl({
      apiKey: 'key123',
      service: 'rpdb',
      tmdbId: 550,
      type: 'movie',
      imdbId: 'tt0137523',
    });
    expect(url).toBe(
      'https://api.ratingposterdb.com/key123/imdb/poster-default/tt0137523.jpg?fallback=true'
    );
  });

  it('falls back to tmdbId when no imdbId', () => {
    const url = generatePosterUrl({
      apiKey: 'key123',
      service: 'rpdb',
      tmdbId: 550,
      type: 'movie',
    });
    expect(url).toBe(
      'https://api.ratingposterdb.com/key123/tmdb/poster-default/movie-550.jpg?fallback=true'
    );
  });

  it('uses series prefix for series type', () => {
    const url = generatePosterUrl({
      apiKey: 'key123',
      service: 'topPosters',
      tmdbId: 1399,
      type: 'series',
    });
    expect(url).toContain('/tmdb/poster-default/series-1399.jpg');
  });

  it('returns null for service=none', () => {
    expect(
      generatePosterUrl({ apiKey: 'key', service: 'none', tmdbId: 1, type: 'movie' })
    ).toBeNull();
  });

  it('returns null without apiKey', () => {
    expect(generatePosterUrl({ apiKey: '', service: 'rpdb', tmdbId: 1, type: 'movie' })).toBeNull();
  });

  it('returns null without any ID', () => {
    expect(
      generatePosterUrl({ apiKey: 'key', service: 'rpdb', tmdbId: 0, type: 'movie' })
    ).toBeNull();
  });
});

describe('generateBackdropUrl', () => {
  it('returns backdrop URL using imdbId', () => {
    const url = generateBackdropUrl({
      apiKey: 'key123',
      service: 'rpdb',
      tmdbId: 550,
      type: 'movie',
      imdbId: 'tt0137523',
    });
    expect(url).toContain('/imdb/backdrop-default/tt0137523.jpg');
  });

  it('returns null for service=none', () => {
    expect(
      generateBackdropUrl({ apiKey: 'key', service: 'none', tmdbId: 1, type: 'movie' })
    ).toBeNull();
  });
});

describe('isValidPosterConfig', () => {
  it('returns true for valid config', () => {
    expect(isValidPosterConfig({ apiKey: 'key', service: 'rpdb' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isValidPosterConfig(null)).toBe(false);
  });

  it('returns false for service=none', () => {
    expect(isValidPosterConfig({ apiKey: 'key', service: 'none' })).toBe(false);
  });

  it('returns false for empty apiKey', () => {
    expect(isValidPosterConfig({ apiKey: '', service: 'rpdb' })).toBe(false);
  });
});

describe('createPosterOptions', () => {
  const mockDecrypt = (s: string) => (s === 'encrypted_key' ? 'decrypted_key' : null);

  it('returns PosterOptions when valid', () => {
    const result = createPosterOptions(
      { posterService: 'rpdb', posterApiKeyEncrypted: 'encrypted_key' },
      mockDecrypt
    );
    expect(result).toEqual({ apiKey: 'decrypted_key', service: 'rpdb' });
  });

  it('returns null for no preferences', () => {
    expect(createPosterOptions(null, mockDecrypt)).toBeNull();
  });

  it('returns null for service=none', () => {
    expect(
      createPosterOptions(
        { posterService: 'none', posterApiKeyEncrypted: 'encrypted_key' },
        mockDecrypt
      )
    ).toBeNull();
  });

  it('returns null when decrypt fails', () => {
    expect(
      createPosterOptions({ posterService: 'rpdb', posterApiKeyEncrypted: 'bad_key' }, mockDecrypt)
    ).toBeNull();
  });

  it('returns null when no encrypted key', () => {
    expect(createPosterOptions({ posterService: 'rpdb' }, mockDecrypt)).toBeNull();
  });
});
