import { rateLimit, ipKeyGenerator, type Options } from 'express-rate-limit';
import { createLogger } from './logger.ts';
import { awaitRedisCommand, redisRecoveryOptions } from './redisConnection.ts';
import { AppError, ErrorCodes } from './AppError.ts';
import { TIMEOUTS } from '../constants.ts';
import { config } from '../config.ts';
import type { RedisClientType } from 'redis';
import type { Request, Response, NextFunction } from 'express';

const log = createLogger('rateLimit');

let createStore: ((prefix: string) => Options['store']) | null = null;
let rateLimitRedis: RedisClientType | undefined;

export function destroyRateLimitRedis(): void {
  const client = rateLimitRedis;
  rateLimitRedis = undefined;
  if (client?.isOpen) client.destroy();
}

export function getRateLimitStatus(): {
  driver: 'redis' | 'memory';
  connected: boolean;
  degraded: boolean;
} {
  const driver = createStore ? 'redis' : 'memory';
  const connected = driver === 'redis' && Boolean(rateLimitRedis?.isReady);
  return {
    driver,
    connected,
    degraded: Boolean(config.cache.redisUrl) && !config.features.disableRateLimit && !connected,
  };
}

if (config.cache.redisUrl) {
  try {
    const { RedisStore } = await import('rate-limit-redis');
    const { createClient } = await import('redis');
    const redisClient = createClient({
      url: config.cache.redisUrl,
      commandOptions: { timeout: TIMEOUTS.REDIS_STARTUP_MS },
      ...redisRecoveryOptions(),
    });
    rateLimitRedis = redisClient;
    redisClient.on('error', (err: Error) =>
      log.warn('Redis rate-limit client error', { error: err.message })
    );
    // Don't block startup or fall back to per-pod memory limits: keep retrying in the
    // background while /ready and the request gate fail closed until Redis is ready.
    redisClient.connect().then(
      () => log.info('Rate-limit Redis connected'),
      (error: Error) => log.warn('Rate-limit Redis connection stopped', { error: error.message })
    );
    class RecoverableRedisStore extends RedisStore {
      // Scripts reload on first use, so a store created before Redis is ready is fine.
      async init(options: Options) {
        try {
          await super.init(options);
        } catch {
          // Reloaded by ensureScript on first use.
        }
      }

      private async ensureScript(
        field: 'incrementScriptSha' | 'getScriptSha',
        load: () => Promise<string>
      ): Promise<void> {
        const previous = this[field];
        try {
          await previous;
        } catch {
          if (this[field] === previous) this[field] = load();
          await this[field];
        }
      }

      async increment(key: string) {
        await this.ensureScript('incrementScriptSha', () => this.loadIncrementScript());
        return super.increment(key);
      }

      async get(key: string) {
        await this.ensureScript('getScriptSha', () => this.loadGetScript());
        return super.get(key);
      }
    }

    createStore = (prefix: string) => {
      return new RecoverableRedisStore({
        sendCommand: async (...args: string[]) => {
          try {
            return await awaitRedisCommand(redisClient.sendCommand(args));
          } catch (error) {
            if (error instanceof Error && /^NOSCRIPT(?:\s|$)/.test(error.message)) throw error;
            log.warn('Redis rate-limit command failed', { error: (error as Error).message });
            throw new AppError(
              503,
              ErrorCodes.RATE_LIMIT_UNAVAILABLE,
              'Request limiting unavailable'
            );
          }
        },
        prefix,
      });
    };
    log.info('Rate limiting backed by Redis');
  } catch (err) {
    destroyRateLimitRedis();
    log.warn('Redis rate-limit store unavailable, using in-memory', {
      error: (err as Error).message,
    });
  }
}

function skipRateLimit(req: Request): boolean {
  if (config.features.disableRateLimit) return true;

  const isDevOrTest = config.nodeEnv === 'development' || config.nodeEnv === 'test';
  const ip = req.ip;
  const isLocalhost =
    ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === '::ffff:127.0.0.1';

  return isDevOrTest && isLocalhost;
}

export function rateLimitRedisUnavailable(req: Request): boolean {
  return !skipRateLimit(req) && createStore !== null && !rateLimitRedis?.isReady;
}

