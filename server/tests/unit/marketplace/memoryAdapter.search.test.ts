import { describe, it, expect, beforeEach } from 'vitest';

import { MemoryAdapter } from '../../../src/services/storage/MemoryAdapter.ts';
import type {
  MarketplaceEntry,
  Visibility,
  ModerationStatus,
} from '../../../src/types/marketplace.ts';

/**
 * Example-based unit tests for MemoryAdapter search visibility/governance and
 * origin-pair dedupe.
 *
 * Covers:
 * - searchMarketplaceEntries returns only public + active entries, excluding
 *   unlisted/private visibility, flagged/removed moderation, and entries whose
 *   visibility or moderation value is missing/invalid (Req 7.1, 7.2, 18.2).
 * - countMarketplaceEntries counts only public + active entries.
 * - upsert enforces at most one entry per (originUserId, originCatalogId) pair,
 *   preserving engagement counters across re-upsert, while a distinct origin
 *   pair creates a separate entry (Req 5.5 / Req 1.10).
 */

let entrySeq = 0;
let originSeq = 0;

/**
 * Build a valid public+active MarketplaceEntry fixture. Pass overrides to vary
 * visibility, moderation, provenance, name, or engagement for a given case.
 *
 * `visibility` / `moderation` are intentionally widened so tests can inject
 * missing/invalid governance values to exercise Req 7.4 / 18.2.
 */
function makeEntry(
  overrides: Partial<
    Omit<MarketplaceEntry, 'visibility' | 'moderation' | 'provenance' | 'engagement'>
  > & {
    visibility?: Visibility | string | null | undefined;
    moderation?: ModerationStatus | string | null | undefined;
    provenance?: Partial<MarketplaceEntry['provenance']>;
    engagement?: Partial<MarketplaceEntry['engagement']>;
  } = {}
): MarketplaceEntry {
  const id = overrides.marketplaceId ?? `mkt-${++entrySeq}`;
  const { provenance, engagement, visibility, moderation, ...rest } = overrides;

  return {
    marketplaceId: id,
    provenance: {
      originUserId: 'user-1',
      originCatalogId: 'catalog-1',
      ...provenance,
    },
    name: 'Popular Action Catalog',
    description: 'An example catalog used for search visibility testing',
    tags: ['action'],
    type: 'movie',
    source: 'tmdb',
    genres: ['Action'],
    filterFacets: ['sort:popularity.desc'],
    filters: {},
    // Cast through unknown so tests can inject invalid governance values that
    // are not part of the Visibility/ModerationStatus unions.
    visibility: (visibility ?? 'public') as Visibility,
    moderation: (moderation ?? 'active') as ModerationStatus,
    engagement: {
      likes: 0,
      installs: 0,
      views: 0,
      trendingScore: 0,
      ...engagement,
    },
    contentHash: `hash-${id}`,
    publishedAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    schemaVersion: 1,
    ...rest,
    // Re-apply id last so an explicit override in `rest` cannot clobber it.
    marketplaceId: id,
  };
}

/** Unique origin pair per entry so each fixture is a distinct row by default. */
function withUniqueOrigin(overrides: Parameters<typeof makeEntry>[0] = {}): MarketplaceEntry {
  const seq = ++originSeq;
  return makeEntry({
    ...overrides,
    provenance: {
      originUserId: `user-${seq}`,
      originCatalogId: `catalog-${seq}`,
      ...overrides.provenance,
    },
  });
}

describe('MemoryAdapter search visibility & governance (Req 7.1, 7.2, 18.2)', () => {
  let adapter: MemoryAdapter;

  beforeEach(async () => {
    entrySeq = 0;
    adapter = new MemoryAdapter();
    await adapter.connect();
  });

  it('returns only public + active entries, excluding all non-searchable states', async () => {
    const publicActive = withUniqueOrigin({
      marketplaceId: 'mkt-public-active',
      name: 'Visible Catalog',
    });

    // Non-searchable variants across visibility + moderation dimensions.
    const unlisted = withUniqueOrigin({ visibility: 'unlisted' });
    const privateEntry = withUniqueOrigin({ visibility: 'private' });
    const flagged = withUniqueOrigin({ moderation: 'flagged' });
    const removed = withUniqueOrigin({ moderation: 'removed' });

    await adapter.upsertMarketplaceEntry(publicActive);
    await adapter.upsertMarketplaceEntry(unlisted);
    await adapter.upsertMarketplaceEntry(privateEntry);
    await adapter.upsertMarketplaceEntry(flagged);
    await adapter.upsertMarketplaceEntry(removed);

    const results = await adapter.searchMarketplaceEntries({});

    expect(results).toHaveLength(1);
    expect(results[0].marketplaceId).toBe('mkt-public-active');
  });

  it('excludes flagged/removed entries regardless of public visibility (Req 7.2)', async () => {
    await adapter.upsertMarketplaceEntry(
      withUniqueOrigin({ visibility: 'public', moderation: 'flagged' })
    );
    await adapter.upsertMarketplaceEntry(
      withUniqueOrigin({ visibility: 'public', moderation: 'removed' })
    );

    const results = await adapter.searchMarketplaceEntries({});
    expect(results).toHaveLength(0);
  });

  it('excludes unlisted/private entries regardless of active moderation (Req 7.3)', async () => {
    await adapter.upsertMarketplaceEntry(
      withUniqueOrigin({ visibility: 'unlisted', moderation: 'active' })
    );
    await adapter.upsertMarketplaceEntry(
      withUniqueOrigin({ visibility: 'private', moderation: 'active' })
    );

    const results = await adapter.searchMarketplaceEntries({});
    expect(results).toHaveLength(0);
  });

  it('excludes entries with missing or invalid visibility/moderation values (Req 7.4, 18.2)', async () => {
    const valid = withUniqueOrigin({ marketplaceId: 'mkt-valid' });

    const missingVisibility = withUniqueOrigin({ visibility: undefined as unknown as string });
    // Explicitly clear to simulate a missing field (overrides default).
    (missingVisibility as { visibility?: unknown }).visibility = undefined;

    const nullModeration = withUniqueOrigin({});
    (nullModeration as { moderation?: unknown }).moderation = null;

    const invalidVisibility = withUniqueOrigin({ visibility: 'PUBLIC' }); // wrong case / not in union
    const invalidModeration = withUniqueOrigin({ moderation: 'approved' }); // not a defined value

    await adapter.upsertMarketplaceEntry(valid);
    await adapter.upsertMarketplaceEntry(missingVisibility);
    await adapter.upsertMarketplaceEntry(nullModeration);
    await adapter.upsertMarketplaceEntry(invalidVisibility);
    await adapter.upsertMarketplaceEntry(invalidModeration);

    const results = await adapter.searchMarketplaceEntries({});

    expect(results).toHaveLength(1);
    expect(results[0].marketplaceId).toBe('mkt-valid');
  });

  it('countMarketplaceEntries counts only public + active entries', async () => {
    await adapter.upsertMarketplaceEntry(withUniqueOrigin({ marketplaceId: 'a' }));
    await adapter.upsertMarketplaceEntry(withUniqueOrigin({ marketplaceId: 'b' }));
    await adapter.upsertMarketplaceEntry(withUniqueOrigin({ visibility: 'private' }));
    await adapter.upsertMarketplaceEntry(withUniqueOrigin({ moderation: 'flagged' }));
    const invalid = withUniqueOrigin({});
    (invalid as { moderation?: unknown }).moderation = null;
    await adapter.upsertMarketplaceEntry(invalid);

    const count = await adapter.countMarketplaceEntries({});
    expect(count).toBe(2);
  });
});

