import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import fetch from 'node-fetch';
import { createLogger } from '../../utils/logger.ts';
import { config } from '../../config.ts';
import type { ImdbDatasetAdapter } from './ImdbDatasetAdapter.ts';
import type { ImdbTitle, ImdbDatasetQuery, ImdbDatasetResult } from '../../types/imdbDataset.ts';

const log = createLogger('ImdbDataset');

const IMDB_RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';
const IMDB_BASICS_URL = 'https://datasets.imdbws.com/title.basics.tsv.gz';
const IMDB_AKAS_URL = 'https://datasets.imdbws.com/title.akas.tsv.gz';
const UPDATE_INTERVAL_HOURS = config.imdbDataset.updateIntervalHours;
const MIN_VOTES = config.imdbDataset.minVotes;
const DOWNLOAD_TIMEOUT_MS = 300_000;
const AKAS_DOWNLOAD_TIMEOUT_MS = 600_000;
const WRITE_BATCH_SIZE = 10_000;
// Bump this when the Redis scoring formula or data schema changes to force a re-import
const DATA_VERSION = '3';

const ALLOWED_TITLE_TYPES = new Set([
  'movie',
  'tvMovie',
  'tvSpecial',
  'video',
  'tvSeries',
  'tvMiniSeries',
]);

let adapter: ImdbDatasetAdapter | null = null;
let datasetLoaded = false;
let movieCount = 0;
let seriesCount = 0;
let updateTimer: ReturnType<typeof setInterval> | null = null;
let downloading = false;
let lastUpdated: string | null = null;

