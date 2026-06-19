import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { MemoryAdapter } from '../../../src/services/storage/MemoryAdapter.ts';
import type { MarketplaceEntry } from '../../../src/types/marketplace.ts';

/**
 * Property test for the per-user like ledger on the in-memory storage adapter
 * (`recordLike` / `removeLike` / `hasLiked`).
 *
 * Property 5: Like idempotency. Over any sequence of recordLike/removeLike calls
 * by arbitrary actorUserIds on a single entry:
 *   - recordLike returns true only the first time for a given (id, actor) and
 *     false while already liked; hasLiked is true afterwards.
 *   - removeLike returns true only when a like existed, false otherwise;
 *     hasLiked is false afterwards.
 *   - The derived set of liked actors always matches a reference Set model,
 *     proving at most one like per (id, actor) regardless of duplicates.
 *
 * **Validates: Requirements 18.6, 18.7, 15.6**
 */

const MARKETPLACE_ID = 'mkt-like-prop-0001';

/** Build a fully valid, searchable MarketplaceEntry for the like ledger. */
function makeEntry(): MarketplaceEntry {
  return {
    marketplaceId: MARKETPLACE_ID,
    provenance: {
      originUserId: 'user-123',
      originCatalogId: 'catalog-abc',
    },
    name: 'Likeable Catalog',
    description: 'A catalog used to exercise the like ledger',
    tags: ['action'],
    type: 'movie',
    source: 'tmdb',
    genres: ['Action'],
    filterFacets: ['sort:popularity.desc'],
    filters: {},
    visibility: 'public',
    moderation: 'active',
    engagement: { likes: 0, installs: 0, views: 0, trendingScore: 0 },
    contentHash: 'hash-xyz',
    publishedAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    schemaVersion: 1,
  } as MarketplaceEntry;
}

// A small pool of actor ids so that record/remove operations frequently target
// the same actor, exercising the idempotency paths.
const ACTORS = ['alice', 'bob', 'carol', 'dave', 'erin'] as const;
const actorArb = fc.constantFrom(...ACTORS);

// An operation against the ledger: either record or remove a like by an actor.
const opArb = fc.record({
  kind: fc.constantFrom<'record' | 'remove'>('record', 'remove'),
  actor: actorArb,
});

const opsArb = fc.array(opArb, { maxLength: 50 });

describe('MemoryAdapter like ledger — idempotency (Property 5)', () => {
  it('mirrors a reference Set across arbitrary record/remove sequences', async () => {
    await fc.assert(
      fc.asyncProperty(opsArb, async (ops) => {
        const adapter = new MemoryAdapter();
        await adapter.upsertMarketplaceEntry(makeEntry());

        // Reference model: the set of actors currently considered "liked".
        const model = new Set<string>();

        for (const op of ops) {
          if (op.kind === 'record') {
            const wasLiked = model.has(op.actor);
            const result = await adapter.recordLike(MARKETPLACE_ID, op.actor);

            // recordLike returns true only on the first like for this actor.
            expect(result).toBe(!wasLiked);
            model.add(op.actor);

            // After a record, the actor is always liked.
            expect(await adapter.hasLiked(MARKETPLACE_ID, op.actor)).toBe(true);
          } else {
            const wasLiked = model.has(op.actor);
            const result = await adapter.removeLike(MARKETPLACE_ID, op.actor);

            // removeLike returns true only when a like existed.
            expect(result).toBe(wasLiked);
            model.delete(op.actor);

            // After a remove, the actor is never liked.
            expect(await adapter.hasLiked(MARKETPLACE_ID, op.actor)).toBe(false);
          }
        }

        // The full ledger always agrees with the reference model — at most one
        // like per (id, actor), regardless of duplicate records/removes.
        for (const actor of ACTORS) {
          expect(await adapter.hasLiked(MARKETPLACE_ID, actor)).toBe(model.has(actor));
        }
      })
    );
  });

  it('record is idempotent: repeated records add at most one like', async () => {
    await fc.assert(
      fc.asyncProperty(actorArb, fc.integer({ min: 1, max: 10 }), async (actor, repeats) => {
        const adapter = new MemoryAdapter();
        await adapter.upsertMarketplaceEntry(makeEntry());

        let trueCount = 0;
        for (let i = 0; i < repeats; i++) {
          if (await adapter.recordLike(MARKETPLACE_ID, actor)) trueCount++;
        }

        // Only the very first record reports a state change.
        expect(trueCount).toBe(1);
        expect(await adapter.hasLiked(MARKETPLACE_ID, actor)).toBe(true);
      })
    );
  });

  it('remove only succeeds when a like exists and restores the unliked state', async () => {
    await fc.assert(
      fc.asyncProperty(actorArb, fc.integer({ min: 1, max: 10 }), async (actor, repeats) => {
        const adapter = new MemoryAdapter();
        await adapter.upsertMarketplaceEntry(makeEntry());

        // Removing before any like is always a no-op.
        expect(await adapter.removeLike(MARKETPLACE_ID, actor)).toBe(false);

        await adapter.recordLike(MARKETPLACE_ID, actor);

        let trueCount = 0;
        for (let i = 0; i < repeats; i++) {
          if (await adapter.removeLike(MARKETPLACE_ID, actor)) trueCount++;
        }

        // Only the first removal after a like reports a state change.
        expect(trueCount).toBe(1);
        expect(await adapter.hasLiked(MARKETPLACE_ID, actor)).toBe(false);
      })
    );
  });
});
