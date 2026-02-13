import { createLogger } from '../utils/logger.ts';
import * as tmdb from '../services/tmdb/index.js';

const log = createLogger('CacheWarmer');

export async function warmEssentialCaches(apiKey) {
  if (!apiKey) {
    log.info('No default TMDB API key configured, skipping cache warming');
    return { warmed: 0, failed: 0, skipped: true };
  }

  const startTime = Date.now();
  log.info('Starting essential cache warming...');

  const tasks = [
    { name: 'movie_genres', fn: () => tmdb.getGenres(apiKey, 'movie') },
    { name: 'tv_genres', fn: () => tmdb.getGenres(apiKey, 'tv') },
    { name: 'languages', fn: () => tmdb.getLanguages(apiKey) },
    { name: 'countries', fn: () => tmdb.getCountries(apiKey) },
    { name: 'movie_certifications', fn: () => tmdb.getCertifications(apiKey, 'movie') },
    { name: 'tv_certifications', fn: () => tmdb.getCertifications(apiKey, 'tv') },
    { name: 'watch_regions', fn: () => tmdb.getWatchRegions(apiKey) },
  ];

  const results = await Promise.allSettled(tasks.map((t) => t.fn()));

  let warmed = 0;
  let failed = 0;

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      warmed++;
      log.debug(`Warmed: ${tasks[i].name}`);
    } else {
      failed++;
      log.warn(`Failed to warm: ${tasks[i].name}`, { error: result.reason?.message });
    }
  });

  const elapsed = Date.now() - startTime;
  log.info('Cache warming complete', { warmed, failed, elapsedMs: elapsed });

  return { warmed, failed, elapsedMs: elapsed };
}
