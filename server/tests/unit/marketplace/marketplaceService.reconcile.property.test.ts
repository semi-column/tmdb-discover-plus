import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import crypto from 'crypto';

import { MemoryAdapter } from '../../../src/services/storage/MemoryAdapter.ts';
import { MARKETPLACE_SOURCES, MARKETPLACE_TYPES } from '../../../src/constants.ts';
import type { UserConfig, CatalogConfig, CatalogFilters } from '../../../src/types/config.ts';
import type { ContentType } from '../../../src/types/common.ts';
import type { SourceType } from '../../../src/types/config.ts';
import type { MarketplaceEntry } from '../../../src/types/marketplace.ts';

/**
 * Property 9: Reconcile fidelity.
 *
 * For arbitrary `prev`/`next` `UserConfig`s — with catalogs randomly flagged
 * published / non-published and freely added, removed, or edited between the two
 * states — after `reconcileMarketplaceEntries(prev, next)` runs:
 *
 *   - The Marketplace_Index contains EXACTLY the set of catalogs in `next` that
 *     are flagged `published` and not deleted, one Marketplace_Entry per
 *     `(originUserId, originCatalogId)` pair (Req 5.1, 5.5).
 *   - Catalogs present in `prev` that were deleted from `next`, or toggled
 *     non-published, are removed from the index (Req 5.4).
 *   - Engagement counters of entries that survive reconciliation (published in
 *     both `prev` and `next`) are preserved across the diff, whether or not their
 *     content changed (Req 5.2 supporting 5.1/5.5).
 *
 * This drives the real `marketplaceService` reconciliation wiring end to end: a
 * real MemoryAdapter backs `getStorage()` and the real marketplace cache handles
 * search-namespace invalidation. Only the storage factory (and `configService`,
 * to keep the import side-effect free) is substituted; the service's own
 * projection → hash-diff → upsert/delete logic runs for real.
 *
 * **Validates: Requirements 5.1, 5.4, 5.5**
 */

// Shared, hoisted reference so the mocked storage module and the test body point
// at the same MemoryAdapter instance within a property iteration.
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

// reconcileMarketplaceEntries never calls into configService, but the module is
// imported transitively by marketplaceService; stub it so importing the service
// has no real side effects.
vi.mock('../../../src/services/configService.ts', () => ({
  getUserConfig: async () => null,
  saveUserConfig: async () => undefined,
}));

import { reconcileMarketplaceEntries } from '../../../src/services/marketplaceService.ts';
import { getMarketplaceCache } from '../../../src/infrastructure/marketplaceCache.ts';

// --- Generators ------------------------------------------------------------

// Alphanumeric tokens only, so sanitization (markup/control stripping + trim)
// is a no-op and a content edit (a name change) reliably changes the hash.
const alnumChar = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
);
const alnumToken = (min: number, max: number) =>
  fc.array(alnumChar, { minLength: min, maxLength: max }).map((cs) => cs.join(''));

// A valid short userId: [A-Za-z0-9_-]{6,30}.
const userIdArb = alnumToken(6, 24);

const typeArb = fc.constantFrom(...MARKETPLACE_TYPES) as fc.Arbitrary<ContentType>;
const sourceArb = fc.constantFrom(...MARKETPLACE_SOURCES) as fc.Arbitrary<SourceType>;

/**
 * A single catalog "slot" describing how one catalog appears across the prev and
 * next configuration states. Base content (name/type/source/filters) is shared;
 * presence and published flags are chosen independently per state, and
 * `editInNext` forces a content change (and therefore a Content_Hash change) for
 * a catalog that exists in both states.
 */
const slotArb = fc.record({
  name: alnumToken(1, 20),
  type: typeArb,
  source: sourceArb,
  sortBy: fc.option(alnumToken(1, 10), { nil: undefined }),
  genreNames: fc.option(fc.array(alnumToken(1, 10), { maxLength: 3 }), { nil: undefined }),
  inPrev: fc.boolean(),
  inNext: fc.boolean(),
  prevPublished: fc.boolean(),
  nextPublished: fc.boolean(),
  editInNext: fc.boolean(),
});

// Keep the slot count small so every entry fits in a single search page
// (MemoryAdapter clamps page size to 50 and caps responses at 100).
const slotsArb = fc.array(slotArb, { minLength: 1, maxLength: 7 });

function toSlot(_: unknown) {
  return _ as {
    name: string;
    type: ContentType;
    source: SourceType;
    sortBy?: string;
    genreNames?: string[];
    inPrev: boolean;
    inNext: boolean;
    prevPublished: boolean;
    nextPublished: boolean;
    editInNext: boolean;
  };
}

function buildFilters(slot: ReturnType<typeof toSlot>): CatalogFilters {
  const filters: Record<string, unknown> = {};
  if (slot.sortBy !== undefined) filters.sortBy = slot.sortBy;
  if (slot.genreNames !== undefined) filters.genreNames = slot.genreNames;
  return filters as CatalogFilters;
}

