import { createLogger } from '../../utils/logger.ts';
import { generatePosterUrl, isValidPosterConfig } from '../posterService.js';

import type { ContentType } from '../../types/index.ts';
import type { ImdbTitle, ImdbRankingEntry, ImdbListItem, ImdbPosterOptions } from './types.ts';

const log = createLogger('imdb:stremioMeta');

function formatRuntime(minutes: number | undefined | null): string | undefined {
  if (!minutes) return undefined;
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}min` : `${h}h`;
}

function generateSlug(type: string, title: string, id: string): string {
  const safeTitle = (title || '').toLowerCase().replace(/ /g, '-');
  return `${type}/${safeTitle}-${id}`;
}

function mapImdbTypeToContentType(imdbType: string): ContentType {
  if (['tvSeries', 'tvMiniSeries', 'tvSpecial', 'tvShort'].includes(imdbType)) {
    return 'series';
  }
  return 'movie';
}

function buildYear(item: ImdbTitle): string {
  if (item.releaseDate?.year) return String(item.releaseDate.year);
  if (item.startYear) return String(item.startYear);
  return '';
}

function buildReleaseInfo(item: ImdbTitle): string {
  const year = buildYear(item);
  if (item.endYear && item.endYear !== item.startYear) {
    return `${item.startYear}–${item.endYear}`;
  }
  return year;
}

export function imdbToStremioMeta(
  item: ImdbTitle,
  type: ContentType,
  posterOptions: ImdbPosterOptions | null = null
): Record<string, unknown> | null {
  if (!item || !item.id) return null;

  const stremioType = type || mapImdbTypeToContentType(item.type);
  const year = buildYear(item);

  let poster = item.primaryImage?.url || null;
  const background = item.posterImages?.[0]?.url || null;

  if (isValidPosterConfig(posterOptions)) {
    const enhancedPoster = generatePosterUrl({
      ...posterOptions,
      tmdbId: 0,
      type: stremioType,
      imdbId: item.id,
    });
    if (enhancedPoster) poster = enhancedPoster;
  }

  return {
    id: item.id,
    tmdbId: 0,
    imdbId: item.id,
    imdb_id: item.id,
    type: stremioType,
    name: item.primaryTitle || item.originalTitle || '',
    slug: generateSlug(stremioType, item.primaryTitle, item.id),
    poster,
    posterShape: 'poster',
    background,
    fanart: background,
    landscapePoster: background,
    description: item.description || '',
    year,
    releaseInfo: buildReleaseInfo(item),
    imdbRating: item.averageRating ? String(item.averageRating) : undefined,
    genres: item.genres || [],
    runtime: formatRuntime(item.runtimeMinutes),
    cast: item.cast
      ?.slice(0, 20)
      .map((c) => c.fullName)
      .filter(Boolean),
    director:
      item.directors
        ?.map((d) => d.fullName)
        .filter(Boolean)
        .join(', ') || undefined,
    writer:
      item.writers
        ?.map((w) => w.fullName)
        .filter(Boolean)
        .join(', ') || undefined,
    contentRating: item.contentRating || undefined,
    country: item.countriesOfOrigin?.join(', ') || undefined,
    language: item.spokenLanguages?.[0] || undefined,
    behaviorHints: {},
  };
}

export function imdbToStremioFullMeta(
  item: ImdbTitle,
  type: ContentType,
  posterOptions: ImdbPosterOptions | null = null
): Record<string, unknown> | null {
  const base = imdbToStremioMeta(item, type, posterOptions);
  if (!base) return null;

  const links: Array<{ name: string; category: string; url: string }> = [];

  if (item.averageRating) {
    links.push({
      name: `${item.averageRating}/10`,
      category: 'imdb',
      url: `https://www.imdb.com/title/${item.id}/`,
    });
  }

  if (item.genres) {
    item.genres.forEach((genre) => {
      links.push({ name: genre, category: 'Genres', url: `stremio:///discover` });
    });
  }

  if (item.cast) {
    item.cast.slice(0, 10).forEach((c) => {
      const name = c.characters?.length ? `${c.fullName} as ${c.characters[0]}` : c.fullName;
      links.push({ name, category: 'Cast', url: `https://www.imdb.com/name/${c.id}/` });
    });
  }

  if (item.directors) {
    item.directors.forEach((d) => {
      links.push({
        name: d.fullName,
        category: 'Directors',
        url: `https://www.imdb.com/name/${d.id}/`,
      });
    });
  }

  if (item.writers) {
    item.writers.forEach((w) => {
      links.push({
        name: w.fullName,
        category: 'Writers',
        url: `https://www.imdb.com/name/${w.id}/`,
      });
    });
  }

  const trailerStreams: Array<{ title: string; ytId: string }> = [];
  if (item.trailer) {
    trailerStreams.push({ title: 'Trailer', ytId: item.trailer });
  }

  const appExtras = {
    cast:
      item.cast?.slice(0, 20).map((c) => ({
        name: c.fullName,
        character: c.characters?.[0] || '',
        photo: c.primaryImage?.url || null,
      })) || [],
    directors:
      item.directors?.map((d) => ({
        name: d.fullName,
        photo: d.primaryImage?.url || null,
      })) || [],
    writers:
      item.writers?.map((w) => ({
        name: w.fullName,
        photo: w.primaryImage?.url || null,
      })) || [],
    seasonPosters: [],
    releaseDates: null,
    certification: item.contentRating || null,
  };

  return {
    ...base,
    links,
    trailerStreams: trailerStreams.length > 0 ? trailerStreams : undefined,
    app_extras: appExtras,
    released: item.releaseDate?.date || undefined,
    status: item.endYear ? 'Ended' : null,
  };
}

export function imdbRankingToStremioMeta(
  entry: ImdbRankingEntry,
  type: ContentType,
  posterOptions: ImdbPosterOptions | null = null
): Record<string, unknown> | null {
  return imdbToStremioMeta(entry as ImdbTitle, type, posterOptions);
}

export function imdbListItemToStremioMeta(
  item: ImdbListItem,
  type: ContentType,
  posterOptions: ImdbPosterOptions | null = null
): Record<string, unknown> | null {
  return imdbToStremioMeta(item as ImdbTitle, type, posterOptions);
}
