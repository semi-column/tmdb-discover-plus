import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/tmdb/index.js', () => ({
  getGenres: vi.fn(),
}));
vi.mock('../../src/utils/helpers.js', () => ({
  normalizeGenreName: vi.fn((s: string) => s.toLowerCase()),
  parseIdArray: vi.fn((s: string) => s.split(',')),
}));
vi.mock('../../src/services/configService.js', () => ({
  getApiKeyFromConfig: vi.fn(),
  updateCatalogGenres: vi.fn(),
}));

vi.mock('../../src/config.ts', () => ({
  config: {
    addon: { variant: undefined },
    baseUrl: 'https://example.com',
    logging: { level: 'info', format: 'text' },
    nodeEnv: 'test',
  },
}));

vi.mock('../../src/services/imdb/index.ts', () => ({
  isImdbApiEnabled: vi.fn(() => false),
}));

import { buildManifest } from '../../src/services/manifestService.js';

describe('buildManifest', () => {
  const baseUrl = 'https://example.com';

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

  it('omits search catalogs when disableSearch is true', () => {
    const manifest = buildManifest(
      { catalogs: [], preferences: { disableSearch: true } },
      baseUrl,
    );
    expect(manifest.catalogs.length).toBe(0);
  });

  it('generates catalog ID from name when _id is missing', () => {
    const manifest = buildManifest(
      { catalogs: [{ name: 'My Custom List', type: 'movie' }] },
      baseUrl,
    );
    expect(manifest.catalogs[0].id).toBe('tmdb-my-custom-list');
  });

  it('has correct behaviorHints', () => {
    const manifest = buildManifest({ catalogs: [] }, baseUrl);
    expect(manifest.behaviorHints.configurable).toBe(true);
    expect(manifest.behaviorHints.newEpisodeNotifications).toBe(true);
  });

  it('includes correct resources, types, and idPrefixes', () => {
    const manifest = buildManifest({ catalogs: [] }, baseUrl);
    expect(manifest.resources).toEqual(['catalog', 'meta']);
    expect(manifest.types).toEqual(['movie', 'series']);
    expect(manifest.idPrefixes).toEqual(['tmdb:', 'tt']);
  });

  it('sets pageSize to 20 for all catalogs', () => {
    const manifest = buildManifest(
      { catalogs: [{ _id: 'test', name: 'Test', type: 'movie' }] },
      baseUrl,
    );
    expect(manifest.catalogs[0].pageSize).toBe(20);
  });

  it('handles empty/null config gracefully', () => {
    expect(buildManifest(null, baseUrl).catalogs.length).toBe(2);
    expect(buildManifest({}, baseUrl).catalogs.length).toBe(2);
  });
});
