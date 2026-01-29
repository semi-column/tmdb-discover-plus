/**
 * Poster Service - RPDB and Top Posters Integration
 *
 * Generates poster URLs for RPDB (RatingPosterDB) and Top Posters services.
 * These services provide movie/series posters with embedded ratings and trend indicators.
 *
 * API Documentation:
 * - RPDB: https://ratingposterdb.com
 * - Top Posters: https://api.top-streaming.stream
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('posterService');

// Service base URLs
const RPDB_BASE_URL = 'https://api.ratingposterdb.com';
const TOP_POSTERS_BASE_URL = 'https://api.top-streaming.stream';

// Default TMDB image base for fallback
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

/**
 * Supported poster services
 * @readonly
 * @enum {string}
 */
export const PosterService = {
  NONE: 'none',
  RPDB: 'rpdb',
  TOP_POSTERS: 'topPosters',
};

/**
 * Get the base URL for a given poster service
 * @param {string} service - The poster service identifier
 * @returns {string|null} The base URL or null if service is invalid/none
 */
function getServiceBaseUrl(service) {
  switch (service) {
    case PosterService.RPDB:
      return RPDB_BASE_URL;
    case PosterService.TOP_POSTERS:
      return TOP_POSTERS_BASE_URL;
    default:
      return null;
  }
}

/**
 * Generate a poster URL using RPDB or Top Posters API
 *
 * Both APIs share the same URL structure:
 * /{apiKey}/{idType}/poster-default/{mediaId}.jpg
 *
 * For TMDb IDs, the mediaId must be prefixed with 'movie-' or 'series-'.
 * IMDb IDs (tt...) can be used directly and are preferred when available.
 *
 * @param {Object} options - Configuration options
 * @param {string} options.apiKey - The API key for the poster service
 * @param {string} options.service - The poster service to use ('rpdb' or 'topPosters')
 * @param {number|string} options.tmdbId - The TMDB ID of the movie/series
 * @param {string} options.type - Content type ('movie' or 'series')
 * @param {string|null} [options.imdbId=null] - Optional IMDb ID (preferred if available)
 * @returns {string|null} The poster URL or null if generation not possible
 */
export function generatePosterUrl(options) {
  const { apiKey, service, tmdbId, type, imdbId = null } = options;

  // Validate required parameters
  if (!apiKey || !service || service === PosterService.NONE) {
    return null;
  }

  if (!tmdbId && !imdbId) {
    log.debug('Cannot generate poster URL: no ID provided');
    return null;
  }

  const baseUrl = getServiceBaseUrl(service);
  if (!baseUrl) {
    log.debug('Unknown poster service', { service });
    return null;
  }

  // Prefer IMDb ID if available (more reliable for poster lookup)
  if (imdbId && typeof imdbId === 'string' && imdbId.startsWith('tt')) {
    return `${baseUrl}/${apiKey}/imdb/poster-default/${imdbId}.jpg?fallback=true`;
  }

  // Use TMDb ID with appropriate prefix
  const prefix = type === 'series' ? 'series' : 'movie';
  return `${baseUrl}/${apiKey}/tmdb/poster-default/${prefix}-${tmdbId}.jpg?fallback=true`;
}

/**
 * Generate a background/backdrop URL using RPDB or Top Posters API
 *
 * @param {Object} options - Configuration options
 * @param {string} options.apiKey - The API key for the poster service
 * @param {string} options.service - The poster service to use
 * @param {number|string} options.tmdbId - The TMDB ID
 * @param {string} options.type - Content type ('movie' or 'series')
 * @param {string|null} [options.imdbId=null] - Optional IMDb ID
 * @returns {string|null} The backdrop URL or null
 */
export function generateBackdropUrl(options) {
  const { apiKey, service, tmdbId, type, imdbId = null } = options;

  if (!apiKey || !service || service === PosterService.NONE) {
    return null;
  }

  if (!tmdbId && !imdbId) {
    return null;
  }

  const baseUrl = getServiceBaseUrl(service);
  if (!baseUrl) {
    return null;
  }

  // Prefer IMDb ID if available
  if (imdbId && typeof imdbId === 'string' && imdbId.startsWith('tt')) {
    return `${baseUrl}/${apiKey}/imdb/backdrop-default/${imdbId}.jpg?fallback=true`;
  }

  const prefix = type === 'series' ? 'series' : 'movie';
  return `${baseUrl}/${apiKey}/tmdb/backdrop-default/${prefix}-${tmdbId}.jpg?fallback=true`;
}

/**
 * Check if poster options are valid for generating enhanced poster URLs
 *
 * @param {Object} posterOptions - The poster configuration
 * @param {string} posterOptions.apiKey - API key
 * @param {string} posterOptions.service - Service type
 * @returns {boolean} True if options are valid for poster generation
 */
export function isValidPosterConfig(posterOptions) {
  if (!posterOptions) return false;
  const { apiKey, service } = posterOptions;
  return Boolean(apiKey && service && service !== PosterService.NONE);
}

/**
 * Create poster options object from user preferences
 *
 * @param {Object} preferences - User preferences from config
 * @param {Function} decryptFn - Function to decrypt the API key
 * @returns {Object|null} Poster options or null if not configured
 */
export function createPosterOptions(preferences, decryptFn) {
  if (
    !preferences ||
    !preferences.posterService ||
    preferences.posterService === PosterService.NONE
  ) {
    return null;
  }

  if (!preferences.posterApiKeyEncrypted) {
    return null;
  }

  const apiKey = decryptFn(preferences.posterApiKeyEncrypted);
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    service: preferences.posterService,
  };
}
