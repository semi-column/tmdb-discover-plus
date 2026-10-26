import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getCacheStatus } from '../cache/index.ts';
import { getCircuitBreakerState } from '../tmdb/client.ts';
import { getImdbCircuitBreakerState } from '../imdb/client.ts';
import { getTmdbThrottle } from '../../infrastructure/tmdbThrottle.ts';
import { getConfigCache } from '../../infrastructure/configCache.ts';
import { logSwallowedError } from '../../utils/helpers.ts';

const MB = 1024 * 1024;

export function startSystemSampler(
  intervalMs: number,
  extra: () => Record<string, unknown>,
  onSample: (data: Record<string, unknown>) => void
): () => void {
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  let lastCpu = process.cpuUsage();
  let lastAt = performance.now();

  const sample = () => {
    try {
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage(lastCpu);
      const elapsedMs = performance.now() - lastAt;
      lastCpu = process.cpuUsage();
      lastAt = performance.now();

      const safe = <T>(fn: () => T): T | null => {
        try {
          return fn();
        } catch {
          return null;
        }
      };

      onSample({
        heapUsedMb: Math.round(mem.heapUsed / MB),
        heapTotalMb: Math.round(mem.heapTotal / MB),
        rssMb: Math.round(mem.rss / MB),
        externalMb: Math.round(mem.external / MB),
        cpuPct: Math.round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 1000) / 10,
        eventLoop: {
          meanMs: Math.round(loop.mean / 1e4) / 100,
          p50Ms: Math.round(loop.percentile(50) / 1e4) / 100,
          p99Ms: Math.round(loop.percentile(99) / 1e4) / 100,
          maxMs: Math.round(loop.max / 1e4) / 100,
        },
        uptimeSec: Math.round(process.uptime()),
        cache: safe(() => getCacheStatus()),
        configCache: safe(() => getConfigCache().getStats()),
        tmdbThrottle: safe(() => getTmdbThrottle().getStats()),
        tmdbCircuit: safe(() => getCircuitBreakerState()),
        imdbCircuit: safe(() => getImdbCircuitBreakerState()),
        ...extra(),
      });
      loop.reset();
    } catch (err) {
      logSwallowedError('obs:system-sample', err);
    }
  };

  const timer = setInterval(sample, intervalMs);
  timer.unref();
  setTimeout(sample, 2000).unref();

  return () => {
    clearInterval(timer);
    loop.disable();
  };
}
