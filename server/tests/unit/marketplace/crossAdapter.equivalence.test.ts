import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

import { MemoryAdapter } from '../../../src/services/storage/MemoryAdapter.ts';
import { MongoAdapter } from '../../../src/services/storage/MongoAdapter.ts';
import { PostgresAdapter } from '../../../src/services/storage/PostgresAdapter.ts';
import type { IStorageAdapter } from '../../../src/types/storage.ts';
import type { MarketplaceEntry, MarketplaceSearchParams } from '../../../src/types/marketplace.ts';

/**
 * Task 7.3 — Cross-adapter equivalence tests.
 *
 * Seeds an identical set of MarketplaceEntry rows into every available storage
 * adapter and asserts that, for a set of identical queries, the adapters agree
 * on:
 *   (a) the set of entries returned, compared by stable ORIGIN id
 *       (`originUserId::originCatalogId`) rather than `marketplaceId`, since the
 *       public id is assigned independently per backend, and
 *   (b) the total reported by `countMarketplaceEntries`.
 *
 * Environment constraint: CI/dev has no live MongoDB or PostgreSQL. The
 * MemoryAdapter always runs as the baseline; the DB-backed adapters are included
 * only when their connection string is present (and the connection actually
 * succeeds), otherwise they are skipped so the suite passes DB-free.
 *
 * Per task 7.2's note, fuzzy text ranking differs between Postgres (pg_trgm) and
 * Memory/Mongo (Levenshtein), so equivalence is asserted over exact-name, facet,
 * browse (empty-query) and sort queries — comparing the *set* of origin ids and
 * the total count, never byte-identical fuzzy score ordering.
 *
 * _Requirements: 18.5_
 */

// --- DB availability (search the documented env var names with fallbacks) ---

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || '';
const POSTGRES_URI = process.env.POSTGRES_URI || process.env.DATABASE_URL || '';

// Unique per-run prefix so seeded rows never collide with (or read) pre-existing
// data in a shared database, and so a scoping facet can isolate our rows.
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const ORIGIN_USER_PREFIX = `equiv-${RUN_ID}-u`;
// A run-unique genre token added to every seeded entry. Including it as a genre
// facet on every query scopes both search() and count() to exactly our rows,
// which keeps count equivalence valid even against a populated shared database.
const SCOPE_GENRE = `EquivScope_${RUN_ID}`;

interface SeedSpec {
  originIdx: number;
  catalogId: string;
  marketplaceId: string;
  name: string;
  source: MarketplaceEntry['source'];
  type: MarketplaceEntry['type'];
  genres: string[];
  visibility: MarketplaceEntry['visibility'];
  moderation: MarketplaceEntry['moderation'];
  installs: number;
  likes: number;
  views: number;
  trendingScore: number;
  publishedAt: string;
}

/**
 * Identical seed set. Six searchable rows spanning multiple sources/types/genres
 * plus two non-searchable rows (unlisted + flagged) to confirm the governance
 * filter is applied identically across adapters. Every row carries SCOPE_GENRE.
 */
