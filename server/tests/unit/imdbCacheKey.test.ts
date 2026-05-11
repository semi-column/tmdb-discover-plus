import { describe, expect, it } from 'vitest';
import {
  buildImdbEnrichmentCacheKey,
  buildArtworkIntegrationScope,
  buildPosterIntegrationScope,
} from '../../src/services/imdb/cacheKey.ts';

describe('IMDb enrichment cache key segregation', () => {
  it('differentiates artwork scope across poster/backdrop/logo', () => {
    const scopeA = buildArtworkIntegrationScope({
      poster: { service: 'rpdb', apiKey: 'a' },
      backdrop: null,
      logo: null,
    });
    const scopeB = buildArtworkIntegrationScope({
      poster: { service: 'rpdb', apiKey: 'a' },
      backdrop: { service: 'customUrl', customUrlPattern: 'https://x/{rating_id}.jpg' },
      logo: null,
    });

    expect(scopeA).not.toBe(scopeB);
  });

  it('uses none scope when no poster integration key exists', () => {
    expect(buildPosterIntegrationScope('none', null)).toBe('none:none');
    expect(buildPosterIntegrationScope(undefined, undefined)).toBe('none:none');
  });

  it('differentiates by poster service and key hash', () => {
    const rpdbA = buildPosterIntegrationScope('rpdb', 'key-a');
    const rpdbB = buildPosterIntegrationScope('rpdb', 'key-b');
    const topA = buildPosterIntegrationScope('topPosters', 'key-a');
    const customA = buildPosterIntegrationScope(
      'customUrl',
      null,
      'https://img.example.com/{rating_id}.jpg'
    );
    const customB = buildPosterIntegrationScope(
      'customUrl',
      null,
      'https://img.example.com/{imdb_id}.jpg'
    );

    expect(rpdbA).not.toBe(rpdbB);
    expect(rpdbA).not.toBe(topA);
    expect(customA).not.toBe(customB);
  });

  it('builds distinct top250 cache keys by integration scope', () => {
    const noneScope = buildPosterIntegrationScope('none', null);
    const rpdbScope = buildPosterIntegrationScope('rpdb', 'secret-key');

    const noneKey = buildImdbEnrichmentCacheKey('movie', 'top250', {}, null, 0, noneScope, '');
    const rpdbKey = buildImdbEnrichmentCacheKey('movie', 'top250', {}, null, 0, rpdbScope, '');

    expect(noneKey).not.toBe(rpdbKey);
  });
});
