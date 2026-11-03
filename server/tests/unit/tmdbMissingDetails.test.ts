import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchTmdb } = vi.hoisted(() => ({ fetchTmdb: vi.fn() }));
vi.mock('../../src/services/tmdb/client.ts', () => ({ tmdbFetch: fetchTmdb }));

import { getDetails } from '../../src/services/tmdb/details.ts';
import { CachedError } from '../../src/services/cache/CacheWrapper.ts';

afterEach(() => vi.clearAllMocks());

describe('TMDB missing details', () => {
  it.each([
    Object.assign(new Error('Missing'), { statusCode: 404 }),
    new CachedError('NOT_FOUND', 'Missing'),
  ])('returns null for fresh and cached missing titles', async (error) => {
    fetchTmdb.mockRejectedValueOnce(error);
    expect(await getDetails('key', 294275, 'series')).toBeNull();
    expect(fetchTmdb).toHaveBeenCalledWith('/tv/294275', 'key', expect.any(Object));
  });

  it.each([401, 429, 503])('does not hide a %i as a missing title', async (statusCode) => {
    const error = Object.assign(new Error('Unavailable'), { statusCode });
    fetchTmdb.mockRejectedValueOnce(error);
    await expect(getDetails('key', 294275, 'series')).rejects.toBe(error);
  });
});
