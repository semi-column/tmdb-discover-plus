import { createLogger } from '../../utils/logger.ts';
import { logSwallowedError } from '../../utils/helpers.ts';
import { getCache } from '../cache/index.ts';
import { tmdbFetch } from './client.ts';
import { TMDB_IMAGE_BASE } from './constants.ts';
import { formatRuntime } from './stremioMeta.ts';
import * as imdb from '../imdb/index.ts';
import { CONCURRENCY, CACHE_TTLS, DISPLAY } from '../../constants.ts';

import type {
  ContentType,
  Logger,
  TmdbImage,
  TmdbSeason,
  TmdbTvDetails,
  StremioVideo,
} from '../../types/index.ts';

const log = createLogger('tmdb:details') as Logger;

const DETAIL_CONCURRENCY = CONCURRENCY.TMDB_DETAIL;

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
      await cache.set(cacheKey, logos, CACHE_TTLS.LOGO);
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
      await cache.set(cacheKey, data, CACHE_TTLS.DETAIL);
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

interface ImdbEpisodeEdge {
  position?: number;
  node?: {
    id?: string;
    titleText?: { text?: string };
    plot?: { plotText?: { plainText?: string } };
    releaseDate?: { year?: number; month?: number | null; day?: number | null };
    runtime?: { seconds?: number };
    primaryImage?: { url?: string };
  };
}

const IMDB_EPISODE_PAGE_LIMIT = DISPLAY.IMDB_EPISODE_PAGE_LIMIT;
const IMDB_EPISODE_PAGE_MAX = DISPLAY.IMDB_EPISODE_PAGE_MAX;

async function getImdbEpisodesForSeason(
  imdbId: string,
  season: number
): Promise<ImdbEpisodeEdge[]> {
  const edges: ImdbEpisodeEdge[] = [];
  let endCursor: string | undefined;

  for (let i = 0; i < IMDB_EPISODE_PAGE_MAX; i++) {
    const response = await imdb.getEpisodesBySeason(imdbId, {
      season,
      limit: IMDB_EPISODE_PAGE_LIMIT,
      endCursor,
    });

    const page = response?.title?.episodes?.episodes;
    const pageEdges = Array.isArray(page?.edges) ? page.edges : [];
    edges.push(...(pageEdges as ImdbEpisodeEdge[]));

    const hasNext = Boolean(page?.pageInfo?.hasNextPage);
    const nextCursor = page?.pageInfo?.endCursor || undefined;
    if (!hasNext || !nextCursor) break;
    endCursor = nextCursor;
  }

  return edges;
}

function mapImdbEpisodesToStremioVideos(
  imdbId: string,
  season: number,
  episodes: ImdbEpisodeEdge[],
  seasonPosterMap: Record<number, string>,
  seriesBackdrop: string | null
): StremioVideo[] {
  return episodes
    .map((ep): StremioVideo | null => {
      const episode = Number(ep.position);

      if (!Number.isFinite(episode) || episode <= 0) return null;

      const title = ep.node?.titleText?.text || `Episode ${episode}`;

      const releaseDate = ep.node?.releaseDate;
      const releaseYear = releaseDate?.year;
      const releaseMonth = releaseDate?.month ?? 1;
      const releaseDay = releaseDate?.day ?? 1;
      const released =
        typeof releaseYear === 'number'
          ? new Date(
              Date.UTC(releaseYear, Math.max(releaseMonth - 1, 0), Math.max(releaseDay, 1))
            ).toISOString()
          : undefined;

      let runtime: string | undefined;
      const runtimeSeconds = ep.node?.runtime?.seconds;
      if (typeof runtimeSeconds === 'number' && runtimeSeconds > 0) {
        runtime = formatRuntime(Math.round(runtimeSeconds / 60));
      }

      const video: StremioVideo = {
        id: ep.node?.id || `${imdbId}:${season}:${episode}`,
        season,
        episode,
        title,
      };

      if (released) video.released = released;
      const overview = ep.node?.plot?.plotText?.plainText;
      if (overview) video.overview = overview;

      const thumbnail =
        ep.node?.primaryImage?.url || seasonPosterMap[season] || seriesBackdrop || undefined;
      if (thumbnail) video.thumbnail = thumbnail;

      if (released) video.available = new Date(released) <= new Date();
      if (runtime) video.runtime = runtime;

      return video;
    })
    .filter((v): v is StremioVideo => v !== null);
}

