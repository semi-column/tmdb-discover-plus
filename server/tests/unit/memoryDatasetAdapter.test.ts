import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryDatasetAdapter } from '../../src/services/imdbDataset/MemoryDatasetAdapter.ts';

function makeTitle(overrides = {}) {
  return {
    tconst: 'tt0000001',
    titleType: 'movie',
    primaryTitle: 'Test Movie',
    startYear: 2000,
    runtimeMinutes: 120,
    genres: ['Action'],
    averageRating: 7.5,
    numVotes: 50000,
    ...overrides,
  };
}

describe('MemoryDatasetAdapter', () => {
  let adapter: MemoryDatasetAdapter;

  beforeEach(() => {
    adapter = new MemoryDatasetAdapter();
  });

  describe('setBatch and count', () => {
    it('counts movies and series separately', async () => {
      await adapter.setBatch([
        makeTitle({ tconst: 'tt1', titleType: 'movie' }),
        makeTitle({ tconst: 'tt2', titleType: 'tvSeries' }),
        makeTitle({ tconst: 'tt3', titleType: 'movie' }),
        makeTitle({ tconst: 'tt4', titleType: 'tvMiniSeries' }),
      ]);
      adapter._finalize!();

      expect(await adapter.count('movie')).toBe(2);
      expect(await adapter.count('series')).toBe(2);
    });

    it('maps tvMovie/tvSpecial/video to movie', async () => {
      await adapter.setBatch([
        makeTitle({ tconst: 'tt1', titleType: 'tvMovie' }),
        makeTitle({ tconst: 'tt2', titleType: 'tvSpecial' }),
        makeTitle({ tconst: 'tt3', titleType: 'video' }),
      ]);
      adapter._finalize!();

      expect(await adapter.count('movie')).toBe(3);
      expect(await adapter.count('series')).toBe(0);
    });

    it('ignores unknown titleTypes', async () => {
      await adapter.setBatch([
        makeTitle({ tconst: 'tt1', titleType: 'short' }),
        makeTitle({ tconst: 'tt2', titleType: 'movie' }),
      ]);
      adapter._finalize!();

      expect(await adapter.count('movie')).toBe(1);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await adapter.setBatch([
        makeTitle({
          tconst: 'tt1',
          titleType: 'movie',
          averageRating: 9.0,
          numVotes: 100000,
          genres: ['Drama'],
          startYear: 1994,
          primaryTitle: 'A',
        }),
        makeTitle({
          tconst: 'tt2',
          titleType: 'movie',
          averageRating: 8.5,
          numVotes: 200000,
          genres: ['Action', 'Drama'],
          startYear: 2008,
          primaryTitle: 'B',
        }),
        makeTitle({
          tconst: 'tt3',
          titleType: 'movie',
          averageRating: 8.0,
          numVotes: 50000,
          genres: ['Comedy'],
          startYear: 1990,
          primaryTitle: 'C',
        }),
        makeTitle({
          tconst: 'tt4',
          titleType: 'tvSeries',
          averageRating: 9.5,
          numVotes: 150000,
          genres: ['Drama', 'Crime'],
          startYear: 2008,
          primaryTitle: 'D',
        }),
        makeTitle({
          tconst: 'tt5',
          titleType: 'tvSeries',
          averageRating: 8.0,
          numVotes: 80000,
          genres: ['Comedy'],
          startYear: 2015,
          primaryTitle: 'E',
        }),
      ]);
      adapter._finalize!();
    });

    it('queries movies sorted by rating desc', async () => {
      const result = await adapter.query({
        type: 'movie',
        sortBy: 'rating',
        sortOrder: 'desc',
        skip: 0,
        limit: 10,
      });
      expect(result.total).toBe(3);
      expect(result.items.map((i: any) => i.tconst)).toEqual(['tt1', 'tt2', 'tt3']);
    });

    it('queries movies sorted by votes desc', async () => {
      const result = await adapter.query({
        type: 'movie',
        sortBy: 'votes',
        sortOrder: 'desc',
        skip: 0,
        limit: 10,
      });
      expect(result.total).toBe(3);
      expect(result.items[0].tconst).toBe('tt2');
    });

    it('queries series separately from movies', async () => {
      const result = await adapter.query({
        type: 'series',
        sortBy: 'rating',
        sortOrder: 'desc',
        skip: 0,
        limit: 10,
      });
      expect(result.total).toBe(2);
      expect(result.items[0].tconst).toBe('tt4');
    });

    it('filters by genre', async () => {
      const result = await adapter.query({
        type: 'movie',
        sortBy: 'rating',
        sortOrder: 'desc',
        skip: 0,
        limit: 10,
        genre: 'Drama',
      });
      expect(result.total).toBe(2);
      expect(result.items.map((i: any) => i.tconst)).toEqual(['tt1', 'tt2']);
    });

    it('filters by decade', async () => {
      const result = await adapter.query({
        type: 'movie',
        sortBy: 'rating',
        sortOrder: 'desc',
        skip: 0,
        limit: 10,
        decadeStart: 1990,
      });
      expect(result.items.every((i: any) => i.startYear >= 1990 && i.startYear < 2000)).toBe(true);
    });

    it('paginates with skip and limit', async () => {
      const page1 = await adapter.query({
        type: 'movie',
        sortBy: 'rating',
        sortOrder: 'desc',
        skip: 0,
        limit: 2,
      });
      const page2 = await adapter.query({
        type: 'movie',
        sortBy: 'rating',
        sortOrder: 'desc',
        skip: 2,
        limit: 2,
      });
      expect(page1.items.length).toBe(2);
      expect(page2.items.length).toBe(1);
      expect(page1.total).toBe(3);
    });

    it('filters by ratingMin', async () => {
      const result = await adapter.query({
        type: 'movie',
        sortBy: 'rating',
        sortOrder: 'desc',
        skip: 0,
        limit: 10,
        ratingMin: 8.5,
      });
      expect(result.items.every((i: any) => i.averageRating >= 8.5)).toBe(true);
      expect(result.items.length).toBe(2);
    });

    it('filters by ratingMax', async () => {
      const result = await adapter.query({
        type: 'movie',
        sortBy: 'rating',
        sortOrder: 'desc',
        skip: 0,
        limit: 10,
        ratingMax: 8.5,
      });
      expect(result.items.every((i: any) => i.averageRating <= 8.5)).toBe(true);
    });

    it('filters by votesMin', async () => {
      const result = await adapter.query({
        type: 'movie',
        sortBy: 'rating',
        sortOrder: 'desc',
        skip: 0,
        limit: 10,
        votesMin: 100000,
      });
      expect(result.items.every((i: any) => i.numVotes >= 100000)).toBe(true);
    });

    it('sorts ascending', async () => {
      const result = await adapter.query({
        type: 'movie',
        sortBy: 'rating',
        sortOrder: 'asc',
        skip: 0,
        limit: 10,
      });
      expect(result.items[0].tconst).toBe('tt3');
    });
  });

  describe('getGenres and getDecades', () => {
    beforeEach(async () => {
      await adapter.setBatch([
        makeTitle({
          tconst: 'tt1',
          titleType: 'movie',
          genres: ['Action', 'Drama'],
          startYear: 1994,
        }),
        makeTitle({ tconst: 'tt2', titleType: 'movie', genres: ['Comedy'], startYear: 2010 }),
        makeTitle({
          tconst: 'tt3',
          titleType: 'tvSeries',
          genres: ['Drama', 'Crime'],
          startYear: 2008,
        }),
      ]);
      adapter._finalize!();
    });

    it('returns sorted genres for type', async () => {
      const genres = await adapter.getGenres('movie');
      expect(genres).toEqual(['Action', 'Comedy', 'Drama']);
    });

    it('returns genres for series', async () => {
      const genres = await adapter.getGenres('series');
      expect(genres).toEqual(['Crime', 'Drama']);
    });

    it('returns decades sorted descending', async () => {
      const decades = await adapter.getDecades('movie');
      expect(decades).toEqual([2010, 1990]);
    });
  });

  describe('clear and meta', () => {
    it('clears all data', async () => {
      await adapter.setBatch([makeTitle()]);
      adapter._finalize!();
      expect(await adapter.count('movie')).toBe(1);

      await adapter.clear();
      expect(await adapter.count('movie')).toBe(0);
    });

    it('stores and retrieves meta', async () => {
      await adapter.setMeta('etag', '"abc123"');
      expect(await adapter.getMeta('etag')).toBe('"abc123"');
    });

    it('returns null for missing meta', async () => {
      expect(await adapter.getMeta('nonexistent')).toBeNull();
    });
  });
});