describe('MemoryAdapter origin-pair dedupe (Req 5.5 / Req 1.10)', () => {
  let adapter: MemoryAdapter;

  beforeEach(async () => {
    entrySeq = 0;
    adapter = new MemoryAdapter();
    await adapter.connect();
  });

  it('upserting the same (originUserId, originCatalogId) yields exactly one entry', async () => {
    const first = makeEntry({
      marketplaceId: 'mkt-first',
      name: 'Original Name',
      provenance: { originUserId: 'author-1', originCatalogId: 'cat-1' },
    });
    const second = makeEntry({
      marketplaceId: 'mkt-second-should-be-ignored',
      name: 'Updated Name',
      provenance: { originUserId: 'author-1', originCatalogId: 'cat-1' },
    });

    const stored1 = await adapter.upsertMarketplaceEntry(first);
    const stored2 = await adapter.upsertMarketplaceEntry(second);

    // Stable marketplaceId is preserved from the first insert.
    expect(stored1.marketplaceId).toBe('mkt-first');
    expect(stored2.marketplaceId).toBe('mkt-first');

    // Searchable content is replaced in place.
    expect(stored2.name).toBe('Updated Name');

    const results = await adapter.searchMarketplaceEntries({});
    expect(results).toHaveLength(1);
    expect(results[0].marketplaceId).toBe('mkt-first');
    expect(results[0].name).toBe('Updated Name');

    expect(await adapter.countMarketplaceEntries({})).toBe(1);
  });

  it('preserves engagement counters on re-upsert of the same origin pair', async () => {
    const original = makeEntry({
      marketplaceId: 'mkt-engage',
      provenance: { originUserId: 'author-2', originCatalogId: 'cat-2' },
    });
    await adapter.upsertMarketplaceEntry(original);

    // Accumulate engagement via the counter API.
    await adapter.incrementMarketplaceCounter('mkt-engage', 'installs', 1);
    await adapter.incrementMarketplaceCounter('mkt-engage', 'installs', 1);
    await adapter.incrementMarketplaceCounter('mkt-engage', 'likes', 1);

    // Re-upsert carries zeroed engagement in the incoming payload.
    const reupsert = makeEntry({
      marketplaceId: 'ignored',
      name: 'Renamed',
      provenance: { originUserId: 'author-2', originCatalogId: 'cat-2' },
      engagement: { likes: 0, installs: 0, views: 0, trendingScore: 0 },
    });
    const merged = await adapter.upsertMarketplaceEntry(reupsert);

    // Engagement counters from the existing entry survive the re-upsert.
    expect(merged.engagement.installs).toBe(2);
    expect(merged.engagement.likes).toBe(1);
    expect(merged.name).toBe('Renamed');

    const stored = await adapter.getMarketplaceEntry('mkt-engage');
    expect(stored).not.toBeNull();
    expect(stored!.engagement.installs).toBe(2);
    expect(stored!.engagement.likes).toBe(1);
  });

  it('creates a separate entry for a different origin pair', async () => {
    await adapter.upsertMarketplaceEntry(
      makeEntry({
        marketplaceId: 'mkt-origin-a',
        provenance: { originUserId: 'author-3', originCatalogId: 'cat-a' },
      })
    );
    await adapter.upsertMarketplaceEntry(
      makeEntry({
        marketplaceId: 'mkt-origin-b',
        // Same user, different catalog -> distinct origin pair.
        provenance: { originUserId: 'author-3', originCatalogId: 'cat-b' },
      })
    );

    const results = await adapter.searchMarketplaceEntries({});
    const ids = results.map((r) => r.marketplaceId).sort();
    expect(ids).toEqual(['mkt-origin-a', 'mkt-origin-b']);
    expect(await adapter.countMarketplaceEntries({})).toBe(2);
  });
});
