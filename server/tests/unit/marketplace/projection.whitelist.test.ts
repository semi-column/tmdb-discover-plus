import { describe, it, expect } from 'vitest';

import { toPublicProjection } from '../../../src/services/marketplace/projection.ts';
import type { CatalogConfig } from '../../../src/types/config.ts';

/**
 * Example-based unit tests for `toPublicProjection` covering the field
 * whitelist and per-field sanitization rules.
 *
 * Validates: Requirements 3.1 (name 1–100), 3.2 (description 0–500),
 * 3.3 (tags ≤20 of ≤40 chars, lowercased, deduped), 2.1 (field whitelist),
 * and 2.4 (filter sanitization failure ⇒ rejection before persistence).
 */

const USER_ID = 'user-123';

/** Build a minimal, valid catalog; callers override the field under test. */
function makeCatalog(overrides: Record<string, unknown> = {}): CatalogConfig {
  return {
    _id: 'catalog-abc',
    name: 'Base Catalog',
    type: 'movie',
    source: 'tmdb',
    filters: {},
    ...overrides,
  } as CatalogConfig;
}

// The exact set of keys a public projection entry may carry.
const EXPECTED_ENTRY_KEYS = [
  'marketplaceId',
  'provenance',
  'name',
  'description',
  'tags',
  'type',
  'source',
  'genres',
  'filterFacets',
  'filters',
  'formState',
  'visibility',
  'moderation',
  'engagement',
  'contentHash',
  'publishedAt',
  'updatedAt',
  'schemaVersion',
].sort();

describe('toPublicProjection — name sanitization (Requirement 3.1)', () => {
  it('rejects a name that is empty after sanitization', () => {
    expect(() => toPublicProjection(USER_ID, makeCatalog({ name: '   ' }))).toThrow(
      /name must contain between 1 and 100 characters/i
    );
  });

  it('rejects a markup-only name (empty after stripping tags)', () => {
    expect(() => toPublicProjection(USER_ID, makeCatalog({ name: '<b></b>' }))).toThrow(
      /name must contain between 1 and 100 characters/i
    );
  });

  it('accepts a 1-character name', () => {
    const entry = toPublicProjection(USER_ID, makeCatalog({ name: 'a' }));
    expect(entry.name).toBe('a');
  });

  it('accepts a 100-character name unchanged', () => {
    const name = 'a'.repeat(100);
    const entry = toPublicProjection(USER_ID, makeCatalog({ name }));
    expect(entry.name).toBe(name);
    expect(entry.name).toHaveLength(100);
  });

  it('truncates a name longer than 100 characters to 100', () => {
    const entry = toPublicProjection(USER_ID, makeCatalog({ name: 'a'.repeat(150) }));
    expect(entry.name).toHaveLength(100);
  });
});

describe('toPublicProjection — description sanitization (Requirement 3.2)', () => {
  it('omits the description when absent (0 chars ⇒ undefined)', () => {
    const entry = toPublicProjection(USER_ID, makeCatalog());
    expect(entry.description).toBeUndefined();
  });

  it('omits the description when it sanitizes to empty', () => {
    const entry = toPublicProjection(USER_ID, makeCatalog({ description: '   ' }));
    expect(entry.description).toBeUndefined();
  });

  it('accepts a 500-character description unchanged', () => {
    const description = 'd'.repeat(500);
    const entry = toPublicProjection(USER_ID, makeCatalog({ description }));
    expect(entry.description).toHaveLength(500);
  });

  it('truncates a description longer than 500 characters to 500', () => {
    const entry = toPublicProjection(USER_ID, makeCatalog({ description: 'd'.repeat(600) }));
    expect(entry.description).toHaveLength(500);
  });

  it('strips HTML/markup from the description', () => {
    const entry = toPublicProjection(
      USER_ID,
      makeCatalog({ description: '<b>Hello</b> <i>World</i>' })
    );
    expect(entry.description).toBe('Hello World');
    expect(entry.description).not.toMatch(/[<>]/);
  });

  it('strips script tags, leaving no markup', () => {
    const entry = toPublicProjection(
      USER_ID,
      makeCatalog({ description: '<script>alert(1)</script>Safe text' })
    );
    expect(entry.description).not.toMatch(/[<>]/);
    expect(entry.description).toContain('Safe text');
  });
});

