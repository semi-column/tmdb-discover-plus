import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import os from 'node:os';
import type { Request } from 'express';
import { config } from '../../config.ts';

export const INSTANCE_ID = (process.env.HOSTNAME || os.hostname() || 'local').slice(0, 64);

let salt: string | null = null;

/** Keyed hash so stored IDs can't be reversed or joined against other datasets without ENCRYPTION_KEY. */
export function hashIdentifier(value: string | undefined | null): string {
  if (!value) return '';
  salt ??= createHmac('sha256', config.encryption.key).update('obs-identity-salt').digest('hex');
  return createHmac('sha256', salt).update(value).digest('base64url').slice(0, 16);
}

function header(req: Request, name: string): string {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

export function getClientIp(req: Request): string {
  if (config.trustCloudflareHeaders) {
    const cf = header(req, 'cf-connecting-ip');
    if (cf && isIP(cf)) return cf;
  }
  return req.ip ?? '';
}

export function getCountry(req: Request): string {
  if (!config.trustCloudflareHeaders) return '';
  const value = header(req, 'cf-ipcountry').toUpperCase();
  return /^[A-Z][A-Z0-9]$/.test(value) ? value : '';
}

/** Cloudflare edge location, e.g. "a5072d859b9fb2ab-MAA" -> "MAA". */
export function getColo(req: Request): string {
  if (!config.trustCloudflareHeaders) return '';
  const match = /-([A-Z]{3})$/.exec(header(req, 'cf-ray'));
  return match ? match[1] : '';
}

export function getUserAgent(req: Request): string {
  return header(req, 'user-agent').slice(0, 256);
}

const CLIENT_RULES: Array<[RegExp, string]> = [
  [/stremio.*android|android.*stremio/i, 'Stremio Android'],
  [
    /stremio.*(windows|macintosh|mac os|linux|x11)|(windows|macintosh|mac os|linux|x11).*stremio/i,
    'Stremio Desktop',
  ],
  [/stremio/i, 'Stremio (other)'],
  [/okhttp|dalvik/i, 'Android app'],
  [/cfnetwork|darwin/i, 'Apple app'],
  [
    /curl|wget|python|go-http|node-fetch|undici|axios|bot|spider|crawl|uptime|monitor/i,
    'Bot / script',
  ],
  [/mozilla.*mobile/i, 'Mobile browser'],
  [/mozilla/i, 'Browser'],
];

export function classifyClient(ua: string): string {
  if (!ua) return 'No user-agent';
  for (const [pattern, label] of CLIENT_RULES) {
    if (pattern.test(ua)) return label;
  }
  return 'Other';
}
