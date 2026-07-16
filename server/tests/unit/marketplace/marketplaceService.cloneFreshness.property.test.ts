import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { cloneCatalog } from '../../../src/services/marketplaceService.ts';
import { MARKETPLACE_SOURCES, MARKETPLACE_TYPES } from '../../../src/constants.ts';
import type { CatalogFilters } from '../../../src/types/config.ts';
import type { ContentType } from '../../../src/types/common.ts';
import type { SourceType } from '../../../src/types/config.ts';
import type { MarketplaceEntry } from '../../../src/types/marketplace.ts';

/**
 * Property 1: Clone freshness & provenance.
 *
 * For an arbitrary valid Marketplace_Entry `e`, `cloneCatalog(e)` produces a
 * Cloned_Catalog whose:
 *   - `_id` is a freshly minted UUID that differs from
 *     `e.provenance.originCatalogId` (Req 13.1); calling `cloneCatalog`
 *     repeatedly on the same entry always yields distinct `_id`s.
 *   - `enabled` is forced to `true` (Req 13.3, covered incidentally).
 *   - `clonedFrom` is fully populated with a non-empty `marketplaceId` equal to
 *     `e.marketplaceId`, `originUserId` equal to `e.provenance.originUserId`,
 *     `originCatalogId` equal to `e.provenance.originCatalogId`, and a `clonedAt`
 *     that is a valid ISO UTC timestamp captured at creation (Req 13.4).
 *
 * `cloneCatalog` is synchronous and pure (it performs no storage I/O), so the
 * real implementation is exercised directly with no mocking.
 *
 * **Validates: Requirements 13.1, 13.4**
 */

// --- Generators ------------------------------------------------------------

const alnumChar = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
);
const alnumToken = (min: number, max: number) =>
  fc.array(alnumChar, { minLength: min, maxLength: max }).map((cs) => cs.join(''));

// A valid short userId: [A-Za-z0-9_-]{6,30}.
const userIdArb = alnumToken(6, 24);

const typeArb = fc.constantFrom(...MARKETPLACE_TYPES) as fc.Arbitrary<ContentType>;
const sourceArb = fc.constantFrom(...MARKETPLACE_SOURCES) as fc.Arbitrary<SourceType>;
const nameArb = alnumToken(1, 40);

// A conservative, clearly-valid filters object.
const filtersArb = fc.record(
  {
    sortBy: fc.option(alnumToken(1, 12), { nil: undefined }),
    genreNames: fc.option(fc.array(alnumToken(1, 10), { maxLength: 4 }), { nil: undefined }),
  },
  { requiredKeys: [] }
) as fc.Arbitrary<CatalogFilters>;

// A UUID generator for the public marketplaceId and the origin catalog id (a
// catalog `_id` is itself a UUID in this codebase).
const uuidArb = fc.uuid();

/**
 * Build an arbitrary, fully-populated Marketplace_Entry. Only the fields read by
 * `cloneCatalog` need to be meaningful, but the rest are filled with valid
 * placeholder values so the entry is a faithful instance of the type.
 */
const entryArb: fc.Arbitrary<MarketplaceEntry> = fc
  .record({
    marketplaceId: uuidArb,
    originUserId: userIdArb,
    originCatalogId: uuidArb,
    name: nameArb,
    type: typeArb,
    source: sourceArb,
    filters: filtersArb,
    genres: fc.array(alnumToken(1, 10), { maxLength: 4 }),
  })
  .map((r) => {
    const now = new Date();
    const entry: MarketplaceEntry = {
      marketplaceId: r.marketplaceId,
      provenance: {
        originUserId: r.originUserId,
        originCatalogId: r.originCatalogId,
      },
      name: r.name,
      tags: [],
      type: r.type,
      source: r.source,
      genres: r.genres,
      filterFacets: [],
      filters: r.filters,
      visibility: 'public',
      moderation: 'active',
      engagement: { likes: 0, installs: 0, views: 0, trendingScore: 0 },
      contentHash: 'deadbeef',
      publishedAt: now,
      updatedAt: now,
      schemaVersion: 1,
    };
    return entry;
  });

// --- Helpers ---------------------------------------------------------------

// RFC 4122 UUID (any version), case-insensitive.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `s` round-trips through Date as a valid ISO UTC timestamp. */
function isValidIsoUtc(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  // ISO UTC timestamps emitted by Date.toISOString() end in 'Z'.
  if (!s.endsWith('Z')) return false;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return false;
  // Re-serializing the parsed instant must reproduce the same canonical string.
  return new Date(t).toISOString() === s;
}

// --- Tests -----------------------------------------------------------------

describe('cloneCatalog freshness & provenance (Property 1 — Req 13.1, 13.4)', () => {
  it('produces a fresh UUID _id differing from the origin catalog id, with fully-populated clonedFrom provenance', () => {
    fc.assert(
      fc.property(entryArb, (entry) => {
        const before = Date.now();
        const clone = cloneCatalog(entry);
        const after = Date.now();

        // Req 13.1: _id is a fresh, valid UUID distinct from the origin id.
        expect(typeof clone._id).toBe('string');
        expect(UUID_RE.test(clone._id as string)).toBe(true);
        expect(clone._id).not.toBe(entry.provenance.originCatalogId);

        // Req 13.3 (incidental): the clone is force-enabled.
        expect(clone.enabled).toBe(true);

        // Req 13.4: clonedFrom is fully populated and matches the source entry.
        expect(clone.clonedFrom).toBeDefined();
        const cf = clone.clonedFrom!;
        expect(typeof cf.marketplaceId).toBe('string');
        expect(cf.marketplaceId.length).toBeGreaterThan(0);
        expect(cf.marketplaceId).toBe(entry.marketplaceId);
        expect(cf.originUserId).toBe(entry.provenance.originUserId);
        expect(cf.originCatalogId).toBe(entry.provenance.originCatalogId);

        // Req 13.4: clonedAt is a valid ISO UTC timestamp captured at creation.
        expect(isValidIsoUtc(cf.clonedAt)).toBe(true);
        const stamp = Date.parse(cf.clonedAt);
        expect(stamp).toBeGreaterThanOrEqual(before);
        expect(stamp).toBeLessThanOrEqual(after);
      }),
      { numRuns: 100 }
    );
  });

  it('yields distinct _ids when cloning the same entry repeatedly', () => {
    fc.assert(
      fc.property(entryArb, fc.integer({ min: 2, max: 12 }), (entry, n) => {
        const ids = new Set<string>();
        for (let i = 0; i < n; i++) {
          const clone = cloneCatalog(entry);
          expect(clone._id).not.toBe(entry.provenance.originCatalogId);
          ids.add(clone._id as string);
        }
        // Every clone must receive a distinct fresh identifier.
        expect(ids.size).toBe(n);
      }),
      { numRuns: 50 }
    );
  });
});
