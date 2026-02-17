import crypto from 'crypto';
import { createLogger } from './logger.ts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import type { Request, Response, NextFunction } from 'express';

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
export function generateETag(data: unknown, extra: string = ''): string {
  const content = `${addonVersion}:${extra}:${typeof data === 'string' ? data : JSON.stringify(data)}`;
  const hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 20);
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
export function etagMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.etagJson = function (data: unknown, options: { extra?: string } = {}) {
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