function rejectRateLimit(
  req: Request,
  res: Response,
  policy: string,
  limit: number | string,
  resetTime?: Date,
  message = 'Rate limit exceeded'
): void {
  const retryAfter = Math.max(
    1,
    Math.ceil(((resetTime?.getTime() ?? Date.now() + 60_000) - Date.now()) / 1000)
  );
  log.warn('Rate limit exceeded', {
    ip: req.ip,
    url: req.originalUrl,
    policy,
    limit,
    userIdPrefix: req.params.userId?.slice(0, 8),
  });
  res.set('Cache-Control', 'no-store');
  res.set('Retry-After', String(retryAfter));
  res.status(429).json({ error: message, policy, retryAfter });
}

const baseOptions: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: true,
  validate: { trustProxy: true },
  skip: skipRateLimit,
  handler: (req, res, _next, options) => {
    const retryAfter = Number(res.getHeader('Retry-After'));
    rejectRateLimit(
      req,
      res,
      options.requestPropertyName,
      String(options.limit),
      Number.isFinite(retryAfter) ? new Date(Date.now() + retryAfter * 1000) : undefined,
      typeof options.message === 'string' ? options.message : undefined
    );
  },
};

const withStore = (prefix: string): Partial<Options> =>
  createStore ? { store: createStore(prefix) } : {};

/**
 * Rate limit for sensitive endpoints (login, config creation)
 */
export const strictRateLimit = rateLimit({
  ...baseOptions,
  ...withStore('rl:strict:'),
  windowMs: 60 * 1000, // 1 minute
  limit: 60,
  requestPropertyName: 'strict',
  message: 'Too many requests to this endpoint, please try again later',
});

/**
 * Standard rate limit for API endpoints
 */
export const apiRateLimit = rateLimit({
  ...baseOptions,
  ...withStore('rl:api:'),
  windowMs: 60 * 1000,
  limit: 300,
  requestPropertyName: 'api',
  skip: (req) =>
    skipRateLimit(req) ||
    /^\/[^/]+\/(?:manifest\.json|(?:catalog|meta)\/[^/]+\/[^/]+(?:\/[^/]+)?\.json)\/?$/i.test(
      req.path
    ),
  message: 'Too many API requests, please try again later',
});

/**
 * Hard IP ceiling, including cache hits and requests with made-up IDs.
 */
export const addonRateLimit = rateLimit({
  ...baseOptions,
  ...withStore('rl:addon:'),
  windowMs: 60 * 1000,
  limit: 3000,
  requestPropertyName: 'addonIp',
  message: 'Rate limit exceeded',
});

export const addonUserRateLimit = rateLimit({
  ...baseOptions,
  ...withStore('rl:addon-user:'),
  windowMs: 60 * 1000,
  limit: 1000,
  requestPropertyName: 'addonUser',
  keyGenerator: (req) => {
    const userId = req.params.userId;
    if (typeof userId !== 'string') throw new Error('Addon limiter requires a validated user ID');
    return userId;
  },
});

export const invalidAddonRateLimit = rateLimit({
  ...baseOptions,
  ...withStore('rl:addon-invalid:'),
  windowMs: 60 * 1000,
  limit: 30,
  requestPropertyName: 'addonInvalid',
});

// Check the invalid-ID budget before touching storage; only missing/invalid IDs increment it.
export async function checkInvalidAddonRateLimit(req: Request, res: Response, next: NextFunction) {
  if (skipRateLimit(req)) return next();
  try {
    const entry = await invalidAddonRateLimit.getKey(ipKeyGenerator(req.ip || ''));
    if (
      entry &&
      entry.totalHits >= 30 &&
      (!entry.resetTime || entry.resetTime.getTime() > Date.now())
    ) {
      return rejectRateLimit(req, res, 'addonInvalid', 30, entry.resetTime);
    }
    next();
  } catch (error) {
    next(error);
  }
}

export const monitoringRateLimit = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: 30,
  requestPropertyName: 'monitoring',
  message: 'Too many monitoring requests, please try again later',
});

export const readinessRateLimit = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: 300,
  requestPropertyName: 'api',
  message: 'Too many API requests, please try again later',
});
