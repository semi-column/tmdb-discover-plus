import type { Request, Response, NextFunction } from 'express';
import { config } from '../../config.ts';
import { ADDON_VERSION } from '../../version.ts';
import { AppError, ErrorCodes } from '../../utils/AppError.ts';
import { createLogger, setLogSink } from '../../utils/logger.ts';
import { awaitRedisStartup } from '../../utils/redisConnection.ts';
import { runShutdownStage } from '../../utils/shutdown.ts';
import { getRequestLiveState } from '../../utils/requestContext.ts';
import { getStorage, getStorageDriver } from '../storage/index.ts';
import { Collector } from './collector.ts';
import { MemoryLiveStore, RedisLiveStore, type LiveStore } from './liveStore.ts';
import type { HistoryStore } from './history/types.ts';
import { MemoryHistory } from './history/memory.ts';
import { startUpstreamCapture } from './upstream.ts';
import { startSystemSampler } from './system.ts';
import { startHealthMonitor } from './health.ts';
import { classifyError, computeFingerprint, extractDetail, extractHttpStatus } from './errors.ts';
import { describePath } from './routeInfo.ts';
import {
  INSTANCE_ID,
  classifyClient,
  getClientIp,
  getColo,
  getCountry,
  getUserAgent,
  hashIdentifier,
} from './identity.ts';

const log = createLogger('obs');

const FLUSH_INTERVAL_MS = 5_000;
const MAINTENANCE_INTERVAL_MS = 5 * 60_000;
const SYSTEM_SAMPLE_INTERVAL_MS = 30_000;
const liveRedisUrl =
  config.observability.redisUrl || (config.cache.driver !== 'memory' ? config.cache.redisUrl : '');

const IGNORED_PREFIXES = ['/health', '/ready', '/assets/', '/static/', '/api/admin/', '/admin/'];
const IGNORED_EXACT = new Set(['/admin', '/api/admin', '/favicon.ico']);
const IGNORED_EXTENSIONS = /\.(?:js|css|map|png|jpg|jpeg|gif|svg|ico|webp|woff2?|txt)$/i;

const collector = new Collector({
  sampleRate: config.observability.sampleRate,
  slowMs: config.observability.slowMs,
  maxBuffer: config.observability.maxBuffer,
  hourTtlSec: (config.observability.retentionDays + 1) * 86_400,
});

let liveStore: LiveStore | null = null;
let historyStore: HistoryStore | null = null;
let liveConnected: Promise<LiveStore> | null = null;
const stoppers: Array<() => void> = [];
let started = false;
let alertingError: string | null = null;

export function getAlertingError() {
  return alertingError;
}

export function getCollectorStats() {
  return collector.stats;
}

export function getHistory(): HistoryStore | null {
  return historyStore;
}

export function getLiveStoreStatus(): {
  enabled: boolean;
  driver: 'redis' | 'memory' | null;
  connected: boolean | null;
} {
  if (!config.observability.enabled) return { enabled: false, driver: null, connected: null };
  return {
    enabled: true,
    driver: liveStore?.driver ?? (liveRedisUrl ? 'redis' : 'memory'),
    connected: liveStore instanceof RedisLiveStore ? liveStore.isReady : liveStore !== null,
  };
}

function connectLiveStore(): Promise<LiveStore> {
  liveConnected ??= (async () => {
    if (liveRedisUrl) {
      const store = new RedisLiveStore(liveRedisUrl);
      void awaitRedisStartup(store.connect()).catch((error) =>
        log.warn('Observability Redis unavailable; admin sessions remain fail-closed', {
          error: (error as Error).message,
        })
      );
      return store;
    }
    return new MemoryLiveStore();
  })()
    .then((store) => {
      liveStore = store;
      return store;
    })
    .catch((error) => {
      liveConnected = null;
      throw error;
    });
  return liveConnected;
}

/** Live store is also used by admin auth (lockout, revocation). */
export async function getLiveStore(): Promise<LiveStore> {
  const store = await connectLiveStore();
  if (store instanceof RedisLiveStore && !store.isReady) {
    throw new AppError(503, ErrorCodes.INTERNAL_ERROR, 'Observability store unavailable');
  }
  return store;
}

function shouldTrack(pathname: string): boolean {
  if (IGNORED_EXACT.has(pathname)) return false;
  if (IGNORED_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  return !IGNORED_EXTENSIONS.test(pathname);
}

export function observabilityMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Routers rewrite req.url while routing, so capture the full path up front.
    const pathname = req.path;
    if (!config.observability.enabled || !started || !shouldTrack(pathname)) return next();
    const state = getRequestLiveState();
    const startedAt = performance.now();
    const ts = Date.now();

    res.on('finish', () => {
      try {
        const routePath = req.route?.path;
        const expressRoute =
          typeof routePath === 'string' ? `${req.baseUrl || ''}${routePath}` : null;
        const info = describePath(pathname, expressRoute);
        const ua = getUserAgent(req);
        const userId =
          info.userId || (typeof req.params?.userId === 'string' ? req.params.userId : '');
        collector.recordRequest({
          ts,
          requestId: state?.requestId ?? '',
          instance: INSTANCE_ID,
          method: req.method,
          route: info.route,
          path: info.path,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
          resource: info.resource,
          source: info.source,
          contentType: info.contentType,
          catalogId: info.catalogId,
          userHash: hashIdentifier(userId),
          client: classifyClient(ua),
          ua,
          country: getCountry(req),
          colo: getColo(req),
          ipHash: hashIdentifier(getClientIp(req)),
          cacheHits: state?.cache.hits ?? 0,
          cacheMisses: state?.cache.misses ?? 0,
          cacheReads: state ? structuredClone(state.cacheReads) : undefined,
          timings: state ? structuredClone(state.timings) : undefined,
          upstreamCalls: state?.obs.upstreamCalls ?? 0,
          upstreamMs: state?.obs.upstreamMs ?? 0,
          errorFp: state?.obs.errorFingerprint ?? '',
        });
      } catch (err) {
        log.warn('Failed to record request', { error: err });
      }
    });
    next();
  };
}

