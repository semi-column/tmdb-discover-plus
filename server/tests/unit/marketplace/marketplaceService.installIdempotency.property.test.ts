import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import crypto from 'crypto';

import { MemoryAdapter } from '../../../src/services/storage/MemoryAdapter.ts';
import { MARKETPLACE_SOURCES, MARKETPLACE_TYPES } from '../../../src/constants.ts';
import type { UserConfig, CatalogFilters, SourceType } from '../../../src/types/config.ts';
import type { ContentType } from '../../../src/types/common.ts';
import type { MarketplaceEntry } from '../../../src/types/marketplace.ts';

/**
 * Property 6: Install idempotency.
 *
 * ∀ user `u`, entry `e`, repeated `installEntry(e, u)` adds at most one catalog
 * with `clonedFrom.marketplaceId = e.marketplaceId` to `u`'s config and
 * increments `installs` at most once.
 *
 * Concretely, for a public + active entry installed N (1..5) times into the same
 * target configuration:
 *   - the config ends with exactly ONE catalog cloned from that entry,
 *   - the entry's `installs` counter increased by exactly 1 from its seeded
 *     baseline,
 *   - the FIRST install reports `alreadyInstalled = false`, and every
 *     subsequent install reports `alreadyInstalled = true`.
 *
 * This drives the real `marketplaceService.installEntry` wiring: a real
 * MemoryAdapter backs `getStorage()`, and an in-memory mutable `UserConfig`
 * store backs `getUserConfig()` / `saveUserConfig()` so the service's own
 * dedupe → clone → save → atomic-increment logic runs end to end. Only the two
 * boundary collaborators (storage factory + config loader/saver) are
 * substituted.
 *
 * **Validates: Requirements 14.1, 14.3, 14.5**
 */

// Shared, hoisted references so the mocked modules and the test body point at
// the same MemoryAdapter / UserConfig instances within a property iteration.
const refs = vi.hoisted(() => ({
  adapter: { current: null as MemoryAdapter | null },
  config: { current: null as UserConfig | null },
}));

vi.mock('../../../src/services/storage/index.ts', () => ({
  getStorage: () => {
    if (!refs.adapter.current) throw new Error('test storage not initialized');
    return refs.adapter.current;
  },
  initStorage: async () => refs.adapter.current,
}));

vi.mock('../../../src/services/configService.ts', () => ({
  getUserConfig: async (userId: string) => {
    const cfg = refs.config.current;
    return cfg && cfg.userId === userId ? cfg : null;
  },
  // In-memory persistence: write the saved config back into the shared ref so
  // the next install observes the just-appended clone (mirrors the real save
  // path's read-after-write behavior).
  saveUserConfig: async (config: UserConfig) => {
    refs.config.current = config;
    return config;
  },
}));

import { installEntry } from '../../../src/services/marketplaceService.ts';
import { getMarketplaceCache } from '../../../src/infrastructure/marketplaceCache.ts';

// --- Generators ------------------------------------------------------------

const alnumChar = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
);
const alnumToken = (min: number, max: number) =>
  fc.array(alnumChar, { minLength: min, maxLength: max }).map((cs) => cs.join(''));

const userIdArb = alnumToken(6, 24);
const typeArb = fc.constantFrom(...MARKETPLACE_TYPES) as fc.Arbitrary<ContentType>;
const sourceArb = fc.constantFrom(...MARKETPLACE_SOURCES) as fc.Arbitrary<SourceType>;
const nameArb = alnumToken(1, 40);

const filtersArb = fc.record(
  {
    sortBy: fc.option(alnumToken(1, 12), { nil: undefined }),
    genreNames: fc.option(fc.array(alnumToken(1, 10), { maxLength: 4 }), { nil: undefined }),
  },
  { requiredKeys: [] }
) as fc.Arbitrary<CatalogFilters>;

// A complete, public + active Marketplace_Entry with a seeded installs baseline.
const entryArb = fc.record({
  name: nameArb,
  type: typeArb,
  source: sourceArb,
  filters: filtersArb,
  baselineInstalls: fc.nat({ max: 1000 }),
  baselineLikes: fc.nat({ max: 1000 }),
  baselineViews: fc.nat({ max: 1000 }),
});

// Number of times the same entry is installed into the same target config.
const installCountArb = fc.integer({ min: 1, max: 5 });

function buildEntry(draft: {
  name: string;
  type: ContentType;
  source: SourceType;
  filters: CatalogFilters;
  baselineInstalls: number;
  baselineLikes: number;
  baselineViews: number;
}): MarketplaceEntry {
  const now = new Date();
  return {
    marketplaceId: crypto.randomUUID(),
    provenance: {
      originUserId: 'author' + crypto.randomUUID().slice(0, 8),
      originCatalogId: crypto.randomUUID(),
    },
    name: draft.name,
    tags: [],
    type: draft.type,
    source: draft.source,
    genres: [],
    filterFacets: [],
    filters: draft.filters,
    visibility: 'public',
    moderation: 'active',
    engagement: {
      likes: draft.baselineLikes,
      installs: draft.baselineInstalls,
      views: draft.baselineViews,
      trendingScore: 0,
    },
    contentHash: crypto.randomUUID(),
    publishedAt: now,
    updatedAt: now,
    schemaVersion: 1,
  };
}

describe('marketplaceService install idempotency (Property 6 — Req 14.1, 14.3, 14.5)', () => {
  it('installing the same entry N times yields exactly one clone and exactly +1 install', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, entryArb, installCountArb, async (userId, draft, n) => {
        // Fresh, isolated storage + cache per iteration.
        const adapter = new MemoryAdapter();
        await adapter.connect();
        refs.adapter.current = adapter;
        getMarketplaceCache().clear();

        // Seed a public + active entry with a known installs baseline.
        const entry = buildEntry(draft);
        await adapter.upsertMarketplaceEntry(entry);
        const seededBaseline = entry.engagement.installs;

        // Seed an empty target config the install will clone into.
        refs.config.current = {
          userId,
          catalogs: [],
          preferences: {},
        };

        // Install the same entry N times into the same target config.
        const results = [];
        for (let i = 0; i < n; i++) {
          results.push(await installEntry(entry.marketplaceId, userId));
        }

        // Req 14.1: exactly ONE catalog cloned from this entry exists in config.
        const config = refs.config.current!;
        const clones = (config.catalogs ?? []).filter(
          (c) => c.clonedFrom?.marketplaceId === entry.marketplaceId
        );
        expect(clones).toHaveLength(1);

        // Req 14.3 / 14.5: installs counter increased by EXACTLY 1 from baseline.
        const stored = await adapter.getMarketplaceEntry(entry.marketplaceId);
        expect(stored).not.toBeNull();
        expect(stored!.engagement.installs).toBe(seededBaseline + 1);

        // Req 14.1: the first install is new; every repeat reports alreadyInstalled.
        expect(results[0].alreadyInstalled).toBe(false);
        for (let i = 1; i < n; i++) {
          expect(results[i].alreadyInstalled).toBe(true);
        }

        // The repeat installs return the same clone added on the first install.
        for (let i = 1; i < n; i++) {
          expect(results[i].catalog._id).toBe(results[0].catalog._id);
        }
      }),
      { numRuns: 30 }
    );
  });
});
