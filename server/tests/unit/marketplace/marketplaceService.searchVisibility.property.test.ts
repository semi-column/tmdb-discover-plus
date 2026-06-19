import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import crypto from 'crypto';

import { MemoryAdapter } from '../../../src/services/storage/MemoryAdapter.ts';
import { MARKETPLACE_SOURCES, MARKETPLACE_TYPES } from '../../../src/constants.ts';
import type { MarketplaceEntry, MarketplaceSearchQuery } from '../../../src/types/marketplace.ts';
import type { ContentType } from '../../../src/types/common.ts';
import type { SourceType } from '../../../src/types/config.ts';

/**
 * Property 7: Search visibility.
 *
 * For an arbitrary set of entries whose `visibility` ranges over
 * {public, unlisted, private, invalid/missing} and whose `moderation` ranges
 * over {active, flagged, removed, invalid/missing}, every entry returned by
 * `searchMarketplace` has `visibility === 'public'` AND `moderation === 'active'`,
 * and every public+active entry matching the query/facets is included.
 *
 * This drives the real `marketplaceService.searchMarketplace` wiring against a
 * real `MemoryAdapter` (the same boundary-substitution approach used by
 * `marketplaceService.publish.property.test.ts`): only `getStorage()` is
 * substituted to return a freshly-seeded in-process adapter, and the real
 * marketplace cache handles per-signature memoization. Entries are seeded
 * directly through `upsertMarketplaceEntry` so arbitrary (including invalid /
 * missing) visibility & moderation values can be injected — something the
 * publish path, which always produces public+active entries, cannot express.
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
 */

// Shared, hoisted reference so the mocked storage module and the test body
// point at the same MemoryAdapter instance within a property iteration.
const refs = vi.hoisted(() => ({
  adapter: { current: null as MemoryAdapter | null },
}));

vi.mock('../../../src/services/storage/index.ts', () => ({
  getStorage: () => {
    if (!refs.adapter.current) throw new Error('test storage not initialized');
    return refs.adapter.current;
  },
  initStorage: async () => refs.adapter.current,
}));

import { searchMarketplace } from '../../../src/services/marketplaceService.ts';
import { getMarketplaceCache } from '../../../src/infrastructure/marketplaceCache.ts';

// --- Generators ------------------------------------------------------------

const alnumChar = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''));
const alnumToken = (min: number, max: number) =>
  fc.array(alnumChar, { minLength: min, maxLength: max }).map((cs) => cs.join(''));

const typeArb = fc.constantFrom(...MARKETPLACE_TYPES) as fc.Arbitrary<ContentType>;
const sourceArb = fc.constantFrom(...MARKETPLACE_SOURCES) as fc.Arbitrary<SourceType>;

// Visibility / moderation draws span the defined values plus invalid / missing
// ones (Req 7.4): bogus tokens, empty string, undefined, and null.
const visibilityArb = fc.constantFrom(
  'public',
  'unlisted',
  'private',
  'bogus',
  '',
  undefined,
  null
);
const moderationArb = fc.constantFrom('active', 'flagged', 'removed', 'bogus', '', undefined, null);

interface SeedDraft {
  name: string;
  type: ContentType;
  source: SourceType;
  genres: string[];
  visibility: unknown;
  moderation: unknown;
}

const seedDraftArb: fc.Arbitrary<SeedDraft> = fc.record({
  name: alnumToken(1, 16),
  type: typeArb,
  source: sourceArb,
  genres: fc.array(alnumToken(1, 8), { maxLength: 3 }),
  visibility: visibilityArb,
  moderation: moderationArb,
});

/**
 * Materialize a full {@link MarketplaceEntry} with a unique origin pair and id.
 * `visibility` / `moderation` are intentionally widened so invalid and missing
 * values can be injected to exercise Req 7.4.
 */