const SEED_SPECS: SeedSpec[] = [
  {
    originIdx: 1,
    catalogId: 'cat-1',
    marketplaceId: randomUUID(),
    name: 'Galaxy Quest Adventures',
    source: 'tmdb',
    type: 'movie',
    genres: ['Action', SCOPE_GENRE],
    visibility: 'public',
    moderation: 'active',
    installs: 50,
    likes: 10,
    views: 200,
    trendingScore: 5,
    publishedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    originIdx: 2,
    catalogId: 'cat-2',
    marketplaceId: randomUUID(),
    name: 'Mystery Manor',
    source: 'tmdb',
    type: 'series',
    genres: ['Drama', SCOPE_GENRE],
    visibility: 'public',
    moderation: 'active',
    installs: 20,
    likes: 30,
    views: 150,
    trendingScore: 8,
    publishedAt: '2024-02-01T00:00:00.000Z',
  },
  {
    originIdx: 3,
    catalogId: 'cat-3',
    marketplaceId: randomUUID(),
    name: 'Anime Legends Unbound',
    source: 'anilist',
    type: 'anime',
    genres: ['Action', SCOPE_GENRE],
    visibility: 'public',
    moderation: 'active',
    installs: 5,
    likes: 2,
    views: 40,
    trendingScore: 1,
    publishedAt: '2024-03-01T00:00:00.000Z',
  },
  {
    originIdx: 4,
    catalogId: 'cat-4',
    marketplaceId: randomUUID(),
    name: 'Cooking Masterclass',
    source: 'trakt',
    type: 'movie',
    genres: ['Drama', SCOPE_GENRE],
    visibility: 'public',
    moderation: 'active',
    installs: 100,
    likes: 1,
    views: 500,
    trendingScore: 9,
    publishedAt: '2024-04-01T00:00:00.000Z',
  },
  {
    originIdx: 5,
    catalogId: 'cat-5',
    marketplaceId: randomUUID(),
    name: 'Space Odyssey Collection',
    source: 'tmdb',
    type: 'collection',
    genres: ['Action', SCOPE_GENRE],
    visibility: 'public',
    moderation: 'active',
    installs: 0,
    likes: 0,
    views: 0,
    trendingScore: 0,
    publishedAt: '2024-05-01T00:00:00.000Z',
  },
  {
    originIdx: 6,
    catalogId: 'cat-6',
    marketplaceId: randomUUID(),
    name: 'Thriller Nights',
    source: 'imdb',
    type: 'series',
    genres: ['Drama', SCOPE_GENRE],
    visibility: 'public',
    moderation: 'active',
    installs: 7,
    likes: 7,
    views: 70,
    trendingScore: 3,
    publishedAt: '2024-06-01T00:00:00.000Z',
  },
  // Non-searchable: unlisted (must be excluded everywhere).
  {
    originIdx: 7,
    catalogId: 'cat-7',
    marketplaceId: randomUUID(),
    name: 'Hidden Gem',
    source: 'tmdb',
    type: 'movie',
    genres: ['Action', SCOPE_GENRE],
    visibility: 'unlisted',
    moderation: 'active',
    installs: 999,
    likes: 999,
    views: 999,
    trendingScore: 999,
    publishedAt: '2024-07-01T00:00:00.000Z',
  },
  // Non-searchable: flagged (must be excluded everywhere).
  {
    originIdx: 8,
    catalogId: 'cat-8',
    marketplaceId: randomUUID(),
    name: 'Flagged Content',
    source: 'tmdb',
    type: 'movie',
    genres: ['Drama', SCOPE_GENRE],
    visibility: 'public',
    moderation: 'flagged',
    installs: 999,
    likes: 999,
    views: 999,
    trendingScore: 999,
    publishedAt: '2024-08-01T00:00:00.000Z',
  },
];

function originId(originUserId: string, originCatalogId: string): string {
  return `${originUserId}::${originCatalogId}`;
}

function specOriginUserId(spec: SeedSpec): string {
  return `${ORIGIN_USER_PREFIX}${spec.originIdx}`;
}

function buildEntry(spec: SeedSpec): MarketplaceEntry {
  return {
    marketplaceId: spec.marketplaceId,
    provenance: {
      originUserId: specOriginUserId(spec),
      originCatalogId: spec.catalogId,
      originConfigName: 'Equivalence Suite',
    },
    name: spec.name,
    description: `Seed entry for cross-adapter equivalence (${spec.name})`,
    tags: ['equiv', spec.type],
    type: spec.type,
    source: spec.source,
    genres: spec.genres,
    filterFacets: [`sort:popularity.desc`, `source:${spec.source}`],
    filters: {},
    visibility: spec.visibility,
    moderation: spec.moderation,
    engagement: {
      likes: spec.likes,
      installs: spec.installs,
      views: spec.views,
      trendingScore: spec.trendingScore,
    },
    contentHash: `hash-${spec.marketplaceId}`,
    publishedAt: new Date(spec.publishedAt),
    updatedAt: new Date(spec.publishedAt),
    schemaVersion: 1,
  };
}

