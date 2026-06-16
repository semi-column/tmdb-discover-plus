import { anilistIdToStremioId, getEntryByAnilistId } from '../animeIdMap/index.ts';
import type { AnilistMedia, AnilistMediaDetail } from './types.ts';
import type {
  StremioMetaPreview,
  StremioMeta,
  StremioVideo,
  AppExtras,
} from '../../types/stremio.ts';
import type { StremioLink, StremioTrailer } from '../../types/stremio.ts';
import type { ContentType } from '../../types/common.ts';
import type { ArtworkOptions } from '../../types/config.ts';
import { generateSlug, formatRuntime } from '../common/stremioHelpers.ts';
import { applyArtworkOverridesSync } from '../artworkService.ts';
import type { ArtworkContext, NativeArtworkUrls } from '../artworkService.ts';

function stripHtml(text: string): string {
  let out = '';
  let inTag = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '<') {
      inTag = true;
      continue;
    }
    if (ch === '>') {
      inTag = false;
      continue;
    }
    if (!inTag) out += ch;
  }

  return out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Builds Stremio links (clickable Studios/Directors/Writers) from an AniList
 * media's studios and staff. Shared by the preview and full meta builders.
 */
function buildAnilistLinks(media: AnilistMedia): StremioLink[] {
  const links: StremioLink[] = [];

  const animationStudios = media.studios?.nodes?.filter((s) => s.isAnimationStudio) || [];
  for (const studio of animationStudios) {
    links.push({
      name: studio.name,
      category: 'Studios',
      url: `https://anilist.co/studio/${studio.id}`,
    });
  }

  const staffEdges = media.staff?.edges || [];
  for (const edge of staffEdges) {
    if (edge.node?.name?.full && edge.role) {
      const role = edge.role.toLowerCase();
      let category: 'Directors' | 'Writers' | undefined;
      if (role.includes('director')) category = 'Directors';
      else if (
        role.includes('script') ||
        role.includes('writer') ||
        role.includes('story') ||
        role.includes('composition')
      )
        category = 'Writers';
      if (category) {
        links.push({
          name: edge.node.name.full,
          category,
          url: `https://anilist.co/staff/${edge.node.id}`,
        });
      }
    }
  }

  return links;
}

/**
 * Builds the fallback Stremio id for an AniList entry that has no IMDB/Kitsu
 * mapping. Prefers a MAL id (widely recognized by streaming addons and
 * resolvable back to AniList via idMal) and falls back to the AniList id.
 */
function anilistFallbackId(media: AnilistMedia): string {
  return media.idMal ? `mal:${media.idMal}` : `anilist:${media.id}`;
}

export function anilistToStremioMeta(
  media: AnilistMedia,
  type: ContentType,
  artworkOptions: ArtworkOptions | null = null
): StremioMetaPreview | null {
  const stremioId = anilistIdToStremioId(media.id) || anilistFallbackId(media);

  const mapEntry = getEntryByAnilistId(media.id);
  const imdbId = mapEntry?.imdb_id || (stremioId.startsWith('tt') ? stremioId : null);
  const primaryId = imdbId || stremioId;
  const tmdbId = mapEntry?.themoviedb_id ?? 0;

  const title = media.title?.english || media.title?.romaji || media.title?.native || 'Unknown';

  const nativePoster = media.coverImage?.extraLarge || media.coverImage?.large || null;
  const nativeBackground = media.bannerImage || null;
  const description = media.description ? stripHtml(media.description) : '';

  const artworkContext: ArtworkContext = {
    tmdbId: tmdbId || undefined,
    imdbId: imdbId ?? undefined,
    type,
  };
  const nativeUrls: NativeArtworkUrls = {
    poster: nativePoster,
    backdrop: nativeBackground,
    logo: null,
    landscape: nativeBackground,
  };
  const resolved = applyArtworkOverridesSync(artworkContext, nativeUrls, artworkOptions);
  const poster = resolved.poster;
  const background = resolved.backdrop;

  const genres = media.genres || [];

  const links = buildAnilistLinks(media);

  const releaseInfo: string[] = [];
  if (media.seasonYear) releaseInfo.push(String(media.seasonYear));
  else if (media.startDate?.year) releaseInfo.push(String(media.startDate.year));
  if (media.season) releaseInfo.push(media.season);

  const meta: StremioMetaPreview & { trailers?: StremioTrailer[] } = {
    id: primaryId,
    tmdbId,
    imdbId,
    imdb_id: imdbId,
    type,
    name: title,
    slug: generateSlug(type, title, primaryId),
    poster,
    posterShape: 'poster',
    background,
    fanart: resolved.landscape || background,
    landscapePoster: resolved.landscape || background,
    logo: resolved.logo || undefined,
    description,
    genres,
    links: links.length > 0 ? links : undefined,
    releaseInfo: releaseInfo.join(' '),
    imdbRating: media.averageScore ? (media.averageScore / 10).toFixed(1) : undefined,
    behaviorHints: {},
  };

  if (media.trailer?.site === 'youtube' && media.trailer.id) {
    meta.trailers = [{ source: media.trailer.id, type: 'Trailer' }];
  }

  return meta;
}

