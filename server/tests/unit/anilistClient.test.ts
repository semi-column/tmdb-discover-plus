import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ok = () => new Response(JSON.stringify({ data: {} }), { status: 200 });
const limited = (retryAfter: string) =>
  new Response('{"errors":[{"status":429}]}', {
    status: 429,
    headers: { 'Retry-After': retryAfter },
  });

describe('anilistFetch rate-limit pause', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('holds every queued request until Retry-After elapses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(limited('30'))
      .mockImplementation(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const { anilistFetch } = await import('../../src/services/anilist/client.ts');

    const a = anilistFetch('query A');
    const b = anilistFetch('query B');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(25_000);
    await expect(Promise.all([a, b])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails fast when the pause outlasts the parent request budget', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(limited('60'))
      .mockImplementation(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const { anilistFetch } = await import('../../src/services/anilist/client.ts');
    const { requestIdMiddleware } = await import('../../src/utils/requestContext.ts');

    const background = anilistFetch('query A');
    await vi.advanceTimersByTimeAsync(0);

    const result = await new Promise<unknown>((resolve) => {
      requestIdMiddleware()({ headers: {} } as any, { setHeader: () => {} } as any, () => {
        anilistFetch('query B').then(resolve, resolve);
      });
    });

    expect(result).toMatchObject({ statusCode: 429, rateLimitExhausted: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(61_000);
    await expect(background).resolves.toEqual({ data: {} });
  });
});
