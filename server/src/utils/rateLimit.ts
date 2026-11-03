import { rateLimit, ipKeyGenerator, type Options } from 'express-rate-limit';
import { createLogger } from './logger.ts';
import { config } from '../config.ts';
import type { Request, Response, NextFunction } from 'express';

const log = createLogger('rateLimit');

let createStore: ((prefix: string) => Options['store']) | null = null;

if (config.cache.redisUrl) {
  try {
    const { RedisStore } = await import('rate-limit-redis');
    const { createClient } = await import('redis');
    const redisClient = createClient({ url: config.cache.redisUrl });
    await redisClient.connect();
    createStore = (prefix: string) =>
      new RedisStore({
        sendCommand: (...args: string[]) => redisClient.sendCommand(args),
        prefix,
      });
    log.info('Rate limiting backed by Redis');
  } catch (err) {
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
  ...withStore('rl:monitor:'),
  windowMs: 60 * 1000,
  limit: 30,
  requestPropertyName: 'monitoring',
  message: 'Too many monitoring requests, please try again later',
});