function buildEntry(draft: SeedDraft): MarketplaceEntry {
  const marketplaceId = crypto.randomUUID();
  const now = new Date();
  const entry = {
    marketplaceId,
    provenance: {
      originUserId: crypto.randomUUID().slice(0, 12),
      originCatalogId: crypto.randomUUID(),
    },
    name: draft.name,
    tags: [],
    type: draft.type,
    source: draft.source,
    genres: draft.genres,
    filterFacets: [],
    filters: {},
    visibility: draft.visibility,
    moderation: draft.moderation,
    engagement: { likes: 0, installs: 0, views: 0, trendingScore: 0 },
    contentHash: marketplaceId,
    publishedAt: now,
    updatedAt: now,
    schemaVersion: 1,
  } as unknown as MarketplaceEntry;
  return entry;
}

/** An entry qualifies for search only when public AND active (Req 7.1). */
function isPublicActive(entry: MarketplaceEntry): boolean {
  return entry.visibility === 'public' && entry.moderation === 'active';
}

describe('marketplaceService search visibility (Property 7 — Req 7.1-7.4)', () => {
  it('search returns exactly the public+active entries matching the query/facets', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(seedDraftArb, { minLength: 1, maxLength: 20 }), async (drafts) => {
        // Fresh, isolated storage + cache per iteration.
        const adapter = new MemoryAdapter();
        await adapter.connect();
        refs.adapter.current = adapter;
        getMarketplaceCache().clear();

        // Seed every entry directly so arbitrary visibility/moderation values
        // (including invalid/missing) reach the index.
        const entries = drafts.map(buildEntry);
        for (const entry of entries) {
          await adapter.upsertMarketplaceEntry(entry);
        }

        const byId = new Map(entries.map((e) => [e.marketplaceId, e]));

        // A page size of 50 (the max) with a single zero-based page index
        // guarantees that, for <= 20 seeded entries, every matching entry
        // fits in one page — so the returned set is the complete match set.
        const pageOpts = { limit: 50, page: 0 };

        // Build the set of search scenarios: a browse-all (empty query, no
        // facets) plus facet-constrained browses over every distinct source
        // and type present in the seed. Facet values are always drawn from the
        // valid allow-lists so the service never 400s on an unknown facet.
        const scenarios: MarketplaceSearchQuery[] = [{ q: '', ...pageOpts }];
        for (const source of new Set(entries.map((e) => e.source))) {
          scenarios.push({ q: '', source, ...pageOpts });
        }
        for (const type of new Set(entries.map((e) => e.type))) {
          scenarios.push({ q: '', type, ...pageOpts });
        }
        // One combined source+type facet scenario from the first entry.
        scenarios.push({
          q: '',
          source: entries[0].source,
          type: entries[0].type,
          ...pageOpts,
        });

        for (const scenario of scenarios) {
          const result = await searchMarketplace(scenario);

          // Expected = public+active entries satisfying all supplied facets.
          const expected = entries.filter((e) => {
            if (!isPublicActive(e)) return false;
            if (scenario.source && e.source !== scenario.source) return false;
            if (scenario.type && e.type !== scenario.type) return false;
            return true;
          });
          const expectedIds = new Set(expected.map((e) => e.marketplaceId));
          const returnedIds = result.items.map((c) => c.marketplaceId);

          // No duplicates in a single page.
          expect(new Set(returnedIds).size).toBe(returnedIds.length);

          // Req 7.1-7.4 (forward): every returned entry is public + active and
          // satisfies the facet constraints.
          for (const id of returnedIds) {
            const source = byId.get(id);
            expect(source).toBeDefined();
            expect(source!.visibility).toBe('public');
            expect(source!.moderation).toBe('active');
            expect(expectedIds.has(id)).toBe(true);
          }

          // Req 7.1 (inclusion): every public+active matching entry appears.
          expect(new Set(returnedIds)).toEqual(expectedIds);
        }
      }),
      { numRuns: 50 }
    );
  });
});
