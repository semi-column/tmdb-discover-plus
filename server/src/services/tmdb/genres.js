import fs from 'fs';
import path from 'path';
import { createLogger } from '../../utils/logger.js';
import { tmdbFetch } from './client.js';

const log = createLogger('tmdb:genres');

// Genre mappings (will be populated from API)
// Structure: { movie: { en: [...], it: [...] }, tv: { ... } }
export let genreCache = { movie: {}, tv: {} };

export let staticGenreMap = { movie: {}, tv: {} };
try {
  // __dirname equivalent: genres.js is in server/src/services/tmdb/
  // tmdb_genres.json is in server/src/services/
  const genresPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')), '..', 'tmdb_genres.json');
  const raw = fs.readFileSync(genresPath, 'utf8');
  staticGenreMap = JSON.parse(raw);
} catch (err) {
  log.warn('Could not load static TMDB genre mapping', { error: err.message });
}

/**
 * Get genre list for movies or TV
 */
export async function getGenres(apiKey, type = 'movie', language = 'en') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const lang = language || 'en';

  if (genreCache[mediaType]?.[lang]) {
    return genreCache[mediaType][lang];
  }

  // If cache structure is not initialized (legacy format handling)
  if (!genreCache[mediaType]) genreCache[mediaType] = {};

  const params = {};
  if (lang !== 'en') params.language = lang;

  const data = await tmdbFetch(`/genre/${mediaType}/list`, apiKey, params);

  if (!genreCache[mediaType]) genreCache[mediaType] = {};
  genreCache[mediaType][lang] = data.genres;

  return data.genres;
}

// Expose cached genres accessor for other modules (may be null if not yet fetched)
export function getCachedGenres(type = 'movie', language = 'en') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const lang = language || 'en';
  return genreCache[mediaType]?.[lang] || null;
}
