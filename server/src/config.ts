import 'dotenv/config';

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

export const config = Object.freeze({
  port: envInt('PORT', 7000),
  nodeEnv: env('NODE_ENV', 'production'),
  baseUrl: env('BASE_URL'),

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
    maxKeys: envInt('CACHE_MAX_KEYS', 50000),
    versionOverride: env('CACHE_VERSION_OVERRIDE'),
    warmRegions: env('CACHE_WARM_REGIONS', 'US,GB,DE,FR,ES')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean),
  }),

  tmdb: Object.freeze({
    apiKey: env('TMDB_API_KEY'),
    rateLimit: envInt('TMDB_RATE_LIMIT', 35),
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
    cacheTtlSearch: envInt('IMDB_CACHE_TTL_SEARCH', 86400),
    cacheTtlDetail: envInt('IMDB_CACHE_TTL_DETAIL', 604800),
    cacheTtlRanking: envInt('IMDB_CACHE_TTL_RANKING', 86400),
    cacheTtlPopular: envInt('IMDB_CACHE_TTL_POPULAR', 21600),
    cacheTtlList: envInt('IMDB_CACHE_TTL_LIST', 21600),
    cacheTtlReference: envInt('IMDB_CACHE_TTL_REFERENCE', 2592000),
    budgetMonthly: envInt('IMDB_BUDGET_MONTHLY', 500000),
    budgetWarnPercent: envInt('IMDB_BUDGET_WARN_PERCENT', 80),
    budgetLimitPercent: envInt('IMDB_BUDGET_LIMIT_PERCENT', 95),
  }),

  rpdb: Object.freeze({
    apiKey: env('RPDB_API_KEY'),
  }),

  logging: Object.freeze({
    level: env('LOG_LEVEL', 'info').toLowerCase(),
    format: env('LOG_FORMAT', 'text'),
  }),

  features: Object.freeze({
    disableRateLimit:
      envBool('DISABLE_RATE_LIMIT') &&
      ['development', 'test'].includes(env('NODE_ENV', 'production')),
    disableMetrics: envBool('DISABLE_METRICS'),
  }),

  trustProxy: env('TRUST_PROXY', '1'),

  addon: Object.freeze({
    variant: env('ADDON_VARIANT'),
  }),
});

export type Config = typeof config;