export function batchConvertToStremioMeta(
  mediaList: AnilistMedia[],
  type: ContentType,
  artworkOptions: ArtworkOptions | null = null
): StremioMetaPreview[] {
  const results: StremioMetaPreview[] = [];
  for (const media of mediaList) {
    const meta = anilistToStremioMeta(media, type, artworkOptions);
    if (meta) results.push(meta);
  }
  return results;
}

function isMovieFormat(media: AnilistMediaDetail): boolean {
  return media.format === 'MOVIE';
}

function buildIsoDate(date?: { year?: number; month?: number; day?: number }): string | undefined {
  if (!date?.year) return undefined;
  const month = String(date.month ?? 1).padStart(2, '0');
  const day = String(date.day ?? 1).padStart(2, '0');
  return `${date.year}-${month}-${day}T00:00:00.000Z`;
}

/**
 * Determines the absolute episode count for a series. Prefers AniList's
 * declared `episodes`, then the highest scheduled/streaming episode for
 * currently-airing titles where the total is not yet known.
 */
function resolveEpisodeCount(media: AnilistMediaDetail): number {
  if (typeof media.episodes === 'number' && media.episodes > 0) return media.episodes;

  let maxEpisode = 0;
  for (const node of media.airingSchedule?.nodes ?? []) {
    if (typeof node.episode === 'number' && node.episode > maxEpisode) maxEpisode = node.episode;
  }
  for (const ep of media.streamingEpisodes ?? []) {
    const parsed = parseEpisodeNumber(ep.title);
    if (parsed != null && parsed > maxEpisode) maxEpisode = parsed;
  }
  return maxEpisode;
}

