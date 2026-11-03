import {
  CACHE_TTLS,
  CACHE_ERROR_TTLS,
  LOCAL_CACHE_TTLS,
  IMDB_CACHE_TTL_DEFAULTS,
  CACHE_STORAGE,
} from '../../cacheTtls.ts';
import { config } from '../../config.ts';
import { REJECTED_CREDENTIAL_TTL_MS } from '../../utils/rejectedCredentials.ts';

/** Read-only inventory of runtime policy, never cache keys, payloads, or credentials. */
export function cachePolicy() {
  const rows = (scope: string, values: Record<string, number>, divisor = 1) =>
    Object.entries(values).map(([name, value]) => ({ scope, name, seconds: value / divisor }));
  return {
    ttls: [
      ...rows('Shared cache / HTTP', CACHE_TTLS),
      ...rows('Cached errors / negative results', CACHE_ERROR_TTLS),
      ...rows('Process-local (not included in lookup metrics)', LOCAL_CACHE_TTLS, 1000),
      ...rows('IMDb (effective runtime values)', {
        DEFAULT_REQUEST: IMDB_CACHE_TTL_DEFAULTS.DEFAULT_REQUEST,
        SEARCH: config.imdbApi.cacheTtlSearch,
        DETAIL: config.imdbApi.cacheTtlDetail,
        RANKING: config.imdbApi.cacheTtlRanking,
        POPULAR: config.imdbApi.cacheTtlPopular,
        LIST: config.imdbApi.cacheTtlList,
        REFERENCE: config.imdbApi.cacheTtlReference,
        SUGGESTIONS: IMDB_CACHE_TTL_DEFAULTS.SUGGESTIONS,
      }),
      ...rows(
        'Process-local (not included in lookup metrics)',
        {
          REJECTED_CREDENTIAL: REJECTED_CREDENTIAL_TTL_MS,
        },
        1000
      ),
      ...rows('Cache storage defaults', {
        MEMORY_DEFAULT_TTL: CACHE_STORAGE.MEMORY_DEFAULT_TTL,
        MEMORY_CHECK_PERIOD: CACHE_STORAGE.MEMORY_CHECK_PERIOD,
      }),
    ],
    lifecycle: {
      wrapperRetentionMultiplier: CACHE_STORAGE.WRAPPER_RETENTION_MULTIPLIER,
      wrapperStaleMultiplier: CACHE_STORAGE.WRAPPER_STALE_MULTIPLIER,
      imdbRetentionMultiplier: CACHE_STORAGE.IMDB_RESPONSE_RETENTION_MULTIPLIER,
      imdbAdvancedSearchDivisor: CACHE_STORAGE.IMDB_ADVANCED_SEARCH_TTL_DIVISOR,
    },
  };
}