function captureLog(
  level: 'warn' | 'error',
  context: string,
  message: string,
  data: Record<string, unknown> | null
): void {
  if (context.startsWith('obs') || context === 'swallowed') return;
  const { detail, stack } = extractDetail(data);
  const statusCode = extractHttpStatus(data);
  const classification = statusCode !== undefined ? `http:${statusCode}` : '';
  const fingerprint = computeFingerprint(level, context, message, detail, stack, classification);
  const state = getRequestLiveState();
  if (state && level === 'error' && !state.obs.errorFingerprint) {
    state.obs.errorFingerprint = fingerprint;
  }
  const pathname = state?.path.split('?')[0] ?? '';
  collector.recordError({
    ts: Date.now(),
    fingerprint,
    level,
    context: context.slice(0, 64),
    message: (detail ? `${message}: ${detail}` : message).slice(0, 1000),
    stack,
    requestId: state?.requestId ?? '',
    instance: INSTANCE_ID,
    route: pathname ? describePath(pathname).route : '',
    classification: classifyError(message, data),
  });
}

export async function initObservability(): Promise<void> {
  if (!config.observability.enabled || started) return;
  started = true;

  let live: LiveStore;
  try {
    live = await connectLiveStore();
  } catch (error) {
    started = false;
    throw error;
  }
  setLogSink(captureLog);
  stoppers.push(() => setLogSink(null));
  stoppers.push(startUpstreamCapture((event) => collector.recordUpstream(event)));

  collector.setLiveStore(live);
  try {
    stoppers.push(startHealthMonitor(live, config.observability.alertWebhookUrl));
  } catch (error) {
    alertingError = error instanceof Error ? error.message : String(error);
    log.error('Invalid alert webhook; collection and local health logging remain active', {
      error,
    });
    stoppers.push(startHealthMonitor(live, ''));
  }

  const flushTimer = setInterval(() => void collector.flush(), FLUSH_INTERVAL_MS);
  flushTimer.unref();
  stoppers.push(() => clearInterval(flushTimer));

  stoppers.push(
    startSystemSampler(
      SYSTEM_SAMPLE_INTERVAL_MS,
      () => ({ version: ADDON_VERSION, collector: structuredClone(collector.stats) }),
      (data) => {
        collector.recordSystem({ ts: Date.now(), instance: INSTANCE_ID, data });
        live
          .heartbeat(INSTANCE_ID, { ts: Date.now(), ...data })
          .catch((error) => log.warn('Instance heartbeat failed', { error }));
      }
    )
  );

  const history = await openHistory();
  historyStore = history;
  collector.setHistory(history);
  const runMaintenance = () =>
    history
      .maintain()
      .catch((err) => log.warn('Maintenance failed', { error: (err as Error).message }));
  void runMaintenance();
  const maintTimer = setInterval(runMaintenance, MAINTENANCE_INTERVAL_MS);
  maintTimer.unref();
  stoppers.push(() => clearInterval(maintTimer));

  log.info('Observability started', {
    instance: INSTANCE_ID,
    live: live.driver,
    history: history.kind,
    sampleRate: config.observability.sampleRate,
    trustCloudflareHeaders: config.trustCloudflareHeaders,
  });
}

function memoryHistory(): MemoryHistory {
  return new MemoryHistory({
    maxEvents: config.observability.memoryEvents,
    retentionDays: config.observability.retentionDays,
    version: ADDON_VERSION,
    loadConfigs: async () => (await getStorage().getAllConfigs?.()) ?? [],
  });
}

/** History lives in whatever database the app already uses; falls back to memory if that fails. */
async function openHistory(): Promise<HistoryStore> {
  const opts = {
    retentionDays: config.observability.retentionDays,
    capMb: config.observability.maxStorageMb,
    version: ADDON_VERSION,
  };
  const driver = getStorageDriver();
  let store: HistoryStore | null = null;
  try {
    if (driver === 'postgres') {
      const { PostgresHistory } = await import('./history/postgres.ts');
      store = new PostgresHistory(config.database.postgresUri, opts);
    } else if (driver === 'mongo') {
      const { MongoHistory } = await import('./history/mongo.ts');
      store = new MongoHistory(opts);
    }
    if (store) {
      await store.init();
      return store;
    }
  } catch (err) {
    log.warn('Observability history init failed; using in-memory history', {
      driver,
      error: (err as Error).message,
    });
    await store?.close().catch(() => undefined);
  }
  return memoryHistory();
}

export async function stopObservability(): Promise<void> {
  if (!started) return;
  started = false;
  for (const stop of stoppers.splice(0)) stop();
  const flushed = await runShutdownStage('observability-flush', 1_000, () => collector.flush());
  const closed = await Promise.all([
    runShutdownStage('observability-history', 3_000, () => historyStore?.close()),
    runShutdownStage('observability-live', 3_000, () => liveStore?.close()),
  ]);
  if (!flushed || closed.some((ok) => !ok)) {
    throw new Error('Observability shutdown did not complete cleanly');
  }
}
