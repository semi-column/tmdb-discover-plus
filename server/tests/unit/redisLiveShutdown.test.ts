import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('redis', () => ({ createClient: state.createClient }));
afterEach(() => vi.restoreAllMocks());

it('destroys offline live connections without issuing a queued QUIT and is idempotent', async () => {
  const subscriber = Object.assign(new EventEmitter(), {
    isOpen: true,
    isReady: false,
    connect: vi.fn(async () => {}),
    subscribe: vi.fn(async () => {}),
    quit: vi.fn(() => new Promise(() => {})),
    destroy: vi.fn(() => {
      subscriber.isOpen = false;
    }),
  });
  const client = Object.assign(new EventEmitter(), {
    isOpen: true,
    isReady: false,
    duplicate: () => subscriber,
    quit: vi.fn(() => new Promise(() => {})),
    destroy: vi.fn(() => {
      client.isOpen = false;
    }),
  });
  state.createClient.mockReturnValue(client);
  const { RedisLiveStore } = await import('../../src/services/observability/liveStore.ts');
  const live = new RedisLiveStore('redis://fixture.invalid');
  const unsubscribe = live.subscribe(() => {});
  await new Promise<void>((resolve) => setImmediate(resolve));
  await live.close();
  await live.close();
  unsubscribe();
  expect(subscriber.destroy).toHaveBeenCalledOnce();
  expect(client.destroy).toHaveBeenCalledOnce();
  expect(client.quit).not.toHaveBeenCalled();
  expect(subscriber.quit).not.toHaveBeenCalled();
});
