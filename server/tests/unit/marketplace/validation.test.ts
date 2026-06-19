import { describe, it, expect } from 'vitest';

import { validateMarketplaceEntry } from '../../../src/services/marketplace/validation.ts';
import type { MarketplaceEntry, MarketplaceEngagement } from '../../../src/types/marketplace.ts';

/**
 * Example-based unit tests for `validateMarketplaceEntry` covering every rule
 * boundary and the rejection of non-finite counter / trending-score values.
 *
 * Validates: Requirements 3.6 (counters are integers >= 0; trendingScore is a
 * finite number >= 0), 3.7 (a rejection identifies the failed rule). Rules
 * 3.1–3.5 boundaries are exercised here as well since the validator owns them.
 */

/** Build a valid engagement block; callers override per-case. */
function makeEngagement(overrides: Partial<MarketplaceEngagement> = {}): MarketplaceEngagement {
  return {
    likes: 0,
    installs: 0,
    views: 0,
    trendingScore: 0,
    ...overrides,
  };
}

/** Build a fully valid Marketplace_Entry; callers override the field under test. */
function makeEntry(overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    marketplaceId: 'mkt-0001',
    provenance: {
      originUserId: 'user-123',
      originCatalogId: 'catalog-abc',
    },
    name: 'Valid Catalog Name',
    description: 'A perfectly fine description',
    tags: ['action', 'drama'],
    type: 'movie',
    source: 'tmdb',
    genres: ['Action'],
    filterFacets: ['sort:popularity.desc'],
    filters: {},
    visibility: 'public',
    moderation: 'active',
    engagement: makeEngagement(),
    contentHash: 'hash-xyz',
    publishedAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    schemaVersion: 1,
    ...overrides,
  } as MarketplaceEntry;
}

describe('validateMarketplaceEntry — happy path', () => {
  it('accepts a fully valid entry without throwing', () => {
    expect(() => validateMarketplaceEntry(makeEntry())).not.toThrow();
  });

  it('accepts an entry with no description (optional field)', () => {
    const entry = makeEntry();
    delete (entry as { description?: string }).description;
    expect(() => validateMarketplaceEntry(entry)).not.toThrow();
  });

  it('accepts an entry with zero tags', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ tags: [] }))).not.toThrow();
  });
});

describe('validateMarketplaceEntry — name length boundaries (Rule 3.1)', () => {
  it('rejects a 0-character name', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ name: '' }))).toThrow(
      /Rule 3\.1 \(name length\)/
    );
  });

  it('accepts a 1-character name', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ name: 'a' }))).not.toThrow();
  });

  it('accepts a 100-character name', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ name: 'a'.repeat(100) }))).not.toThrow();
  });

  it('rejects a 101-character name', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ name: 'a'.repeat(101) }))).toThrow(
      /Rule 3\.1 \(name length\)/
    );
  });
});

describe('validateMarketplaceEntry — description length boundaries (Rule 3.2)', () => {
  it('accepts a 500-character description', () => {
    expect(() =>
      validateMarketplaceEntry(makeEntry({ description: 'd'.repeat(500) }))
    ).not.toThrow();
  });

  it('rejects a 501-character description', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ description: 'd'.repeat(501) }))).toThrow(
      /Rule 3\.2 \(description length\)/
    );
  });
});

