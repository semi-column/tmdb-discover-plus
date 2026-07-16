import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock the api singleton so the hook talks to stubs instead of the network.
vi.mock('../services/api', () => ({
  api: {
    searchMarketplace: vi.fn(),
    getMarketplaceEntry: vi.fn(),
    installMarketplaceCatalog: vi.fn(),
    likeMarketplaceCatalog: vi.fn(),
    unlikeMarketplaceCatalog: vi.fn(),
  },
}));

import { api } from '../services/api';
import { useMarketplace } from './useMarketplace';

const DEBOUNCE_MS = 300;

function card(overrides = {}) {
  return {
    marketplaceId: 'm1',
    name: 'Card',
    source: 'tmdb',
    type: 'movie',
    liked: false,
    engagement: { likes: 5, installs: 2, views: 0 },
    ...overrides,
  };
}

// Advance past the debounce window and flush the pending async search.
async function flushDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
  });
}

describe('useMarketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('debounce', () => {
    it('collapses rapid successive search() calls into a single api call', async () => {
      api.searchMarketplace.mockResolvedValue({ items: [card()], total: 1, page: 0 });
      const { result } = renderHook(() => useMarketplace());

      act(() => {
        result.current.search({ q: 'a' });
        result.current.search({ q: 'ab' });
        result.current.search({ q: 'abc' });
      });

      // Nothing fires before the debounce window elapses.
      expect(api.searchMarketplace).not.toHaveBeenCalled();

      await flushDebounce();

      // Exactly one request, using the most recent query.
      expect(api.searchMarketplace).toHaveBeenCalledTimes(1);
      expect(api.searchMarketplace).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'abc', page: 0 })
      );
    });
  });

  describe('pagination append', () => {
    it('appends the next page to results and updates hasMore from total', async () => {
      api.searchMarketplace
        .mockResolvedValueOnce({
          items: [card({ marketplaceId: 'm1' }), card({ marketplaceId: 'm2' })],
          total: 4,
          page: 0,
        })
        .mockResolvedValueOnce({
          items: [card({ marketplaceId: 'm3' }), card({ marketplaceId: 'm4' })],
          total: 4,
          page: 1,
        });

      const { result } = renderHook(() => useMarketplace());

      act(() => {
        result.current.search({ q: 'x' });
      });
      await flushDebounce();

      // First page loaded; more remain (2 of 4).
      expect(result.current.results.map((r) => r.marketplaceId)).toEqual(['m1', 'm2']);
      expect(result.current.hasMore).toBe(true);

      await act(async () => {
        await result.current.loadMore();
      });

      // Second page appended; all 4 loaded, no more pages.
      expect(result.current.results.map((r) => r.marketplaceId)).toEqual(['m1', 'm2', 'm3', 'm4']);
      expect(result.current.hasMore).toBe(false);
      expect(api.searchMarketplace).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'x', page: 1 })
      );
    });
  });

  describe('optimistic like with rollback', () => {
    it('rolls back the optimistic update when the like api rejects', async () => {
      api.searchMarketplace.mockResolvedValue({
        items: [card({ marketplaceId: 'm1', liked: false, engagement: { likes: 5 } })],
        total: 1,
        page: 1,
      });
      api.likeMarketplaceCatalog.mockRejectedValue(new Error('network down'));

      const { result } = renderHook(() => useMarketplace());

      act(() => {
        result.current.search({ q: 'x' });
      });
      await flushDebounce();

      const entry = result.current.results[0];
      expect(entry.liked).toBe(false);
      expect(entry.engagement.likes).toBe(5);

      await act(async () => {
        await expect(result.current.toggleLike(entry)).rejects.toThrow('network down');
      });

      // State rolled back to the pre-toggle snapshot.
      const after = result.current.results[0];
      expect(after.liked).toBe(false);
      expect(after.engagement.likes).toBe(5);
      expect(result.current.error).toBe('network down');
    });

    it('keeps the optimistic update and reconciles likes when the api resolves', async () => {
      api.searchMarketplace.mockResolvedValue({
        items: [card({ marketplaceId: 'm1', liked: false, engagement: { likes: 5 } })],
        total: 1,
        page: 1,
      });
      api.likeMarketplaceCatalog.mockResolvedValue({ likes: 6 });

      const { result } = renderHook(() => useMarketplace());

      act(() => {
        result.current.search({ q: 'x' });
      });
      await flushDebounce();

      await act(async () => {
        await result.current.toggleLike(result.current.results[0]);
      });

      const after = result.current.results[0];
      expect(after.liked).toBe(true);
      expect(after.engagement.likes).toBe(6);
      expect(api.likeMarketplaceCatalog).toHaveBeenCalledWith('m1');
    });
  });

  describe('install then refresh', () => {
    it('installs the catalog and invokes the refreshConfig callback', async () => {
      api.installMarketplaceCatalog.mockResolvedValue({ installs: 10 });
      const refreshConfig = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() => useMarketplace({ userId: 'user1', refreshConfig }));

      await act(async () => {
        await result.current.install(card({ marketplaceId: 'm1' }));
      });

      expect(api.installMarketplaceCatalog).toHaveBeenCalledWith('m1', 'user1');
      expect(refreshConfig).toHaveBeenCalledTimes(1);
    });

    it('surfaces the error and does not refresh when install fails', async () => {
      api.installMarketplaceCatalog.mockRejectedValue(new Error('save failed'));
      const refreshConfig = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() => useMarketplace({ userId: 'user1', refreshConfig }));

      await act(async () => {
        await expect(result.current.install(card({ marketplaceId: 'm1' }))).rejects.toThrow(
          'save failed'
        );
      });

      expect(refreshConfig).not.toHaveBeenCalled();
      expect(result.current.error).toBe('save failed');
    });
  });
});
