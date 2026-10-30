import { describe, expect, it } from 'vitest';
import { buildMetaCacheKey } from '../../src/services/cache/keys.ts';

const input = {
  userId: 'user-a',
  type: 'movie' as const,
  requestedId: 'tt0137523',
  language: 'en',
  baseUrl: 'https://addon.example',
  manifestUrl: 'https://addon.example/user-a/manifest.json',
  genreCatalogId: 'tmdb.movies',
  userRegion: 'US',
  artworkOptions: { poster: { service: 'rpdb' as const, apiKey: 'secret-a' } },
};

describe('metadata cache keys', () => {
  it('is deterministic without a config timestamp and never exposes artwork credentials', () => {
    expect(buildMetaCacheKey(input)).toBe(buildMetaCacheKey({ ...input }));
    expect(buildMetaCacheKey(input)).not.toContain('secret-a');
  });

  it.each([
    { userId: 'user-b' },
    { type: 'series' as const },
    { requestedId: 'tt0111161' },
    { language: 'fr' },
    { baseUrl: 'https://other.example' },
    { manifestUrl: 'https://other.example/user-a/manifest.json' },
    { genreCatalogId: 'tmdb.other' },
    { genreCatalogId: null },
    { userRegion: 'GB' },
    { artworkOptions: { poster: { service: 'rpdb' as const, apiKey: 'secret-b' } } },
    {
      artworkOptions: {
        poster: {
          service: 'customUrl' as const,
          customUrlPattern: 'https://images.example/{imdb_id}',
        },
      },
    },
  ])('invalidates for output-affecting changes: %j', (change) => {
    expect(buildMetaCacheKey({ ...input, ...change })).not.toBe(buildMetaCacheKey(input));
  });
});
