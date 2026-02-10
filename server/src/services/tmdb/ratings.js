/**
 * IMDb Ratings — powered by the official IMDb bulk dataset.
 *
 * The dataset is downloaded once on startup and refreshed every 24 h
 * (configurable via IMDB_RATINGS_UPDATE_HOURS). Storage is either a
 * Redis Hash (ElfHosted) or an in-memory Map (BeamUp), selected
 * automatically by the imdbRatings service factory.
 *
 * This module re-exports the two functions that the rest of the
 * codebase relies on, keeping the same call signatures as the old
 * Cinemeta-based implementation so nothing else needs to change.
 */

import {
  getImdbRatingString,
  batchGetImdbRatings,
} from '../imdbRatings/index.js';

/**
 * Look up the IMDb rating for a single title.
 *
 * @param {string} imdbId - e.g. "tt0133093"
 * @param {string} [_type] - Unused (kept for backward compat)
 * @returns {Promise<string|null>} e.g. "8.7" or null
 */
export async function getCinemetaRating(imdbId, _type) {
  return getImdbRatingString(imdbId);
}

/**
 * Batch-fetch IMDb ratings for a list of TMDB items.
 * Returns a Map of imdbId → rating string (e.g. "8.7").
 *
 * @param {Array<{ imdb_id?: string }>} items
 * @param {string} [type] - Content type (unused by dataset, kept for compat)
 * @returns {Promise<Map<string, string>>}
 */
export async function batchGetCinemetaRatings(items, type) {
  return batchGetImdbRatings(items, type);
}
