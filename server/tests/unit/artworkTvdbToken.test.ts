import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyArtworkOverrides } from '../../src/services/artworkService.ts';
import { abortRequestContext, withRequestAbortContext } from '../../src/utils/requestContext.ts';

const nativePoster = 'https://image.tmdb.org/t/p/w500/native.jpg';
const tvdbPoster = 'https://artwork.thetvdb.com/poster.jpg';

function resolvePoster(apiKey: string) {
  return applyArtworkOverrides(
    { imdbId: 'tt0137523', type: 'series' },
    { poster: nativePoster },
    { poster: { service: 'tvdb', apiKey } }
  );
}

function tvdbResponse(url: string) {
  return {
    ok: true,
    json: async () =>
      url.endsWith('/login')
        ? { data: { token: 'artwork-token' } }
        : url.includes('/search/')
          ? { data: [{ series: { id: 1 } }] }
          : { data: { artworks: [{ image: tvdbPoster, type: 2 }] } },
  };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('TVDB artwork login coalescing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shares concurrent login per credential, keeps credentials independent and reuses tokens', async () => {
    const pending = gate();
    const login = vi.fn();
    const fetch = vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/login')) {
        login(JSON.parse(options.body as string).apikey);
        await pending.promise;
      }
      return tvdbResponse(url);
    });
    vi.stubGlobal('fetch', fetch);

    const calls = [
      resolvePoster('tvdb-coalesced-a'),
      resolvePoster('tvdb-coalesced-a'),
      resolvePoster('tvdb-coalesced-b'),
    ];
    expect(login.mock.calls).toEqual([['tvdb-coalesced-a'], ['tvdb-coalesced-b']]);
    pending.release();
    for (const result of await Promise.all(calls)) expect(result.poster).toBe(tvdbPoster);
    expect((await resolvePoster('tvdb-coalesced-a')).poster).toBe(tvdbPoster);
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('lets healthy waiters coalesce a replacement login after the owner is cancelled', async () => {
    const pending = gate();
    const reason = new DOMException('Owner cancelled', 'AbortError');
    let logins = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/login') && ++logins === 1) {
        await pending.promise;
        abortRequestContext(reason);
        throw reason;
      }
      return tvdbResponse(url);
    });
    vi.stubGlobal('fetch', fetch);

    const owner = withRequestAbortContext(() => resolvePoster('tvdb-cancel-owner'));
    const ownerRejected = expect(owner).rejects.toBe(reason);
    const healthy = [
      withRequestAbortContext(() => resolvePoster('tvdb-cancel-owner')),
      withRequestAbortContext(() => resolvePoster('tvdb-cancel-owner')),
    ];
    expect(logins).toBe(1);
    pending.release();
    await ownerRejected;
    for (const result of await Promise.all(healthy)) expect(result.poster).toBe(tvdbPoster);
    expect(logins).toBe(2);
    await resolvePoster('tvdb-cancel-owner');
    expect(logins).toBe(2);
  });

  it('cancels a waiting caller promptly without cancelling the shared login', async () => {
    const pending = gate();
    let loginSignal!: AbortSignal;
    const login = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.endsWith('/login')) {
          login();
          loginSignal = options.signal as AbortSignal;
          await pending.promise;
        }
        return tvdbResponse(url);
      })
    );

    const owner = withRequestAbortContext(() => resolvePoster('tvdb-cancel-waiter'));
    await withRequestAbortContext(async () => {
      const waiter = resolvePoster('tvdb-cancel-waiter');
      const reason = new DOMException('Waiter cancelled', 'AbortError');
      const rejected = expect(waiter).rejects.toBe(reason);
      abortRequestContext(reason);
      await rejected;
    });
    expect(loginSignal.aborted).toBe(false);
    expect(login).toHaveBeenCalledOnce();
    pending.release();
    expect((await owner).poster).toBe(tvdbPoster);
    expect((await resolvePoster('tvdb-cancel-waiter')).poster).toBe(tvdbPoster);
    expect(login).toHaveBeenCalledOnce();
  });

  it.each([401, 403])('does not suppress a cancelled login %s credential', async (status) => {
    const reason = new DOMException('Login cancelled', 'AbortError');
    let logins = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/login') && ++logins === 1) {
          abortRequestContext(reason);
          return { ok: false, status };
        }
        return tvdbResponse(url);
      })
    );
    await expect(
      withRequestAbortContext(() => resolvePoster(`tvdb-cancel-rejection-${status}`))
    ).rejects.toBe(reason);
    expect((await resolvePoster(`tvdb-cancel-rejection-${status}`)).poster).toBe(tvdbPoster);
    expect(logins).toBe(2);
  });

  it.each([401, 403])('suppresses confirmed login %s only for that credential', async (status) => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const login = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.endsWith('/login')) {
          const key = JSON.parse(options.body as string).apikey;
          login(key);
          if (key === `tvdb-rejected-${status}`) return { ok: false, status, body: { cancel } };
        }
        return tvdbResponse(url);
      })
    );
    expect((await resolvePoster(`tvdb-rejected-${status}`)).poster).toBe(nativePoster);
    expect((await resolvePoster(`tvdb-rejected-${status}`)).poster).toBe(nativePoster);
    expect((await resolvePoster(`tvdb-other-${status}`)).poster).toBe(tvdbPoster);
    expect(login).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['network', 'timeout', 'missing-token', 'upstream'] as const)(
    'removes a failed %s login so a later caller can recover',
    async (failure) => {
      let logins = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.endsWith('/login') && ++logins === 1) {
            if (failure === 'network') throw new Error('connection reset');
            if (failure === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
            if (failure === 'missing-token') return { ok: true, json: async () => ({ data: {} }) };
            return { ok: false, status: 503 };
          }
          return tvdbResponse(url);
        })
      );
      expect((await resolvePoster(`tvdb-recover-${failure}`)).poster).toBe(nativePoster);
      expect((await resolvePoster(`tvdb-recover-${failure}`)).poster).toBe(tvdbPoster);
      expect(logins).toBe(2);
    }
  );
});
