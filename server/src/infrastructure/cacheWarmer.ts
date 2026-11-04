import { createLogger } from '../utils/logger.ts';
import { config } from '../config.ts';
import * as tmdb from '../services/tmdb/index.ts';
import * as imdb from '../services/imdb/index.ts';
import { getTmdbThrottle } from './tmdbThrottle.ts';
import { startOpportunisticWork, throwIfRequestAborted } from '../utils/requestContext.ts';

const log = createLogger('CacheWarmer');

export async function warmEssentialCaches(apiKey: string | null): Promise<{
  warmed: number;
  failed: number;
  skipped?: boolean;
  skippedTasks?: number;
  elapsedMs?: number;
}> {
  if (!apiKey) {
    log.info('No default TMDB API key configured, skipping cache warming');
    return { warmed: 0, failed: 0, skipped: true };
  }

  const startTime = Date.now();
  log.info('Starting essential cache warming...');

  const tasks: { name: string; fn: () => Promise<unknown> }[] = [
    { name: 'movie_genres', fn: () => tmdb.getGenres(apiKey, 'movie') },
    { name: 'tv_genres', fn: () => tmdb.getGenres(apiKey, 'tv') },
    { name: 'languages', fn: () => tmdb.getLanguages(apiKey) },
    { name: 'countries', fn: () => tmdb.getCountries(apiKey) },
    { name: 'movie_certifications', fn: () => tmdb.getCertifications(apiKey, 'movie') },
    { name: 'tv_certifications', fn: () => tmdb.getCertifications(apiKey, 'tv') },
    { name: 'watch_regions', fn: () => tmdb.getWatchRegions(apiKey) },
  ];

  const regions = config.cache.warmRegions;
  for (const region of regions) {
    tasks.push({
      name: `watch_providers_movie_${region}`,
      fn: () => tmdb.getWatchProviders(apiKey, 'movie', region),
    });
    tasks.push({
      name: `watch_providers_tv_${region}`,
      fn: () => tmdb.getWatchProviders(apiKey, 'tv', region),
    });
  }

  const tmdbTaskCount = tasks.length;
  if (imdb.isImdbApiEnabled()) {
    tasks.push(
      { name: 'imdb_genres', fn: () => imdb.getGenres() },
      { name: 'imdb_top250_movie', fn: () => imdb.getTopRanking('movie') },
      { name: 'imdb_top250_series', fn: () => imdb.getTopRanking('series') },
      { name: 'imdb_popular_movie', fn: () => imdb.getPopular('movie') },
      { name: 'imdb_popular_series', fn: () => imdb.getPopular('series') }
    );
  }

  let warmed = 0;
  let failed = 0;
  let skippedTasks = 0;
  const warmTask = async (task: (typeof tasks)[number]) => {
    const work = startOpportunisticWork(async () => {
      await task.fn();
      throwIfRequestAborted();
    });
    if (!work) {
      skippedTasks++;
      return;
    }
    try {
      await work.promise;
      warmed++;
      log.debug(`Warmed: ${task.name}`);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'OPPORTUNISTIC_SKIPPED'
      ) {
        skippedTasks++;
        return;
      }
      failed++;
      log.warn(`Failed to warm: ${task.name}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  try {
    if (config.features?.backgroundPriority === false) {
      await Promise.all(tasks.slice(0, tmdbTaskCount).map(warmTask));
      await Promise.all(tasks.slice(tmdbTaskCount).map(warmTask));
    } else {
      for (const task of tasks) await warmTask(task);
    }
  } finally {
    await getTmdbThrottle().endWarmup();
  }

  const elapsed = Date.now() - startTime;
  log.info('Cache warming complete', { warmed, failed, skippedTasks, elapsedMs: elapsed });
  return { warmed, failed, skippedTasks, elapsedMs: elapsed };
}
