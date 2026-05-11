import { describe, it, expect } from 'vitest';
import { UserConfig } from '../../src/models/UserConfig.ts';

describe('UserConfig preferences schema', () => {
  it('includes per-source search disable fields', () => {
    const paths = [
      'preferences.disableTmdbSearch',
      'preferences.disableImdbSearch',
      'preferences.disableAnilistSearch',
      'preferences.disableMalSearch',
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
    expect(doc.preferences.disableSimklSearch).toBe(true);
    expect(doc.preferences.disableTraktSearch).toBe(true);
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
});
