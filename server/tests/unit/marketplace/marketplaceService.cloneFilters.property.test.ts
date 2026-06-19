import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { cloneCatalog } from '../../../src/services/marketplaceService.ts';
import { MARKETPLACE_SOURCES, MARKETPLACE_TYPES } from '../../../src/constants.ts';
import type { CatalogFilters, CatalogFormState } from '../../../src/types/config.ts';
import type { ContentType } from '../../../src/types/common.ts';
import type { SourceType } from '../../../src/types/config.ts';
import type { MarketplaceEntry } from '../../../src/types/marketplace.ts';

/**
 * Property 2: Clone preserves filter semantics.
 *
 * For an arbitrary valid Marketplace_Entry `e`, `cloneCatalog(e)` produces a
 * Cloned_Catalog whose `name`, `type`, `source`, `filters`, and `formState`
 * are value-equal (deep-equal) to those of `e`. Because previewing is driven
 * purely by `source` + `filters` (Req 12.3), deep-equal filters guarantee that
 * previewing the clone yields identical query results to previewing the origin
 * entry (Req 13.2, 13.5).
 *
 * `cloneCatalog` is synchronous and pure (no storage I/O), so the real
 * implementation is exercised directly with no mocking. The filters generator
 * produces nested arrays and mixed scalar values so deep equality is
 * meaningfully exercised rather than trivially comparing flat objects.
 *
 * **Validates: Requirements 13.2, 13.5**
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
const uuidArb = fc.uuid();

// A rich, deeply-structured filters object. It mixes the well-known
// BaseCatalogFilters fields (numeric arrays, sort strings) with source-specific
// array/scalar fields so that deep equality must traverse nested arrays and
// heterogeneous values rather than a flat record.
const filtersArb = fc.record(
  {
    sortBy: fc.option(alnumToken(1, 12), { nil: undefined }),
    genres: fc.option(fc.array(fc.integer({ min: 0, max: 10000 }), { maxLength: 8 }), {
      nil: undefined,
    }),
    genreNames: fc.option(fc.array(alnumToken(1, 12), { maxLength: 6 }), { nil: undefined }),
    yearMin: fc.option(fc.integer({ min: 1900, max: 2100 }), { nil: undefined }),
    yearMax: fc.option(fc.integer({ min: 1900, max: 2100 }), { nil: undefined }),
    voteAverageMin: fc.option(fc.float({ min: 0, max: 10, noNaN: true }), { nil: undefined }),
    // Source-specific array fields exercise nested-array deep equality.
    format: fc.option(fc.array(alnumToken(1, 8), { maxLength: 5 }), { nil: undefined }),
    keywords: fc.option(
      fc.array(fc.record({ id: fc.integer({ min: 1, max: 99999 }), name: alnumToken(1, 10) }), {
        maxLength: 4,
      }),
      { nil: undefined }
    ),
    listType: fc.option(alnumToken(1, 12), { nil: undefined }),
  },
  { requiredKeys: [] }
) as unknown as fc.Arbitrary<CatalogFilters>;

// An arbitrary formState: present (with nested arrays of objects) or absent.
const formStateArb = fc.option(
  fc.record(
    {
      selectedPeople: fc.array(
        fc.record({ id: fc.oneof(fc.integer(), alnumToken(1, 6)), name: alnumToken(1, 10) }),
        { maxLength: 3 }
      ),
      selectedCompanies: fc.array(
        fc.record({ id: fc.oneof(fc.integer(), alnumToken(1, 6)), name: alnumToken(1, 10) }),
        { maxLength: 3 }
      ),
    },
    { requiredKeys: [] }
  ),
  { nil: undefined }
) as fc.Arbitrary<CatalogFormState | undefined>;

/**
 * Build an arbitrary, fully-populated Marketplace_Entry. Only the fields read by
 * `cloneCatalog` need to be meaningful; the rest carry valid placeholder values
 * so the entry is a faithful instance of the type.
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
    formState: formStateArb,
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
      ...(r.formState !== undefined ? { formState: r.formState } : {}),
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

// --- Tests -----------------------------------------------------------------

describe('cloneCatalog preserves filter semantics (Property 2 — Req 13.2, 13.5)', () => {
  it('copies name/type/source/filters/formState deep-equal to the origin entry', () => {
    fc.assert(
      fc.property(entryArb, (entry) => {
        const clone = cloneCatalog(entry);

        // Req 13.2: name, type, source copied verbatim.
        expect(clone.name).toBe(entry.name);
        expect(clone.type).toBe(entry.type);
        expect(clone.source).toBe(entry.source);

        // Req 13.5: filters are value-equal (deep-equal) so the preview query
        // produced from source + filters is identical for clone and origin.
        expect(clone.filters).toEqual(entry.filters);

        // Req 13.2: formState equivalence — present-vs-present deep-equal, and
        // absent-vs-absent preserved.
        if (entry.formState === undefined) {
          expect(clone.formState).toBeUndefined();
        } else {
          expect(clone.formState).toEqual(entry.formState);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('preview-relevant key (source + deep-equal filters) is identical for clone and origin', () => {
    fc.assert(
      fc.property(entryArb, (entry) => {
        const clone = cloneCatalog(entry);

        // The preview pipeline keys solely off source + filters (Req 12.3), so a
        // stable serialization of that pair must coincide between clone and
        // origin for previews to yield identical query results (Req 13.5).
        const previewKey = (s: SourceType | undefined, f: CatalogFilters) =>
          JSON.stringify({ source: s, filters: f });

        expect(previewKey(clone.source, clone.filters)).toBe(
          previewKey(entry.source, entry.filters)
        );
      }),
      { numRuns: 200 }
    );
  });
});
