import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  createClient: vi.fn(),
  stores: [] as Array<{ prefix: string; sendCommand: (...args: string[]) => Promise<unknown> }>,
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
    constructor(options: (typeof state.stores)[number]) {
      state.stores.push(options);
    }
    init() {}
    async increment() {
      return { totalHits: 1 };
    }
    async decrement() {}
    async resetKey() {}
  },
}));

beforeEach(() => {
  vi.resetModules();
  state.stores.length = 0;
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

function client() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    isOpen: true,
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
      'rl:monitor:',
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
});
