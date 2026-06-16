import type { AnimeIdEntry } from '../services/animeIdMap/index.ts';

export interface ResolvedMetaId {
  tmdbId: number | null;
  imdbId: string | null;
  requiresImdbLookup: boolean;
  /** AniList id for the anime metadata fallback, when resolvable. */
  anilistId: number | null;
  /** MAL id for the anime metadata fallback, when resolvable. */
  malId: number | null;
}

function parsePositiveInt(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePrefixedId(rawId: string, prefix: string): number | null {
  if (!rawId.toLowerCase().startsWith(prefix)) return null;
  return parsePositiveInt(rawId.slice(prefix.length));
}

function normalizeImdbId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return /^tt\d+$/i.test(trimmed) ? trimmed : null;
}

function animeIdsFromEntry(
  entry: AnimeIdEntry | undefined,
  directAnilistId: number | null = null,
  directMalId: number | null = null
): { anilistId: number | null; malId: number | null } {
  return {
    anilistId: directAnilistId ?? (entry?.anilist_id || null),
    malId: directMalId ?? (entry?.mal_id || null),
  };
}

export function resolveRequestedMetaId(
  requestedId: string,
  lookupAnimeEntry: (id: string) => AnimeIdEntry | undefined
): ResolvedMetaId {
  const rawId = String(requestedId || '').trim();
  if (!rawId) {
    return {
      tmdbId: null,
      imdbId: null,
      requiresImdbLookup: false,
      anilistId: null,
      malId: null,
    };
  }

  const directImdbId = normalizeImdbId(rawId);
  if (directImdbId) {
    const { anilistId, malId } = animeIdsFromEntry(lookupAnimeEntry(rawId));
    return {
      tmdbId: null,
      imdbId: directImdbId,
      requiresImdbLookup: true,
      anilistId,
      malId,
    };
  }

  if (rawId.startsWith('tmdb:')) {
    const tmdbId = parsePositiveInt(rawId.slice('tmdb:'.length));
    const { anilistId, malId } = animeIdsFromEntry(tmdbId ? lookupAnimeEntry(rawId) : undefined);
    return {
      tmdbId,
      imdbId: null,
      requiresImdbLookup: false,
      anilistId,
      malId,
    };
  }

  if (/^\d+$/.test(rawId)) {
    return {
      tmdbId: parsePositiveInt(rawId),
      imdbId: null,
      requiresImdbLookup: false,
      anilistId: null,
      malId: null,
    };
  }

  const mapEntry = lookupAnimeEntry(rawId);
  const directAnilistId = parsePrefixedId(rawId, 'anilist:');
  const directMalId = parsePrefixedId(rawId, 'mal:');
  const { anilistId, malId } = animeIdsFromEntry(mapEntry, directAnilistId, directMalId);

  if (!mapEntry) {
    return {
      tmdbId: null,
      imdbId: null,
      requiresImdbLookup: false,
      anilistId,
      malId,
    };
  }

  const mappedTmdbId =
    typeof mapEntry.themoviedb_id === 'number' && Number.isFinite(mapEntry.themoviedb_id)
      ? mapEntry.themoviedb_id
      : null;
  const mappedImdbId = normalizeImdbId(mapEntry.imdb_id);

  return {
    tmdbId: mappedTmdbId,
    imdbId: mappedImdbId,
    requiresImdbLookup: !mappedTmdbId && Boolean(mappedImdbId),
    anilistId,
    malId,
  };
}
