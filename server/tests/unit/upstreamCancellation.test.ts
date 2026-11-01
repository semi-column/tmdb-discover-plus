import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config.ts', () => ({
  config: {
    logging: { level: 'silent', format: 'text' },
    tmdb: { debug: false },
    imdbApi: {
      apiKey: 'key',
      apiHost: 'imdb.example.test',
      apiKeyHeader: 'x-api-key',
      apiHostHeader: 'x-api-host',
    },
    addon: { variant: '' },
  },
}));
vi.mock('../../src/services/cache/index.ts', () => ({ getCache: () => cache }));
vi.mock('../../src/infrastructure/tmdbThrottle.ts', () => ({
  getTmdbThrottle: () => ({ acquire: async () => {} }),
  RATE_LIMITER_TIMEOUT_CODE: 'RATE_LIMITER_TIMEOUT',
}));
vi.mock('../../src/infrastructure/imdbThrottle.ts', () => ({
  getImdbThrottle: () => ({ acquire: async () => {} }),
}));

import { CacheWrapper } from '../../src/services/cache/CacheWrapper.ts';
import { MockCacheAdapter } from './helpers/mocks.ts';
import { requestIdMiddleware } from '../../src/utils/requestContext.ts';
import { setLogSink } from '../../src/utils/logger.ts';
import {
  tmdbFetch,
  resetCircuitBreaker,
  getCircuitBreakerState,
} from '../../src/services/tmdb/client.ts';
import {
  imdbFetch,
  resetImdbCircuitBreaker,
  getImdbCircuitBreakerState,
} from '../../src/services/imdb/client.ts';

let adapter: MockCacheAdapter;
let cache: CacheWrapper;
const fetchMock = vi.fn();
function startRequest<T>(work: () => Promise<T>) {
  const res = Object.assign(new EventEmitter(), { setHeader() {}, writableFinished: false });
  const promise = new Promise<T>((resolve, reject) => {
    requestIdMiddleware()({ headers: {} } as any, res as any, () => {
      work().then(resolve, reject);
    });
  });
  return { promise, cancel: () => res.emit('close') };
}
const providers = [
  {
    name: 'TMDB',
    fetch: () => tmdbFetch('/movie/123', 'key', {}, 0),
    retryFetch: () => tmdbFetch('/movie/123', 'key'),
    circuit: getCircuitBreakerState,
  },
  {
    name: 'IMDb',
    fetch: () => imdbFetch('/api/imdb/tt1234567', {}, 120, 0),
    retryFetch: () => imdbFetch('/api/imdb/tt1234567'),
    circuit: getImdbCircuitBreakerState,
  },
];

describe.each(providers)('$name request cancellation', (provider) => {
  beforeEach(() => {
    adapter = new MockCacheAdapter();
    cache = new CacheWrapper(adapter);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    resetCircuitBreaker();
    resetImdbCircuitBreaker();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setLogSink(null);
  });

  it('aborts in-flight transport, leaves no cache/error entry and does not trip the circuit', async () => {
    fetchMock.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
    );
    const request = startRequest(provider.fetch);
    const rejection = expect(request.promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    request.cancel();
    await rejection;
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(adapter.store.size).toBe(0);
    expect(provider.circuit().recentFailures).toBe(0);
  });

  it('lets a healthy coalesced caller recover when the first caller disconnects', async () => {
    fetchMock.mockImplementationOnce(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
    );
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'complete' }) });
    const first = startRequest(provider.fetch);
    const firstRejection = expect(first.promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const second = startRequest(provider.fetch);
    await new Promise((resolve) => setImmediate(resolve));
    first.cancel();
    await firstRejection;
    await expect(second.promise).resolves.toEqual({ id: 'complete' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(provider.circuit().recentFailures).toBe(0);
  });

  it('cancels a retry wait without sending another request or recording a circuit failure', async () => {
    const events: string[] = [];
    setLogSink((_level, _context, message) => events.push(message));
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const request = startRequest(provider.retryFetch);
    const rejection = expect(request.promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() =>
      expect(events.some((message) => message.includes('retrying'))).toBe(true)
    );
    request.cancel();
    await rejection;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(adapter.store.size).toBe(0);
    expect(provider.circuit().recentFailures).toBe(0);
  });

  it('does not cancel the shared transport when only the waiting caller disconnects', async () => {
    let finish!: (value: unknown) => void;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const first = startRequest(provider.fetch);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const second = startRequest(provider.fetch);
    const secondRejection = expect(second.promise).rejects.toMatchObject({ name: 'AbortError' });
    second.cancel();
    await secondRejection;
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    finish({ ok: true, json: async () => ({ id: 'complete' }) });
    await expect(first.promise).resolves.toEqual({ id: 'complete' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('sends redacted Error stacks to the logger rather than only messages', async () => {
    const events: unknown[] = [];
    setLogSink((_level, _context, _message, data) => events.push(data));
    fetchMock.mockRejectedValue(new Error('Invalid API key api_key=SECRET'));
    await expect(provider.fetch()).rejects.toThrow('Invalid API key');
    const event = events.find((data: any) => data?.error?.stack) as any;
    expect(event.error.stack).toContain('upstreamCancellation.test.ts');
    expect(event.error.message).toContain('[REDACTED]');
    expect(JSON.stringify(events)).not.toContain('SECRET');
  });
});
