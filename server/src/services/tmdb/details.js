import { createLogger } from '../../utils/logger.js';
import { getCache } from '../cache/index.js';
import { tmdbFetch } from './client.js';
import { TMDB_IMAGE_BASE } from './constants.js';
import { formatRuntime } from './stremioMeta.js';

const log = createLogger('tmdb:details');

/**
 * Get detailed info for a movie or TV show
 */
export async function getDetails(apiKey, tmdbId, type = 'movie') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  // Allow localization via TMDB `language` parameter.
  // eslint-disable-next-line prefer-rest-params
  const maybeOptions = arguments.length >= 4 ? arguments[3] : undefined;
  const languageParam = maybeOptions?.displayLanguage || maybeOptions?.language;

  // Build params for the request
  const params = {
    append_to_response: 'external_ids,credits,videos,release_dates,content_ratings,images',
  };

  if (languageParam) {
    params.language = languageParam;

    // Include videos in target language + English fallback
    params.include_video_language = `${languageParam},en,null`;
    // Include images (logos, posters, backdrops) in target language + English + null (textless)
    params.include_image_language = `${languageParam},en,null`;
  } else {
    // Default to English videos/images if no language specified
    params.include_video_language = 'en,null';
    params.include_image_language = 'en,null';
  }

  return tmdbFetch(`/${mediaType}/${tmdbId}`, apiKey, params);
}

export async function getLogos(apiKey, tmdbId, type = 'movie') {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const cacheKey = `logos_${mediaType}_${tmdbId}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    /* ignore */
  }

  try {
    const data = await tmdbFetch(`/${mediaType}/${tmdbId}/images`, apiKey);
    const logos = data?.logos || [];
    try {
      await cache.set(cacheKey, logos, 86400 * 7);
    } catch (e) {
      /* ignore */
    }
    return logos;
  } catch (e) {
    log.warn('Failed to fetch logos', { tmdbId, type, error: e.message });
    return [];
  }
}

/**
 * Get season details including episodes
 * @param {string} apiKey - TMDB API key
 * @param {number} tmdbId - TMDB TV show ID
 * @param {number} seasonNumber - Season number
 * @param {Object} options - Optional parameters
 * @returns {Object} Season details with episodes
 */
export async function getSeasonDetails(apiKey, tmdbId, seasonNumber, options = {}) {
  const languageParam = options?.displayLanguage || options?.language;
  const cacheKey = `season_${tmdbId}_${seasonNumber}_${languageParam || 'en'}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    /* ignore */
  }

  const params = {};
  if (languageParam) params.language = languageParam;

  try {
    const data = await tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`, apiKey, params);
    try {
      await cache.set(cacheKey, data, 86400); // Cache for 24 hours
    } catch (e) {
      /* ignore cache errors */
    }
    return data;
  } catch (error) {
    log.warn('Failed to fetch season details', { tmdbId, seasonNumber, error: error.message });
    return null;
  }
}

/**
 * Get all episodes for a TV series
 * @param {string} apiKey - TMDB API key
 * @param {number} tmdbId - TMDB TV show ID
 * @param {Object} details - TV show details (must include seasons array)
 * @param {Object} options - Optional parameters
 * @returns {Array} Array of Stremio Video objects
 */
export async function getSeriesEpisodes(apiKey, tmdbId, details, options = {}) {
  if (!details?.seasons || !Array.isArray(details.seasons)) {
    return [];
  }

  const imdbId = details?.external_ids?.imdb_id || null;
  const videos = [];

  // Filter out specials (season 0) and get regular seasons
  const regularSeasons = details.seasons.filter((s) => s.season_number > 0);

  // Series backdrop for episode thumbnail fallback
  const seriesBackdrop = details.backdrop_path
    ? `${TMDB_IMAGE_BASE}/w500${details.backdrop_path}`
    : null;

  // Build a season poster map for episode thumbnail fallback
  const seasonPosterMap = {};
  for (const s of regularSeasons) {
    if (s.poster_path) {
      seasonPosterMap[s.season_number] = `${TMDB_IMAGE_BASE}/w500${s.poster_path}`;
    }
  }

  // Fetch all seasons in parallel (with reasonable limit)
  const seasonPromises = regularSeasons.slice(0, 50).map(async (season) => {
    const seasonData = await getSeasonDetails(apiKey, tmdbId, season.season_number, options);
    if (!seasonData?.episodes) return [];

    return seasonData.episodes.map((ep) => {
      // Build episode ID: prefer IMDb format for Cinemeta/stream compatibility
      const episodeId = imdbId
        ? `${imdbId}:${ep.season_number}:${ep.episode_number}`
        : `tmdb:${tmdbId}:${ep.season_number}:${ep.episode_number}`;

      // Thumbnail fallback chain: episode still → season poster → series backdrop
      const thumbnail = ep.still_path
        ? `${TMDB_IMAGE_BASE}/w500${ep.still_path}`
        : seasonPosterMap[ep.season_number] || seriesBackdrop || undefined;

      return {
        id: episodeId,
        season: ep.season_number,
        episode: ep.episode_number,
        title: ep.name || `Episode ${ep.episode_number}`,
        released: ep.air_date ? new Date(ep.air_date).toISOString() : undefined,
        overview: ep.overview || undefined,
        thumbnail,
        available: ep.air_date ? new Date(ep.air_date) <= new Date() : undefined,
        runtime: formatRuntime(ep.runtime),
      };
    });
  });

  const seasonResults = await Promise.all(seasonPromises);

  // Flatten and sort by season/episode
  for (const episodes of seasonResults) {
    videos.push(...episodes);
  }

  videos.sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    return a.episode - b.episode;
  });

  return videos;
}
