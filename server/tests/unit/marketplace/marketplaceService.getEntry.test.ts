import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';

import { MemoryAdapter } from '../../../src/services/storage/MemoryAdapter.ts';
import type { UserConfig, CatalogConfig } from '../../../src/types/config.ts';
import { AppError } from '../../../src/utils/AppError.ts';

/**
 * Unit tests for `getEntry` detail retrieval with view counting.
 *
 * Exercises the real `marketplaceService` wiring against a real MemoryAdapter:
 * only the storage factory and config loader boundary collaborators are
 * substituted. An entry is seeded by publishing an owned catalog so the entry
 * goes through the genuine projection path.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5.
 */

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

import { publishCatalog, getEntry } from '../../../src/services/marketplaceService.ts';
import { getMarketplaceCache } from '../../../src/infrastructure/marketplaceCache.ts';

const USER_ID = 'authorUser1';

async function seedEntry(): Promise<{ adapter: MemoryAdapter; marketplaceId: string }> {
  const adapter = new MemoryAdapter();
  await adapter.connect();
  refs.adapter.current = adapter;
  getMarketplaceCache().clear();

  const catalogId = crypto.randomUUID();
  const catalog: CatalogConfig = {
    _id: catalogId,
    name: 'PopularMovies',
    type: 'movie',
    source: 'tmdb',
    filters: { sortBy: 'popularity' },
    enabled: true,
    published: true,
  };
  refs.config.current = { userId: USER_ID, catalogs: [catalog], preferences: {} };

  const entry = await publishCatalog(USER_ID, catalogId);
  return { adapter, marketplaceId: entry.marketplaceId };
}

describe('marketplaceService.getEntry (Req 11.1-11.5)', () => {
  beforeEach(() => {
    refs.adapter.current = null;
    refs.config.current = null;
  });

  it('returns the entry and increments views by exactly 1 per retrieval (Req 11.1, 11.2)', async () => {
    const { adapter, marketplaceId } = await seedEntry();

    const first = await getEntry(marketplaceId);
    expect(first.marketplaceId).toBe(marketplaceId);
    expect(first.name).toBe('PopularMovies');
    expect(first.engagement.views).toBe(1);

    const second = await getEntry(marketplaceId);
    expect(second.engagement.views).toBe(2);

    // The increment is persisted (consistent under repeated retrievals).
    const stored = await adapter.getMarketplaceEntry(marketplaceId);
    expect(stored?.engagement.views).toBe(2);
  });

  it('returns only public projection fields, never secrets (Req 11.1)', async () => {
    const { marketplaceId } = await seedEntry();
    const entry = await getEntry(marketplaceId);

    // The MarketplaceEntry is itself the secret-free projection.
    expect(entry).not.toHaveProperty('apiKey');
    expect(JSON.stringify(entry)).not.toMatch(/apiKey|secret|token/i);
    expect(entry.visibility).toBe('public');
  });

  it('throws 404 and does not increment for an unknown but valid id (Req 11.3)', async () => {
    const { adapter } = await seedEntry();
    const unknownId = crypto.randomUUID();

    const incSpy = vi.spyOn(adapter, 'incrementMarketplaceCounter');
    await expect(getEntry(unknownId)).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
    expect(incSpy).not.toHaveBeenCalled();
  });

  it('throws 400 for a missing, empty, or malformed id and does not increment (Req 11.4)', async () => {
    const { adapter } = await seedEntry();
    const incSpy = vi.spyOn(adapter, 'incrementMarketplaceCounter');

    for (const bad of ['', '   ', 'has spaces', 'bad/slash', 'a'.repeat(65)]) {
      await expect(getEntry(bad)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(incSpy).not.toHaveBeenCalled();
  });

  it('returns the entry with its last recorded views value when the increment fails (Req 11.5)', async () => {
    const { adapter, marketplaceId } = await seedEntry();

    // Advance views to a known value, then force the next increment to fail.
    await getEntry(marketplaceId); // views -> 1
    vi.spyOn(adapter, 'incrementMarketplaceCounter').mockRejectedValueOnce(
      new Error('counter backend unavailable')
    );

    const entry = await getEntry(marketplaceId);
    // Request still succeeds and exposes the last successfully recorded value.
    expect(entry.marketplaceId).toBe(marketplaceId);
    expect(entry.engagement.views).toBe(1);

    // No partial update: the stored counter is unchanged.
    const stored = await adapter.getMarketplaceEntry(marketplaceId);
    expect(stored?.engagement.views).toBe(1);
  });
});
