import { simklIdToStremioId, malIdToStremioId, getEntryBySimklId } from '../animeIdMap/index.ts';
import { SIMKL_IMAGE_BASE } from './types.ts';
import type { SimklAnime, SimklTrendingItem, SimklSearchResult } from './types.ts';
import type { StremioMetaPreview } from '../../types/stremio.ts';
import type { StremioLink } from '../../types/stremio.ts';
import type { ContentType } from '../../types/common.ts';
import type { ArtworkOptions } from '../../types/config.ts';
import { generateSlug } from '../common/stremioHelpers.ts';
import { applyArtworkOverridesSync } from '../artworkService.ts';
import type { ArtworkContext, NativeArtworkUrls } from '../artworkService.ts';

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
  type: ContentType,
  artworkOptions: ArtworkOptions | null = null
): StremioMetaPreview | null {
  const stremioId = resolveStremioId(anime.ids);
  if (!stremioId) return null;

  const simklRawId = anime.ids.simkl ?? anime.ids.simkl_id;
  const simklId = simklRawId != null ? parseInt(String(simklRawId), 10) : NaN;
  const mapEntry = Number.isNaN(simklId) ? undefined : getEntryBySimklId(simklId);
  const imdbId =
    anime.ids.imdb || mapEntry?.imdb_id || (stremioId.startsWith('tt') ? stremioId : null);
  const primaryId = imdbId || stremioId;
  const tmdbId = mapEntry?.themoviedb_id ?? 0;

  const rating = anime.ratings?.simkl?.rating || anime.ratings?.mal?.rating;

  const nativePoster = buildPosterUrl(anime.poster) || null;
  const nativeBackground = buildFanartUrl(anime.fanart) || null;
  const links: StremioLink[] = [];
  if (imdbId) {
    links.push({
      name: rating ? rating.toFixed(1) : 'IMDb',
      category: 'imdb',
      url: `https://imdb.com/title/${imdbId}`,
    });
  }

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

  const meta: StremioMetaPreview = {
    id: primaryId,
    tmdbId,
    imdbId,
    imdb_id: imdbId,
    type,
    name: anime.title,
    slug: generateSlug(type, anime.title, primaryId),
    poster: resolved.poster,
    posterShape: 'poster',
    background: resolved.backdrop,
    fanart: resolved.landscape || resolved.backdrop,
    landscapePoster: resolved.landscape || resolved.backdrop,
    logo: resolved.logo || undefined,
    genres: ('genres' in anime && anime.genres) || [],
    description: ('overview' in anime && anime.overview) || '',
    releaseInfo: anime.year ? String(anime.year) : '',
    imdbRating: rating ? rating.toFixed(1) : undefined,
    links: links.length > 0 ? links : undefined,
    behaviorHints: {},
  };

  return meta;
}

export function batchConvertToStremioMeta(
  animeList: (SimklAnime | SimklTrendingItem)[],
  type: ContentType,
  artworkOptions: ArtworkOptions | null = null
): StremioMetaPreview[] {
  const results: StremioMetaPreview[] = [];
  for (const anime of animeList) {
    const meta = simklToStremioMeta(anime, type, artworkOptions);
    if (meta) results.push(meta);
  }
  return results;
}
