import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KitsuAnime } from '../../src/services/kitsu/types';

vi.mock('../../src/services/cache/index.ts', () => ({
  getCache: () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../src/services/animeIdMap/index.ts', () => ({
  kitsuIdToStremioId: (id: number) => (id === 1 ? 'tt0000001' : `kitsu:${id}`),
  getEntryByKitsuId: (id: number) =>
    id === 1 ? { imdb_id: 'tt0000001', themoviedb_id: 100 } : undefined,
}));

describe('Kitsu source', () => {
  describe('kitsuResourceToAnime', () => {
    it('converts a Kitsu JSON:API resource to KitsuAnime', async () => {
      const { kitsuResourceToAnime } = await import('../../src/services/kitsu/types');

      const resource = {
        id: '12',
        type: 'anime' as const,
        attributes: {
          canonicalTitle: 'One Punch Man',
          titles: { en: 'One Punch Man', en_jp: 'One Punch Man', ja_jp: 'ワンパンマン' },
          synopsis: 'A hero for fun.',
          subtype: 'TV',
          status: 'finished',
          startDate: '2015-10-05',
          endDate: '2015-12-21',
          episodeCount: 12,
          episodeLength: 24,
          ageRating: 'PG',
          ageRatingGuide: null,
          averageRating: '84.52',
          userCount: 500000,
          favoritesCount: 10000,
          popularityRank: 5,
          ratingRank: 20,
          posterImage: { large: 'https://poster.jpg', medium: null, original: null },
          coverImage: { large: 'https://cover.jpg', original: null },
          nsfw: false,
        },
      };

      const result = kitsuResourceToAnime(resource);
      expect(result.id).toBe(12);
      expect(result.title).toBe('One Punch Man');
      expect(result.subtype).toBe('TV');
      expect(result.averageRating).toBeCloseTo(84.52);
      expect(result.poster).toBe('https://poster.jpg');
      expect(result.cover).toBe('https://cover.jpg');
      expect(result.startDate).toBe('2015-10-05');
    });
  });

  describe('kitsuToStremioMeta', () => {
    it('maps anime with known IMDB ID', async () => {
      const { kitsuToStremioMeta } = await import('../../src/services/kitsu/stremioMeta');

      const anime: KitsuAnime = {
        id: 1,
        title: 'Cowboy Bebop',
        titles: { en: 'Cowboy Bebop', en_jp: 'Cowboy Bebop', ja_jp: 'カウボーイビバップ' },
        synopsis: 'Space bounty hunters.',
        subtype: 'TV',
        status: 'finished',
        startDate: '1998-04-03',
        endDate: '1999-04-24',
        episodeCount: 26,
        averageRating: 89.12,
        popularityRank: 3,
        ratingRank: 5,
        poster: 'https://poster.jpg',
        cover: 'https://cover.jpg',
        ageRating: 'R',
        nsfw: false,
        categories: ['Action', 'Sci-Fi'],
      };

      const meta = kitsuToStremioMeta(anime, 'anime');
      expect(meta).not.toBeNull();
      expect(meta!.id).toBe('tt0000001');
      expect(meta!.imdbId).toBe('tt0000001');
      expect(meta!.tmdbId).toBe(100);
      expect(meta!.name).toBe('Cowboy Bebop');
      expect(meta!.genres).toEqual(['Action', 'Sci-Fi']);
      expect(meta!.imdbRating).toBe('8.9');
    });

    it('uses kitsu: prefix when no IMDB mapping', async () => {
      const { kitsuToStremioMeta } = await import('../../src/services/kitsu/stremioMeta');

      const anime: KitsuAnime = {
        id: 999,
        title: 'Unknown Anime',
        titles: { en: 'Unknown Anime' },
        synopsis: null,
        subtype: 'ONA',
        status: 'current',
        startDate: '2024-01-01',
        endDate: null,
        episodeCount: null,
        averageRating: null,
        popularityRank: null,
        ratingRank: null,
        poster: null,
        cover: null,
        ageRating: null,
        nsfw: false,
        categories: [],
      };

      const meta = kitsuToStremioMeta(anime, 'anime');
      expect(meta).not.toBeNull();
      expect(meta!.id).toBe('kitsu:999');
      expect(meta!.imdbId).toBeNull();
      expect(meta!.tmdbId).toBe(0);
    });
  });

  describe('batchConvertToStremioMeta', () => {
    it('converts multiple anime items', async () => {
      const { batchConvertToStremioMeta } = await import('../../src/services/kitsu/stremioMeta');

      const animeList: KitsuAnime[] = [
        {
          id: 1,
          title: 'A',
          titles: {},
          synopsis: null,
          subtype: 'TV',
          status: 'finished',
          startDate: null,
          endDate: null,
          episodeCount: null,
          averageRating: null,
          popularityRank: null,
          ratingRank: null,
          poster: null,
          cover: null,
          ageRating: null,
          nsfw: false,
          categories: [],
        },
        {
          id: 2,
          title: 'B',
          titles: {},
          synopsis: null,
          subtype: 'TV',
          status: 'finished',
          startDate: null,
          endDate: null,
          episodeCount: null,
          averageRating: null,
          popularityRank: null,
          ratingRank: null,
          poster: null,
          cover: null,
          ageRating: null,
          nsfw: false,
          categories: [],
        },
      ];

      const results = batchConvertToStremioMeta(animeList, 'anime');
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('tt0000001');
      expect(results[1].id).toBe('kitsu:2');
    });
  });

  describe('KitsuSource', () => {
    it('has correct sourceId and prefix', async () => {
      const { KitsuSource } = await import('../../src/services/sources/KitsuSource');
      expect(KitsuSource.sourceId).toBe('kitsu');
      expect(KitsuSource.catalogIdPrefix).toBe('kitsu');
      expect(KitsuSource.isEnabled()).toBe(true);
    });

    it('sanitizes filters by stripping non-kitsu keys', async () => {
      const { KitsuSource } = await import('../../src/services/sources/KitsuSource');
      const filters = {
        kitsuSort: '-averageRating',
        kitsuCategories: ['action'],
        malRankingType: 'all',
        anilistSort: 'POPULARITY_DESC',
      } as any;

      const sanitized = KitsuSource.sanitizeFilters(filters);
      expect(sanitized).toHaveProperty('kitsuSort', '-averageRating');
      expect(sanitized).toHaveProperty('kitsuCategories');
      expect(sanitized).not.toHaveProperty('malRankingType');
      expect(sanitized).not.toHaveProperty('anilistSort');
    });
  });

  describe('discover routing', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('routes trending list type to trending endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              {
                id: '42',
                type: 'anime',
                attributes: {
                  canonicalTitle: 'Test',
                  titles: {},
                  synopsis: null,
                  subtype: 'TV',
                  status: 'finished',
                  startDate: null,
                  endDate: null,
                  episodeCount: null,
                  episodeLength: null,
                  ageRating: null,
                  ageRatingGuide: null,
                  averageRating: null,
                  userCount: null,
                  favoritesCount: null,
                  popularityRank: null,
                  ratingRank: null,
                  posterImage: null,
                  coverImage: null,
                  nsfw: false,
                },
              },
            ],
            meta: { count: 1 },
            links: {},
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { discover } = await import('../../src/services/kitsu/discover');
      const result = await discover({ kitsuListType: 'trending' }, 'anime', 1);

      expect(result.anime).toHaveLength(1);
      expect(result.anime[0].title).toBe('Test');
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('/trending/anime');
      expect(calledUrl).not.toContain('filter%5Bsubtype%5D');

      vi.unstubAllGlobals();
    });

    it('applies TV subtype for series trending catalogs', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [],
            meta: { count: 0 },
            links: {},
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { discover } = await import('../../src/services/kitsu/discover');
      await discover({ kitsuListType: 'trending' }, 'series', 1);

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('/trending/anime');
      expect(calledUrl).toContain('filter%5Bsubtype%5D=TV');

      vi.unstubAllGlobals();
    });

    it('routes browse filters to /anime endpoint with params', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [],
            meta: { count: 0 },
            links: {},
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { discover } = await import('../../src/services/kitsu/discover');
      await discover(
        {
          kitsuListType: 'browse',
          kitsuCategories: ['action', 'comedy'],
          kitsuStatus: ['current'],
          kitsuSort: '-userCount',
        },
        'anime',
        1
      );

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('filter%5Bcategories%5D=action%2Ccomedy');
      expect(calledUrl).toContain('filter%5Bstatus%5D=current');
      expect(calledUrl).toContain('sort=-userCount');
      expect(calledUrl).not.toContain('filter%5Bsubtype%5D');

      vi.unstubAllGlobals();
    });

    it('supports category exclusion via !slug syntax', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [],
            meta: { count: 0 },
            links: {},
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { discover } = await import('../../src/services/kitsu/discover');
      await discover(
        {
          kitsuListType: 'browse',
          kitsuCategories: ['romance'],
          kitsuExcludeCategories: ['horror'],
        },
        'anime',
        1
      );

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('filter%5Bcategories%5D=romance%2C%21horror');

      vi.unstubAllGlobals();
    });

    it('ignores unsupported age ratings when building query params', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [],
            meta: { count: 0 },
            links: {},
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { discover } = await import('../../src/services/kitsu/discover');
      await discover(
        {
          kitsuListType: 'browse',
          kitsuAgeRating: ['R18'],
        },
        'anime',
        1
      );

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).not.toContain('filter%5BageRating%5D');

      vi.unstubAllGlobals();
    });

    it('applies TV subtype for series browse when subtype is not explicitly set', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [],
            meta: { count: 0 },
            links: {},
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { discover } = await import('../../src/services/kitsu/discover');
      await discover(
        {
          kitsuListType: 'browse',
          kitsuSort: '-averageRating',
        },
        'series',
        1
      );

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('/anime?');
      expect(calledUrl).toContain('filter%5Bsubtype%5D=TV');

      vi.unstubAllGlobals();
    });
  });

  describe('reference data', () => {
    it('exports categories, subtypes, statuses, age ratings, sort options, seasons', async () => {
      const ref = await import('../../src/services/kitsu/reference');
      expect(ref.getCategories().length).toBeGreaterThan(0);
      expect(ref.getSubtypes().length).toBe(6);
      expect(ref.getStatuses().length).toBe(5);
      expect(ref.getAgeRatings().length).toBe(3);
      expect(ref.getSortOptions().length).toBe(6);
      expect(ref.getSeasons().length).toBe(4);
    });
  });
});
