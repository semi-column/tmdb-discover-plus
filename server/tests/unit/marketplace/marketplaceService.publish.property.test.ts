import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import crypto from 'crypto';

import { MemoryAdapter } from '../../../src/services/storage/MemoryAdapter.ts';
import { MARKETPLACE_SOURCES, MARKETPLACE_TYPES } from '../../../src/constants.ts';
import type { UserConfig, CatalogConfig, CatalogFilters } from '../../../src/types/config.ts';
import type { ContentType } from '../../../src/types/common.ts';
import type { SourceType } from '../../../src/types/config.ts';

/**
 * Property 8: Publish/unpublish round-trip.
 *
 * For an arbitrary owned catalog, after `publishCatalog` the resulting
 * Marketplace_Entry is searchable/retrievable (it appears in search results and
 * the matching count is > 0), and after `unpublishCatalog` it is no longer
 * returned by any search (zero occurrences across every query issued after the
 * deletion completes).
 *
 * This drives the real `marketplaceService` wiring: a real MemoryAdapter backs
 * `getStorage()`, a seeded `UserConfig` backs `getUserConfig()`, and the real
 * marketplace cache handles invalidation. Only the two boundary collaborators
 * (storage factory + config loader) are substituted so the service's own
 * projection → validate → upsert/delete → cache-invalidate logic runs end to end.
 *
 * **Validates: Requirements 4.2, 4.3**
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
}));

import { publishCatalog, unpublishCatalog } from '../../../src/services/marketplaceService.ts';
import { getMarketplaceCache } from '../../../src/infrastructure/marketplaceCache.ts';

// --- Generators ------------------------------------------------------------

// Alphanumeric tokens only, so sanitization (markup/control stripping + trim)
// is a no-op and the projected name equals the input — making it a reliable
// exact-match query for search.
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

// Minimal, clearly-valid filters: optionally a sortBy token and genre names.
// Kept conservative so source-specific sanitization never rejects the entry.
const filtersArb = fc.record(
  {
    sortBy: fc.option(alnumToken(1, 12), { nil: undefined }),
    genreNames: fc.option(fc.array(alnumToken(1, 10), { maxLength: 4 }), { nil: undefined }),
  },
  { requiredKeys: [] }
) as fc.Arbitrary<CatalogFilters>;

const catalogArb = fc.record({
  name: nameArb,
  type: typeArb,
  source: sourceArb,
  filters: filtersArb,
});

/**
 * Count occurrences of a given marketplaceId across a representative set of
 * queries: the catch-all empty query plus the entry's exact name. Used to
 * assert "searchable after publish" and "zero occurrences after unpublish".
 */
async function countOccurrences(
  adapter: MemoryAdapter,
  marketplaceId: string,
  name: string
): Promise<number> {
  const empty = await adapter.searchMarketplaceEntries({});
  const byName = await adapter.searchMarketplaceEntries({ q: name });
  const inEmpty = empty.filter((e) => e.marketplaceId === marketplaceId).length;
  const inByName = byName.filter((e) => e.marketplaceId === marketplaceId).length;
  return inEmpty + inByName;
}

describe('marketplaceService publish/unpublish round-trip (Property 8 — Req 4.2, 4.3)', () => {
  it('publish makes an owned catalog searchable; unpublish removes it from all searches', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, catalogArb, async (userId, draft) => {
        // Fresh, isolated storage per iteration.
        const adapter = new MemoryAdapter();
        await adapter.connect();
        refs.adapter.current = adapter;

        // Clear any cached search namespace state carried over between runs.
        getMarketplaceCache().clear();

        const catalogId = crypto.randomUUID();
        const catalog: CatalogConfig = {
          _id: catalogId,
          name: draft.name,
          type: draft.type,
          source: draft.source,
          filters: draft.filters,
          enabled: true,
          published: true,
        };

        // Seed the owner's config so getUserConfig resolves ownership + lookup.
        refs.config.current = {
          userId,
          catalogs: [catalog],
          preferences: {},
        };

        // --- publish ---
        const entry = await publishCatalog(userId, catalogId);

        // Entry is retrievable by its stable id.
        const fetched = await adapter.getMarketplaceEntry(entry.marketplaceId);
        expect(fetched).not.toBeNull();

        // Req 4.2 (positive side): the entry is returned by search and the
        // matching count is > 0.
        const occurrencesAfterPublish = await countOccurrences(
          adapter,
          entry.marketplaceId,
          draft.name
        );
        expect(occurrencesAfterPublish).toBeGreaterThan(0);
        expect(await adapter.countMarketplaceEntries({})).toBeGreaterThan(0);

        // --- unpublish ---
        await unpublishCatalog(userId, catalogId);

        // Req 4.2 / 4.3: zero occurrences across every search issued after the
        // unpublish completes, and the entry is no longer retrievable.
        const occurrencesAfterUnpublish = await countOccurrences(
          adapter,
          entry.marketplaceId,
          draft.name
        );
        expect(occurrencesAfterUnpublish).toBe(0);
        expect(await adapter.countMarketplaceEntries({})).toBe(0);
        expect(await adapter.getMarketplaceEntry(entry.marketplaceId)).toBeNull();
      }),
      { numRuns: 30 }
    );
  });
});
