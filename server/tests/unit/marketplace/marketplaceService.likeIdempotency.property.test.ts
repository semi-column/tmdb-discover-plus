import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

import { MemoryAdapter } from '../../../src/services/storage/MemoryAdapter.ts';
import type { MarketplaceEntry } from '../../../src/types/marketplace.ts';

/**
 * Property 5: Like idempotency (service layer).
 *
 * Over an arbitrary sequence of like/unlike operations issued by various
 * `actorUserId`s against a single seeded public + active Marketplace_Entry, the
 * real `marketplaceService.likeEntry` / `unlikeEntry` wiring must keep the
 * stored `likes` counter exactly equal to the number of distinct actors
 * currently in the "liked" state (tracked by a reference `Set` model):
 *
 *   - A first `likeEntry(e, u)` moves the counter up by 1; a repeated
 *     `likeEntry(e, u)` by the same actor is a no-op for the counter (Req 15.1,
 *     15.2).
 *   - A first `unlikeEntry(e, u)` after a like moves the counter down by 1; a
 *     repeated `unlikeEntry(e, u)` (or one by an actor who never liked) is a
 *     no-op for the counter (Req 15.3).
 *   - The counter is always an integer >= 0 and never goes negative (Req 15.5).
 *   - `likeEntry` always returns `{ liked: true }` and `unlikeEntry` always
 *     returns `{ liked: false }`, and the returned `likes` count always matches
 *     both the reference model and the value persisted on the entry.
 *
 * This drives the real service: a real `MemoryAdapter` backs `getStorage()` (so
 * the ledger, atomic counter, and trending recompute all run for real). Only
 * the two boundary collaborators (storage factory + config loader) are
 * substituted; `configService` is stubbed because like/unlike do not consult
 * user configs.
 *
 * **Validates: Requirements 15.1, 15.2, 15.3, 15.5**
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

// like/unlike never read or write user configs; stub the loader so the module
// import graph resolves without touching real storage/config.
vi.mock('../../../src/services/configService.ts', () => ({
  getUserConfig: async () => null,
  saveUserConfig: async () => undefined,
}));

import { likeEntry, unlikeEntry } from '../../../src/services/marketplaceService.ts';
import { getMarketplaceCache } from '../../../src/infrastructure/marketplaceCache.ts';

// --- Fixtures & generators -------------------------------------------------

const MARKETPLACE_ID = 'mkt-like-svc-prop-0001';

/** Build a fully valid, public + active MarketplaceEntry with zero likes. */
function makeEntry(): MarketplaceEntry {
  return {
    marketplaceId: MARKETPLACE_ID,
    provenance: {
      originUserId: 'user-123',
      originCatalogId: 'catalog-abc',
    },
    name: 'Likeable Catalog',
    description: 'A catalog used to exercise the service-layer like flow',
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

// A small pool of actor ids so like/unlike operations frequently target the
// same actor, exercising the idempotency (no-op) paths.
const ACTORS = ['alice', 'bob', 'carol', 'dave', 'erin'] as const;
const actorArb = fc.constantFrom(...ACTORS);

// An operation against the service: either like or unlike by an actor.
const opArb = fc.record({
  kind: fc.constantFrom<'like' | 'unlike'>('like', 'unlike'),
  actor: actorArb,
});

const opsArb = fc.array(opArb, { maxLength: 40 });

describe('marketplaceService like idempotency (Property 5 — Req 15.1, 15.2, 15.3, 15.5)', () => {
  it('keeps likes equal to the distinct set of liked actors across arbitrary like/unlike sequences', async () => {
    await fc.assert(
      fc.asyncProperty(opsArb, async (ops) => {
        // Fresh, isolated storage + cache per iteration.
        const adapter = new MemoryAdapter();
        await adapter.connect();
        refs.adapter.current = adapter;
        getMarketplaceCache().clear();

        await adapter.upsertMarketplaceEntry(makeEntry());

        // Reference model: the set of actors currently in the "liked" state.
        const model = new Set<string>();

        for (const op of ops) {
          if (op.kind === 'like') {
            const result = await likeEntry(MARKETPLACE_ID, op.actor);
            model.add(op.actor);

            // Req 15.1 / 15.2: likeEntry always reports the entry as liked, and
            // the returned counter equals the distinct set of likers (a repeat
            // like by the same actor is a no-op for the counter).
            expect(result.liked).toBe(true);
            expect(result.likes).toBe(model.size);
          } else {
            const result = await unlikeEntry(MARKETPLACE_ID, op.actor);
            model.delete(op.actor);

            // Req 15.3: unlikeEntry always reports the entry as not liked, and
            // the returned counter equals the distinct set of remaining likers
            // (an unlike by an actor who never liked is a no-op).
            expect(result.liked).toBe(false);
            expect(result.likes).toBe(model.size);
          }

          // Req 15.5: the counter is a non-negative integer at all times.
          expect(result_likesNonNegative(model.size)).toBe(true);

          // The persisted counter on the entry agrees with the model after
          // every operation (not just the LikeResult return value).
          const persisted = await adapter.getMarketplaceEntry(MARKETPLACE_ID);
          expect(persisted).not.toBeNull();
          expect(persisted!.engagement?.likes ?? 0).toBe(model.size);
          expect(persisted!.engagement?.likes ?? 0).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 40 }
    );
  });

  it('repeated like by the same actor increments likes at most once; unlike restores the prior count', async () => {
    await fc.assert(
      fc.asyncProperty(
        actorArb,
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        async (actor, likeRepeats, unlikeRepeats) => {
          const adapter = new MemoryAdapter();
          await adapter.connect();
          refs.adapter.current = adapter;
          getMarketplaceCache().clear();

          await adapter.upsertMarketplaceEntry(makeEntry());

          let last = { liked: false, likes: 0 };
          for (let i = 0; i < likeRepeats; i++) {
            last = await likeEntry(MARKETPLACE_ID, actor);
          }

          // Req 15.1 / 15.2: any number of likes by one actor settles at 1.
          expect(last.liked).toBe(true);
          expect(last.likes).toBe(1);

          for (let i = 0; i < unlikeRepeats; i++) {
            last = await unlikeEntry(MARKETPLACE_ID, actor);
          }

          // Req 15.3 / 15.5: unliking restores the prior (zero) count and never
          // drives the counter negative.
          expect(last.liked).toBe(false);
          expect(last.likes).toBe(0);

          const persisted = await adapter.getMarketplaceEntry(MARKETPLACE_ID);
          expect(persisted!.engagement?.likes ?? 0).toBe(0);
        }
      ),
      { numRuns: 40 }
    );
  });
});

/** Helper: a likes count is valid only when it is a non-negative integer. */
function result_likesNonNegative(likes: number): boolean {
  return Number.isInteger(likes) && likes >= 0;
}
