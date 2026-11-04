import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('closes both stores after a stuck flush instead of waiting on Redis indefinitely', async () => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    CACHE_DRIVER: 'memory',
    DATABASE_DRIVER: 'memory',
    REDIS_URL: '',
    OBS_REDIS_URL: '',
    ADMIN_USERNAME: 'shutdown-fixture',
    ADMIN_PASSWORD: 'shutdown-fixture-password',
    ADMIN_PASSWORD_HASH: '',
    OBS_ALERT_WEBHOOK_URL: '',
  }))
    vi.stubEnv(name, value);
  const { Collector } = await import('../../src/services/observability/collector.ts');
  const pending = Promise.withResolvers<void>();
  vi.spyOn(Collector.prototype, 'flush').mockReturnValue(pending.promise);
  const { initObservability, stopObservability, getLiveStore, getHistory } =
    await import('../../src/services/observability/index.ts');
  await initObservability();
  vi.useFakeTimers();
  const live = await getLiveStore();
  const history = getHistory();
  if (!history) throw new Error('Expected isolated memory history');
  const closeLive = vi.spyOn(live, 'close');
  const closeHistory = vi.spyOn(history, 'close').mockReturnValue(new Promise(() => {}));
  const result = stopObservability().catch((error) => error);
  await vi.advanceTimersByTimeAsync(999);
  expect(closeLive).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(closeLive).toHaveBeenCalledOnce();
  expect(closeHistory).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(3000);
  expect(await result).toMatchObject({
    message: 'Observability shutdown did not complete cleanly',
  });
  await stopObservability();
  expect(closeLive).toHaveBeenCalledOnce();
  pending.reject(new Error('Redis connection closed'));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
});
