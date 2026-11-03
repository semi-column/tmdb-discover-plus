import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../../src/services/tmdb/index.ts', () => ({
  getGenres: vi.fn(),
  getCertifications: vi.fn(),
}));
vi.mock('../../src/services/configService.ts', () => ({
  getApiKeyFromConfig: vi.fn(),
  updateCatalogGenres: vi.fn(),
}));

vi.mock('../../src/config.ts', () => ({
  config: {
    addon: { variant: undefined },
    baseUrl: 'https://example.com',
    cache: { maxKeys: 20000 },
    logging: { level: 'info', format: 'text' },
    nodeEnv: 'test',
  },
}));

vi.mock('../../src/services/imdb/index.ts', () => ({
  getGenres: vi.fn(async () => ['Action', 'Drama', 'Comedy']),
  isImdbApiEnabled: vi.fn(() => false),
}));

vi.mock('../../src/services/anilist/index.ts', () => ({
  getGenres: vi.fn(() => ['Action', 'Adventure', 'Drama']),
}));

vi.mock('../../src/services/mal/index.ts', () => ({
  getGenres: vi.fn(() => [
    { id: 1, name: 'Action' },
    { id: 2, name: 'Comedy' },
  ]),
}));

vi.mock('../../src/services/simkl/index.ts', () => ({
  isSimklEnabled: vi.fn(() => true),
  getGenres: vi.fn(() => ['Action', 'Horror', 'Thriller']),
}));

import { buildManifest } from '../../src/services/manifestService.ts';
import { enrichManifestWithGenres } from '../../src/services/manifestService.ts';
import { enrichManifestWithExtras } from '../../src/services/manifestService.ts';
import * as tmdb from '../../src/services/tmdb/index.ts';
import { getApiKeyFromConfig, updateCatalogGenres } from '../../src/services/configService.ts';

describe('TMDB manifest genre mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getApiKeyFromConfig).mockReturnValue(null);
  });

  it.each([
    ['movie', [' 28 ', 'science fiction', 'Drama'], ['Action', 'Drama', 'Science Fiction']],
    [
      'series',
      ['10759', 'sci-fi & fantasy', ' Drama '],
      ['Action & Adventure', 'Drama', 'Sci-Fi & Fantasy'],
    ],
  ])('maps mixed names and IDs using real parsing for %s', async (type, genres, expected) => {
    const userConfig = {
      userId: 'test-user',
      catalogs: [{ _id: 'mixed', name: 'Mixed', source: 'tmdb', type, filters: { genres } }],
      preferences: { disableSearch: true },
    };
    const manifest = buildManifest(userConfig as any, 'https://example.com');
    await enrichManifestWithGenres(manifest, userConfig as any);
    expect(manifest.catalogs[0].extra?.find((extra) => extra.name === 'genre')?.options).toEqual([
      'All',
      ...expected,
    ]);
    expect(updateCatalogGenres).not.toHaveBeenCalled();
  });

  it('applies exclusions expressed as names and padded IDs', async () => {
    const userConfig = {
      userId: 'test-user',
      catalogs: [
        {
          _id: 'excluded',
          name: 'Excluded',
          type: 'movie',
          filters: { excludeGenres: [' 28 ', 'Science Fiction'] },
        },
      ],
      preferences: { disableSearch: true },
    };
    const manifest = buildManifest(userConfig as any, 'https://example.com');
    await enrichManifestWithGenres(manifest, userConfig as any);
    const options = manifest.catalogs[0].extra?.find((extra) => extra.name === 'genre')?.options;
    expect(options).toContain('Drama');
    expect(options).not.toContain('Action');
    expect(options).not.toContain('Science Fiction');
  });

  it('does not broaden unmappable selections, retry the same data, or persist repairs', async () => {
    vi.mocked(getApiKeyFromConfig).mockReturnValue('key');
    vi.mocked(tmdb.getGenres).mockResolvedValue([{ id: 28, name: 'Action' }]);
    const userConfig = {
      userId: 'test-user',
      catalogs: [{ _id: 'unknown', name: 'Unknown', type: 'movie', filters: { genres: [99999] } }],
      preferences: { disableSearch: true },
    };
    const manifest = buildManifest(userConfig as any, 'https://example.com');
    await enrichManifestWithGenres(manifest, userConfig as any);
    expect(manifest.catalogs[0].extra).toEqual([{ name: 'skip' }]);
    expect(tmdb.getGenres).toHaveBeenCalledTimes(1);
    expect(updateCatalogGenres).not.toHaveBeenCalled();
  });
});