describe('toPublicProjection — tag sanitization (Requirement 3.3)', () => {
  it('keeps at most 20 tags', () => {
    const tags = Array.from({ length: 25 }, (_, i) => `tag${i}`);
    const entry = toPublicProjection(USER_ID, makeCatalog({ tags }));
    expect(entry.tags).toHaveLength(20);
  });

  it('truncates each tag to 40 characters', () => {
    const entry = toPublicProjection(USER_ID, makeCatalog({ tags: ['t'.repeat(50)] }));
    expect(entry.tags[0]).toHaveLength(40);
  });

  it('lowercases tags', () => {
    const entry = toPublicProjection(USER_ID, makeCatalog({ tags: ['ACTION', 'SciFi'] }));
    expect(entry.tags).toEqual(['action', 'scifi']);
  });

  it('deduplicates tags after lowercasing', () => {
    const entry = toPublicProjection(
      USER_ID,
      makeCatalog({ tags: ['action', 'ACTION', 'Action', 'drama'] })
    );
    expect(entry.tags).toEqual(['action', 'drama']);
  });

  it('drops empty / markup-only tags', () => {
    const entry = toPublicProjection(
      USER_ID,
      makeCatalog({ tags: ['', '   ', '<b></b>', 'keep'] })
    );
    expect(entry.tags).toEqual(['keep']);
  });

  it('returns an empty tag list when tags are absent or non-array', () => {
    expect(toPublicProjection(USER_ID, makeCatalog()).tags).toEqual([]);
    expect(toPublicProjection(USER_ID, makeCatalog({ tags: 'not-an-array' })).tags).toEqual([]);
  });
});

describe('toPublicProjection — field whitelist (Requirement 2.1)', () => {
  it('produces an entry whose keys are exactly the whitelisted set', () => {
    const entry = toPublicProjection(USER_ID, makeCatalog({ description: 'x', tags: ['y'] }));
    expect(Object.keys(entry).sort()).toEqual(EXPECTED_ENTRY_KEYS);
  });

  it('excludes arbitrary extra catalog fields from the entry', () => {
    const entry = toPublicProjection(
      USER_ID,
      makeCatalog({
        somethingArbitrary: 'should-not-appear',
        internalNote: 42,
        enabled: true,
        published: true,
      }) as CatalogConfig
    ) as unknown as Record<string, unknown>;

    expect(entry).not.toHaveProperty('somethingArbitrary');
    expect(entry).not.toHaveProperty('internalNote');
    expect(entry).not.toHaveProperty('enabled');
    expect(entry).not.toHaveProperty('published');
  });

  it('copies only the catalog-derived public fields it is meant to carry', () => {
    const entry = toPublicProjection(
      USER_ID,
      makeCatalog({ name: 'Visible', type: 'series', source: 'anilist' })
    );
    expect(entry.name).toBe('Visible');
    expect(entry.type).toBe('series');
    expect(entry.source).toBe('anilist');
    expect(entry.visibility).toBe('public');
    expect(entry.moderation).toBe('active');
  });
});

describe('toPublicProjection — filter sanitization failure (Requirement 2.4)', () => {
  it('rejects the entry when source-specific filter sanitization throws', () => {
    // A filters object whose property access throws causes
    // sanitizeFiltersForSource to fail while copying the filters, which must
    // be surfaced as a rejection before any persistence.
    const hostileFilters: Record<string, unknown> = {};
    Object.defineProperty(hostileFilters, 'boom', {
      enumerable: true,
      get() {
        throw new Error('filter blew up');
      },
    });

    expect(() => toPublicProjection(USER_ID, makeCatalog({ filters: hostileFilters }))).toThrow(
      /filter sanitization failed/i
    );
  });
});
