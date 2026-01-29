import { rateLimit } from 'express-rate-limit';
import { createLogger } from './logger.js';

const log = createLogger('rateLimit');

/**
 * Common configuration for rate limiters
 */
const baseOptions = {
  // Use a memory store as default
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: true, // Disable the `X-RateLimit-*` headers
  validate: { trustProxy: false }, // Allow 'trust proxy' in Express without error
  skip: (req) => {
    // Skip rate limiting if disabled via env
    if (process.env.DISABLE_RATE_LIMIT === 'true') return true;

    // Bypass rate limiting for localhost in development or test mode
    const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    const ip = req.ip || req.headers['x-forwarded-for'];
    const isLocalhost =
      ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === '::ffff:127.0.0.1';

    return isDevOrTest && isLocalhost;
  },
  handler: (req, res, options) => {
    log.warn('Rate limit exceeded', {
      ip: req.ip,
      url: req.originalUrl,
      limit: options.limit,
    });
    res.status(429).json({
      error: options.message,
      retryAfter: Math.ceil(options.windowMs / 1000),
    });
  },
};

/**
 * Rate limit for sensitive endpoints (login, config creation)
 */
export const strictRateLimit = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000, // 1 minute
  limit: 60,
  message: 'Too many requests to this endpoint, please try again later',
});

/**
 * Standard rate limit for API endpoints
 */
export const apiRateLimit = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: 300,
  message: 'Too many API requests, please try again later',
});

/**
 * Relaxed rate limit for addon endpoints (catalog/manifest)
 */
export const addonRateLimit = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: 1000,
  message: 'Rate limit exceeded',
});
