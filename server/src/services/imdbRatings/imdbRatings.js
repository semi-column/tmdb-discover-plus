import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import fetch from 'node-fetch';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ImdbRatings');

// ── Configuration ────────────────────────────────────────────────────────────

const IMDB_RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';
const UPDATE_INTERVAL_HOURS = parseInt(process.env.IMDB_RATINGS_UPDATE_HOURS || '24', 10);
const MIN_VOTES = parseInt(process.env.IMDB_MIN_VOTES || '100', 10);
const DOWNLOAD_TIMEOUT_MS = 120_000; // 2 minutes
const WRITE_BATCH_SIZE = 10_000;

// ── Module state ─────────────────────────────────────────────────────────────

/** @type {import('./ImdbRatingsAdapter.js').ImdbRatingsAdapter | null} */
let adapter = null;

let ratingsLoaded = false;
let ratingsCount = 0;
let updateTimer = null;
let downloading = false;

// Stats
let totalRequests = 0;
let datasetHits = 0;
let datasetMisses = 0;

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parse a stored rating string "rating|votes" → { rating, votes }
 * @param {string} value
 * @returns {{ rating: number, votes: number } | null}
 */
function parseRating(value) {
  const sep = value.indexOf('|');
  if (sep === -1) return null;
  const rating = parseFloat(value.slice(0, sep));
  const votes = parseInt(value.slice(sep + 1), 10);
  if (Number.isNaN(rating) || Number.isNaN(votes)) return null;
  return { rating, votes };
}

/**
 * Download, stream-parse, and store the IMDb ratings dataset.
 * Uses ETag-based conditional download to skip re-import when unchanged.
 *
 * @returns {Promise<boolean>} true if ratings are available after this call
 */