interface AdapterUnderTest {
  label: string;
  adapter: IStorageAdapter;
}

const adapters: AdapterUnderTest[] = [];
let setupError: string | null = null;

/** Attempt to connect + seed a DB adapter; on any failure, skip it cleanly. */
async function tryAddDbAdapter(label: string, factory: () => IStorageAdapter): Promise<void> {
  let adapter: IStorageAdapter;
  try {
    adapter = factory();
    await adapter.connect();
  } catch (err) {
    // Connection string present but DB unreachable -> treat as unavailable.
    console.warn(
      `[crossAdapter.equivalence] ${label} unavailable, skipping: ${(err as Error).message}`
    );
    return;
  }
  try {
    await seedAdapter(adapter);
    adapters.push({ label, adapter });
  } catch (err) {
    console.warn(
      `[crossAdapter.equivalence] ${label} seed failed, skipping: ${(err as Error).message}`
    );
    try {
      await cleanupAdapter(adapter);
    } catch {
      /* best effort */
    }
    try {
      await adapter.disconnect();
    } catch {
      /* best effort */
    }
  }
}

async function seedAdapter(adapter: IStorageAdapter): Promise<void> {
  for (const spec of SEED_SPECS) {
    await adapter.upsertMarketplaceEntry(buildEntry(spec));
  }
}

async function cleanupAdapter(adapter: IStorageAdapter): Promise<void> {
  for (const spec of SEED_SPECS) {
    await adapter.deleteMarketplaceEntryByOrigin(specOriginUserId(spec), spec.catalogId);
  }
}

/**
 * Run a query against an adapter and return the scoped set of ORIGIN ids plus the
 * reported total. Results are filtered to our run prefix as a second line of
 * defense even though the scope-genre facet already isolates our rows.
 */
async function runQuery(
  adapter: IStorageAdapter,
  params: MarketplaceSearchParams
): Promise<{ originIds: Set<string>; count: number }> {
  const results = await adapter.searchMarketplaceEntries(params);
  const originIds = new Set(
    results
      .filter((r) => r.provenance.originUserId.startsWith(ORIGIN_USER_PREFIX))
      .map((r) => originId(r.provenance.originUserId, r.provenance.originCatalogId))
  );
  const count = await adapter.countMarketplaceEntries(params);
  return { originIds, count };
}

// Every scenario includes the run-unique scope genre so search + count are
// restricted to this run's seeded rows.
function scoped(facets: MarketplaceSearchParams['facets'] = {}): MarketplaceSearchParams['facets'] {
  const genres = [SCOPE_GENRE, ...(facets?.genres ?? [])];
  return { ...facets, genres };
}

interface Scenario {
  name: string;
  params: MarketplaceSearchParams;
  /** Expected scoped origin ids (validated against Memory baseline directly). */
  expectedOriginIdxs: number[];
}

const SEARCHABLE_IDXS = [1, 2, 3, 4, 5, 6];

const SCENARIOS: Scenario[] = [
  {
    name: 'empty-query browse, sort=trending',
    params: { facets: scoped(), sort: 'trending', page: 1, limit: 50 },
    expectedOriginIdxs: SEARCHABLE_IDXS,
  },
  {
    name: 'empty-query browse, sort=newest',
    params: { facets: scoped(), sort: 'newest', page: 1, limit: 50 },
    expectedOriginIdxs: SEARCHABLE_IDXS,
  },
  {
    name: 'empty-query browse, sort=popular',
    params: { facets: scoped(), sort: 'popular', page: 1, limit: 50 },
    expectedOriginIdxs: SEARCHABLE_IDXS,
  },
  {
    name: 'empty-query browse, sort=most-installed',
    params: { facets: scoped(), sort: 'most-installed', page: 1, limit: 50 },
    expectedOriginIdxs: SEARCHABLE_IDXS,
  },
  {
    name: 'facet source=tmdb',
    params: { facets: scoped({ source: 'tmdb' }), sort: 'trending', page: 1, limit: 50 },
    // tmdb + public + active: idx 1, 2, 5 (7 unlisted, 8 flagged excluded).
    expectedOriginIdxs: [1, 2, 5],
  },
  {
    name: 'facet type=series',
    params: { facets: scoped({ type: 'series' }), sort: 'trending', page: 1, limit: 50 },
    expectedOriginIdxs: [2, 6],
  },
  {
    name: 'facet genre=Action',
    params: { facets: scoped({ genres: ['Action'] }), sort: 'trending', page: 1, limit: 50 },
    // Action + public + active: idx 1, 3, 5 (7 unlisted excluded).
    expectedOriginIdxs: [1, 3, 5],
  },
  {
    name: 'exact-name query "Mystery Manor"',
    params: { q: 'Mystery Manor', facets: scoped(), page: 1, limit: 50 },
    expectedOriginIdxs: [2],
  },
];

