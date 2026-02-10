import { getCache } from './cache/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CacheWarmer');

/**
 * Pre-fetches commonly needed data on startup so first users don't hit cold cache.
 *
 * Warms: genre lists, languages, countries, certifications, watch regions.
 * These are 7-day TTL items that every user needs.
 */
export async function warmEssentialCaches(apiKey) {
  if (!apiKey) {
    log.info('No default TMDB API key configured, skipping cache warming');
    return { warmed: 0, failed: 0, skipped: true };
  }

  const startTime = Date.now();
  log.info('Starting essential cache warming...');

  const tasks = [
    { name: 'movie_genres', fn: () => warmGenres(apiKey, 'movie') },
    { name: 'tv_genres', fn: () => warmGenres(apiKey, 'tv') },
    { name: 'languages', fn: () => warmLanguages(apiKey) },
    { name: 'countries', fn: () => warmCountries(apiKey) },
    { name: 'movie_certifications', fn: () => warmCertifications(apiKey, 'movie') },
    { name: 'tv_certifications', fn: () => warmCertifications(apiKey, 'tv') },
    { name: 'watch_regions', fn: () => warmWatchRegions(apiKey) },
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

// Individual warmer functions — they call the TMDB API and store results in cache

async function warmGenres(apiKey, mediaType) {
  const { default: fetch } = await import('node-fetch');
  const url = `https://api.themoviedb.org/3/genre/${mediaType}/list?api_key=${apiKey}&language=en`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();

  const cache = getCache();
  // Cache with the same key format tmdbFetch uses
  await cache.set(url, data, 3600);
  return data;
}

async function warmLanguages(apiKey) {
  const { default: fetch } = await import('node-fetch');
  const url = `https://api.themoviedb.org/3/configuration/languages?api_key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();

  const cache = getCache();
  await cache.set('tmdb_languages', data, 86400 * 7);
  return data;
}

async function warmCountries(apiKey) {
  const { default: fetch } = await import('node-fetch');
  const url = `https://api.themoviedb.org/3/configuration/countries?api_key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();

  const cache = getCache();
  await cache.set('tmdb_countries', data, 86400 * 7);
  return data;
}

async function warmCertifications(apiKey, mediaType) {
  const { default: fetch } = await import('node-fetch');
  const url = `https://api.themoviedb.org/3/certification/${mediaType}/list?api_key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();

  const cache = getCache();
  await cache.set(`tmdb_certifications_${mediaType}`, data.certifications || {}, 86400 * 7);
  return data;
}

async function warmWatchRegions(apiKey) {
  const { default: fetch } = await import('node-fetch');
  const url = `https://api.themoviedb.org/3/watch/providers/regions?api_key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();

  const cache = getCache();
  await cache.set('tmdb_watch_regions', data.results || [], 86400 * 7);
  return data;
}