function mergeSeriesVideos(primary: StremioVideo[], fallback: StremioVideo[]): StremioVideo[] {
  const merged = new Map<string, StremioVideo>();

  for (const v of primary) {
    merged.set(`${v.season}:${v.episode}`, { ...v });
  }

  for (const fb of fallback) {
    const key = `${fb.season}:${fb.episode}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...fb });
      continue;
    }

    const isGenericTmdbTitle =
      !current.title || new RegExp(`^Episode\\s+${current.episode}$`, 'i').test(current.title);

    merged.set(key, {
      ...current,
      title: isGenericTmdbTitle && fb.title ? fb.title : current.title,
      overview: current.overview || fb.overview,
      released: current.released || fb.released,
      thumbnail: current.thumbnail || fb.thumbnail,
      runtime: current.runtime || fb.runtime,
      available: current.available ?? fb.available,
    });
  }

  return Array.from(merged.values()).sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    return a.episode - b.episode;
  });
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

  const seasonQueue = regularSeasons.slice(0, 50);
  const seasonResults: StremioVideo[][] = [];

  for (let i = 0; i < seasonQueue.length; i += DETAIL_CONCURRENCY) {
    const batch = seasonQueue.slice(i, i + DETAIL_CONCURRENCY);
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

  if (imdbId) {
    const fallbackVideos: StremioVideo[] = [];
    const IMDB_SEASON_CONCURRENCY = CONCURRENCY.IMDB_SEASON;
    const tmdbSeasonNumbers = seasonQueue.map((s) => s.season_number).filter((n) => n > 0);
    const maxTmdbSeason = tmdbSeasonNumbers.length > 0 ? Math.max(...tmdbSeasonNumbers) : 0;
    const seasonNumbersToProbe = Array.from(
      new Set([
        ...tmdbSeasonNumbers,
        ...(maxTmdbSeason > 0 ? [maxTmdbSeason + 1, maxTmdbSeason + 2] : [1, 2]),
      ])
    ).sort((a, b) => a - b);

    const imdbSeasonQueue = seasonNumbersToProbe.map((season_number) => ({ season_number }));

    for (let i = 0; i < imdbSeasonQueue.length; i += IMDB_SEASON_CONCURRENCY) {
      const batch = imdbSeasonQueue.slice(i, i + IMDB_SEASON_CONCURRENCY);
      const batchVideos = await Promise.all(
        batch.map(async (season) => {
          try {
            const episodeEdges = await getImdbEpisodesForSeason(imdbId, season.season_number);
            if (!episodeEdges.length) return [];
            return mapImdbEpisodesToStremioVideos(
              imdbId,
              season.season_number,
              episodeEdges,
              seasonPosterMap,
              seriesBackdrop
            );
          } catch (error) {
            log.debug('IMDb season episode fetch failed', {
              imdbId,
              season: season.season_number,
              error: (error as Error).message,
            });
            return [];
          }
        })
      );

      for (const arr of batchVideos) fallbackVideos.push(...arr);
    }

    if (fallbackVideos.length > 0) {
      const merged = mergeSeriesVideos(videos, fallbackVideos);
      if (merged.length > videos.length) {
        log.debug('Merged missing episodes from IMDb API', {
          tmdbId,
          tmdbCount: videos.length,
          imdbCount: fallbackVideos.length,
          mergedCount: merged.length,
        });
      }
      return merged;
    }
  }

  return videos;
}

export async function batchGetDetails(
  apiKey: string,
  tmdbIds: number[],
  type: ContentType,
  options?: { displayLanguage?: string }
): Promise<Map<number, unknown>> {
  const results = new Map<number, unknown>();

  for (let i = 0; i < tmdbIds.length; i += DETAIL_CONCURRENCY) {
    const batch = tmdbIds.slice(i, i + DETAIL_CONCURRENCY);
    await Promise.all(
      batch.map(async (tmdbId) => {
        try {
          const details = await getDetails(apiKey, tmdbId, type, {
            displayLanguage: options?.displayLanguage,
          });
          if (details) results.set(tmdbId, details);
        } catch (err) {
          logSwallowedError('tmdb-details:catalog-batch-fetch', err);
        }
      })
    );
  }

  return results;
}
