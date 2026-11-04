import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('redis', () => ({ createClient: state.createClient }));

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();
});

describe('Redis connection deadlines', () => {
  it('caps the pending command queue so a stalled socket cannot grow it unbounded', async () => {
    const { redisRecoveryOptions } = await import('../../src/utils/redisConnection.ts');
    expect(redisRecoveryOptions().commandsQueueMaxLength).toBe(1_000);
  });

  it('bounds a sent command and handles its eventual rejection', async () => {
    vi.useFakeTimers();
    const { awaitRedisCommand } = await import('../../src/utils/redisConnection.ts');
    const pending = Promise.withResolvers<string>();
    const assertion = expect(awaitRedisCommand(pending.promise)).rejects.toThrow(
      'Redis command timed out'
    );

    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
    pending.reject(new Error('socket closed later'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns a stalled cache read into a bounded miss', async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<string | null>();
    const client = Object.assign(new EventEmitter(), { get: vi.fn(() => pending.promise) });
    state.createClient.mockReturnValue(client);
    const { RedisAdapter } = await import('../../src/services/cache/RedisAdapter.ts');
    const result = new RedisAdapter('redis://fixture.invalid').get('stalled');

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toBeNull();
    pending.reject(new Error('socket closed later'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('destroys a timed-out cache startup client', async () => {
    vi.useFakeTimers();
    const client = Object.assign(new EventEmitter(), {
      isOpen: false,
      isReady: false,
      connect: vi.fn(() => {
        client.isOpen = true;
        return new Promise(() => {});
      }),
      destroy: vi.fn(),
    });
    state.createClient.mockReturnValue(client);
    const { RedisAdapter } = await import('../../src/services/cache/RedisAdapter.ts');
    const adapter = new RedisAdapter('redis://fixture.invalid');
    const connection = adapter.connect();
    const assertion = expect(connection).rejects.toThrow('Redis startup connection timed out');

    await vi.advanceTimersByTimeAsync(1_999);
    expect(client.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(client.destroy).toHaveBeenCalledOnce();
  });

  it('destroys a revocation client even while its initial connection is pending', async () => {
    const pending = Promise.withResolvers<void>();
    const client = Object.assign(new EventEmitter(), {
      isOpen: true,
      isReady: false,
      connect: vi.fn(() => pending.promise),
      destroy: vi.fn(() => {
        client.isOpen = false;
        pending.reject(new Error('closed'));
      }),
    });
    state.createClient.mockReturnValue(client);
    const { RedisRevocationStore } = await import('../../src/infrastructure/revocationStore.ts');
    const store = new RedisRevocationStore('redis://fixture.invalid');
    client.isOpen = false;
    const connection = store.connect();
    client.isOpen = true;
    const assertion = expect(connection).rejects.toThrow('closed');

    await store.destroy();
    await assertion;
    await store.destroy();
    expect(client.destroy).toHaveBeenCalledOnce();
  });
});
