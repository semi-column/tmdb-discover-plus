export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

import { config } from '../config.ts';

export function getBaseUrl(req: {
  get: (name: string) => string | undefined;
  protocol: string;
}): string {
  if (config.baseUrl) {
    return config.baseUrl;
  }

  const origin = req.get('origin');
  if (origin) {
    return origin.replace(/\/$/, '');
  }

  const referer = req.get('referer');
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      return `${refererUrl.protocol}//${refererUrl.host}`;
    } catch {}
  }

  const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';

  return `${protocol}://${host}`;
}

export function normalizeGenreName(name: string | number | null | undefined): string {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[\u2013\u2014]/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseIdArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  return String(val)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function setNoCacheHeaders(res: { set: (name: string, value: string) => void }): void {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}
