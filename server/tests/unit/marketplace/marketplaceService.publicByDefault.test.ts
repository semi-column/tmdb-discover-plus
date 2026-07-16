import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

import { MemoryAdapter } from '../../../src/services/storage/MemoryAdapter.ts';
import type { UserConfig, CatalogConfig } from '../../../src/types/config.ts';

/**
 * Public-by-default reconciliation (opt-out model).
 *
 * Catalogs are indexed in the marketplace unless explicitly marked private
 * (`published === false`). A catalog with no `published` field is public by
 * default, so a freshly-saved config populates the marketplace without an
 * explicit publish step. Half-built catalogs that cannot be projected (e.g. no
 * name yet) are skipped rather than aborting the whole reconciliation.
 */

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

vi.mock('../../../src/services/configService.ts', () => ({
  getUserConfig: async () => null,
  saveUserConfig: async () => undefined,
}));

import { reconcileMarketplaceEntries } from '../../../src/services/marketplaceService.ts';
import { getMarketplaceCache } from '../../../src/infrastructure/marketplaceCache.ts';

const USER_ID = 'public-default-user';

function makeCatalog(overrides: Partial<CatalogConfig> = {}): CatalogConfig {
  return {
    _id: crypto.randomUUID(),
    name: 'Default Catalog',
    type: 'movie',
    source: 'tmdb',
    enabled: true,
    filters: { sortBy: 'popularity.desc' },
    ...overrides,
  } as CatalogConfig;
}

function makeConfig(catalogs: CatalogConfig[]): UserConfig {
  return { userId: USER_ID, catalogs, preferences: {} } as UserConfig;
}

async function indexedOriginIds(): Promise<string[]> {
  const rows = await refs.adapter.current!.searchMarketplaceEntries({ limit: 50 });
  return rows
    .filter((r) => r.provenance.originUserId === USER_ID)
    .map((r) => r.provenance.originCatalogId)
    .sort();
}

describe('reconcileMarketplaceEntries — public by default (opt-out)', () => {
  beforeEach(async () => {
    refs.adapter.current = new MemoryAdapter();
    await refs.adapter.current.connect();
    getMarketplaceCache().clear();
  });

  it('indexes a catalog that has no published field (public by default)', async () => {
    const cat = makeCatalog(); // no `published` field
    await reconcileMarketplaceEntries(null, makeConfig([cat]));

    expect(await indexedOriginIds()).toEqual([cat._id]);
  });

  it('does NOT index a catalog explicitly marked private', async () => {
    const cat = makeCatalog({ published: false });
    await reconcileMarketplaceEntries(null, makeConfig([cat]));

    expect(await indexedOriginIds()).toEqual([]);
  });

  it('indexes published:true the same as the default', async () => {
    const a = makeCatalog({ published: true });
    const b = makeCatalog(); // default => public
    await reconcileMarketplaceEntries(null, makeConfig([a, b]));

    expect(await indexedOriginIds()).toEqual([a._id, b._id].sort());
  });

  it('removes a catalog from the index when it is toggled private', async () => {
    const cat = makeCatalog(); // public by default
    await reconcileMarketplaceEntries(null, makeConfig([cat]));
    expect(await indexedOriginIds()).toEqual([cat._id]);

    // Toggle the same catalog (same _id) to private and reconcile prev -> next.
    const prev = makeConfig([cat]);
    const next = makeConfig([{ ...cat, published: false }]);
    await reconcileMarketplaceEntries(prev, next);

    expect(await indexedOriginIds()).toEqual([]);
  });

  it('skips an unprojectable (half-built) catalog without aborting the sync', async () => {
    // A catalog with an empty name cannot be projected; it must be skipped while
    // a sibling valid default-public catalog is still indexed.
    const invalid = makeCatalog({ name: '   ' });
    const valid = makeCatalog({ name: 'Valid Catalog' });

    await expect(
      reconcileMarketplaceEntries(null, makeConfig([invalid, valid]))
    ).resolves.toBeUndefined();

    expect(await indexedOriginIds()).toEqual([valid._id]);
  });

  it('excludes stock preset catalogs from auto-indexing', async () => {
    // A preset (non-discover listType, no presetOrigin) is a stock default and
    // must NOT flood the marketplace; a custom discover catalog is indexed.
    const preset = makeCatalog({ name: 'Popular', filters: { listType: 'popular' } });
    const discover = makeCatalog({ name: 'My Custom', filters: { listType: 'discover' } });
    const promoted = makeCatalog({
      name: 'Promoted Preset',
      filters: { listType: 'popular', presetOrigin: 'tmdb' },
    });

    await reconcileMarketplaceEntries(null, makeConfig([preset, discover, promoted]));

    // Only the custom discover catalog and the promoted-from-preset catalog are
    // indexed; the untouched stock preset is excluded.
    expect(await indexedOriginIds()).toEqual([discover._id, promoted._id].sort());
  });
});
