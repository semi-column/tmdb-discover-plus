import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatRuntime,
  generateSlug,
  toStremioMeta,
  toStremioMetaPreview,
  toStremioFullMeta,
} from '../../src/services/tmdb/stremioMeta.ts';

vi.mock('../../src/services/artworkService.ts', async () => {
  const { metahubUrl } = await import('../../src/constants.ts');

  const METAHUB_KIND_MAP = {
    poster: 'poster',
    backdrop: 'background',
    logo: 'logo',
    landscape: 'background',
  };

  function metahubFallback(kind, imdbId) {
    if (!imdbId || !imdbId.startsWith('tt')) return null;
    const metahubKind = METAHUB_KIND_MAP[kind];
    if (!metahubKind) return null;
    return metahubUrl(metahubKind, imdbId);
  }

  function resolveKind(kind, nativeUrls, context) {
    let url = metahubFallback(kind, context?.imdbId);
    if (!url) url = nativeUrls?.[kind] || null;
    return url;
  }

  return {
    applyArtworkOverrides: (_ctx, nativeUrls, _opts, _extra) => {
      return Promise.resolve({
        poster: resolveKind('poster', nativeUrls, _ctx),
        backdrop: resolveKind('backdrop', nativeUrls, _ctx),
        logo: resolveKind('logo', nativeUrls, _ctx),
        landscape: resolveKind('landscape', nativeUrls, _ctx),
        episode: null,
      });
    },
    applyArtworkOverridesSync: (_ctx, nativeUrls) => ({
      poster: resolveKind('poster', nativeUrls, _ctx),
      backdrop: resolveKind('backdrop', nativeUrls, _ctx),
      logo: resolveKind('logo', nativeUrls, _ctx),
      landscape: resolveKind('landscape', nativeUrls, _ctx),
      episode: null,
    }),
    checkPosterExists: () => Promise.resolve(false),
    isValidPosterConfig: () => false,
    generatePosterUrl: () => null,
    generateBackdropUrl: () => null,
    generateLogoUrl: () => null,
    generateEpisodeThumbnailUrl: () => null,
  };
});
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

describe('toStremioMetaPreview — poster fallbacks', () => {
  const baseDetails = {
    id: 100,
    title: 'Test Movie',
    overview: 'desc',
    genres: [],
    credits: { cast: [], crew: [] },
    images: {},
    external_ids: {},
  };

  it('uses poster_path when available', async () => {
    const details = { ...baseDetails, poster_path: '/poster.jpg' } as any;
    const result = await toStremioMetaPreview(details, 'movie');
    expect(result?.poster).toContain('/poster.jpg');
  });

  it('falls back to images.posters when poster_path is null', async () => {
    const details = {
      ...baseDetails,
      poster_path: null,
      images: { posters: [{ file_path: '/alt-poster.jpg' }] },
    } as any;
    const result = await toStremioMetaPreview(details, 'movie');
    expect(result?.poster).toContain('/alt-poster.jpg');
  });

  it('falls back to metahub when no TMDB poster and imdbId is available', async () => {
    const details = {
      ...baseDetails,
      poster_path: null,
      images: { posters: [] },
      external_ids: { imdb_id: 'tt1234567' },
    } as any;
    const result = await toStremioMetaPreview(details, 'movie');
    expect(result?.poster).toContain('tt1234567');
    expect(result?.poster).toContain('metahub.space');
  });

  it('leaves poster null when no TMDB poster and no imdbId', async () => {
    const details = {
      ...baseDetails,
      poster_path: null,
      images: { posters: [] },
      external_ids: {},
    } as any;
    const result = await toStremioMetaPreview(details, 'movie');
    expect(result?.poster).toBeNull();
  });
});

describe('toStremioFullMeta — poster fallbacks', () => {
  const baseFullDetails = {
    id: 200,
    title: 'Test Movie Full',
    overview: 'desc',
    genres: [],
    credits: { cast: [], crew: [] },
    images: {},
    external_ids: {},
    release_dates: { results: [] },
  };

  it('uses poster_path when available', async () => {
    const details = { ...baseFullDetails, poster_path: '/poster.jpg' } as any;
    const result = await toStremioFullMeta(details, 'movie');
    expect(result?.poster).toContain('/poster.jpg');
  });

  it('falls back to images.posters when poster_path is null', async () => {
    const details = {
      ...baseFullDetails,
      poster_path: null,
      images: { posters: [{ file_path: '/alt.jpg' }] },
    } as any;
    const result = await toStremioFullMeta(details, 'movie');
    expect(result?.poster).toContain('/alt.jpg');
  });

  it('falls back to metahub poster when no TMDB poster', async () => {
    const details = {
      ...baseFullDetails,
      poster_path: null,
      images: { posters: [] },
      external_ids: { imdb_id: 'tt9999999' },
    } as any;
    const result = await toStremioFullMeta(details, 'movie');
    expect(result?.poster).toContain('tt9999999');
    expect(result?.poster).toContain('metahub.space');
  });

  it('falls back to metahub background when no TMDB backdrop', async () => {
    const details = {
      ...baseFullDetails,
      poster_path: '/poster.jpg',
      backdrop_path: null,
      images: { backdrops: [] },
      external_ids: { imdb_id: 'tt9999999' },
    } as any;
    const result = await toStremioFullMeta(details, 'movie');
    expect(result?.background).toContain('tt9999999');
    expect(result?.background).toContain('metahub.space');
  });
});

describe('toStremioMeta — poster fallbacks', () => {
  it('uses poster_path when available', () => {
    const item = {
      id: 1,
      title: 'Movie',
      poster_path: '/poster.jpg',
      overview: '',
      genre_ids: [],
    } as any;
    const result = toStremioMeta(item, 'movie');
    expect(result.poster).toContain('/poster.jpg');
  });

  it('falls back to metahub when no poster_path and imdbId is available', () => {
    const item = { id: 1, title: 'Movie', poster_path: null, overview: '', genre_ids: [] } as any;
    const result = toStremioMeta(item, 'movie', 'tt5555555');
    expect(result.poster).toContain('tt5555555');
    expect(result.poster).toContain('metahub.space');
  });

  it('falls back to metahub background when no backdrop_path', () => {
    const item = {
      id: 1,
      title: 'Movie',
      poster_path: '/p.jpg',
      backdrop_path: null,
      overview: '',
      genre_ids: [],
    } as any;
    const result = toStremioMeta(item, 'movie', 'tt5555555');
    expect(result.background).toContain('tt5555555');
    expect(result.background).toContain('metahub.space');
  });

  it('leaves poster null when no TMDB poster and no imdbId', () => {
    const item = { id: 1, title: 'Movie', poster_path: null, overview: '', genre_ids: [] } as any;
    const result = toStremioMeta(item, 'movie');
    expect(result.poster).toBeNull();
  });
});
