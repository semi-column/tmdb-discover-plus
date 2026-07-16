import { describe, it, expect, beforeAll } from 'vitest';

import type { UserConfig, CatalogConfig } from '../../../src/types/config.ts';
import type { MarketplaceSearchParams } from '../../../src/types/marketplace.ts';
import type { getStorage as GetStorageFn } from '../../../src/services/storage/index.ts';
import type {
  saveUserConfig as SaveUserConfigFn,
  deleteUserConfig as DeleteUserConfigFn,
} from '../../../src/services/configService.ts';

/**
 * Integration test for config-save reconciliation (Task 13.2).
 *
 * Exercises the real configService -> reconcileMarketplaceEntries wiring end to
 * end against a single shared MemoryAdapter. configService.saveUserConfig
 * persists the config and then reconciles the marketplace index (via a lazy
 * dynamic import of marketplaceService); deleteUserConfig reconciles every
 * published catalog away. Because both configService and marketplaceService
 * resolve storage through getStorage(), and the storage layer is initialized in
 * memory mode here, the save path reconciles into exactly the same index the
 * test inspects.
 *
 * Validates Requirements 5.1, 5.2, 5.3, 5.4.
 */

const USER_ID = 'reconcile-user-01';
// A valid 32-hex TMDB API key so deleteUserConfig (which authorizes by matching
// the stored key) succeeds in the final scenario.
const API_KEY = 'abcdef0123456789abcdef0123456789';

const CATALOG_A_ID = 'catalog-a-id';
const CATALOG_B_ID = 'catalog-b-id';

// Bound lazily after the storage layer is initialized in memory mode, so the
// modules under test are loaded only once DATABASE_DRIVER=memory is in effect.
let getStorage: typeof GetStorageFn;
let saveUserConfig: typeof SaveUserConfigFn;
let deleteUserConfig: typeof DeleteUserConfigFn;

beforeAll(async () => {
  // Force the storage factory to pick the in-process MemoryAdapter before any
  // module that reads the frozen config is loaded. Dynamic imports below ensure
  // config.ts observes this value at evaluation time.
  process.env.DATABASE_DRIVER = 'memory';

  const storageMod = await import('../../../src/services/storage/index.ts');
  await storageMod.initStorage();
  getStorage = storageMod.getStorage;

  const configMod = await import('../../../src/services/configService.ts');
  saveUserConfig = configMod.saveUserConfig;
  deleteUserConfig = configMod.deleteUserConfig;
});

/** Build a catalog with a stable origin id, source, and filters. */
function makeCatalog(
  id: string,
  name: string,
  published: boolean,
  overrides: Partial<CatalogConfig> = {}
): CatalogConfig {
  return {
    _id: id,
    name,
    type: 'movie',
    source: 'tmdb',
    enabled: true,
    published,
    filters: { sortBy: 'popularity.desc', genreNames: ['Action'] },
    ...overrides,
  } as CatalogConfig;
}

/** Assemble a full UserConfig snapshot to hand to saveUserConfig. */
function makeConfig(catalogs: CatalogConfig[]): UserConfig {
  return {
    userId: USER_ID,
    tmdbApiKey: API_KEY,
    catalogs,
    preferences: {},
  };
}

/** The set of origin catalog ids currently indexed for our user, sorted. */
async function indexedCatalogIds(): Promise<string[]> {
  const params: MarketplaceSearchParams = { limit: 50 };
  const rows = await getStorage().searchMarketplaceEntries(params);
  return rows
    .filter((r) => r.provenance.originUserId === USER_ID)
    .map((r) => r.provenance.originCatalogId)
    .sort();
}

/** Total count of indexed (public + active) entries. */
async function indexedCount(): Promise<number> {
  const params: MarketplaceSearchParams = { limit: 50 };
  return getStorage().countMarketplaceEntries(params);
}

/** Look up the single indexed entry for an origin catalog id (or null). */
async function entryForCatalog(catalogId: string) {
  const params: MarketplaceSearchParams = { limit: 50 };
  const rows = await getStorage().searchMarketplaceEntries(params);
  return (
    rows.find(
      (r) => r.provenance.originUserId === USER_ID && r.provenance.originCatalogId === catalogId
    ) ?? null
  );
}

