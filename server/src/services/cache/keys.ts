import crypto from 'node:crypto';
import { stableStringify } from '../../utils/stableStringify.ts';
import type { ArtworkOptions, ContentType } from '../../types/index.ts';
import type { CacheReadLayer } from '../../types/cache.ts';

/** Classify before recording: keys can contain credentials, user IDs and search terms. */
export function cacheReadLayer(key: string): CacheReadLayer {
  if (/^(catalog:|meta:full:|catalog-imdb:|(?:anilist|mal|kitsu|simkl):catalog:)/.test(key))
    return 'addon_response';
  if (key.startsWith('tmdb:api-key-status:')) return 'key_validation';
  if (key.startsWith('season_')) return 'seasons';
  if (/^(logos_|rpdb_)/.test(key)) return 'artwork';
  if (/^(external_ids_|find_)/.test(key)) return 'id_lookup';
  if (
    /^tmdb_(languages|original_languages|countries|certifications|watch_regions|watch_providers)/.test(
      key
    )
  )
    return 'tmdb_reference';
  if (key.startsWith('https://api.themoviedb.org/')) {
    if (/\/tv\/\d+\/season\/\d+/.test(key)) return 'seasons';
    if (/\/(?:configuration|genre)(?:[/?]|$)/.test(key)) return 'tmdb_reference';
    return 'tmdb_api';
  }
  if (key.startsWith('tmdb_site:')) return 'tmdb_api';
  if (key.startsWith('imdb:fresh:')) return 'imdb_freshness';
  if (key.startsWith('imdb:')) return 'imdb';
  if (/^(anime-id-map:|anilist:|mal:|kitsu:|simkl:)/.test(key)) return 'anime';
  if (key.startsWith('total_pages:')) return 'discovery';
  return 'other';
}

export function buildMetaCacheKey(input: {
  userId: string;
  type: ContentType;
  requestedId: string;
  language: string;
  baseUrl: string;
  manifestUrl: string;
  genreCatalogId: string | null;
  userRegion: string | null;
  artworkOptions: ArtworkOptions;
}): string {
  const digest = crypto.createHash('sha256').update(stableStringify(input)).digest('hex');
  return `meta:full:${digest}`;
}
