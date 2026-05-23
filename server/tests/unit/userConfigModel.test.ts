import { describe, it, expect } from 'vitest';
import { UserConfig } from '../../src/models/UserConfig.ts';
import type { SourceType } from '../../src/types/config.ts';

describe('UserConfig preferences schema', () => {
  it('includes per-source search disable fields', () => {
    const paths = [
      'preferences.disableTmdbSearch',
      'preferences.disableImdbSearch',
      'preferences.disableAnilistSearch',
      'preferences.disableMalSearch',
      'preferences.disableKitsuSearch',
      'preferences.disableSimklSearch',
      'preferences.disableTraktSearch',
    ];

    for (const path of paths) {
      expect(UserConfig.schema.path(path)).toBeDefined();
    }
  });

  it('defaults per-source search disable fields to true except tmdb', () => {
    const doc = new UserConfig({ userId: 'schema-test-user', catalogs: [], preferences: {} });

    expect(doc.preferences.disableTmdbSearch).toBe(false);
    expect(doc.preferences.disableImdbSearch).toBe(true);
    expect(doc.preferences.disableAnilistSearch).toBe(true);
    expect(doc.preferences.disableMalSearch).toBe(true);
    expect(doc.preferences.disableKitsuSearch).toBe(true);
    expect(doc.preferences.disableSimklSearch).toBe(true);
    expect(doc.preferences.disableTraktSearch).toBe(true);
  });

  it('accepts kitsu as a valid catalog source', () => {
    const doc = new UserConfig({
      userId: 'schema-kitsu-source-user',
      catalogs: [
        {
          name: 'Kitsu Test',
          type: 'anime',
          source: 'kitsu',
          filters: {
            listType: 'discover',
          },
        },
      ],
      preferences: {},
    });

    const error = doc.validateSync();
    expect(error).toBeUndefined();
  });

  it('preserves nested artwork custom URL settings', () => {
    const doc = new UserConfig({
      userId: 'schema-artwork-test-user',
      catalogs: [],
      preferences: {
        artwork: {
          movie: {
            poster: {
              provider: 'customUrl',
              customUrlPattern: 'https://img.example.com/{type}/{rating_id}.jpg',
            },
          },
          englishArtOnly: true,
        },
      },
    });

    const raw = doc.toObject();
    expect(raw.preferences.artwork.movie.poster.provider).toBe('customUrl');
    expect(raw.preferences.artwork.movie.poster.customUrlPattern).toBe(
      'https://img.example.com/{type}/{rating_id}.jpg'
    );
    expect(raw.preferences.artwork.englishArtOnly).toBe(true);
  });

  it('catalog.source enum matches the SourceType union (schema-sync invariant)', () => {
    // Authoritative list — must equal SourceType union in src/types/config.ts.
    // Compile-time check: every literal here is assignable to SourceType, and the
    // tuple's element type is SourceType. If either side drifts, this fails to compile.
    const expectedSources = ['tmdb', 'imdb', 'anilist', 'mal', 'simkl', 'trakt', 'kitsu'] as const;
    const _typecheck: readonly SourceType[] = expectedSources;
    void _typecheck;

    const catalogsPath = UserConfig.schema.path('catalogs') as unknown as {
      schema: { path: (key: string) => { enumValues?: string[] } };
    };
    const sourcePath = catalogsPath.schema.path('source');
    const mongooseEnum = sourcePath.enumValues || [];

    expect([...mongooseEnum].sort()).toEqual([...expectedSources].sort());
  });
});