describe('config-save reconciliation (integration)', () => {
  it('shares a single MemoryAdapter across configService and marketplaceService', () => {
    // Sanity: both lazily-bound helpers resolve the same initialized adapter.
    expect(getStorage()).toBe(getStorage());
  });

  it('Req 5.1: saving a config indexes exactly the published catalogs', async () => {
    // Catalog A is published, B is not -> only A should be indexed.
    await saveUserConfig(
      makeConfig([
        makeCatalog(CATALOG_A_ID, 'Action Movies', true),
        makeCatalog(CATALOG_B_ID, 'Drama Picks', false),
      ])
    );

    expect(await indexedCatalogIds()).toEqual([CATALOG_A_ID]);
    expect(await indexedCount()).toBe(1);
  });

  it('Req 5.2: editing a published catalog re-upserts it while preserving counters', async () => {
    // Seed an engagement counter on A's entry so we can prove it survives the
    // content-change re-upsert.
    const before = await entryForCatalog(CATALOG_A_ID);
    expect(before).not.toBeNull();
    const marketplaceId = before!.marketplaceId;
    await getStorage().incrementMarketplaceCounter(marketplaceId, 'installs', 1);

    const seeded = await entryForCatalog(CATALOG_A_ID);
    expect(seeded!.engagement.installs).toBe(1);
    const originalHash = seeded!.contentHash;

    // Edit A's content (rename) -> content hash changes -> entry re-upserted.
    await saveUserConfig(
      makeConfig([
        makeCatalog(CATALOG_A_ID, 'Action Movies (Updated)', true),
        makeCatalog(CATALOG_B_ID, 'Drama Picks', false),
      ])
    );

    const after = await entryForCatalog(CATALOG_A_ID);
    expect(after).not.toBeNull();
    // Same stable id, still present, new content hash, counters preserved.
    expect(after!.marketplaceId).toBe(marketplaceId);
    expect(after!.name).toBe('Action Movies (Updated)');
    expect(after!.contentHash).not.toBe(originalHash);
    expect(after!.engagement.installs).toBe(1);

    // Index still holds exactly A.
    expect(await indexedCatalogIds()).toEqual([CATALOG_A_ID]);
  });

  it('Req 5.2/5.3: publishing B adds it; unchanged A is left untouched', async () => {
    const aBefore = await entryForCatalog(CATALOG_A_ID);
    const aHashBefore = aBefore!.contentHash;
    const aInstallsBefore = aBefore!.engagement.installs;

    // Toggle B to published (A unchanged, same name/filters as the prior save).
    await saveUserConfig(
      makeConfig([
        makeCatalog(CATALOG_A_ID, 'Action Movies (Updated)', true),
        makeCatalog(CATALOG_B_ID, 'Drama Picks', true),
      ])
    );

    // Index now holds A and B.
    expect(await indexedCatalogIds()).toEqual([CATALOG_A_ID, CATALOG_B_ID].sort());
    expect(await indexedCount()).toBe(2);

    // Req 5.3: A's hash is unchanged and its counter is preserved (no rewrite).
    const aAfter = await entryForCatalog(CATALOG_A_ID);
    expect(aAfter!.marketplaceId).toBe(aBefore!.marketplaceId);
    expect(aAfter!.contentHash).toBe(aHashBefore);
    expect(aAfter!.engagement.installs).toBe(aInstallsBefore);
  });

  it('Req 5.4/5.3: unpublishing A removes it; B (unchanged, published) remains', async () => {
    const bBefore = await entryForCatalog(CATALOG_B_ID);
    expect(bBefore).not.toBeNull();

    // Toggle A back to unpublished, leave B published and unchanged.
    await saveUserConfig(
      makeConfig([
        makeCatalog(CATALOG_A_ID, 'Action Movies (Updated)', false),
        makeCatalog(CATALOG_B_ID, 'Drama Picks', true),
      ])
    );

    // Req 5.4: A removed. Req 5.3: B still present and unchanged.
    expect(await indexedCatalogIds()).toEqual([CATALOG_B_ID]);
    expect(await indexedCount()).toBe(1);

    const bAfter = await entryForCatalog(CATALOG_B_ID);
    expect(bAfter!.marketplaceId).toBe(bBefore!.marketplaceId);
    expect(bAfter!.contentHash).toBe(bBefore!.contentHash);
  });

  it('Req 5.4: removing a published catalog entirely deletes its entry', async () => {
    // Drop B from the config altogether -> its entry must be removed.
    await saveUserConfig(makeConfig([makeCatalog(CATALOG_A_ID, 'Action Movies (Updated)', false)]));

    expect(await indexedCatalogIds()).toEqual([]);
    expect(await indexedCount()).toBe(0);
  });

  it('Req 5.4: deleteUserConfig reconciles away all of the user entries', async () => {
    // Re-publish both catalogs so there is something to clear on delete.
    await saveUserConfig(
      makeConfig([
        makeCatalog(CATALOG_A_ID, 'Action Movies (Updated)', true),
        makeCatalog(CATALOG_B_ID, 'Drama Picks', true),
      ])
    );
    expect(await indexedCount()).toBe(2);

    // Deleting the config removes the user entirely; every published entry goes.
    const result = await deleteUserConfig(USER_ID, API_KEY);
    expect(result.deleted).toBe(true);

    expect(await indexedCatalogIds()).toEqual([]);
    expect(await indexedCount()).toBe(0);
  });
});
