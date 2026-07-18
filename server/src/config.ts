import 'dotenv/config';
import { IMDB_CACHE_TTL_DEFAULTS } from './cacheTtls.ts';

const env = (key: string, fallback?: string): string => process.env[key] ?? fallback ?? '';

const envInt = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const envBool = (key: string, fallback = false): boolean => {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw === 'true' || raw === '1';
};

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Required environment variable ${key} is not set`);
  return value;
};

const addonVariant = env('ADDON_VARIANT');
const isNightlyVariant = addonVariant === 'nightly';

const envIntWithNightlyDefault = (
  key: string,
  standardFallback: number,
  nightlyFallback: number
): number => envInt(key, isNightlyVariant ? nightlyFallback : standardFallback);

const envCsv = (key: string, fallback: string): string[] =>
  env(key, fallback)
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

export const config = Object.freeze({
  port: envInt('PORT', 7000),
  nodeEnv: env('NODE_ENV', 'production'),
  baseUrl: env('BASE_URL'),
  jsonBodyLimit: env('JSON_BODY_LIMIT', '512kb'),

  cors: Object.freeze({
    origin: env('CORS_ORIGIN', '*'),
    allowCredentials: envBool('CORS_ALLOW_CREDENTIALS'),
  }),

  jwt: Object.freeze({
    get secret(): string {
      return requireEnv('JWT_SECRET');
    },
  }),

  encryption: Object.freeze({
    get key(): string {
      const value = requireEnv('ENCRYPTION_KEY');
      if (!/^[0-9a-fA-F]{64}$/.test(value)) {
        throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
      }
      return value;
    },
  }),

  database: Object.freeze({
    driver: env('DATABASE_DRIVER'),
    postgresUri: env('POSTGRES_URI'),
    mongodbUri: env('MONGODB_URI'),
    databaseUrl: env('DATABASE_URL'),
  }),

  cache: Object.freeze({
    driver: env('CACHE_DRIVER'),
    redisUrl: env('REDIS_URL'),
    maxKeys: envIntWithNightlyDefault('CACHE_MAX_KEYS', 20000, 6000),
    versionOverride: env('CACHE_VERSION_OVERRIDE'),
    warmRegions: envCsv('CACHE_WARM_REGIONS', isNightlyVariant ? 'US' : 'US,GB,DE,FR,ES'),
  }),

  tmdb: Object.freeze({
    apiKey: env('TMDB_API_KEY'),
    rateLimit: envIntWithNightlyDefault('TMDB_RATE_LIMIT', 35, 12),
    disableTlsVerify: envBool('DISABLE_TLS_VERIFY'),
    debug: envBool('DEBUG_TMDB'),
  }),

  imdbRatings: Object.freeze({
    disabled: envBool('IMDB_RATINGS_DISABLED'),
    updateIntervalHours: envInt('IMDB_RATINGS_UPDATE_HOURS', 24),
    minVotes: envInt('IMDB_MIN_VOTES', 100),
  }),

  imdbApi: Object.freeze({
    apiKey: env('IMDB_DATA_KEY'),
    apiHost: env('IMDB_DATA_HOST'),
    apiKeyHeader: env('IMDB_DATA_ATTR_K'),
    apiHostHeader: env('IMDB_DATA_ATTR_H'),
    rateLimit: envInt('IMDB_DATA_RATE_LIMIT', 5),
    get enabled(): boolean {
      const explicit = process.env['IMDB_DATA_ENABLED'];
      if (explicit) return explicit === 'true' || explicit === '1';
      return !!process.env['IMDB_DATA_KEY'];
    },
    cacheTtlSearch: envInt('IMDB_CACHE_TTL_SEARCH', IMDB_CACHE_TTL_DEFAULTS.SEARCH),
    cacheTtlDetail: envInt('IMDB_CACHE_TTL_DETAIL', IMDB_CACHE_TTL_DEFAULTS.DETAIL),
    cacheTtlRanking: envInt('IMDB_CACHE_TTL_RANKING', IMDB_CACHE_TTL_DEFAULTS.RANKING),
    cacheTtlPopular: envInt('IMDB_CACHE_TTL_POPULAR', IMDB_CACHE_TTL_DEFAULTS.POPULAR),
    cacheTtlList: envInt('IMDB_CACHE_TTL_LIST', IMDB_CACHE_TTL_DEFAULTS.LIST),
    cacheTtlReference: envInt('IMDB_CACHE_TTL_REFERENCE', IMDB_CACHE_TTL_DEFAULTS.REFERENCE),
  }),

  rpdb: Object.freeze({
    apiKey: env('RPDB_API_KEY', 't0-free-rpdb'),
  }),

  topPosters: Object.freeze({
    apiKey: env('TOP_POSTERS_API_KEY'),
  }),

  fanart: Object.freeze({
    apiKey: env('FANART_API_KEY'),
  }),

  malApi: Object.freeze({
    clientId: env('MAL_CLIENT_ID'),
    rateLimit: envInt('MAL_RATE_LIMIT', 3),
    get enabled(): boolean {
      return !!process.env['MAL_CLIENT_ID'];
    },
  }),

  simklApi: Object.freeze({
    clientId: env('SIMKL_CLIENT_ID'),
    rateLimit: envInt('SIMKL_RATE_LIMIT', 5),
    get enabled(): boolean {
      return !!process.env['SIMKL_CLIENT_ID'];
    },
  }),

  traktApi: Object.freeze({
    clientId: env('TRAKT_CLIENT_ID'),
    clientSecret: env('TRAKT_CLIENT_SECRET'),
    rateLimit: envInt('TRAKT_RATE_LIMIT', 3),
    get enabled(): boolean {
      return !!process.env['TRAKT_CLIENT_ID'];
    },
  }),

  logging: Object.freeze({
    level: env('LOG_LEVEL', 'info').toLowerCase(),
    format: env('LOG_FORMAT', 'text'),
  }),

  features: Object.freeze({
    disableRateLimit:
      envBool('DISABLE_RATE_LIMIT') &&
      ['development', 'test'].includes(env('NODE_ENV', 'production')),
  }),

  trustProxy: env('TRUST_PROXY', '1'),

  addon: Object.freeze({
    variant: addonVariant,
    isNightly: isNightlyVariant,
  }),
});

export type Config = typeof config;

export function validateRequiredConfig(): void {
  config.jwt.secret;
  config.encryption.key;
}
