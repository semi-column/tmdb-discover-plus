import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkPosterExists } from '../../src/services/artworkService.ts';
import { getRpdbRating } from '../../src/services/rpdb.ts';
import { abortRequestContext, withRequestAbortContext } from '../../src/utils/requestContext.ts';

vi.mock('../../src/services/cache/index.ts', () => ({
  getCache: () => ({ get: async () => null, set: async () => {} }),
}));

describe('RPDB rating and artwork credential scopes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('suppresses a rejected rating operation without rejecting posters or another key', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({ ok: true, headers: { get: () => 'image/jpeg' } })
      .mockResolvedValueOnce({ ok: true, text: async () => '8.5' });
    vi.stubGlobal('fetch', fetch);
    expect(await getRpdbRating('rpdb-rating-scope', 'tt101')).toBeNull();
    expect(await getRpdbRating('rpdb-rating-scope', 'tt102')).toBeNull();
    expect(
      await checkPosterExists(
        'https://api.ratingposterdb.com/rpdb-rating-scope/imdb/poster-default/tt101.jpg'
      )
    ).toBe(true);
    expect(await getRpdbRating('rpdb-other-rating-scope', 'tt101')).toBe('8.5');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not suppress a rating credential when cancelled before handling a 403', async () => {
    const reason = new DOMException('Request cancelled', 'AbortError');
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () => {
        abortRequestContext(reason);
        return { ok: false, status: 403 };
      })
      .mockResolvedValueOnce({ ok: true, text: async () => '8.5' });
    vi.stubGlobal('fetch', fetch);
    await expect(
      withRequestAbortContext(() => getRpdbRating('rpdb-cancel-rating-scope', 'tt101'))
    ).rejects.toBe(reason);
    expect(await getRpdbRating('rpdb-cancel-rating-scope', 'tt102')).toBe('8.5');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
