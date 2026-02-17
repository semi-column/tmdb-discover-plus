import fs from 'fs';
import path from 'path';
import { createLogger } from '../../utils/logger.ts';
import { tmdbFetch } from './client.ts';
import type { TmdbGenre, GenreCache, StaticGenreMap } from '../../types/index.ts';

const log = createLogger('tmdb:genres');

export let genreCache: GenreCache = { movie: {}, tv: {} };

export let staticGenreMap: StaticGenreMap = { movie: {}, tv: {} };
try {
  const genresPath = path.join(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')),
    '..',
    '..',
    'data',
    'tmdb_genres.json'
  );
  const raw = fs.readFileSync(genresPath, 'utf8');
  staticGenreMap = JSON.parse(raw);
} catch (err) {
  log.warn('Could not load static TMDB genre mapping', { error: (err as Error).message });
}

export async function getGenres(
  apiKey: string,
  type: string = 'movie',
  language: string = 'en'
): Promise<TmdbGenre[]> {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const lang = language || 'en';

  if (genreCache[mediaType]?.[lang]) {
    return genreCache[mediaType][lang];
  }
  if (!genreCache[mediaType]) genreCache[mediaType] = {};

  const params: Record<string, string> = {};
  if (lang !== 'en') params.language = lang;

  const data = (await tmdbFetch(`/genre/${mediaType}/list`, apiKey, params)) as {
    genres: TmdbGenre[];
  };

  if (!genreCache[mediaType]) genreCache[mediaType] = {};
  genreCache[mediaType][lang] = data.genres;

  return data.genres;
}

export function getCachedGenres(
  type: string = 'movie',
  language: string = 'en'
): TmdbGenre[] | null {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const lang = language || 'en';
  return genreCache[mediaType]?.[lang] || null;
}
