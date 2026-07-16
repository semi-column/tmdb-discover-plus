import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { MemoryAdapter } from '../../../src/services/storage/MemoryAdapter.ts';
import type { MarketplaceEntry } from '../../../src/types/marketplace.ts';

/**
 * Property 4: Counter monotonicity (Memory adapter).
 *
 * After upserting an entry, applying an arbitrary sequence of +1 / -1
 * increments to a counter (installs | likes | views):
 *   (a) the stored counter never goes below 0 (each operation floors at 0), and
 *   (b) it equals a reference model that clamps to 0 after every step.
 *
 * The value returned by each `incrementMarketplaceCounter` call must equal the
 * counter that `getMarketplaceEntry` reports, and every stored counter value is
 * always an integer >= 0. For an all-`+1` sequence this reduces to the design's
 * monotonicity statement: the counter is non-decreasing and equals the number
 * of successful increments.
 *
 * **Validates: Requirements 16.2, 16.4, 16.5**
 */

const COUNTER_FIELDS = ['installs', 'likes', 'views'] as const;
type CounterField = (typeof COUNTER_FIELDS)[number];

/** Build a minimal, valid public Marketplace_Entry with zeroed counters. */
function makeEntry(marketplaceId: string): MarketplaceEntry {
  return {
    marketplaceId,
    provenance: {
      originUserId: 'user-1',
      originCatalogId: 'catalog-1',
    },
    name: 'Counter Property Catalog',
    description: 'Entry used for counter monotonicity property testing',
    tags: ['action'],
    type: 'movie',
    source: 'tmdb',
    genres: ['Action'],
    filterFacets: ['sort:popularity.desc'],
    filters: {},
    visibility: 'public',
    moderation: 'active',
    engagement: {
      likes: 0,
      installs: 0,
      views: 0,
      trendingScore: 0,
    },
    contentHash: 'hash-counter',
    publishedAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    schemaVersion: 1,
  };
}

const fieldArb = fc.constantFrom<CounterField>(...COUNTER_FIELDS);
const deltaArb = fc.constantFrom<1 | -1>(1, -1);
const opsArb = fc.array(fc.tuple(fieldArb, deltaArb), { minLength: 0, maxLength: 200 });

describe('MemoryAdapter.incrementMarketplaceCounter — counter monotonicity', () => {
  it('floors at 0 each step and matches a clamping reference model', async () => {
    await fc.assert(
      fc.asyncProperty(opsArb, async (ops) => {
        const adapter = new MemoryAdapter();
        await adapter.connect();
        const entry = makeEntry('mkt-counter-1');
        await adapter.upsertMarketplaceEntry(entry);

        // Reference model: counters clamped to >= 0 after every step.
        const model: Record<CounterField, number> = { installs: 0, likes: 0, views: 0 };

        for (const [field, delta] of ops) {
          model[field] = Math.max(0, model[field] + delta);

          const returned = await adapter.incrementMarketplaceCounter(
            entry.marketplaceId,
            field,
            delta
          );

          // (a) returned value never below 0 and matches the clamping model.
          expect(returned).toBe(model[field]);
          expect(returned).toBeGreaterThanOrEqual(0);

          // The returned value matches the stored counter via getMarketplaceEntry.
          const stored = await adapter.getMarketplaceEntry(entry.marketplaceId);
          expect(stored).not.toBeNull();
          expect(stored!.engagement[field]).toBe(returned);

          // (b) every counter is always an integer >= 0.
          for (const f of COUNTER_FIELDS) {
            expect(Number.isInteger(stored!.engagement[f])).toBe(true);
            expect(stored!.engagement[f]).toBeGreaterThanOrEqual(0);
          }
        }
      })
    );
  });

  it('an all-+1 sequence is non-decreasing and equals the number of increments', async () => {
    await fc.assert(
      fc.asyncProperty(fieldArb, fc.integer({ min: 0, max: 500 }), async (field, n) => {
        const adapter = new MemoryAdapter();
        await adapter.connect();
        const entry = makeEntry('mkt-counter-2');
        await adapter.upsertMarketplaceEntry(entry);

        let prev = 0;
        for (let i = 1; i <= n; i++) {
          const returned = await adapter.incrementMarketplaceCounter(entry.marketplaceId, field, 1);
          // Non-decreasing across successive increments (Requirement 16.4).
          expect(returned).toBeGreaterThanOrEqual(prev);
          // Equals the count of successful increments so far (Requirement 16.2).
          expect(returned).toBe(i);
          prev = returned;
        }

        const stored = await adapter.getMarketplaceEntry(entry.marketplaceId);
        expect(stored!.engagement[field]).toBe(n);
      })
    );
  });
});
