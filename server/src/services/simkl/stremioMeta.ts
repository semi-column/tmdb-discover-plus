import { simklIdToStremioId, malIdToStremioId, getEntryBySimklId } from '../animeIdMap/index.ts';
import { SIMKL_IMAGE_BASE } from './types.ts';
import type { SimklAnime, SimklTrendingItem, SimklSearchResult } from './types.ts';
import type { StremioMetaPreview } from '../../types/stremio.ts';
import type { ContentType } from '../../types/common.ts';

function resolveStremioId(ids: SimklAnime['ids']): string | null {
  // Direct IMDB ID from Simkl's response
  if (ids.imdb) return ids.imdb;

  // Try Simkl's own ID map
  const simklId = ids.simkl ?? ids.simkl_id;
  if (simklId) {
    const resolved = simklIdToStremioId(simklId);
    if (resolved) return resolved;
  }

  // Try via MAL ID
  if (ids.mal) {
    const malId = parseInt(String(ids.mal), 10);
    if (!isNaN(malId)) {
      const resolved = malIdToStremioId(malId);
      if (resolved) return resolved;
    }
  }

  // Kitsu fallback
  if (ids.kitsu) return `kitsu:${ids.kitsu}`;

  return null;
}

function buildPosterUrl(poster: string | undefined): string {
  if (!poster) return '';
  if (poster.startsWith('http')) return poster;
  return `${SIMKL_IMAGE_BASE}/posters/${poster}_ca.jpg`;
}

function buildFanartUrl(fanart: string | undefined): string {
  if (!fanart) return '';
  if (fanart.startsWith('http')) return fanart;
  return `${SIMKL_IMAGE_BASE}/fanart/${fanart}_w.jpg`;
}

export function simklToStremioMeta(
  anime: SimklAnime | SimklTrendingItem,
  type: ContentType
): StremioMetaPreview | null {
  const stremioId = resolveStremioId(anime.ids);
  if (!stremioId) return null;

  const rating = anime.ratings?.simkl?.rating || anime.ratings?.mal?.rating;

  const meta: StremioMetaPreview = {
    id: stremioId,
    type,
    name: anime.title,
    poster: buildPosterUrl(anime.poster),
    background: buildFanartUrl(anime.fanart),
    genres: ('genres' in anime && anime.genres) || [],
    description: ('overview' in anime && anime.overview) || '',
    releaseInfo: anime.year ? String(anime.year) : undefined,
    imdbRating: rating ? rating.toFixed(1) : undefined,
  };

  return meta;
}

export function batchConvertToStremioMeta(
  animeList: (SimklAnime | SimklTrendingItem)[],
  type: ContentType
): StremioMetaPreview[] {
  const results: StremioMetaPreview[] = [];
  for (const anime of animeList) {
    const meta = simklToStremioMeta(anime, type);
    if (meta) results.push(meta);
  }
  return results;
}
