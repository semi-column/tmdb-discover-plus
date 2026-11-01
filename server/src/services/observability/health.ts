import { createLogger } from '../../utils/logger.ts';
import { liveOverview, liveUpstreams } from './liveQueries.ts';
import type { LiveStore } from './liveStore.ts';

const log = createLogger('obs:health');
export const HEALTH_RULES = [
  { field: 'errors5xx', threshold: 0.01, label: '5xx responses' },
  { field: 'errors4xx', threshold: 0.05, label: '4xx responses (inspect route/client)' },
  { field: 'slow', threshold: 0.15, label: 'Slow responses' },
] as const;

interface HealthSeries {
  t: number[];
  requests: number[];
  errors5xx: number[];
  errors4xx: number[];
  slow: number[];
}

export function findIncidents(series: HealthSeries, bucketMs: number) {
  return HEALTH_RULES.flatMap((rule) => {
    const incidents: Array<{
      kind: string;
      label: string;
      from: number;
      to: number;
      affected: number;
      requests: number;
    }> = [];
    series.t.forEach((time, i) => {
      const requests = series.requests[i];
      const affected = series[rule.field][i];
      if (requests < 20 || affected / requests <= rule.threshold) return;
      const from = time * 1000;
      const last = incidents.at(-1);
      if (last && last.to === from) {
        last.to += bucketMs;
        last.requests += requests;
        last.affected += affected;
      } else {
        incidents.push({
          kind: rule.field,
          label: rule.label,
          from,
          to: from + bucketMs,
          affected,
          requests,
        });
      }
    });
    return incidents;
  }).sort((a, b) => b.from - a.from);
}

export function deploymentMarkers(rows: Record<string, unknown>[]) {
  const starts = new Map<string, { at: number; label: string; estimated: boolean }>();
  for (const row of rows) {
    const data = row.data;
    if (!data || typeof data !== 'object') continue;
    const sample = data as Record<string, unknown>;
    const bucket = new Date(String(row.bucket)).getTime();
    const explicit = Number(sample.startedAt);
    const at =
      Number.isFinite(explicit) && explicit > 0
        ? explicit
        : bucket - Number(sample.uptimeSec) * 1000;
    if (!Number.isFinite(at)) continue;
    const key = `${row.instance}:${sample.version}:${explicit || 'legacy'}`;
    if (!starts.has(key))
      starts.set(key, {
        at,
        label: `v${sample.version ?? '?'} · ${row.instance}`,
        estimated: !explicit,
      });
  }
  return [...starts.values()].sort((a, b) => a.at - b.at);
}

/** Evaluates completed minutes even when no dashboard is open. No request paths leave the app. */
export function startHealthMonitor(live: LiveStore, webhook: string): () => void {
  if (webhook) {
    const url = new URL(webhook);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('OBS_ALERT_WEBHOOK_URL must be an HTTPS URL without embedded credentials');
    }
  }
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const to = Math.floor(Date.now() / 60_000) * 60_000 - 1;
      const range = { from: to + 1 - 5 * 60_000, to, kind: 'm' as const };
      const [overview, upstreams] = await Promise.all([
        liveOverview(live, range),
        liveUpstreams(live, range),
      ]);
      const incidents = findIncidents(overview.series, 60_000);
      const rateLimited = upstreams
        .filter((provider) => provider.rateLimited > 0)
        .map(({ provider, rateLimited }) => ({ provider, rateLimited }));
      if (!incidents.length && !rateLimited.length) return;
      const key = 'health:notification';
      if ((await live.incr(key, 300)) !== 1) return;
      const payload = {
        from: range.from,
        to,
        scope: live.driver === 'redis' ? 'shared' : 'instance',
        incidents,
        rateLimited,
      };
      try {
        log.warn('Observability health thresholds exceeded', payload);
        if (webhook) {
          const response = await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
            redirect: 'error',
          });
          if (!response.ok) throw new Error(`Alert webhook returned HTTP ${response.status}`);
          await response.body?.cancel();
        }
      } catch (error) {
        await live.del(key);
        throw error;
      }
    } catch (error) {
      log.error('Health evaluation or alert delivery failed', { error });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void check(), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
