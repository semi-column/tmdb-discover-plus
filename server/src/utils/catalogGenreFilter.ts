import type { StremioMetaPreview } from '../types/stremio.ts';

const UNKNOWN_GENRES = new Set([
  'unknown',
  'unknown genre',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
]);

export function hasKnownGenre(meta: Pick<StremioMetaPreview, 'genres'>): boolean {
  return (
    Array.isArray(meta.genres) &&
    meta.genres.some(
      (genre) =>
        typeof genre === 'string' && genre.trim() && !UNKNOWN_GENRES.has(genre.trim().toLowerCase())
    )
  );
}

export function filterUnknownGenreMetas<T extends Pick<StremioMetaPreview, 'genres'>>(
  metas: T[],
  excludeUnknownGenres: boolean
): T[] {
  return excludeUnknownGenres ? metas.filter(hasKnownGenre) : metas;
}