describe('validateMarketplaceEntry — tag rules (Rule 3.3)', () => {
  it('accepts 20 tags', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag${i}`);
    expect(() => validateMarketplaceEntry(makeEntry({ tags }))).not.toThrow();
  });

  it('rejects 21 tags', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    expect(() => validateMarketplaceEntry(makeEntry({ tags }))).toThrow(/Rule 3\.3 \(tag count\)/);
  });

  it('accepts a tag of exactly 40 characters', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ tags: ['a'.repeat(40)] }))).not.toThrow();
  });

  it('rejects a tag of 41 characters', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ tags: ['a'.repeat(41)] }))).toThrow(
      /Rule 3\.3 \(tag length\)/
    );
  });

  it('rejects an empty-string tag (below 1-char minimum)', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ tags: [''] }))).toThrow(
      /Rule 3\.3 \(tag length\)/
    );
  });

  it('rejects a non-lowercase tag', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ tags: ['Action'] }))).toThrow(
      /Rule 3\.3 \(tag case\)/
    );
  });

  it('rejects duplicate tags', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ tags: ['action', 'action'] }))).toThrow(
      /Rule 3\.3 \(tag dedupe\)/
    );
  });
});

describe('validateMarketplaceEntry — type allow-list (Rule 3.4)', () => {
  it('accepts a valid type', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ type: 'series' }))).not.toThrow();
  });

  it('rejects an invalid type', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ type: 'documentary' as never }))).toThrow(
      /Rule 3\.4 \(type allow-list\)/
    );
  });

  it('rejects a type that differs only by case (case-sensitive)', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ type: 'Movie' as never }))).toThrow(
      /Rule 3\.4 \(type allow-list\)/
    );
  });
});

describe('validateMarketplaceEntry — source allow-list (Rule 3.5)', () => {
  it('accepts a valid source', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ source: 'anilist' }))).not.toThrow();
  });

  it('rejects an invalid source', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ source: 'netflix' as never }))).toThrow(
      /Rule 3\.5 \(source allow-list\)/
    );
  });

  it('rejects a source that differs only by case (case-sensitive)', () => {
    expect(() => validateMarketplaceEntry(makeEntry({ source: 'TMDB' as never }))).toThrow(
      /Rule 3\.5 \(source allow-list\)/
    );
  });
});

describe('validateMarketplaceEntry — engagement counters (Rule 3.6)', () => {
  for (const field of ['likes', 'installs', 'views'] as const) {
    it(`accepts ${field} = 0`, () => {
      const entry = makeEntry({ engagement: makeEngagement({ [field]: 0 }) });
      expect(() => validateMarketplaceEntry(entry)).not.toThrow();
    });

    it(`rejects a negative ${field}`, () => {
      const entry = makeEntry({ engagement: makeEngagement({ [field]: -1 }) });
      expect(() => validateMarketplaceEntry(entry)).toThrow(/Rule 3\.6 \(counter\)/);
    });

    it(`rejects a non-integer ${field}`, () => {
      const entry = makeEntry({ engagement: makeEngagement({ [field]: 1.5 }) });
      expect(() => validateMarketplaceEntry(entry)).toThrow(/Rule 3\.6 \(counter\)/);
    });

    it(`rejects a NaN ${field}`, () => {
      const entry = makeEntry({ engagement: makeEngagement({ [field]: NaN }) });
      expect(() => validateMarketplaceEntry(entry)).toThrow(/Rule 3\.6 \(counter\)/);
    });

    it(`rejects an Infinity ${field}`, () => {
      const entry = makeEntry({
        engagement: makeEngagement({ [field]: Number.POSITIVE_INFINITY }),
      });
      expect(() => validateMarketplaceEntry(entry)).toThrow(/Rule 3\.6 \(counter\)/);
    });
  }
});

describe('validateMarketplaceEntry — trendingScore finiteness (Rule 3.6)', () => {
  it('accepts a finite trendingScore of 0', () => {
    const entry = makeEntry({ engagement: makeEngagement({ trendingScore: 0 }) });
    expect(() => validateMarketplaceEntry(entry)).not.toThrow();
  });

  it('accepts a finite positive trendingScore', () => {
    const entry = makeEntry({ engagement: makeEngagement({ trendingScore: 12.5 }) });
    expect(() => validateMarketplaceEntry(entry)).not.toThrow();
  });

  it('rejects a negative trendingScore', () => {
    const entry = makeEntry({ engagement: makeEngagement({ trendingScore: -0.01 }) });
    expect(() => validateMarketplaceEntry(entry)).toThrow(/Rule 3\.6 \(trendingScore\)/);
  });

  it('rejects a NaN trendingScore', () => {
    const entry = makeEntry({ engagement: makeEngagement({ trendingScore: NaN }) });
    expect(() => validateMarketplaceEntry(entry)).toThrow(/Rule 3\.6 \(trendingScore\)/);
  });

  it('rejects a +Infinity trendingScore', () => {
    const entry = makeEntry({
      engagement: makeEngagement({ trendingScore: Number.POSITIVE_INFINITY }),
    });
    expect(() => validateMarketplaceEntry(entry)).toThrow(/Rule 3\.6 \(trendingScore\)/);
  });

  it('rejects a -Infinity trendingScore', () => {
    const entry = makeEntry({
      engagement: makeEngagement({ trendingScore: Number.NEGATIVE_INFINITY }),
    });
    expect(() => validateMarketplaceEntry(entry)).toThrow(/Rule 3\.6 \(trendingScore\)/);
  });
});
