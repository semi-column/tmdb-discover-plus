import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import crypto from 'crypto';

import { MemoryAdapter } from '../../../src/services/storage/MemoryAdapter.ts';
import {
  MARKETPLACE_SORT_MODES,
  MARKETPLACE_SOURCES,
  MARKETPLACE_TYPES,
  MARKETPLACE_RANKING,
} from '../../../src/constants.ts';
import type { MarketplaceEntry, MarketplaceSort } from '../../../src/types/marketplace.ts';
import type { ContentType } from '../../../src/types/common.ts';
import type { SourceType } from '../../../src/types/config.ts';

/**
 * Property 10: Sort total order (and stable pagination).
 *
 * Over an arbitrary set of public + active Marketplace_Entries, for every sort
 * mode the service returns:
 *
 * - A *total order* by the documented sort key with a deterministic secondary
 *   tiebreak on `marketplaceId` ascending — i.e. no two consecutive results ever
 *   violate the `(key descending, marketplaceId ascending)` ordering (Req 8.7,
 *   driven by Req 8.2–8.6).
 * - *Stable pagination* (Req 9.7): walking the full result set page by page over
 *   an unchanged dataset yields every entry exactly once — the concatenation of
 *   all pages equals the single-shot ordered list, with no duplicates and no
 *   omissions, across several page sizes.
 *
 * The real `searchMarketplace` orchestration runs end to end: a real
 * MemoryAdapter backs `getStorage()` and the real marketplace cache handles
 * per-signature memoization. Only the two boundary collaborators (storage
 * factory + config loader) are substituted, mirroring
 * `marketplaceService.publish.property.test.ts`.
 *
 * **Validates: Requirements 8.7, 9.7**
 */

// Shared hoisted reference so the mocked storage module and the test body point
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

// searchMarketplace never reads user configs, but marketplaceService imports the
// config service at module load; stub it so no real persistence layer is pulled in.
vi.mock('../../../src/services/configService.ts', () => ({
  getUserConfig: async () => null,
  saveUserConfig: async (config: unknown) => config,
}));

import { searchMarketplace } from '../../../src/services/marketplaceService.ts';
import { getMarketplaceCache } from '../../../src/infrastructure/marketplaceCache.ts';

const { POP_INSTALLS_WEIGHT, POP_LIKES_WEIGHT } = MARKETPLACE_RANKING;

// --- Generators ------------------------------------------------------------

const typeArb = fc.constantFrom(...MARKETPLACE_TYPES) as fc.Arbitrary<ContentType>;
const sourceArb = fc.constantFrom(...MARKETPLACE_SOURCES) as fc.Arbitrary<SourceType>;

