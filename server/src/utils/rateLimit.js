/**
 * Simple in-memory rate limiter
 * No external dependencies - suitable for single-instance deployments
 * For multi-instance deployments, consider Redis-based rate limiting
 */

import { createLogger } from './logger.js';

const log = createLogger('rateLimit');

/**
 * Rate limit store
 * Map of IP -> { count, resetTime }
 */
const store = new Map();

/**
 * Clean up expired entries periodically
 */
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of store.entries()) {
    if (now > value.resetTime) {
      store.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    log.debug('Rate limit cleanup', { entriesRemoved: cleaned, remaining: store.size });
  }
}, CLEANUP_INTERVAL);

/**
 * Get client IP address, handling proxies
 * @param {Request} req - Express request
 * @returns {string} Client IP
 */
function getClientIp(req) {
  // Trust proxy is enabled, so x-forwarded-for should be reliable
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // Take the first IP (original client)
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Create rate limiting middleware
 * @param {Object} options - Rate limit options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000 = 1 minute)
 * @param {number} options.maxRequests - Max requests per window (default: 100)
 * @param {string} options.message - Error message (default: 'Too many requests')
 * @param {boolean} options.skipSuccessfulRequests - Don't count successful requests (default: false)
 * @returns {Function} Express middleware
 */
export function rateLimit(options = {}) {
  const {
    windowMs = 60 * 1000, // 1 minute
    maxRequests = 100,
    message = 'Too many requests, please try again later',
    skipSuccessfulRequests = false,
  } = options;

  return (req, res, next) => {
    // Skip rate limiting if disabled via env
    if (process.env.DISABLE_RATE_LIMIT === 'true') {
      return next();
    }

    // Bypass rate limiting for localhost in development or test mode
    const ip = getClientIp(req);
    const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    const isLocalhost =
      ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === '::ffff:127.0.0.1';
    if (isDevOrTest && isLocalhost) {
      return next();
    }
    const now = Date.now();

    let record = store.get(ip);

    // Initialize or reset if window expired
    if (!record || now > record.resetTime) {
      record = {
        count: 0,
        resetTime: now + windowMs,
      };
      store.set(ip, record);
    }

    // Increment count
    record.count++;

    // Calculate remaining requests and reset time
    const remaining = Math.max(0, maxRequests - record.count);
    const resetSeconds = Math.ceil((record.resetTime - now) / 1000);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    // Check if over limit
    if (record.count > maxRequests) {
      log.warn('Rate limit exceeded', { ip, count: record.count, limit: maxRequests });
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        error: message,
        retryAfter: resetSeconds,
      });
    }

    // If skipSuccessfulRequests, decrement on successful response
    if (skipSuccessfulRequests) {
      res.on('finish', () => {
        if (res.statusCode < 400) {
          record.count = Math.max(0, record.count - 1);
        }
      });
    }

    next();
  };
}

/**
 * Rate limit for sensitive endpoints (login, config creation)
 */
export const strictRateLimit = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 60,
  message: 'Too many requests to this endpoint, please try again later',
});

/**
 * Standard rate limit for API endpoints
 */
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 300,
  message: 'Too many API requests, please try again later',
});

/**
 * Relaxed rate limit for addon endpoints (catalog/manifest)
 */
export const addonRateLimit = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 1000,
  message: 'Rate limit exceeded',
});
