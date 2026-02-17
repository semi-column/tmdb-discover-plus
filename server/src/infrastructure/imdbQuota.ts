import { createLogger } from '../utils/logger.ts';
import { config } from '../config.ts';
import { getCache } from '../services/cache/index.ts';

const log = createLogger('ImdbQuota');

interface QuotaState {
  requestsToday: number;
  requestsThisMonth: number;
  requestsTotal: number;
  lastResetDay: number;
  lastResetMonth: number;
  perEndpoint: Record<string, number>;
  warnEmitted: boolean;
  limitEmitted: boolean;
}

const state: QuotaState = {
  requestsToday: 0,
  requestsThisMonth: 0,
  requestsTotal: 0,
  lastResetDay: new Date().getUTCDate(),
  lastResetMonth: new Date().getUTCMonth(),
  perEndpoint: {},
  warnEmitted: false,
  limitEmitted: false,
};

function getQuotaCacheKey(): string {
  const now = new Date();
  return `imdb:quota:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function persistQuota(): void {
  try {
    const cache = getCache();
    cache.set(getQuotaCacheKey(), state.requestsThisMonth, 86400 * 35).catch(() => {});
  } catch {
    // cache not ready yet
  }
}

export async function initImdbQuota(): Promise<void> {
  try {
    const cache = getCache();
    const persisted = await cache.get(getQuotaCacheKey());
    if (typeof persisted === 'number' && persisted > state.requestsThisMonth) {
      state.requestsThisMonth = persisted;
      log.info('Restored IMDb quota from cache', { requestsThisMonth: persisted });
    }
  } catch {
    // cache not available at startup
  }
}

function checkResets(): void {
  const now = new Date();
  const currentDay = now.getUTCDate();
  const currentMonth = now.getUTCMonth();

  if (currentDay !== state.lastResetDay) {
    state.requestsToday = 0;
    state.lastResetDay = currentDay;
  }

  if (currentMonth !== state.lastResetMonth) {
    state.requestsThisMonth = 0;
    state.lastResetMonth = currentMonth;
    state.perEndpoint = {};
    state.warnEmitted = false;
    state.limitEmitted = false;
  }
}

export function recordImdbApiCall(endpoint: string): void {
  checkResets();
  state.requestsToday++;
  state.requestsThisMonth++;
  state.requestsTotal++;
  state.perEndpoint[endpoint] = (state.perEndpoint[endpoint] || 0) + 1;
  persistQuota();

  const budget = config.imdbApi.budgetMonthly;
  const warnThreshold = Math.floor((budget * config.imdbApi.budgetWarnPercent) / 100);
  const limitThreshold = Math.floor((budget * config.imdbApi.budgetLimitPercent) / 100);

  if (!state.warnEmitted && state.requestsThisMonth >= warnThreshold) {
    state.warnEmitted = true;
    log.warn('IMDb API budget warning threshold reached', {
      used: state.requestsThisMonth,
      budget,
      percent: config.imdbApi.budgetWarnPercent,
    });
  }

  if (!state.limitEmitted && state.requestsThisMonth >= limitThreshold) {
    state.limitEmitted = true;
    log.warn('IMDb API budget HARD LIMIT reached — new requests will be rejected', {
      used: state.requestsThisMonth,
      budget,
      percent: config.imdbApi.budgetLimitPercent,
    });
  }
}

export function isQuotaExceeded(): boolean {
  checkResets();
  const budget = config.imdbApi.budgetMonthly;
  const limitThreshold = Math.floor((budget * config.imdbApi.budgetLimitPercent) / 100);
  return state.requestsThisMonth >= limitThreshold;
}

export function getImdbQuotaStats(): {
  requestsToday: number;
  requestsThisMonth: number;
  requestsTotal: number;
  budgetMonthly: number;
  budgetUsedPercent: string;
  quotaExceeded: boolean;
  perEndpoint: Record<string, number>;
} {
  checkResets();
  const budget = config.imdbApi.budgetMonthly;
  return {
    requestsToday: state.requestsToday,
    requestsThisMonth: state.requestsThisMonth,
    requestsTotal: state.requestsTotal,
    budgetMonthly: budget,
    budgetUsedPercent:
      budget > 0 ? ((state.requestsThisMonth / budget) * 100).toFixed(2) + '%' : 'N/A',
    quotaExceeded: isQuotaExceeded(),
    perEndpoint: { ...state.perEndpoint },
  };
}

export function resetImdbQuota(): void {
  state.requestsToday = 0;
  state.requestsThisMonth = 0;
  state.requestsTotal = 0;
  state.perEndpoint = {};
  state.warnEmitted = false;
  state.limitEmitted = false;
}