async function downloadAndCacheRatings() {
  if (!adapter) return false;
  if (downloading) {
    log.warn('Download already in progress, skipping');
    return ratingsLoaded;
  }

  downloading = true;

  try {
    // ── ETag check (skip download if unchanged) ──────────────────────
    const storedEtag = await adapter.getMeta('etag');
    const existingCount = await adapter.count();

    if (storedEtag && existingCount > 0) {
      try {
        const headResp = await fetch(IMDB_RATINGS_URL, {
          method: 'HEAD',
          signal: AbortSignal.timeout(15_000),
        });
        const remoteEtag = headResp.headers.get('etag');

        if (remoteEtag && remoteEtag === storedEtag) {
          log.info('IMDb dataset unchanged (ETag match), reusing existing data', {
            count: existingCount,
            etag: remoteEtag.slice(0, 20),
          });
          ratingsLoaded = true;
          ratingsCount = existingCount;
          return true;
        }
        log.info('IMDb dataset changed, downloading fresh copy', {
          oldEtag: storedEtag.slice(0, 20),
          newEtag: remoteEtag?.slice(0, 20),
        });
      } catch (headErr) {
        // HEAD failed — play safe and re-download
        log.warn('ETag HEAD request failed, proceeding with download', {
          error: headErr.message,
        });
      }
    }

    // ── Download + stream-parse ──────────────────────────────────────
    log.info('Downloading IMDb ratings dataset (streaming)...', {
      url: IMDB_RATINGS_URL,
      minVotes: MIN_VOTES,
    });

    const response = await fetch(IMDB_RATINGS_URL, {
      method: 'GET',
      headers: { 'User-Agent': 'TMDB-Discover-Plus/1.0' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    // Clear existing data before repopulating
    await adapter.clear();

    const gunzip = createGunzip();
    const bodyStream = Readable.fromWeb(response.body);
    const rl = createInterface({
      input: bodyStream.pipe(gunzip),
      crlfDelay: Infinity,
    });

    let count = 0;
    let filtered = 0;
    let isFirstLine = true;
    let batch = [];

    for await (const line of rl) {
      if (isFirstLine) {
        isFirstLine = false; // Skip TSV header
        continue;
      }
      if (!line) continue;

      // TSV columns: tconst \t averageRating \t numVotes
      const firstTab = line.indexOf('\t');
      const secondTab = line.indexOf('\t', firstTab + 1);
      if (firstTab === -1 || secondTab === -1) continue;

      const id = line.slice(0, firstTab);
      const rating = parseFloat(line.slice(firstTab + 1, secondTab));
      const votes = parseInt(line.slice(secondTab + 1), 10);

      if (!id || Number.isNaN(rating) || Number.isNaN(votes)) continue;

      if (votes < MIN_VOTES) {
        filtered++;
        continue;
      }

      batch.push([id, `${rating}|${votes}`]);
      count++;

      if (batch.length >= WRITE_BATCH_SIZE) {
        await adapter.setBatch(batch);
        batch = [];
        if (count % 100_000 === 0) {
          log.debug('Import progress', { imported: count, filtered });
        }
      }
    }

    // Flush remaining
    if (batch.length > 0) {
      await adapter.setBatch(batch);
    }

    log.info('IMDb dataset import complete', {
      imported: count,
      filtered,
      minVotes: MIN_VOTES,
    });

    // Store ETag for next conditional download
    const etag = response.headers.get('etag');
    if (etag) {
      await adapter.setMeta('etag', etag);
    }
    await adapter.setMeta('lastUpdate', Date.now().toString());

    ratingsLoaded = true;
    ratingsCount = count;

    return true;
  } catch (error) {
    log.error('Failed to download/import IMDb ratings', { error: error.message });

    // If we had data before, keep using it
    const existingCount = await adapter.count().catch(() => 0);
    if (existingCount > 0) {
      log.info('Falling back to existing dataset', { count: existingCount });
      ratingsLoaded = true;
      ratingsCount = existingCount;
      return true;
    }

    return false;
  } finally {
    downloading = false;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the ratings subsystem:
 *  1. Sets the adapter
 *  2. Downloads the dataset (or reuses cached data)
 *  3. Schedules periodic updates
 *
 * @param {import('./ImdbRatingsAdapter.js').ImdbRatingsAdapter} ratingsAdapter
 * @returns {Promise<void>}
 */
export async function initializeRatings(ratingsAdapter) {
  adapter = ratingsAdapter;

  log.info('Initializing IMDb ratings...', {
    adapter: adapter.constructor.name,
    updateIntervalHours: UPDATE_INTERVAL_HOURS,
    minVotes: MIN_VOTES,
  });

  await downloadAndCacheRatings();

  // Schedule periodic refresh
  if (!updateTimer) {
    const intervalMs = UPDATE_INTERVAL_HOURS * 60 * 60 * 1000;
    updateTimer = setInterval(async () => {
      log.info('Running scheduled IMDb ratings update...');
      try {
        await downloadAndCacheRatings();
        log.info('Scheduled update completed', { count: ratingsCount });
      } catch (err) {
        log.error('Scheduled update failed', { error: err.message });
      }
    }, intervalMs);

    // Don't let the timer block process exit
    if (updateTimer.unref) updateTimer.unref();

    log.info(`Scheduled IMDb ratings refresh every ${UPDATE_INTERVAL_HOURS}h`);
  }
}

/**
 * Look up a single IMDb rating.
 * @param {string} imdbId - e.g. "tt0133093"
 * @returns {Promise<{ rating: number, votes: number } | null>}
 */
export async function getImdbRating(imdbId) {
  if (!imdbId || !adapter) return null;
  totalRequests++;

  try {
    const val = await adapter.get(imdbId);
    if (val) {
      datasetHits++;
      return parseRating(val);
    }
    datasetMisses++;
    return null;
  } catch (err) {
    datasetMisses++;
    return null;
  }
}

/**
 * Look up a single IMDb rating, returning the numeric string (e.g. "8.7").
 * This is the drop-in replacement for the old Cinemeta-based getRating.
 * @param {string} imdbId
 * @returns {Promise<string | null>}
 */
export async function getImdbRatingString(imdbId) {
  const result = await getImdbRating(imdbId);
  return result ? String(result.rating) : null;
}

/**
 * Batch-fetch IMDb ratings for a list of items.
 * Returns a Map of imdbId → rating string (e.g. "8.7").
 *
 * @param {Array<{ imdb_id?: string }>} items
 * @param {string} [_type] - Unused, kept for API compat with old Cinemeta function
 * @returns {Promise<Map<string, string>>}
 */
export async function batchGetImdbRatings(items, _type) {
  const ratingsMap = new Map();
  if (!adapter || !items?.length) return ratingsMap;

  const imdbIds = items
    .map((item) => item.imdb_id)
    .filter((id) => id && /^tt\d{7,10}$/.test(id));

  if (imdbIds.length === 0) return ratingsMap;

  const unique = [...new Set(imdbIds)];
  totalRequests += unique.length;

  try {
    const results = await adapter.getMany(unique);

    for (const [id, val] of results) {
      const parsed = parseRating(val);
      if (parsed) {
        ratingsMap.set(id, String(parsed.rating));
        datasetHits++;
      }
    }

    datasetMisses += unique.length - results.size;
  } catch (err) {
    log.warn('Batch lookup failed', { error: err.message });
    datasetMisses += unique.length;
  }

  return ratingsMap;
}

/**
 * Force a fresh download (ignores ETag). Used by admin/health endpoints.
 * @returns {Promise<{ success: boolean, message: string, count: number }>}
 */
export async function forceUpdate() {
  if (!adapter) {
    return { success: false, message: 'Not initialized', count: 0 };
  }

  log.info('Force update requested');
  await adapter.delMeta('etag');

  try {
    const success = await downloadAndCacheRatings();
    return {
      success,
      message: success
        ? `Updated (${ratingsCount.toLocaleString()} ratings)`
        : 'Download failed',
      count: ratingsCount,
    };
  } catch (err) {
    return { success: false, message: err.message, count: 0 };
  }
}

/**
 * Whether the dataset has been loaded successfully.
 * @returns {boolean}
 */
export function isLoaded() {
  return ratingsLoaded;
}

/**
 * Stats object for health/monitoring endpoints.
 */
export function getStats() {
  const hitPct = totalRequests > 0
    ? parseFloat(((datasetHits / totalRequests) * 100).toFixed(1))
    : 0;
  const missPct = totalRequests > 0
    ? parseFloat(((datasetMisses / totalRequests) * 100).toFixed(1))
    : 0;

  return {
    loaded: ratingsLoaded,
    count: ratingsCount,
    downloading,
    adapter: adapter?.constructor.name || 'none',
    updateIntervalHours: UPDATE_INTERVAL_HOURS,
    minVotes: MIN_VOTES,
    totalRequests,
    datasetHits,
    hitPercentage: hitPct,
    datasetMisses,
    missPercentage: missPct,
  };
}

/**
 * Cleanup: stop the refresh timer and destroy the adapter.
 */
export async function destroyRatings() {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
  if (adapter) {
    await adapter.destroy();
    adapter = null;
  }
  ratingsLoaded = false;
  ratingsCount = 0;
  totalRequests = 0;
  datasetHits = 0;
  datasetMisses = 0;
  log.info('IMDb ratings service destroyed');
}
