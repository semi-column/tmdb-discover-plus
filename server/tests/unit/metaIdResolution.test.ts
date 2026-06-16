import { describe, it, expect, vi } from 'vitest';
import { resolveRequestedMetaId } from '../../src/utils/metaIdResolution.ts';

describe('resolveRequestedMetaId', () => {
  it('resolves direct imdb IDs', () => {
    const result = resolveRequestedMetaId('tt1375666', () => undefined);

    expect(result).toEqual({
      tmdbId: null,
      imdbId: 'tt1375666',
      requiresImdbLookup: true,
      anilistId: null,
      malId: null,
    });
  });

  it('resolves direct tmdb IDs', () => {
    const result = resolveRequestedMetaId('tmdb:150540', () => undefined);

    expect(result).toEqual({
      tmdbId: 150540,
      imdbId: null,
      requiresImdbLookup: false,
      anilistId: null,
      malId: null,
    });
  });

  it('resolves numeric tmdb IDs', () => {
    const result = resolveRequestedMetaId('150540', () => undefined);

    expect(result).toEqual({
      tmdbId: 150540,
      imdbId: null,
      requiresImdbLookup: false,
      anilistId: null,
      malId: null,
    });
  });

  it('resolves anime-prefixed IDs via mapping to tmdb', () => {
    const lookup = vi.fn((id: string) => {
      if (id === 'mal:5114') {
        return {
          mal_id: 5114,
          anilist_id: 5114,
          themoviedb_id: 269,
        };
      }
      return undefined;
    });

    const result = resolveRequestedMetaId('mal:5114', lookup);

    expect(lookup).toHaveBeenCalledWith('mal:5114');
    expect(result).toEqual({
      tmdbId: 269,
      imdbId: null,
      requiresImdbLookup: false,
      anilistId: 5114,
      malId: 5114,
    });
  });

  it('resolves anime-prefixed IDs via mapping to imdb fallback', () => {
    const result = resolveRequestedMetaId('kitsu:1234', (id: string) => {
      if (id === 'kitsu:1234') {
        return {
          kitsu_id: 1234,
          anilist_id: 9876,
          imdb_id: 'tt2085059',
        };
      }
      return undefined;
    });

    expect(result).toEqual({
      tmdbId: null,
      imdbId: 'tt2085059',
      requiresImdbLookup: true,
      anilistId: 9876,
      malId: null,
    });
  });

  it('surfaces the AniList id from an anilist-prefixed id when unmapped', () => {
    const result = resolveRequestedMetaId('anilist:1535', () => undefined);

    expect(result).toEqual({
      tmdbId: null,
      imdbId: null,
      requiresImdbLookup: false,
      anilistId: 1535,
      malId: null,
    });
  });

  it('surfaces the MAL id from a mal-prefixed id when unmapped', () => {
    const result = resolveRequestedMetaId('mal:5114', () => undefined);

    expect(result).toEqual({
      tmdbId: null,
      imdbId: null,
      requiresImdbLookup: false,
      anilistId: null,
      malId: 5114,
    });
  });

  it('returns empty resolution for unknown IDs', () => {
    const result = resolveRequestedMetaId('tvmaze:1399', () => undefined);

    expect(result).toEqual({
      tmdbId: null,
      imdbId: null,
      requiresImdbLookup: false,
      anilistId: null,
      malId: null,
    });
  });
});