function parseEpisodeNumber(title: string | undefined): number | null {
  if (!title) return null;
  const match = /episode\s+(\d+)/i.exec(title);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Picks the id namespace for episode video ids. Reuses the requested id when it
 * is already an anime namespace; otherwise prefers MAL (best streaming-addon
 * support) and falls back to the AniList id.
 */
function resolveVideoIdBase(media: AnilistMediaDetail, requestedId: string): string {
  const lower = requestedId.toLowerCase();
  if (lower.startsWith('mal:') || lower.startsWith('kitsu:') || lower.startsWith('anilist:')) {
    return requestedId;
  }
  if (media.idMal) return `mal:${media.idMal}`;
  return `anilist:${media.id}`;
}

/**
 * Builds a Stremio episode list from real AniList data: episode count drives
 * the list, airing schedule supplies release dates, and streaming episodes
 * supply titles/thumbnails when their episode number can be parsed reliably.
 */
function buildAnilistVideos(media: AnilistMediaDetail, videoIdBase: string): StremioVideo[] {
  const episodeCount = resolveEpisodeCount(media);
  if (episodeCount < 1) return [];

  const releasedByEpisode = new Map<number, string>();
  for (const node of media.airingSchedule?.nodes ?? []) {
    if (typeof node.episode === 'number' && typeof node.airingAt === 'number') {
      releasedByEpisode.set(node.episode, new Date(node.airingAt * 1000).toISOString());
    }
  }

  const streamingByEpisode = new Map<number, { title?: string; thumbnail?: string }>();
  for (const ep of media.streamingEpisodes ?? []) {
    const episodeNumber = parseEpisodeNumber(ep.title);
    if (episodeNumber != null && !streamingByEpisode.has(episodeNumber)) {
      streamingByEpisode.set(episodeNumber, { title: ep.title, thumbnail: ep.thumbnail });
    }
  }

  const videos: StremioVideo[] = [];
  for (let episode = 1; episode <= episodeCount; episode++) {
    const streaming = streamingByEpisode.get(episode);
    videos.push({
      id: `${videoIdBase}:${episode}`,
      season: 1,
      episode,
      title: streaming?.title?.trim() || `Episode ${episode}`,
      released: releasedByEpisode.get(episode),
      thumbnail: streaming?.thumbnail || undefined,
    });
  }
  return videos;
}

/**
 * Builds a full Stremio meta object from an AniList media detail. Used as the
 * metadata fallback for anime that have no TMDB/IMDB mapping. Movies expose a
 * single playable id; series expose a real episode list.
 */
export function anilistToStremioFullMeta(
  media: AnilistMediaDetail,
  type: ContentType,
  requestedId: string,
  artworkOptions: ArtworkOptions | null = null
): Partial<StremioMeta> {
  const mapEntry = getEntryByAnilistId(media.id);
  const imdbId = mapEntry?.imdb_id || (requestedId.startsWith('tt') ? requestedId : null);
  const tmdbId = mapEntry?.themoviedb_id ?? 0;

  const title = media.title?.english || media.title?.romaji || media.title?.native || 'Unknown';
  const description = media.description ? stripHtml(media.description) : '';
  const genres = media.genres || [];

  const nativePoster = media.coverImage?.extraLarge || media.coverImage?.large || null;
  const nativeBackground = media.bannerImage || null;
  const artworkContext: ArtworkContext = {
    tmdbId: tmdbId || undefined,
    imdbId: imdbId ?? undefined,
    type,
  };
  const nativeUrls: NativeArtworkUrls = {
    poster: nativePoster,
    backdrop: nativeBackground,
    logo: null,
    landscape: nativeBackground,
  };
  const resolved = applyArtworkOverridesSync(artworkContext, nativeUrls, artworkOptions);

  const links = buildAnilistLinks(media);

  const startYear = media.seasonYear || media.startDate?.year || null;
  const endYear = media.endDate?.year || null;
  let releaseInfo = startYear ? String(startYear) : '';
  if (media.status === 'RELEASING') {
    releaseInfo = startYear ? `${startYear}-` : '';
  } else if (media.status === 'FINISHED' && endYear && startYear && endYear !== startYear) {
    releaseInfo = `${startYear}-${endYear}`;
  }

  const isMovie = isMovieFormat(media);
  const videoIdBase = resolveVideoIdBase(media, requestedId);
  const videos = isMovie ? [] : buildAnilistVideos(media, videoIdBase);

  const directorString = links
    .filter((l) => l.category === 'Directors')
    .map((l) => l.name)
    .join(', ');
  const writerString = links
    .filter((l) => l.category === 'Writers')
    .map((l) => l.name)
    .join(', ');

  const appExtras: AppExtras = {
    cast: [],
    directors: links
      .filter((l) => l.category === 'Directors')
      .map((l) => ({ name: l.name, photo: null })),
    writers: links
      .filter((l) => l.category === 'Writers')
      .map((l) => ({ name: l.name, photo: null })),
    seasonPosters: [],
    releaseDates: null,
    certification: null,
  };

  const meta: Partial<StremioMeta> = {
    id: requestedId,
    tmdbId,
    imdbId,
    imdb_id: imdbId,
    type,
    name: title,
    slug: generateSlug(type, title, requestedId),
    poster: resolved.poster,
    posterShape: 'poster',
    background: resolved.backdrop,
    fanart: resolved.landscape || resolved.backdrop,
    landscapePoster: resolved.landscape || resolved.backdrop,
    logo: resolved.logo || undefined,
    description,
    releaseInfo,
    year: startYear ? String(startYear) : undefined,
    released: buildIsoDate(media.startDate),
    runtime: formatRuntime(media.duration),
    imdbRating: media.averageScore ? (media.averageScore / 10).toFixed(1) : undefined,
    genres,
    director: directorString || undefined,
    writer: writerString || undefined,
    links: links.length > 0 ? links : undefined,
    status: media.status || null,
    app_extras: appExtras,
    behaviorHints: {
      defaultVideoId: isMovie ? requestedId : null,
      hasScheduledVideos: !isMovie && media.status === 'RELEASING',
    },
  };

  if (media.trailer?.site === 'youtube' && media.trailer.id) {
    meta.trailers = [{ source: media.trailer.id, type: 'Trailer' }];
    meta.trailer = media.trailer.id;
  }

  if (videos.length > 0) {
    meta.videos = videos;
  }

  return meta;
}