/** Fetch every indexed entry keyed by its origin catalog id. */
async function indexByCatalogId(adapter: MemoryAdapter): Promise<Map<string, MarketplaceEntry>> {
  const rows = await adapter.searchMarketplaceEntries({ page: 1, limit: 50 });
  const map = new Map<string, MarketplaceEntry>();
  for (const e of rows) {
    map.set(e.provenance.originCatalogId, e);
  }
  return map;
}

describe('marketplaceService reconcile fidelity (Property 9 — Req 5.1, 5.4, 5.5)', () => {
  it('index equals the published-and-present set of next; surviving counters preserved', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, slotsArb, async (userId, rawSlots) => {
        const slots = rawSlots
          .map(toSlot)
          // Drop slots that exist in neither state — they describe nothing.
          .filter((s) => s.inPrev || s.inNext);

        // Fresh, isolated storage + cache per iteration.
        const adapter = new MemoryAdapter();
        await adapter.connect();
        refs.adapter.current = adapter;
        getMarketplaceCache().clear();

        // Assign a unique, stable origin id to each slot.
        const ids = slots.map(() => crypto.randomUUID());

        const prevCatalogs: CatalogConfig[] = [];
        const nextCatalogs: CatalogConfig[] = [];

        slots.forEach((slot, i) => {
          const _id = ids[i];
          const filters = buildFilters(slot);

          if (slot.inPrev) {
            prevCatalogs.push({
              _id,
              name: slot.name,
              type: slot.type,
              source: slot.source,
              filters,
              enabled: true,
              published: slot.prevPublished,
            });
          }

          if (slot.inNext) {
            // A content edit only matters when the catalog also existed in prev;
            // otherwise it is simply a fresh catalog. Appending alnum chars keeps
            // the name valid while guaranteeing a different Content_Hash.
            const editing = slot.inPrev && slot.editInNext;
            nextCatalogs.push({
              _id,
              name: editing ? `${slot.name}Z9` : slot.name,
              type: slot.type,
              source: slot.source,
              filters,
              enabled: true,
              published: slot.nextPublished,
            });
          }
        });

        const prevConfig: UserConfig = {
          userId,
          catalogs: prevCatalogs,
          preferences: {},
        } as UserConfig;
        const nextConfig: UserConfig = {
          userId,
          catalogs: nextCatalogs,
          preferences: {},
        } as UserConfig;

        // --- Seed the index to match prev's published set. ---
        await reconcileMarketplaceEntries(null, prevConfig);

        // Seed a distinct engagement value on every entry currently indexed
        // (i.e. every prev-published catalog) so we can assert preservation of
        // surviving counters after the second reconcile.
        const seeded = await indexByCatalogId(adapter);
        const seededLikes = new Map<string, number>();
        let n = 0;
        for (const [catalogId, entry] of seeded) {
          const likes = (n % 3) + 1; // 1..3
          for (let k = 0; k < likes; k++) {
            await adapter.incrementMarketplaceCounter(entry.marketplaceId, 'likes', 1);
          }
          seededLikes.set(catalogId, likes);
          n++;
        }

        // --- Reconcile prev -> next. ---
        await reconcileMarketplaceEntries(prevConfig, nextConfig);

        // Expected post-state: exactly the catalogs in next that are published.
        const expectedIds = new Set<string>();
        slots.forEach((slot, i) => {
          if (slot.inNext && slot.nextPublished) expectedIds.add(ids[i]);
        });

        const after = await indexByCatalogId(adapter);

        // Req 5.1: indexed origin ids equal exactly the published-and-present set.
        expect([...after.keys()].sort()).toEqual([...expectedIds].sort());

        // Req 5.5: at most one entry per origin pair — no duplicate rows beyond
        // the distinct expected set.
        const total = await adapter.countMarketplaceEntries({});
        expect(total).toBe(expectedIds.size);

        // Req 5.4: catalogs removed from next, or toggled non-published, must be
        // absent from the index.
        slots.forEach((slot, i) => {
          const removedOrUnpublished = !(slot.inNext && slot.nextPublished);
          if (removedOrUnpublished) {
            expect(after.has(ids[i])).toBe(false);
          }
        });

        // Counter preservation: every catalog published in BOTH states survives
        // reconciliation (whether or not its content changed) and retains the
        // engagement value seeded before the reconcile.
        slots.forEach((slot, i) => {
          const survives = slot.inPrev && slot.prevPublished && slot.inNext && slot.nextPublished;
          if (survives) {
            const entry = after.get(ids[i]);
            expect(entry).toBeDefined();
            expect(entry!.engagement.likes).toBe(seededLikes.get(ids[i]));
          }
        });
      }),
      { numRuns: 50 }
    );
  });
});
