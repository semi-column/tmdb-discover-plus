import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CACHE_TTLS, TIMEOUTS, catalogServerTtl } from '../../src/constants.ts';

describe('catalogServerTtl', () => {
  it('returns trending TTL for trending list type', () => {
    expect(catalogServerTtl('trending')).toBe(CACHE_TTLS.CATALOG_SERVER_TRENDING);
  });

  it('returns trending TTL for now_playing', () => {
    expect(catalogServerTtl('now_playing')).toBe(CACHE_TTLS.CATALOG_SERVER_TRENDING);
  });

  it('returns trending TTL for upcoming', () => {
    expect(catalogServerTtl('upcoming')).toBe(CACHE_TTLS.CATALOG_SERVER_TRENDING);
  });

  it('returns trending TTL for on_the_air', () => {
    expect(catalogServerTtl('on_the_air')).toBe(CACHE_TTLS.CATALOG_SERVER_TRENDING);
  });

  it('returns trending TTL for popular', () => {
    expect(catalogServerTtl('popular')).toBe(CACHE_TTLS.CATALOG_SERVER_TRENDING);
  });

  it('returns discover TTL for discover list type', () => {
    expect(catalogServerTtl('discover')).toBe(CACHE_TTLS.CATALOG_SERVER_DISCOVER);
  });

  it('returns discover TTL for undefined list type', () => {
    expect(catalogServerTtl(undefined)).toBe(CACHE_TTLS.CATALOG_SERVER_DISCOVER);
  });

  it('returns discover TTL for null list type', () => {
    expect(catalogServerTtl(null)).toBe(CACHE_TTLS.CATALOG_SERVER_DISCOVER);
  });

  it('returns discover TTL for unknown list type', () => {
    expect(catalogServerTtl('my_custom_list')).toBe(CACHE_TTLS.CATALOG_SERVER_DISCOVER);
  });
});

describe('TTL constants', () => {
  it('META_HEADER is 24 hours', () => {
    expect(CACHE_TTLS.META_HEADER).toBe(86_400);
  });

  it('CATALOG_HEADER is 3 hours', () => {
    expect(CACHE_TTLS.CATALOG_HEADER).toBe(10_800);
  });

  it('CATALOG_STALE_REVALIDATE is 1 hour', () => {
    expect(CACHE_TTLS.CATALOG_STALE_REVALIDATE).toBe(3_600);
  });

  it('CATALOG_SERVER_DISCOVER is 3 hours', () => {
    expect(CACHE_TTLS.CATALOG_SERVER_DISCOVER).toBe(10_800);
  });

  it('CATALOG_SERVER_TRENDING is 3 hours', () => {
    expect(CACHE_TTLS.CATALOG_SERVER_TRENDING).toBe(10_800);
  });

  it('RPDB timeout is 1.5 seconds', () => {
    expect(TIMEOUTS.RPDB_FETCH_MS).toBe(1_500);
  });
});
