import { afterAll, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

afterAll(() => vi.unstubAllEnvs());

it('freezes read details at response finish rather than including later background work', async () => {
  for (const [key, value] of Object.entries({
    ADMIN_USERNAME: 'capture-test',
    ADMIN_PASSWORD: 'capture-test-password',
    DATABASE_DRIVER: 'memory',
    CACHE_DRIVER: 'memory',
    REDIS_URL: '',
    OBS_REDIS_URL: '',
    OBS_ALERT_WEBHOOK_URL: '',
    OBS_SAMPLE_RATE: '1',
  }))
    vi.stubEnv(key, value);
  const { initObservability, stopObservability, getHistory, observabilityMiddleware } =
    await import('../../src/services/observability/index.ts');
  const { getRequestLiveState, requestIdMiddleware, trackCacheRead, measureRequestStage } =
    await import('../../src/utils/requestContext.ts');
  const { parseRequestFilter } = await import('../../src/services/observability/history/types.ts');
  const { adminRouter } = await import('../../src/routes/admin.ts');
  const { issueSession, ADMIN_COOKIE } = await import('../../src/services/admin/auth.ts');
  await initObservability();
  const history = getHistory();
  try {
    if (!history) throw new Error('Memory history was not initialized');
    let finishBackground = () => {};
    let lateMisses: number | undefined;
    const backgroundFinished = new Promise<void>((resolve) => {
      finishBackground = resolve;
    });
    const app = express();
    app.use(requestIdMiddleware(), observabilityMiddleware());
    app.use('/api/admin', adminRouter);
    app.get('/catalog', async (_req, res) => {
      await measureRequestStage('addon_admission', async () => undefined);
      trackCacheRead('addon_response', 'freshHits');
      res.once('finish', () => {
        setImmediate(async () => {
          await measureRequestStage('imdb_throttle', async () => undefined);
          trackCacheRead('addon_response', 'misses');
          trackCacheRead('artwork', 'readErrors');
          lateMisses = getRequestLiveState()?.cacheReads.addon_response?.misses;
          finishBackground();
        });
      });
      res.json({ ok: true });
    });
    await request(app).get('/catalog').set('X-Request-Id', 'snapshot-test').expect(200);
    await backgroundFinished;
    expect(lateMisses).toBe(1);
    await stopObservability();
    const now = Date.now();
    const rows = await history.listRequests(
      { from: now - 60_000, to: now + 1000, kind: 'm' },
      parseRequestFilter({ requestId: 'snapshot-test' }),
      10
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      cache_hits: 1,
      cache_misses: 0,
      cache_reads: {
        addon_response: { freshHits: 1, staleHits: 0, misses: 0, cachedErrors: 0, readErrors: 0 },
      },
      timings: { addon_admission: { calls: 1, durationMs: expect.any(Number) } },
    });
    expect(rows.rows[0].timings).not.toHaveProperty('imdb_throttle');
    expect(rows.rows[0].cache_reads).not.toHaveProperty('artwork');
    const { token } = issueSession();
    const response = await request(app)
      .get('/api/admin/caching?range=1h')
      .set('X-Admin-Request', '1')
      .set('Cookie', `${ADMIN_COOKIE}=${token}`)
      .expect(200);
    expect(response.body.history).toMatchObject({
      backend: 'memory',
      liveBackend: 'memory',
      storage: { memory: { requests: 1, capacity: 10000 } },
    });
    expect(response.body.analytics.coverage).toMatchObject({
      retainedRequests: 1,
      detailedRequests: 1,
    });
    expect(response.body.analytics.details.totals).toMatchObject({
      freshHits: 1,
      misses: 0,
      readErrors: 0,
    });
    const caching = () =>
      request(app)
        .get('/api/admin/caching?range=1h')
        .set('X-Admin-Request', '1')
        .set('Cookie', `${ADMIN_COOKIE}=${token}`);
    const analytics = vi
      .spyOn(history, 'cacheStats')
      .mockRejectedValue(new Error('statement timeout'));
    const failedAnalytics = await caching().expect(200);
    expect(failedAnalytics.body.analytics).toBeNull();
    expect(failedAnalytics.body.history.storage.memory.requests).toBe(1);
    expect(failedAnalytics.body.historyErrors).toHaveLength(1);
    expect(failedAnalytics.body.ttls.length).toBeGreaterThan(0);
    analytics.mockRestore();
    const storage = vi
      .spyOn(history, 'storageInfo')
      .mockRejectedValue(new Error('storage query timeout'));
    const failedStorage = await caching().expect(200);
    expect(failedStorage.body.analytics.coverage.retainedRequests).toBe(1);
    expect(failedStorage.body.history.storage).toBeNull();
    expect(failedStorage.body.historyErrors).toHaveLength(1);
    const failedAgain = vi
      .spyOn(history, 'cacheStats')
      .mockRejectedValue(new Error('statement timeout'));
    const failedBoth = await caching().expect(200);
    expect(failedBoth.body.analytics).toBeNull();
    expect(failedBoth.body.history.storage).toBeNull();
    expect(failedBoth.body.historyErrors).toHaveLength(2);
    expect(failedBoth.body.ttls.length).toBeGreaterThan(0);
    storage.mockRestore();
    failedAgain.mockRestore();
  } finally {
    await stopObservability();
  }
});
