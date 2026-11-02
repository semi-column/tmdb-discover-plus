import { createLogger } from '../../utils/logger.ts';
import { logSwallowedError } from '../../utils/helpers.ts';
import { getCache } from '../cache/index.ts';
import { tmdbFetch } from './client.ts';
import { TMDB_IMAGE_BASE } from './constants.ts';
import { formatRuntime } from './stremioMeta.ts';
import { generateEpisodeThumbnailUrl, isValidPosterConfig } from '../artworkService.ts';
import * as imdb from '../imdb/index.ts';
import { CONCURRENCY, DISPLAY, TIMEOUTS } from '../../constants.ts';
import { CACHE_TTLS } from '../../cacheTtls.ts';
import {
  getRequestRemainingMs,
  isRequestAborted,
  throwIfRequestAborted,
} from '../../utils/requestContext.ts';

import type {
  ArtworkOptions,
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
  artworkOptions?: ArtworkOptions | null;
  completedSeason?: boolean;
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
    throwIfRequestAborted();
    log.warn('Failed to fetch logos', { tmdbId, type, error: e });
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
      await cache.set(
        cacheKey,
        data,
        options.completedSeason ? CACHE_TTLS.SEASON_COMPLETED : CACHE_TTLS.DETAIL
      );
    } catch (e) {
      log.debug('Cache set failed', { key: cacheKey, error: (e as Error).message });
    }
    return data;
  } catch (error) {
    throwIfRequestAborted();
    log.warn('Failed to fetch season details', {
      tmdbId,
      seasonNumber,
      error,
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
  status?: string;
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
/** IMDb episodes only fill gaps in TMDB data; stop starting new pages once the request is this close to timing out. */
const IMDB_ENRICHMENT_RESERVE_MS = 8_000;

function hasImdbEnrichmentBudget(): boolean {
  return getRequestRemainingMs(TIMEOUTS.REQUEST_MS) > IMDB_ENRICHMENT_RESERVE_MS;
}

/**
 * Resolves true when `work` settles, false once the enrichment budget runs out. A started page
 * can wait ~10s for a throttle token plus ~10s to fetch, so checking before each page isn't enough.
 * Abandoned pages keep running and still fill the cache for the next request.
 */
async function settlesWithinImdbBudget(work: Promise<unknown>): Promise<boolean> {
  const waitMs = getRequestRemainingMs(TIMEOUTS.REQUEST_MS) - IMDB_ENRICHMENT_RESERVE_MS;
  if (!Number.isFinite(waitMs)) return work.then(() => true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, waitMs));
  });
  try {
    return await Promise.race([work.then(() => true), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function getImdbEpisodesForSeason(
  imdbId: string,
  season: number
): Promise<ImdbEpisodeEdge[]> {
  const edges: ImdbEpisodeEdge[] = [];
  let endCursor: string | undefined;
  const cursors = new Set<string>();

  while (true) {
    throwIfRequestAborted();
    // Pages already fetched are cached, so a later request picks up where this one stopped.
    if (!hasImdbEnrichmentBudget()) break;

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
    if (cursors.has(nextCursor))
      throw new Error('IMDb episode pagination returned a repeated cursor');
    cursors.add(nextCursor);
    endCursor = nextCursor;
  }

  throwIfRequestAborted();
  return edges;
}

function mapImdbEpisodesToStremioVideos(
  imdbId: string,
  season: number,
  episodes: ImdbEpisodeEdge[]
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

      const imdbImage = ep.node?.primaryImage?.url;
      if (imdbImage) video.thumbnail = imdbImage;

      if (released) video.available = new Date(released) <= new Date();
      if (runtime) video.runtime = runtime;

      return video;
    })
    .filter((v): v is StremioVideo => v !== null);
}

function mergeSeriesVideos(tmdbVideos: StremioVideo[], imdbVideos: StremioVideo[]): StremioVideo[] {
  const tmdbMap = new Map<string, StremioVideo>();
  const imdbMap = new Map<string, StremioVideo>();

  for (const v of tmdbVideos) tmdbMap.set(`${v.season}:${v.episode}`, { ...v });
  for (const v of imdbVideos) imdbMap.set(`${v.season}:${v.episode}`, { ...v });

  const allKeys = new Set([...tmdbMap.keys(), ...imdbMap.keys()]);
  const merged: StremioVideo[] = [];

  for (const key of allKeys) {
    const tmdb = tmdbMap.get(key);
    const imdbEp = imdbMap.get(key);

    if (!tmdb && !imdbEp) continue;
    if (!tmdb) {
      merged.push(imdbEp!);
      continue;
    }
    if (!imdbEp) {
      merged.push(tmdb);
      continue;
    }

    const isGenericTitle =
      !tmdb.title || new RegExp(`^Episode\\s+${tmdb.episode}$`, 'i').test(tmdb.title);

    merged.push({
      id: tmdb.id,
      season: tmdb.season,
      episode: tmdb.episode,
      title: isGenericTitle && imdbEp.title ? imdbEp.title : tmdb.title,
      overview: imdbEp.overview || tmdb.overview,
      released: tmdb.released || imdbEp.released,
      thumbnail: tmdb.thumbnail || imdbEp.thumbnail,
      runtime: tmdb.runtime || imdbEp.runtime,
      available: tmdb.available ?? imdbEp.available,
    });
  }

  return merged.sort((a, b) => {
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
  throwIfRequestAborted();
  if (!details?.seasons || !Array.isArray(details.seasons)) {
    return [];
  }

  const imdbId = details?.external_ids?.imdb_id || null;
  const language = options.displayLanguage || options.language || null;
  const episodeOptions = options.artworkOptions?.episode || null;
  const videos: StremioVideo[] = [];

  const applyEpisodeThumbnailOverride = (video: StremioVideo): void => {
    if (!episodeOptions || !isValidPosterConfig(episodeOptions)) return;

    const enhancedThumbnail = generateEpisodeThumbnailUrl({
      ...episodeOptions,
      tmdbId,
      type: 'series',
      imdbId,
      language,
      season: video.season,
      episode: video.episode,
    });

    if (enhancedThumbnail) {
      video.thumbnail = enhancedThumbnail;
    }
  };

  const regularSeasons = details.seasons.filter((s) => s.season_number > 0);
  const latestSeasonNumber = Math.max(0, ...regularSeasons.map((season) => season.season_number));
  const seriesEnded = details.status === 'Ended' || details.status === 'Canceled';

  const seriesBackdrop = details.backdrop_path
    ? `${TMDB_IMAGE_BASE}/w500${details.backdrop_path}`
    : null;

  const seasonPosterMap: Record<number, string> = {};
  for (const s of regularSeasons) {
    if (s.poster_path) {
      seasonPosterMap[s.season_number] = `${TMDB_IMAGE_BASE}/w500${s.poster_path}`;
    }
  }

  const seasonQueue = regularSeasons;
  const seasonResults: StremioVideo[][] = [];
  const seasonDataByNumber = new Map<number, SeasonDetailsResult>();
  const cache = getCache();
  const seasonCacheKey = (number: number) => `season_${tmdbId}_${number}_${language || 'en'}`;
  await Promise.all(
    seasonQueue.map(async (season) => {
      const cached = (await cache.get(
        seasonCacheKey(season.season_number)
      )) as SeasonDetailsResult | null;
      if (cached?.episodes) seasonDataByNumber.set(season.season_number, cached);
    })
  );
  const missingSeasons = seasonQueue.filter(
    (season) => !seasonDataByNumber.has(season.season_number)
  );
  // TMDB supports up to 20 appended subresources per TV details request.
  for (let i = 0; i < missingSeasons.length; i += 20) {
    throwIfRequestAborted();
    const batch = missingSeasons.slice(i, i + 20);
    if (batch.length === 1) continue; // The normal season endpoint is smaller for one miss.
    try {
      const data = (await tmdbFetch(`/tv/${tmdbId}`, apiKey, {
        append_to_response: batch.map((season) => `season/${season.season_number}`).join(','),
        ...(language ? { language } : {}),
      })) as Record<string, SeasonDetailsResult>;
      throwIfRequestAborted();
      for (const season of batch) {
        const seasonData = data[`season/${season.season_number}`];
        if (!Array.isArray(seasonData?.episodes)) continue;
        seasonDataByNumber.set(season.season_number, seasonData);
        await cache.set(
          seasonCacheKey(season.season_number),
          seasonData,
          seriesEnded || season.season_number < latestSeasonNumber
            ? CACHE_TTLS.SEASON_COMPLETED
            : CACHE_TTLS.DETAIL
        );
      }
    } catch (error) {
      throwIfRequestAborted();
      log.warn('Season batch fetch failed, falling back to individual seasons', { tmdbId, error });
    }
  }

  for (let i = 0; i < seasonQueue.length; i += DETAIL_CONCURRENCY) {
    throwIfRequestAborted();

    const batch = seasonQueue.slice(i, i + DETAIL_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (season) => {
        const seasonData =
          seasonDataByNumber.get(season.season_number) ||
          ((await getSeasonDetails(apiKey, tmdbId, season.season_number, {
            ...options,
            completedSeason: seriesEnded || season.season_number < latestSeasonNumber,
          })) as SeasonDetailsResult | null);
        if (!seasonData?.episodes) return [];

        return seasonData.episodes.map((ep) => {
          const episodeId = imdbId
            ? `${imdbId}:${ep.season_number}:${ep.episode_number}`
            : `tmdb:${tmdbId}:${ep.season_number}:${ep.episode_number}`;

          const video: StremioVideo = {
            id: episodeId,
            season: ep.season_number,
            episode: ep.episode_number,
            title: ep.name || `Episode ${ep.episode_number}`,
            released: ep.air_date ? new Date(ep.air_date).toISOString() : undefined,
            overview: ep.overview || undefined,
            thumbnail: ep.still_path ? `${TMDB_IMAGE_BASE}/w500${ep.still_path}` : undefined,
            available: ep.air_date ? new Date(ep.air_date) <= new Date() : undefined,
            runtime: formatRuntime(ep.runtime),
          };

          return video;
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
      throwIfRequestAborted();
      if (!hasImdbEnrichmentBudget()) {
        log.info('IMDb episode enrichment stopped early to meet request deadline', {
          imdbId,
          seasonsFetched: i,
          seasonsTotal: imdbSeasonQueue.length,
        });
        break;
      }

      const batch = imdbSeasonQueue.slice(i, i + IMDB_SEASON_CONCURRENCY);
      // Seasons are kept as they finish, so a deadline cut still merges the ones that made it.
      const finished: StremioVideo[][] = [];
      const work = Promise.all(
        batch.map(async (season) => {
          try {
            const episodeEdges = await getImdbEpisodesForSeason(imdbId, season.season_number);
            if (episodeEdges.length)
              finished.push(
                mapImdbEpisodesToStremioVideos(imdbId, season.season_number, episodeEdges)
              );
          } catch (error) {
            if (isRequestAborted()) return;
            log.debug('IMDb season episode fetch failed', {
              imdbId,
              season: season.season_number,
              error,
            });
          }
        })
      );
      const completed = await settlesWithinImdbBudget(work);
      throwIfRequestAborted();
      for (const arr of finished.splice(0)) fallbackVideos.push(...arr);
      if (!completed) {
        log.info('IMDb episode enrichment cut off to meet request deadline', {
          imdbId,
          seasonsStarted: i + batch.length,
          seasonsTotal: imdbSeasonQueue.length,
        });
        break;
      }
    }

    if (fallbackVideos.length > 0) {
      throwIfRequestAborted();
      const merged = mergeSeriesVideos(videos, fallbackVideos);
      for (const v of merged) {
        applyEpisodeThumbnailOverride(v);
        if (!v.thumbnail) {
          v.thumbnail = seasonPosterMap[v.season] || seriesBackdrop || undefined;
        }
      }
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

  // Apply season poster / backdrop fallback for episodes without a thumbnail
  for (const v of videos) {
    applyEpisodeThumbnailOverride(v);
    if (!v.thumbnail) {
      v.thumbnail = seasonPosterMap[v.season] || seriesBackdrop || undefined;
    }
  }

  throwIfRequestAborted();
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
    throwIfRequestAborted();

    const batch = tmdbIds.slice(i, i + DETAIL_CONCURRENCY);
    await Promise.all(
      batch.map(async (tmdbId) => {
        try {
          const details = await getDetails(apiKey, tmdbId, type, {
            displayLanguage: options?.displayLanguage,
          });
          if (details) results.set(tmdbId, details);
        } catch (err) {
          throwIfRequestAborted();
          logSwallowedError('tmdb-details:catalog-batch-fetch', err);
        }
      })
    );
  }

  throwIfRequestAborted();
  return results;
}

export async function getPreviewDetails(
  apiKey: string,
  tmdbId: number | string,
  type: ContentType = 'movie',
  options?: DetailsOptions
): Promise<unknown> {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const languageParam = options?.displayLanguage || options?.language;

  const params: Record<string, string | number | boolean | undefined> = {
    append_to_response: 'external_ids,credits,images',
  };

  if (languageParam) {
    params.language = languageParam;
    params.include_image_language = `${languageParam},en,null`;
  } else {
    params.include_image_language = 'en,null';
  }

  return tmdbFetch(`/${mediaType}/${tmdbId}`, apiKey, params);
}

export async function batchGetPreviewDetails(
  apiKey: string,
  tmdbIds: number[],
  type: ContentType,
  options?: { displayLanguage?: string }
): Promise<Map<number, unknown>> {
  const results = new Map<number, unknown>();

  for (let i = 0; i < tmdbIds.length; i += DETAIL_CONCURRENCY) {
    throwIfRequestAborted();
    const batch = tmdbIds.slice(i, i + DETAIL_CONCURRENCY);
    await Promise.all(
      batch.map(async (tmdbId) => {
        try {
          const details = await getPreviewDetails(apiKey, tmdbId, type, {
            displayLanguage: options?.displayLanguage,
          });
          if (details) results.set(tmdbId, details);
        } catch (err) {
          throwIfRequestAborted();
          logSwallowedError('tmdb-details:catalog-preview-batch-fetch', err);
        }
      })
    );
  }

  throwIfRequestAborted();
  return results;
}
