import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryAdapter } from '../../src/services/storage/MemoryAdapter.ts';
import { getConfigCache } from '../../src/infrastructure/configCache.ts';

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('redis', () => ({ createClient: mocks.createClient }));
vi.mock('../../src/config.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config.ts')>();
  return {
    config: {
      ...original.config,
      database: {
        ...original.config.database,
        driver: 'postgres',
        postgresUri: 'postgres://fixture/configs',
      },
      cache: { ...original.config.cache, redisUrl: 'redis://fixture.invalid' },
    },
  };
});
import {
  ConfigInvalidation,
  synchronizeConfigWrites,
} from '../../src/infrastructure/configInvalidation.ts';

function redisPair() {
  const subscriber = Object.assign(new EventEmitter(), {
    isOpen: true,
    connect: vi.fn(async () => {}),
    subscribe: vi.fn(async (_channel: string, _listener: (value: string) => void) => {}),
    destroy: vi.fn(),
  });
  const publisher = Object.assign(new EventEmitter(), {
    isOpen: true,
    connect: vi.fn(async () => {}),
    duplicate: vi.fn(() => subscriber),
    publish: vi.fn(async (_channel: string, _value: string) => 1),
    destroy: vi.fn(),
  });
  mocks.createClient.mockReturnValue(publisher);
  return { publisher, subscriber };
}

beforeEach(() => {
  vi.clearAllMocks();
  getConfigCache().clear();
});
afterEach(() => vi.restoreAllMocks());

describe('configuration invalidation', () => {
  it('evicts peer entries, clears missed events on reconnect and validates messages', async () => {
    const { publisher, subscriber } = redisPair();
    const sync = new ConfigInvalidation('redis://fixture.invalid', 'postgres://fixture/configs');
    await sync.connect();
    const userId = 'a'.repeat(24);
    getConfigCache().set(userId, { revision: 1 });
    const listener = subscriber.subscribe.mock.calls[0][1];
    listener(userId);
    expect(await getConfigCache().getOrLoad(userId, async () => ({ revision: 2 }))).toEqual({
      revision: 2,
    });
    listener('invalid');
    expect(getConfigCache().getStats().size).toBe(1);
    subscriber.emit('ready');
    expect(getConfigCache().getStats().size).toBe(0);
    getConfigCache().set(userId, { revision: 2 });
    publisher.emit('error', new Error('offline'));
    expect(getConfigCache().getStats().size).toBe(0);
    sync.destroy();
    expect(subscriber.destroy).toHaveBeenCalledOnce();
    expect(publisher.destroy).toHaveBeenCalledOnce();
  });

  it('preserves successful mutations on publication failure and invalidates all adapter writes', async () => {
    const { publisher } = redisPair();
    // Exercise the storage boundary, including callers that bypass configService.
    const adapter = new MemoryAdapter();
    synchronizeConfigWrites(adapter);
    publisher.publish.mockRejectedValue(new Error('offline'));
    const userId = 'b'.repeat(24);
    getConfigCache().set(userId, { revision: 1 });
    const saved = { userId, catalogs: [], preferences: {} };
    expect(await adapter.saveUserConfig(saved)).toEqual(saved);
    expect(getConfigCache().getStats().size).toBe(0);
    expect(publisher.publish).toHaveBeenCalledWith(expect.any(String), userId);
    getConfigCache().set(userId, saved);
    expect(await adapter.deleteUserConfig(userId)).toBe(true);
    expect(getConfigCache().getStats().size).toBe(0);
    expect(publisher.publish).toHaveBeenCalledTimes(2);
    const writes = publisher.publish.mock.calls.length;
    const failing = new MemoryAdapter();
    vi.spyOn(failing, 'saveUserConfig').mockRejectedValue(new Error('database unavailable'));
    synchronizeConfigWrites(failing);
    getConfigCache().set(userId, saved);
    await expect(failing.saveUserConfig(saved)).rejects.toThrow('database unavailable');
    expect(getConfigCache().getStats().size).toBe(1);
    expect(publisher.publish).toHaveBeenCalledTimes(writes);
    await failing.disconnect();
    await adapter.disconnect();
    expect(publisher.destroy).toHaveBeenCalledTimes(2);
  });
});