function expectedOriginIdSet(idxs: number[]): Set<string> {
  const byIdx = new Map(SEED_SPECS.map((s) => [s.originIdx, s]));
  return new Set(
    idxs.map((i) => {
      const spec = byIdx.get(i)!;
      return originId(specOriginUserId(spec), spec.catalogId);
    })
  );
}

beforeAll(async () => {
  try {
    // Memory is always the baseline.
    const memory = new MemoryAdapter();
    await memory.connect();
    await seedAdapter(memory);
    adapters.push({ label: 'Memory', adapter: memory });

    if (MONGO_URI) {
      await tryAddDbAdapter('Mongo', () => new MongoAdapter(MONGO_URI));
    }
    if (POSTGRES_URI) {
      await tryAddDbAdapter('Postgres', () => new PostgresAdapter(POSTGRES_URI));
    }
  } catch (err) {
    setupError = (err as Error).message;
  }
}, 30000);

afterAll(async () => {
  for (const { adapter } of adapters) {
    try {
      await cleanupAdapter(adapter);
    } catch {
      /* best effort */
    }
    try {
      await adapter.disconnect();
    } catch {
      /* best effort */
    }
  }
}, 30000);

describe('Cross-adapter marketplace equivalence (Req 18.5)', () => {
  it('sets up the Memory baseline and reports active adapters', () => {
    expect(setupError).toBeNull();
    const labels = adapters.map((a) => a.label);
    // eslint-disable-next-line no-console
    console.info(
      `[crossAdapter.equivalence] adapters running: ${labels.join(', ')}` +
        (labels.includes('Mongo') ? '' : ' (Mongo skipped: no/unreachable MONGODB_URI)') +
        (labels.includes('Postgres') ? '' : ' (Postgres skipped: no/unreachable POSTGRES_URI)')
    );
    expect(labels).toContain('Memory');
  });

  describe.each(SCENARIOS)('query: $name', (scenario) => {
    it('Memory baseline returns exactly the expected scoped origin ids and count', async () => {
      const memory = adapters.find((a) => a.label === 'Memory')!.adapter;
      const expected = expectedOriginIdSet(scenario.expectedOriginIdxs);

      const { originIds, count } = await runQuery(memory, scenario.params);

      expect([...originIds].sort()).toEqual([...expected].sort());
      expect(count).toBe(expected.size);
    });

    it('every available DB adapter agrees with Memory on origin-id set and total', async () => {
      const memory = adapters.find((a) => a.label === 'Memory')!.adapter;
      const baseline = await runQuery(memory, scenario.params);
      const baselineIds = [...baseline.originIds].sort();

      const others = adapters.filter((a) => a.label !== 'Memory');
      if (others.length === 0) {
        // Memory-only environment (CI/dev): nothing to cross-check. The baseline
        // assertion above already validated Memory behaviour.
        expect(others.length).toBe(0);
        return;
      }

      for (const { label, adapter } of others) {
        const { originIds, count } = await runQuery(adapter, scenario.params);
        expect([...originIds].sort(), `${label} origin-id set mismatch`).toEqual(baselineIds);
        expect(count, `${label} total count mismatch`).toBe(baseline.count);
      }
    });
  });
});
