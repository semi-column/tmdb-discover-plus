import type { TraktMovie, TraktShow } from './types.ts';
import type { StremioMetaPreview, StremioLink } from '../../types/stremio.ts';
import type { ContentType } from '../../types/common.ts';
import type { ArtworkOptions } from '../../types/config.ts';
import { generateSlug } from '../common/stremioHelpers.ts';
import { applyArtworkOverridesSync } from '../artworkService.ts';
import type { ArtworkContext, NativeArtworkUrls } from '../artworkService.ts';

export function traktToStremioMeta(
  item: TraktMovie | TraktShow,
  type: ContentType,
  artworkOptions: ArtworkOptions | null = null
): StremioMetaPreview | null {
  const imdbId = item.ids.imdb;
  if (!imdbId) return null;

  const tmdbId = item.ids.tmdb ?? 0;

  const artworkContext: ArtworkContext = {
    tmdbId,
    imdbId,
    type,
  };
  const nativeUrls: NativeArtworkUrls = {
    poster: null,
    backdrop: null,
    logo: null,
    landscape: null,
  };
  const resolved = applyArtworkOverridesSync(artworkContext, nativeUrls, artworkOptions);
  const poster = resolved.poster;
  const background = resolved.backdrop;
  const logo = resolved.logo || undefined;

  const links: StremioLink[] = [];
  if (imdbId) {
    links.push({
      name: item.rating ? item.rating.toFixed(1) : 'IMDb',
      category: 'imdb',
      url: `https://imdb.com/title/${imdbId}`,
    });
  }

  return {
    id: imdbId,
    tmdbId,
    imdbId,
    imdb_id: imdbId,
    traktSlug: item.ids.slug || null,
    type,
    name: item.title,
    slug: generateSlug(type, item.title, imdbId),
    poster,
    posterShape: 'poster',
    background,
    fanart: resolved.landscape || background,
    landscapePoster: resolved.landscape || background,
    logo,
    genres: item.genres || [],
    description: item.overview || '',
    releaseInfo: item.year ? String(item.year) : '',
    imdbRating: item.rating ? item.rating.toFixed(1) : undefined,
    links: links.length > 0 ? links : undefined,
    behaviorHints: {},
  };
}

export function batchConvertToStremioMeta(
  items: (TraktMovie | TraktShow)[],
  type: ContentType,
  artworkOptions: ArtworkOptions | null = null
): StremioMetaPreview[] {
  const results: StremioMetaPreview[] = [];
  for (const item of items) {
    const meta = traktToStremioMeta(item, type, artworkOptions);
    if (meta) results.push(meta);
  }
  return results;
}
