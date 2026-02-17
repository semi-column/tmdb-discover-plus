import { createLogger } from '../../utils/logger.ts';
import { getCache } from '../cache/index.ts';
import { tmdbFetch } from './client.ts';
import { TMDB_IMAGE_BASE } from './constants.ts';
import { formatRuntime } from './stremioMeta.ts';

import type {
  ContentType,
  Logger,
  TmdbImage,
  TmdbSeason,
  TmdbTvDetails,
  StremioVideo,
} from '../../types/index.ts';

const log = createLogger('tmdb:details') as Logger;

interface DetailsOptions {
  displayLanguage?: string;
  language?: string;
}

export async function getDetails(
  apiKey: string,
  tmdbId: number | string,
  type: ContentType = 'movie',
  options?: DetailsOptions
): Promise<unknown> {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const languageParam = options?.displayLanguage || options?.language;

  const params: Record<string, string | number | boolean | undefined> = {
    append_to_response: 'external_ids,credits,videos,release_dates,content_ratings,images',
  };

  if (languageParam) {
    params.language = languageParam;
    params.include_video_language = `${languageParam},en,null`;
    params.include_image_language = `${languageParam},en,null`;
  } else {
    params.include_video_language = 'en,null';
    params.include_image_language = 'en,null';
  }

  return tmdbFetch(`/${mediaType}/${tmdbId}`, apiKey, params);
}

export async function getLogos(
  apiKey: string,
  tmdbId: number | string,
  type: ContentType = 'movie'
): Promise<TmdbImage[]> {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const cacheKey = `logos_${mediaType}_${tmdbId}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached as TmdbImage[];
  } catch (e) {
    log.debug('Cache get failed', { key: cacheKey, error: (e as Error).message });
  }

  try {
    const data = (await tmdbFetch(`/${mediaType}/${tmdbId}/images`, apiKey)) as {
      logos?: TmdbImage[];
    };
    const logos = data?.logos || [];
    try {
      await cache.set(cacheKey, logos, 86400 * 7);
    } catch (e) {
      log.debug('Cache set failed', { key: cacheKey, error: (e as Error).message });
    }
    return logos;
  } catch (e) {
    log.warn('Failed to fetch logos', { tmdbId, type, error: (e as Error).message });
    return [];
  }
}

export async function getSeasonDetails(
  apiKey: string,
  tmdbId: number | string,
  seasonNumber: number,
  options: DetailsOptions = {}
): Promise<unknown> {
  const languageParam = options?.displayLanguage || options?.language;
  const cacheKey = `season_${tmdbId}_${seasonNumber}_${languageParam || 'en'}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    log.debug('Cache get failed', { key: cacheKey, error: (e as Error).message });
  }

  const params: Record<string, string | undefined> = {};
  if (languageParam) params.language = languageParam;

  try {
    const data = await tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`, apiKey, params);
    try {
      await cache.set(cacheKey, data, 86400);
    } catch (e) {
      log.debug('Cache set failed', { key: cacheKey, error: (e as Error).message });
    }
    return data;
  } catch (error) {
    log.warn('Failed to fetch season details', {
      tmdbId,
      seasonNumber,
      error: (error as Error).message,
    });
    return null;
  }
}

interface SeasonDetailsResult {
  episodes?: Array<{
    season_number: number;
    episode_number: number;
    name: string;
    overview: string;
    air_date: string | null;
    still_path: string | null;
    runtime: number | null;
  }>;
}

interface TvDetailsForEpisodes {
  seasons?: TmdbSeason[];
  backdrop_path?: string | null;
  external_ids?: { imdb_id?: string | null };
}

export async function getSeriesEpisodes(
  apiKey: string,
  tmdbId: number | string,
  details: TvDetailsForEpisodes,
  options: DetailsOptions = {}
): Promise<StremioVideo[]> {
  if (!details?.seasons || !Array.isArray(details.seasons)) {
    return [];
  }

  const imdbId = details?.external_ids?.imdb_id || null;
  const videos: StremioVideo[] = [];

  const regularSeasons = details.seasons.filter((s) => s.season_number > 0);

  const seriesBackdrop = details.backdrop_path
    ? `${TMDB_IMAGE_BASE}/w500${details.backdrop_path}`
    : null;

  const seasonPosterMap: Record<number, string> = {};
  for (const s of regularSeasons) {
    if (s.poster_path) {
      seasonPosterMap[s.season_number] = `${TMDB_IMAGE_BASE}/w500${s.poster_path}`;
    }
  }

  const CONCURRENCY = 5;
  const seasonQueue = regularSeasons.slice(0, 50);
  const seasonResults: StremioVideo[][] = [];

  for (let i = 0; i < seasonQueue.length; i += CONCURRENCY) {
    const batch = seasonQueue.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (season) => {
        const seasonData = (await getSeasonDetails(
          apiKey,
          tmdbId,
          season.season_number,
          options
        )) as SeasonDetailsResult | null;
        if (!seasonData?.episodes) return [];

        return seasonData.episodes.map((ep) => {
          const episodeId = imdbId
            ? `${imdbId}:${ep.season_number}:${ep.episode_number}`
            : `tmdb:${tmdbId}:${ep.season_number}:${ep.episode_number}`;

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
      })
    );
    seasonResults.push(...batchResults);
  }

  for (const episodes of seasonResults) {
    videos.push(...episodes);
  }

  videos.sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    return a.episode - b.episode;
  });

  return videos;
}
