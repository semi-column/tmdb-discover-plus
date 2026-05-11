import { describe, it, expect } from 'vitest';
import {
  traktToStremioMeta,
  batchConvertToStremioMeta,
} from '../../src/services/trakt/stremioMeta.ts';
import type { ArtworkOptions } from '../../src/types/config.ts';

describe('trakt stremio meta poster handling', () => {
  const baseItem = {
    title: 'Example Title',
    year: 2024,
    ids: {
      trakt: 1,
      slug: 'example-title',
      imdb: 'tt1234567',
      tmdb: 42,
    },
    overview: 'Example overview',
    rating: 8.1,
    genres: ['drama'],
  };

  const rpdbOptions: ArtworkOptions = {
    poster: { apiKey: 'rpdb-key', service: 'rpdb' },
    backdrop: null,
    logo: null,
    landscape: null,
    episode: null,
  };

  it('uses metahub poster by default', () => {
    const meta = traktToStremioMeta(baseItem as any, 'movie');
    expect(meta).not.toBeNull();
    expect(meta?.poster).toBe('https://images.metahub.space/poster/medium/tt1234567/img');
  });

  it('uses RPDB poster when poster options are provided', () => {
    const meta = traktToStremioMeta(baseItem as any, 'movie', rpdbOptions);

    expect(meta).not.toBeNull();
    expect(meta?.poster).toBe(
      'https://api.ratingposterdb.com/rpdb-key/imdb/poster-default/tt1234567.jpg?fallback=true'
    );
  });

  it('passes poster options through batch conversion', () => {
    const metas = batchConvertToStremioMeta([baseItem as any], 'movie', rpdbOptions);

    expect(metas).toHaveLength(1);
    expect(metas[0]?.poster).toContain('api.ratingposterdb.com');
  });
});