async function downloadRatingsMap() {
  log.info('Downloading IMDB ratings dataset...');

  const response = await fetch(IMDB_RATINGS_URL, {
    method: 'GET',
    headers: { 'User-Agent': 'TMDB-Discover-Plus/1.0' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Ratings HTTP ${response.status} ${response.statusText}`);
  }

  const ratingsMap = new Map<string, { rating: number; votes: number }>();
  const gunzip = createGunzip();
  const rl = createInterface({ input: response.body!.pipe(gunzip), crlfDelay: Infinity });

  let isFirstLine = true;

  for await (const line of rl) {
    if (isFirstLine) {
      isFirstLine = false;
      continue;
    }
    if (!line) continue;

    const firstTab = line.indexOf('\t');
    const secondTab = line.indexOf('\t', firstTab + 1);
    if (firstTab === -1 || secondTab === -1) continue;

    const id = line.slice(0, firstTab);
    const rating = parseFloat(line.slice(firstTab + 1, secondTab));
    const votes = parseInt(line.slice(secondTab + 1), 10);

    if (!id || Number.isNaN(rating) || Number.isNaN(votes)) continue;
    if (votes < MIN_VOTES) continue;

    ratingsMap.set(id, { rating, votes });
  }

  log.info('Ratings parsed', { count: ratingsMap.size });
  return ratingsMap;
}

async function downloadRegionsMap(validTconsts: Set<string>): Promise<Map<string, string[]>> {
  log.info('Downloading IMDB akas dataset for region data...');

  const response = await fetch(IMDB_AKAS_URL, {
    method: 'GET',
    headers: { 'User-Agent': 'TMDB-Discover-Plus/1.0' },
    signal: AbortSignal.timeout(AKAS_DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Akas HTTP ${response.status} ${response.statusText}`);
  }

  const regionSets = new Map<string, Set<string>>();
  const gunzip = createGunzip();
  const rl = createInterface({ input: response.body!.pipe(gunzip), crlfDelay: Infinity });

  let isFirstLine = true;
  let processed = 0;

  for await (const line of rl) {
    if (isFirstLine) {
      isFirstLine = false;
      continue;
    }
    if (!line) continue;

    const firstTab = line.indexOf('\t');
    if (firstTab === -1) continue;

    const titleId = line.slice(0, firstTab);
    if (!validTconsts.has(titleId)) continue;

    // Columns: titleId, ordering, title, region, language, types, attributes, isOriginalTitle
    const parts = line.split('\t');
    if (parts.length < 4) continue;

    const region = parts[3];
    if (!region || region === '\\N') continue;

    if (!regionSets.has(titleId)) {
      regionSets.set(titleId, new Set());
    }
    regionSets.get(titleId)!.add(region);
    processed++;
  }

  // Convert sets to arrays
  const regionsMap = new Map<string, string[]>();
  for (const [id, regions] of regionSets) {
    regionsMap.set(id, [...regions]);
  }

  log.info('Akas regions parsed', { titles: regionsMap.size, regionEntries: processed });
  return regionsMap;
}

async function downloadAndStore() {
  if (!adapter) return false;
  if (downloading) {
    log.warn('Download already in progress, skipping');
    return datasetLoaded;
  }

  downloading = true;

  try {
    const storedEtag = await adapter.getMeta('etag');
    const storedVersion = await adapter.getMeta('dataVersion');
    const existingMovies = await adapter.count('movie');
    const existingSeries = await adapter.count('series');

    if (
      storedEtag &&
      storedVersion === DATA_VERSION &&
      (existingMovies > 0 || existingSeries > 0)
    ) {
      try {
        const headResp = await fetch(IMDB_BASICS_URL, {
          method: 'HEAD',
          signal: AbortSignal.timeout(15_000),
        });
        const remoteEtag = headResp.headers.get('etag');

        if (remoteEtag && remoteEtag === storedEtag) {
          log.info('IMDB dataset unchanged (ETag match), reusing existing data', {
            movies: existingMovies,
            series: existingSeries,
          });
          datasetLoaded = true;
          movieCount = existingMovies;
          seriesCount = existingSeries;
          lastUpdated = await adapter.getMeta('lastUpdate');
          return true;
        }
      } catch (headErr: any) {
        log.warn('ETag HEAD request failed, proceeding with download', {
          error: headErr.message,
        });
      }
    }

    if (storedVersion !== DATA_VERSION && (existingMovies > 0 || existingSeries > 0)) {
      log.info('Data version changed, forcing re-import', {
        stored: storedVersion,
        current: DATA_VERSION,
      });
    }

    log.info('Downloading IMDB datasets...', { minVotes: MIN_VOTES });

    const ratingsMap = await downloadRatingsMap();

    let regionsMap: Map<string, string[]>;
    try {
      regionsMap = await downloadRegionsMap(new Set(ratingsMap.keys()));
    } catch (akasErr: any) {
      log.warn('Failed to download akas dataset, proceeding without region data', {
        error: akasErr.message,
      });
      regionsMap = new Map();
    }

    log.info('Downloading IMDB basics dataset...');
    const basicsResponse = await fetch(IMDB_BASICS_URL, {
      method: 'GET',
      headers: { 'User-Agent': 'TMDB-Discover-Plus/1.0' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (!basicsResponse.ok) {
      throw new Error(`Basics HTTP ${basicsResponse.status} ${basicsResponse.statusText}`);
    }

    await adapter.clear();

    const gunzip = createGunzip();
    const rl = createInterface({ input: basicsResponse.body!.pipe(gunzip), crlfDelay: Infinity });

    let isFirstLine = true;
    let batch: ImdbTitle[] = [];
    let movies = 0;
    let series = 0;
    let skipped = 0;

    for await (const line of rl) {
      if (isFirstLine) {
        isFirstLine = false;
        continue;
      }
      if (!line) continue;

      const parts = line.split('\t');
      if (parts.length < 9) continue;

      const [tconst, titleType, primaryTitle, , , startYearStr, , runtimeStr, genresStr] = parts;

      if (!ALLOWED_TITLE_TYPES.has(titleType)) {
        skipped++;
        continue;
      }

      const ratingData = ratingsMap.get(tconst);
      if (!ratingData) {
        skipped++;
        continue;
      }

      const startYear = startYearStr === '\\N' ? 0 : parseInt(startYearStr, 10);
      const runtimeMinutes = runtimeStr === '\\N' ? 0 : parseInt(runtimeStr, 10);
      const genres =
        genresStr === '\\N'
          ? []
          : genresStr
              .split(',')
              .map((g) => g.trim())
              .filter(Boolean);

      const entry: ImdbTitle = {
        tconst,
        titleType,
        primaryTitle,
        startYear: Number.isNaN(startYear) ? 0 : startYear,
        runtimeMinutes: Number.isNaN(runtimeMinutes) ? 0 : runtimeMinutes,
        genres,
        averageRating: ratingData.rating,
        numVotes: ratingData.votes,
        regions: regionsMap.get(tconst) || [],
      };

      const mappedType =
        titleType === 'tvSeries' || titleType === 'tvMiniSeries' ? 'series' : 'movie';
      if (mappedType === 'movie') movies++;
      else series++;

      batch.push(entry);

      if (batch.length >= WRITE_BATCH_SIZE) {
        await adapter.setBatch(batch);
        batch = [];
        if ((movies + series) % 100_000 === 0) {
          log.debug('Import progress', { movies, series, skipped });
        }
      }
    }

    if (batch.length > 0) {
      await adapter.setBatch(batch);
    }

    if (adapter._finalize) {
      adapter._finalize();
    }

    log.info('IMDB dataset import complete', { movies, series, skipped });

    const etag = basicsResponse.headers.get('etag');
    if (etag) {
      await adapter.setMeta('etag', etag);
    }
    await adapter.setMeta('dataVersion', DATA_VERSION);
    const now = Date.now().toString();
    await adapter.setMeta('lastUpdate', now);

    datasetLoaded = true;
    movieCount = movies;
    seriesCount = series;
    lastUpdated = now;

    return true;
  } catch (error: any) {
    log.error('Failed to download/import IMDB dataset', { error: error.message });

    const existingMovies = await adapter.count('movie').catch(() => 0);
    const existingSeries = await adapter.count('series').catch(() => 0);
    if (existingMovies > 0 || existingSeries > 0) {
      log.info('Falling back to existing dataset', {
        movies: existingMovies,
        series: existingSeries,
      });
      datasetLoaded = true;
      movieCount = existingMovies;
      seriesCount = existingSeries;
      return true;
    }

    return false;
  } finally {
    downloading = false;
  }
}

export async function initializeDataset(datasetAdapter: ImdbDatasetAdapter) {
  adapter = datasetAdapter;

  log.info('Initializing IMDB dataset...', {
    adapter: adapter.constructor.name,
    updateIntervalHours: UPDATE_INTERVAL_HOURS,
    minVotes: MIN_VOTES,
  });

  await downloadAndStore();

  if (!updateTimer) {
    const intervalMs = UPDATE_INTERVAL_HOURS * 60 * 60 * 1000;
    updateTimer = setInterval(async () => {
      log.info('Running scheduled IMDB dataset update...');
      try {
        await downloadAndStore();
        log.info('Scheduled dataset update completed', { movies: movieCount, series: seriesCount });
      } catch (err: any) {
        log.error('Scheduled dataset update failed', { error: err.message });
      }
    }, intervalMs);

    if (updateTimer.unref) updateTimer.unref();
    log.info(`Scheduled IMDB dataset refresh every ${UPDATE_INTERVAL_HOURS}h`);
  }
}

export async function queryDataset(query: ImdbDatasetQuery): Promise<ImdbDatasetResult> {
  if (!adapter || !datasetLoaded) return { items: [], total: 0 };
  return adapter.query(query);
}

export async function getDatasetGenres(type: string): Promise<string[]> {
  if (!adapter || !datasetLoaded) return [];
  return adapter.getGenres(type as 'movie' | 'series');
}

export async function getDatasetDecades(type: string): Promise<number[]> {
  if (!adapter || !datasetLoaded) return [];
  return adapter.getDecades(type as 'movie' | 'series');
}

export async function getDatasetRegions(type: string): Promise<string[]> {
  if (!adapter || !datasetLoaded) return [];
  return adapter.getRegions(type as 'movie' | 'series');
}

export function isDatasetLoaded() {
  return datasetLoaded;
}

export function getDatasetStats() {
  return {
    loaded: datasetLoaded,
    movieCount,
    seriesCount,
    lastUpdated,
    downloading,
    adapter: adapter?.constructor.name || 'none',
    updateIntervalHours: UPDATE_INTERVAL_HOURS,
    minVotes: MIN_VOTES,
  };
}

export async function destroyDataset() {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
  if (adapter) {
    await adapter.destroy();
    adapter = null;
  }
  datasetLoaded = false;
  movieCount = 0;
  seriesCount = 0;
  lastUpdated = null;
  log.info('IMDB dataset service destroyed');
}
