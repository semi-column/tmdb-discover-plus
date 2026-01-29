import fetch from 'node-fetch';
import { getCache } from './cache/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('rpdb');
const RPDB_BASE_URL = 'https://api.ratingposterdb.com';

/**
 * Get rating from RPDB
 * @param {string} apiKey - RPDB API Key
 * @param {string} imdbId - IMDb ID (e.g. tt1234567)
 * @returns {Promise<string|null>} - The rating as a string (e.g. "7.8") or null
 */
export async function getRpdbRating(apiKey, imdbId) {
  if (!apiKey || !imdbId) return null;

  // Validate apiKey - should be hex-like or alphanumeric typically
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(apiKey)) {
    log.warn('Invalid RPDB API Key format', { apiKey: '[REDACTED]' });
    return null;
  }

  // Validate imdbId - should follow tt\d+ format
  if (!/^tt\d+$/.test(imdbId)) {
    log.warn('Invalid IMDb ID format', { imdbId });
    return null;
  }

  const cacheKey = `rpdb_rating_${imdbId}`;
  const cache = getCache();

  // Check cache first
  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    /* ignore cache error */
  }

  // Logic: RPDB free tier allows fetching rating via this endpoint
  // https://api.ratingposterdb.com/{api-key}/imdb/rating/{imdb-id}

  const url = `${RPDB_BASE_URL}/${apiKey}/imdb/rating/${imdbId}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      // 404 means not found, 403 means bad key/limit/expired
      if (response.status === 404) {
        await cache.set(cacheKey, 'N/A', 86400); // Cache 'N/A' to avoid hitting 404s repeatedly
        return null;
      }
      if (response.status === 403) {
        // Invalid key or expired plan. Log at debug level to avoid spam.
        log.debug(`RPDB 403 Forbidden (Invalid Key?): ${url}`);
        return null;
      }
      throw new Error(`RPDB Status ${response.status}`);
    }

    const text = await response.text();
    // RPDB returns raw text number like "7.2"
    const rating = text.trim();

    if (rating && !isNaN(parseFloat(rating))) {
      await cache.set(cacheKey, rating, 86400); // Cache for 24 hours
      return rating;
    }

    return null;
  } catch (error) {
    if (error.message.includes('RPDB Status 403')) {
      // Should have been caught above, but just in case
      log.debug('Failed to fetch RPDB rating (403)', { imdbId });
      return null;
    }
    log.warn('Failed to fetch RPDB rating', { imdbId, error: error.message });
    return null;
  }
}
