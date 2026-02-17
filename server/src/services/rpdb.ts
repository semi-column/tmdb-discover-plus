import fetch from 'node-fetch';
import { getCache } from './cache/index.ts';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('rpdb');
const RPDB_BASE_URL = 'https://api.ratingposterdb.com';

export async function getRpdbRating(apiKey: string, imdbId: string): Promise<string | null> {
  if (!apiKey || !imdbId) return null;

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(apiKey)) {
    log.warn('Invalid RPDB API Key format', { apiKey: '[REDACTED]' });
    return null;
  }

  if (!/^tt\d+$/.test(imdbId)) {
    log.warn('Invalid IMDb ID format', { imdbId });
    return null;
  }

  const cacheKey = `rpdb_rating_${imdbId}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached as string;
  } catch (_e) {}

  const url = `${RPDB_BASE_URL}/${apiKey}/imdb/rating/${imdbId}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!response.ok) {
      if (response.status === 404) {
        await cache.set(cacheKey, 'N/A', 86400);
        return null;
      }
      if (response.status === 403) {
        log.debug(`RPDB 403 Forbidden (Invalid Key?): ${url}`);
        return null;
      }
      throw new Error(`RPDB Status ${response.status}`);
    }

    const text = await response.text();
    const rating = text.trim();

    if (rating && !isNaN(parseFloat(rating))) {
      await cache.set(cacheKey, rating, 86400);
      return rating;
    }

    return null;
  } catch (err) {
    log.warn('Failed to fetch RPDB rating', { imdbId, error: (err as Error).message });
    return null;
  }
}
