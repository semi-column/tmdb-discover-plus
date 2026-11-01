import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/services/tmdb/client.ts', () => ({ tmdbFetch: vi.fn() }));
import { tmdbFetch } from '../../src/services/tmdb/client.ts';
import { comprehensiveSearch } from '../../src/services/tmdb/search.ts';

describe('comprehensive search pagination', () => {
  beforeEach(() => vi.clearAllMocks());

  it('paginates a large filmography without losing or repeating title/credit results', async () => {
    const titles = Array.from({ length: 45 }, (_, id) => ({ id: id + 1, title: `Title ${id}` }));
    const credits = Array.from({ length: 310 }, (_, id) => ({ id: id + 20, popularity: 400 - id }));
    vi.mocked(tmdbFetch).mockImplementation(async (endpoint, _key, params = {}) => {
      if (endpoint === '/search/person') {
        return { results: [{ id: 7, name: 'Walt Disney', popularity: 20 }] };
      }
      if (endpoint === '/person/7/movie_credits') return { cast: credits, crew: credits };
      const page = Number(params.page || 1);
      return {
        results: titles.slice((page - 1) * 20, page * 20),
        total_pages: 3,
        total_results: 45,
      };
    });
    const seen: number[] = [];
    for (let page = 1; page <= 18; page++) {
      const result = await comprehensiveSearch('key', 'Disney', 'movie', page);
      expect(result.results.length).toBeLessThanOrEqual(20);
      seen.push(...result.results.map((item) => item.id));
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 329 }, (_, id) => id + 1));
  });
});
