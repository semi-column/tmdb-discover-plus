import crypto from 'crypto';
import { createLogger } from './logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('etag');

let addonVersion = 'unknown';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'));
  addonVersion = pkg.version || 'unknown';
} catch {
  /* ignore */
}

/**
 * Generates an ETag from response data.
 * Includes addon version so ETags auto-invalidate on deploy.
 *
 * @param {any} data - Response body (will be JSON.stringified)
 * @param {string} [extra=''] - Extra data to include in hash (e.g., userId, language)
 * @returns {string} ETag value (weak validator)
 */
export function generateETag(data, extra = '') {
  const content = `${addonVersion}:${extra}:${typeof data === 'string' ? data : JSON.stringify(data)}`;
  const hash = crypto.createHash('md5').update(content).digest('hex').substring(0, 16);
  return `W/"${hash}"`;
}

/**
 * Express middleware that adds ETag / 304 support to Stremio addon responses.
 * Apply to specific routes, not globally.
 *
 * Usage:
 *   res.etagJson(data)  — like res.json(data) but with ETag support
 *   res.etagJson(data, { extra: userId })
 */
export function etagMiddleware(req, res, next) {
  res.etagJson = function (data, options = {}) {
    const extra = options.extra || '';
    const etag = generateETag(data, extra);

    res.set('ETag', etag);

    // Check If-None-Match header
    const clientETag = req.get('If-None-Match');
    if (clientETag && clientETag === etag) {
      return res.status(304).end();
    }

    return res.json(data);
  };

  next();
}