describe('buildManifest', () => {
  const baseUrl = 'https://example.com';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires configuration and advertises no unsupported root resources', () => {
    const root = JSON.parse(
      readFileSync(new URL('../../../client/public/manifest.json', import.meta.url), 'utf8')
    );
    for (const manifest of [root, buildManifest(null, baseUrl)]) {
      expect(manifest.resources).toEqual([]);
      expect(manifest.idPrefixes).toEqual([]);
      expect(manifest.catalogs).toEqual([]);
      expect(manifest.types).toEqual([]);
      expect(manifest.behaviorHints.configurationRequired).toBe(true);
    }
    const configured = buildManifest({ catalogs: [] } as any, baseUrl);
    expect(configured.resources).toEqual(['catalog', 'meta']);
    expect(configured.types).toEqual(['movie', 'series', 'anime']);
    expect(configured.idPrefixes).toContain('tt');
    expect(configured.behaviorHints.configurationRequired).toBe(false);
  });

  it('builds manifest with catalogs', () => {
    const userConfig = {
      catalogs: [
        { _id: 'action-movies', name: 'Action Movies', type: 'movie', enabled: true },
        { _id: 'top-tv', name: 'Top TV', type: 'series', enabled: true },
      ],
    };
    const manifest = buildManifest(userConfig, baseUrl);
    expect(manifest.id).toBe('community.tmdb.discover.plus');
    expect(manifest.catalogs.length).toBe(4);
    expect(manifest.catalogs[0].id).toBe('tmdb-action-movies');
    expect(manifest.catalogs[0].type).toBe('movie');
    expect(manifest.catalogs[1].id).toBe('tmdb-top-tv');
    expect(manifest.catalogs[1].type).toBe('series');
    expect(manifest.catalogs[2].id).toBe('tmdb-search-movie');
    expect(manifest.catalogs[3].id).toBe('tmdb-search-series');
  });

  it('filters out disabled catalogs', () => {
    const userConfig = {
      catalogs: [
        { _id: 'enabled', name: 'Enabled', type: 'movie', enabled: true },
        { _id: 'disabled', name: 'Disabled', type: 'movie', enabled: false },
      ],
    };
    const manifest = buildManifest(userConfig, baseUrl);
    const catalogIds = manifest.catalogs.map((c: any) => c.id);
    expect(catalogIds).toContain('tmdb-enabled');
    expect(catalogIds).not.toContain('tmdb-disabled');
  });

  it('includes MAL catalogs since MAL is always enabled', () => {
    const manifest = buildManifest(
      {
        catalogs: [
          { _id: 'mal-catalog', name: 'MAL Catalog', type: 'anime', source: 'mal', enabled: true },
        ],
        preferences: { disableSearch: true },
      },
      baseUrl
    );

    expect(manifest.catalogs.map((catalog: any) => catalog.id)).toContain('mal-mal-catalog');
  });

  it('preserves catalog order from saved configuration', () => {
    const manifest = buildManifest(
      {
        catalogs: [
          { _id: 'third', name: 'Third', type: 'movie', source: 'tmdb', enabled: true },
          { _id: 'first', name: 'First', type: 'series', source: 'imdb', enabled: true },
          { _id: 'second', name: 'Second', type: 'movie', source: 'simkl', enabled: true },
        ],
        preferences: { disableSearch: true },
      },
      baseUrl
    );

    expect(manifest.catalogs.map((catalog: any) => catalog.id)).toEqual([
      'tmdb-third',
      'imdb-first',
      'simkl-second',
    ]);
  });

  it('omits search catalogs when disableSearch is true', () => {
    const manifest = buildManifest({ catalogs: [], preferences: { disableSearch: true } }, baseUrl);
    expect(manifest.catalogs.length).toBe(0);
  });

  it('includes AniList search catalogs when AniList search is enabled, even without AniList catalogs', () => {
    const manifest = buildManifest(
      {
        catalogs: [{ _id: 'tmdb-list', name: 'TMDB List', type: 'movie', source: 'tmdb' }],
        preferences: { disableAnilistSearch: false },
      },
      baseUrl
    );

    const ids = manifest.catalogs.map((catalog: any) => catalog.id);
    expect(ids).toContain('anilist-search-movie');
    expect(ids).toContain('anilist-search-series');
    expect(ids).toContain('anilist-search-anime');
  });

  it('includes MAL search catalogs when MAL search is enabled', () => {
    const manifest = buildManifest(
      {
        catalogs: [{ _id: 'tmdb-list', name: 'TMDB List', type: 'movie', source: 'tmdb' }],
        preferences: { disableMalSearch: false },
      },
      baseUrl
    );

    const ids = manifest.catalogs.map((catalog: any) => catalog.id);
    expect(ids).toContain('mal-search-movie');
    expect(ids).toContain('mal-search-series');
    expect(ids).toContain('mal-search-anime');
  });

  it('includes Simkl search catalogs when Simkl search is enabled, even without Simkl catalogs', () => {
    const manifest = buildManifest(
      {
        catalogs: [{ _id: 'tmdb-list', name: 'TMDB List', type: 'movie', source: 'tmdb' }],
        preferences: { disableSimklSearch: false },
      },
      baseUrl
    );

    const ids = manifest.catalogs.map((catalog: any) => catalog.id);
    expect(ids).toContain('simkl-search-movie');
    expect(ids).toContain('simkl-search-series');
    expect(ids).toContain('simkl-search-anime');
  });

  it('generates catalog ID from name when _id is missing', () => {
    const manifest = buildManifest(
      { catalogs: [{ name: 'My Custom List', type: 'movie' }] },
      baseUrl
    );
    expect(manifest.catalogs[0].id).toBe('tmdb-my-custom-list');
  });

  it('advertises MAL anime catalogs as anime for custom-type clients', () => {
    const manifest = buildManifest(
      {
        catalogs: [{ _id: 'mal-anime', name: 'MAL Anime', type: 'anime', source: 'mal' }],
        preferences: { disableSearch: true },
      },
      baseUrl
    );

    expect(manifest.catalogs.find((catalog: any) => catalog.id === 'mal-mal-anime')?.type).toBe(
      'anime'
    );
  });

  it('has correct behaviorHints', () => {
    const manifest = buildManifest({ catalogs: [] }, baseUrl);
    expect(manifest.behaviorHints.configurable).toBe(true);
    expect(manifest.behaviorHints.newEpisodeNotifications).toBe(true);
  });

  it('includes correct resources, types, and idPrefixes', () => {
    const manifest = buildManifest({ catalogs: [] }, baseUrl);
    expect(manifest.resources).toEqual(['catalog', 'meta']);
    expect(manifest.types).toEqual(['movie', 'series', 'anime']);
    expect(manifest.idPrefixes).toEqual(['tmdb:', 'tt', 'mal:', 'kitsu:', 'anilist:', 'anidb:']);
  });

  it('sets pageSize to 20 for all catalogs', () => {
    const manifest = buildManifest(
      { catalogs: [{ _id: 'test', name: 'Test', type: 'movie' }] },
      baseUrl
    );
    expect(manifest.catalogs[0].pageSize).toBe(20);
  });

  it('handles empty/null config gracefully', () => {
    const nullConfigManifest = buildManifest(null, baseUrl);
    expect(nullConfigManifest.catalogs.length).toBe(0);
    expect(nullConfigManifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(buildManifest({}, baseUrl).catalogs.length).toBe(2);
  });

  it('maps year mode to a single genre dropdown options list', async () => {
    const userConfig = {
      userId: 'user1',
      catalogs: [
        {
          _id: 'tmdb-year',
          name: 'Year Catalog',
          type: 'movie',
          source: 'tmdb',
          enabled: true,
          filters: { stremioExtraMode: 'year' },
        },
      ],
      preferences: { disableSearch: true },
    };

    const manifest = buildManifest(userConfig as any, baseUrl);
    await enrichManifestWithExtras(manifest, userConfig as any);

    const target = manifest.catalogs.find((c) => c.id === 'tmdb-tmdb-year');
    expect(target).toBeTruthy();
    const genreExtra = target?.extra.find((e) => e.name === 'genre');
    expect(genreExtra).toBeTruthy();
    expect(genreExtra?.options?.[0]).toBe('All');
    expect(genreExtra?.options).toContain(String(new Date().getFullYear()));
    expect(genreExtra?.isRequired).toBe(false);
    expect(target?.extra[0]?.name).toBe('genre');
    expect(target?.extra[1]?.name).toBe('skip');
    expect(target?.extra.some((e) => e.name === 'year')).toBe(false);
  });

  it('preserves discoverOnly required flag for year mode', async () => {
    const userConfig = {
      userId: 'user-year-discover-only',
      catalogs: [
        {
          _id: 'tmdb-year-discover-only',
          name: 'Year Discover Only Catalog',
          type: 'movie',
          source: 'tmdb',
          enabled: true,
          filters: {
            stremioExtraMode: 'year',
            discoverOnly: true,
          },
        },
      ],
      preferences: { disableSearch: true },
    };

    const manifest = buildManifest(userConfig as any, baseUrl);
    await enrichManifestWithExtras(manifest, userConfig as any);

    const target = manifest.catalogs.find((c) => c.id === 'tmdb-tmdb-year-discover-only');
    const genreExtra = target?.extra.find((e) => e.name === 'genre');

    expect(genreExtra?.isRequired).toBe(true);
    expect(target?.extra[0]?.name).toBe('genre');
    expect(target?.extra[1]?.name).toBe('skip');
  });

  it('limits year options to selected range and excludes future years when releasedOnly is enabled', async () => {
    const currentYear = new Date().getFullYear();
    const userConfig = {
      userId: 'user-year-range',
      catalogs: [
        {
          _id: 'tmdb-year-range',
          name: 'Year Range Catalog',
          type: 'movie',
          source: 'tmdb',
          enabled: true,
          filters: {
            stremioExtraMode: 'year',
            releasedOnly: true,
            yearFrom: currentYear - 2,
            yearTo: currentYear + 3,
          },
        },
      ],
      preferences: { disableSearch: true },
    };

    const manifest = buildManifest(userConfig as any, baseUrl);
    await enrichManifestWithExtras(manifest, userConfig as any);

    const target = manifest.catalogs.find((c) => c.id === 'tmdb-tmdb-year-range');
    const genreExtra = target?.extra.find((e) => e.name === 'genre');

    expect(genreExtra?.options).toEqual([
      'All',
      String(currentYear),
      String(currentYear - 1),
      String(currentYear - 2),
    ]);
  });

  it('maps sortBy mode to a single genre dropdown options list', async () => {
    const userConfig = {
      userId: 'user2',
      catalogs: [
        {
          _id: 'tmdb-sort',
          name: 'Sort Catalog',
          type: 'series',
          source: 'tmdb',
          enabled: true,
          filters: { stremioExtraMode: 'sortBy' },
        },
      ],
      preferences: { disableSearch: true },
    };

    const manifest = buildManifest(userConfig as any, baseUrl);
    await enrichManifestWithExtras(manifest, userConfig as any);

    const target = manifest.catalogs.find((c) => c.id === 'tmdb-tmdb-sort');
    expect(target).toBeTruthy();
    const genreExtra = target?.extra.find((e) => e.name === 'genre');
    expect(genreExtra).toBeTruthy();
    expect(genreExtra?.options?.[0]).toBe('All');
    expect(genreExtra?.options).toContain('Most Popular');
    expect(target?.extra[0]?.name).toBe('genre');
    expect(target?.extra[1]?.name).toBe('skip');
    expect(target?.extra.some((e) => e.name === 'sortBy')).toBe(false);
  });

  it('maps certification options to selected country and selected certifications only', async () => {
    const getCertificationsMock = vi.mocked(tmdb.getCertifications);
    const getApiKeyMock = vi.mocked(getApiKeyFromConfig);
    getApiKeyMock.mockReturnValue('tmdb-key');
    getCertificationsMock.mockResolvedValue({
      US: [{ certification: 'PG' }, { certification: 'R' }],
      DE: [{ certification: 'FSK 12' }, { certification: 'FSK 16' }],
    } as any);

    const userConfig = {
      userId: 'user-cert-country',
      catalogs: [
        {
          _id: 'tmdb-cert-country',
          name: 'Certification Catalog',
          type: 'movie',
          source: 'tmdb',
          enabled: true,
          filters: {
            stremioExtraMode: 'certification',
            certificationCountry: 'DE',
            certifications: ['FSK 16'],
          },
        },
      ],
      preferences: { disableSearch: true },
    };

    const manifest = buildManifest(userConfig as any, baseUrl);
    await enrichManifestWithExtras(manifest, userConfig as any);

    const target = manifest.catalogs.find((c) => c.id === 'tmdb-tmdb-cert-country');
    const genreExtra = target?.extra.find((e) => e.name === 'genre');

    expect(genreExtra?.options).toEqual(['All', 'FSK 16']);
    expect(target?.extra[0]?.name).toBe('genre');
    expect(target?.extra[1]?.name).toBe('skip');
    expect(genreExtra?.options).not.toContain('PG');
    expect(getCertificationsMock).toHaveBeenCalledWith('tmdb-key', 'movie');
  });

  it('adds genre extras for AniList catalogs', async () => {
    const userConfig = {
      userId: 'user-anilist',
      catalogs: [
        {
          _id: 'anilist-genre',
          name: 'AniList Genre Catalog',
          type: 'series',
          source: 'anilist',
          enabled: true,
          filters: {
            stremioExtraMode: 'genre',
          },
        },
      ],
      preferences: { disableSearch: true },
    };

    const manifest = buildManifest(userConfig as any, baseUrl);
    await enrichManifestWithGenres(manifest, userConfig as any);

    const target = manifest.catalogs.find((c) => c.id === 'anilist-anilist-genre');
    const genreExtra = target?.extra.find((e) => e.name === 'genre');

    expect(genreExtra?.options).toEqual(['All', 'Action', 'Adventure', 'Drama']);
    expect(genreExtra?.optionsLimit).toBe(1);
    expect(target?.extra[0]?.name).toBe('genre');
    expect(target?.extra[1]?.name).toBe('skip');
  });

  it('does not inject extras for TMDB collection catalogs', async () => {
    const userConfig = {
      userId: 'user-collection',
      catalogs: [
        {
          _id: 'tmdb-collection',
          name: 'Collection Catalog',
          type: 'movie',
          source: 'tmdb',
          enabled: true,
          filters: {
            listType: 'collection',
            collectionId: '10',
            stremioExtraMode: 'genre',
          },
        },
      ],
      preferences: { disableSearch: true },
    };

    const manifest = buildManifest(userConfig as any, baseUrl);
    await enrichManifestWithGenres(manifest, userConfig as any);
    await enrichManifestWithExtras(manifest, userConfig as any);

    const target = manifest.catalogs.find((c) => c.id === 'tmdb-tmdb-collection');
    expect(target?.extra).toEqual([{ name: 'skip' }]);
  });
});
