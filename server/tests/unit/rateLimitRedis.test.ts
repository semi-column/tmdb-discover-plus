import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  createClient: vi.fn(),
  stores: [] as Array<{ prefix: string; sendCommand: (...args: string[]) => Promise<unknown> }>,
  instances: [] as Array<{
    loadIncrementScript: ReturnType<typeof vi.fn>;
    loadGetScript: ReturnType<typeof vi.fn>;
    incrementScriptSha: Promise<string>;
    getScriptSha: Promise<string>;
    increment: (key: string) => Promise<unknown>;
    get: (key: string) => Promise<unknown>;
  }>,
  warn: vi.fn(),
}));
vi.mock('../../src/config.ts', () => ({
  config: {
    cache: { redisUrl: 'redis://fixture.invalid' },
    nodeEnv: 'production',
    features: { disableRateLimit: false },
  },
}));
vi.mock('../../src/utils/logger.ts', () => ({
  createLogger: () => ({ warn: state.warn, info: vi.fn() }),
}));
vi.mock('redis', () => ({ createClient: state.createClient }));
vi.mock('rate-limit-redis', () => ({
  RedisStore: class {
    localKeys = false;
    loadIncrementScript = vi.fn().mockResolvedValue('increment-sha');
    loadGetScript = vi.fn().mockResolvedValue('get-sha');
    incrementScriptSha = Promise.resolve('increment-sha');
    getScriptSha = Promise.resolve('get-sha');
    constructor(options: (typeof state.stores)[number]) {
      state.stores.push(options);
      state.instances.push(this);
    }
    init() {}
    async increment() {
      return { totalHits: 1 };
    }
    async get() {
      return { totalHits: 1 };
    }
    async decrement() {}
    async resetKey() {}
  },
}));

beforeEach(() => {
  vi.resetModules();
  state.stores.length = 0;
  state.instances.length = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function client() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    isOpen: true,
    isReady: true,
    connect: vi.fn(async () => {
      expect(emitter.listenerCount('error')).toBe(1);
    }),
    destroy: vi.fn(),
    sendCommand: vi.fn(async () => 'OK'),
  });
}

describe('Redis request-rate client lifecycle', () => {
  it('handles repeated socket errors without throwing or replacing shared policies', async () => {
    const redis = client();
    state.createClient.mockReturnValue(redis);
    const { destroyRateLimitRedis } = await import('../../src/utils/rateLimit.ts');
    for (let i = 0; i < 2; i++) {
      expect(() => redis.emit('error', new Error('Socket closed unexpectedly'))).not.toThrow();
    }
    expect(state.warn).toHaveBeenCalledWith('Redis rate-limit client error', {
      error: 'Socket closed unexpectedly',
    });
    expect(state.stores.map((store) => store.prefix)).toEqual([
      'rl:strict:',
      'rl:api:',
      'rl:addon:',
      'rl:addon-user:',
      'rl:addon-invalid:',
    ]);
    await state.stores[0].sendCommand('PING');
    expect(redis.sendCommand).toHaveBeenCalledWith(['PING']);
    destroyRateLimitRedis();
    destroyRateLimitRedis();
    expect(redis.destroy).toHaveBeenCalledOnce();
    expect(state.createClient).toHaveBeenCalledOnce();
  });

  it('destroys a failed startup client before retaining the existing memory fallback', async () => {
    const redis = client();
    redis.connect.mockRejectedValueOnce(new Error('connect failed'));
    state.createClient.mockReturnValue(redis);
    const { destroyRateLimitRedis } = await import('../../src/utils/rateLimit.ts');
    expect(redis.destroy).toHaveBeenCalledOnce();
    expect(state.stores).toEqual([]);
    expect(state.warn).toHaveBeenCalledWith('Redis rate-limit store unavailable, using in-memory', {
      error: 'connect failed',
    });
    destroyRateLimitRedis();
    expect(redis.destroy).toHaveBeenCalledOnce();
  });

  it('does not destroy an already closed client', async () => {
    const redis = client();
    state.createClient.mockReturnValue(redis);
    const { destroyRateLimitRedis } = await import('../../src/utils/rateLimit.ts');
    redis.isOpen = false;
    destroyRateLimitRedis();
    expect(redis.destroy).not.toHaveBeenCalled();
  });

  it('reports Redis command failures without masking NOSCRIPT recovery', async () => {
    const redis = client();
    state.createClient.mockReturnValue(redis);
    await import('../../src/utils/rateLimit.ts');
    redis.sendCommand.mockRejectedValueOnce(new Error('command timed out'));
    await expect(state.stores[0].sendCommand('EVALSHA')).rejects.toMatchObject({
      statusCode: 503,
      code: 'RATE_LIMIT_UNAVAILABLE',
    });
    const noScript = new Error('NOSCRIPT missing');
    redis.sendCommand.mockRejectedValueOnce(noScript);
    await expect(state.stores[0].sendCommand('EVALSHA')).rejects.toBe(noScript);
  });

  it('reloads a failed initialization script once for concurrent requests', async () => {
    const redis = client();
    state.createClient.mockReturnValue(redis);
    await import('../../src/utils/rateLimit.ts');
    const store = state.instances[0];
    store.incrementScriptSha = Promise.reject(new Error('initial script failed'));
    store.getScriptSha = Promise.reject(new Error('initial script failed'));
    void store.incrementScriptSha.catch(() => {});
    void store.getScriptSha.catch(() => {});

    await Promise.all([store.increment('a'), store.increment('b'), store.get('a'), store.get('b')]);
    expect(store.loadIncrementScript).toHaveBeenCalledOnce();
    expect(store.loadGetScript).toHaveBeenCalledOnce();
  });

  it('bounds a pending initial connection and destroys its retrying client', async () => {
    vi.useFakeTimers();
    const redis = client();
    const started = Promise.withResolvers<void>();
    const connection = Promise.withResolvers<void>();
    redis.connect.mockImplementation(() => {
      started.resolve();
      return connection.promise;
    });
    state.createClient.mockReturnValue(redis);

    const loading = import('../../src/utils/rateLimit.ts');
    await started.promise;
    await vi.advanceTimersByTimeAsync(1_999);
    expect(redis.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const { getRateLimitStatus } = await loading;

    expect(redis.destroy).toHaveBeenCalledOnce();
    expect(state.stores).toEqual([]);
    expect(getRateLimitStatus()).toMatchObject({ driver: 'memory', degraded: true });
    connection.resolve();
    await Promise.resolve();
    expect(state.stores).toEqual([]);
  });
});
