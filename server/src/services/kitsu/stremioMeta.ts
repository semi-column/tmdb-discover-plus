import { getEntryByKitsuId, kitsuIdToStremioId } from '../animeIdMap/index.ts';
import type { KitsuAnime } from './types.ts';
import type { StremioMetaPreview } from '../../types/stremio.ts';
import type { StremioLink } from '../../types/stremio.ts';
import type { ContentType } from '../../types/common.ts';
import type { ArtworkOptions } from '../../types/config.ts';
import { generateSlug } from '../common/stremioHelpers.ts';
import { applyArtworkOverridesSync } from '../artworkService.ts';
import type { ArtworkContext, NativeArtworkUrls } from '../artworkService.ts';

export function kitsuToStremioMeta(
  anime: KitsuAnime,
  type: ContentType,
  artworkOptions: ArtworkOptions | null = null
): StremioMetaPreview | null {
  const mappedStremioId = kitsuIdToStremioId(anime.id);
  const stremioId = mappedStremioId || `kitsu:${anime.id}`;

  const mapEntry = getEntryByKitsuId(anime.id);
  const imdbId = mapEntry?.imdb_id || (stremioId.startsWith('tt') ? stremioId : null);
  const primaryId = imdbId || stremioId;
  const tmdbId = mapEntry?.themoviedb_id ?? 0;

  const title = anime.titles?.en || anime.title;

  const links: StremioLink[] = [];

  const releaseInfo: string[] = [];
  if (anime.startDate) {
    releaseInfo.push(anime.startDate.split('-')[0]);
  }
  if (anime.status === 'current') {
    releaseInfo.push('Airing');
  }

  const rating = anime.averageRating ? (anime.averageRating / 10).toFixed(1) : undefined;

  const artworkContext: ArtworkContext = {
    tmdbId: tmdbId || undefined,
    imdbId: imdbId ?? undefined,
    type,
  };
  const nativeUrls: NativeArtworkUrls = {
    poster: anime.poster || null,
    backdrop: anime.cover || null,
    logo: null,
    landscape: anime.cover || null,
  };
  const resolved = applyArtworkOverridesSync(artworkContext, nativeUrls, artworkOptions);

  return {
    id: primaryId,
    tmdbId,
    imdbId,
    imdb_id: imdbId,
    type,
    name: title,
    slug: generateSlug(type, title, primaryId),
    poster: resolved.poster,
    posterShape: 'poster',
    background: resolved.backdrop,
    fanart: resolved.landscape || resolved.backdrop,
    landscapePoster: resolved.landscape || resolved.backdrop,
    logo: resolved.logo || undefined,
    description: anime.synopsis || '',
    genres: anime.categories,
    links: links.length > 0 ? links : undefined,
    releaseInfo: releaseInfo.join(' · '),
    imdbRating: rating,
    behaviorHints: {},
  };
}

export function batchConvertToStremioMeta(
  animeList: KitsuAnime[],
  type: ContentType,
  artworkOptions: ArtworkOptions | null = null
): StremioMetaPreview[] {
  const results: StremioMetaPreview[] = [];
  for (const anime of animeList) {
    const meta = kitsuToStremioMeta(anime, type, artworkOptions);
    if (meta) results.push(meta);
  }
  return results;
}