// A small base timestamp; publishedAt is drawn from a tight set of day offsets so
// ties on the `newest` key occur frequently and exercise the marketplaceId tiebreak.
const BASE_TIME = Date.UTC(2024, 0, 1, 0, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

// Deliberately narrow numeric ranges so distinct entries collide on each sort
// key (likes/installs/trendingScore/publishedAt), forcing the tiebreak to fire.
const entryDraftArb = fc.record({
  name: fc.constantFrom('Alpha', 'Beta', 'Gamma', 'Delta'),
  type: typeArb,
  source: sourceArb,
  likes: fc.integer({ min: 0, max: 3 }),
  installs: fc.integer({ min: 0, max: 3 }),
  trendingScore: fc.constantFrom(0, 0.5, 1, 2),
  dayOffset: fc.integer({ min: 0, max: 2 }),
});

type EntryDraft = {
  name: string;
  type: ContentType;
  source: SourceType;
  likes: number;
  installs: number;
  trendingScore: number;
  dayOffset: number;
};

// Between 1 and 40 entries: small enough to fetch the full ordered list in a
// single max-size page (limit 50), large enough to span many pages.
const draftsArb = fc.array(entryDraftArb, { minLength: 1, maxLength: 40 });

const enabledDrafts = (drafts: EntryDraft[]) => drafts.filter((draft) => draft.source !== 'mal');

/** Build a fully-formed, searchable (public + active) Marketplace_Entry. */
function buildEntry(draft: EntryDraft): MarketplaceEntry {
  const marketplaceId = crypto.randomUUID();
  const originCatalogId = crypto.randomUUID();
  const publishedAt = new Date(BASE_TIME + draft.dayOffset * DAY_MS);
  return {
    marketplaceId,
    provenance: {
      originUserId: 'author01',
      originCatalogId,
      originConfigName: 'My Catalog',
    },
    name: draft.name,
    description: '',
    tags: [],
    type: draft.type,
    source: draft.source,
    genres: [],
    filterFacets: [],
    filters: {},
    visibility: 'public',
    moderation: 'active',
    engagement: {
      likes: draft.likes,
      installs: draft.installs,
      views: 0,
      trendingScore: draft.trendingScore,
    },
    contentHash: crypto.randomUUID(),
    publishedAt,
    updatedAt: publishedAt,
    schemaVersion: 1,
  };
}

// --- Sort-key extractors ---------------------------------------------------

/** Log-dampened popularity boost — the only non-zero composite term for an empty query. */
function popularityBoost(installs: number, likes: number): number {
  return (
    Math.log10(1 + Math.max(0, installs)) * POP_INSTALLS_WEIGHT +
    Math.log10(1 + Math.max(0, likes)) * POP_LIKES_WEIGHT
  );
}

type Card = {
  marketplaceId: string;
  engagement: { likes: number; installs: number; trendingScore: number };
  publishedAt: string;
};

/**
 * The documented sort key for each mode, returned as a descending-priority tuple
 * (larger values rank first). With an empty query the `relevance` composite score
 * collapses to its popularity term, so popularity is the effective relevance key.
 */
function sortKey(mode: MarketplaceSort, card: Card): number[] {
  switch (mode) {
    case 'relevance':
      return [popularityBoost(card.engagement.installs, card.engagement.likes)];
    case 'popular':
      return [card.engagement.likes, card.engagement.installs];
    case 'most-installed':
      return [card.engagement.installs];
    case 'newest':
      return [Date.parse(card.publishedAt)];
    case 'trending':
      return [card.engagement.trendingScore];
    default:
      return [0];
  }
}

const EPSILON = 1e-9;

/**
 * Assert the cards form a total order: every consecutive pair respects
 * `(key descending, marketplaceId ascending)`.
 */
function assertTotalOrder(mode: MarketplaceSort, cards: Card[]): void {
  for (let i = 0; i + 1 < cards.length; i++) {
    const a = sortKey(mode, cards[i]);
    const b = sortKey(mode, cards[i + 1]);

    let decided = false;
    for (let k = 0; k < a.length; k++) {
      if (a[k] - b[k] > EPSILON) {
        decided = true; // a strictly outranks b — correct descending order.
        break;
      }
      if (b[k] - a[k] > EPSILON) {
        throw new Error(
          `Sort "${mode}" violated descending key order at index ${i}: ` +
            `${JSON.stringify(a)} should not precede ${JSON.stringify(b)}`
        );
      }
    }

    if (!decided) {
      // All keys equal within tolerance — the marketplaceId tiebreak must hold.
      expect(
        cards[i].marketplaceId <= cards[i + 1].marketplaceId,
        `Sort "${mode}" tiebreak violated at index ${i}: ` +
          `${cards[i].marketplaceId} should precede ${cards[i + 1].marketplaceId}`
      ).toBe(true);
    }
  }
}

/** Page through the full result set and return the concatenated marketplaceIds. */
async function paginateAll(sort: MarketplaceSort, limit: number): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 0; ; page++) {
    const result = await searchMarketplace({ sort, page, limit });
    if (result.items.length === 0) break;
    ids.push(...result.items.map((c) => c.marketplaceId));
    // Guard against a runaway loop if pagination ever fails to terminate.
    if (page > 1000) throw new Error('pagination did not terminate');
  }
  return ids;
}

describe('marketplaceService sort total order & stable pagination (Property 10 — Req 8.7, 9.7)', () => {
  it('orders every sort mode by its key with a stable marketplaceId tiebreak', async () => {
    await fc.assert(
      fc.asyncProperty(draftsArb, async (drafts) => {
        const adapter = new MemoryAdapter();
        await adapter.connect();
        refs.adapter.current = adapter;
        getMarketplaceCache().clear();

        for (const draft of drafts) {
          await adapter.upsertMarketplaceEntry(buildEntry(draft));
        }

        for (const sort of MARKETPLACE_SORT_MODES) {
          // Single max-size page returns the full ordered list (dataset <= 40).
          const full = await searchMarketplace({ sort, page: 0, limit: 50 });
          expect(full.sort).toBe(sort);
          expect(full.items.length).toBe(enabledDrafts(drafts).length);
          assertTotalOrder(sort, full.items as Card[]);
        }
      }),
      { numRuns: 40 }
    );
  });

  it('paginates the full result set with no duplicates or omissions across page sizes', async () => {
    await fc.assert(
      fc.asyncProperty(
        draftsArb,
        fc.constantFrom<MarketplaceSort>(...MARKETPLACE_SORT_MODES),
        async (drafts, sort) => {
          const adapter = new MemoryAdapter();
          await adapter.connect();
          refs.adapter.current = adapter;
          getMarketplaceCache().clear();

          for (const draft of drafts) {
            await adapter.upsertMarketplaceEntry(buildEntry(draft));
          }

          // Reference ordering: the full result in a single page.
          const reference = await searchMarketplace({ sort, page: 0, limit: 50 });
          const referenceIds = reference.items.map((c) => c.marketplaceId);
          expect(referenceIds.length).toBe(enabledDrafts(drafts).length);

          for (const pageSize of [1, 2, 3, 7]) {
            const pagedIds = await paginateAll(sort, pageSize);

            // No omissions, no duplicates, identical order: concat(pages) === full list.
            expect(pagedIds).toEqual(referenceIds);
            expect(new Set(pagedIds).size).toBe(pagedIds.length);
          }
        }
      ),
      { numRuns: 40 }
    );
  });
});
