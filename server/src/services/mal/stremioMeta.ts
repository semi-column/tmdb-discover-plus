import { getEntryByMalId, malIdToStremioId } from '../animeIdMap/index.ts';
import type { MalAnime } from './types.ts';
import type { StremioMetaPreview } from '../../types/stremio.ts';
import type { StremioLink } from '../../types/stremio.ts';
import type { ContentType } from '../../types/common.ts';
import type { ArtworkOptions } from '../../types/config.ts';
import { generateSlug } from '../common/stremioHelpers.ts';
import { applyArtworkOverridesSync } from '../artworkService.ts';
import type { ArtworkContext, NativeArtworkUrls } from '../artworkService.ts';

export function malToStremioMeta(
  anime: MalAnime,
  type: ContentType,
  artworkOptions: ArtworkOptions | null = null
): StremioMetaPreview | null {
  const mappedStremioId = malIdToStremioId(anime.id);
  const stremioId = mappedStremioId || `mal:${anime.id}`;

  const mapEntry = getEntryByMalId(anime.id);
  const imdbId = mapEntry?.imdb_id || (stremioId.startsWith('tt') ? stremioId : null);
  const primaryId = imdbId || stremioId;
  const tmdbId = mapEntry?.themoviedb_id ?? 0;

  const nativePoster = anime.main_picture?.large || anime.main_picture?.medium || null;
  const title = anime.alternative_titles?.en || anime.title;
  const genres = anime.genres?.map((g) => g.name) || [];

  const artworkContext: ArtworkContext = {
    tmdbId: tmdbId || undefined,
    imdbId: imdbId ?? undefined,
    type,
  };
  const nativeUrls: NativeArtworkUrls = {
    poster: nativePoster,
    backdrop: null,
    logo: null,
    landscape: null,
  };
  const resolved = applyArtworkOverridesSync(artworkContext, nativeUrls, artworkOptions);

  const links: StremioLink[] = [];
  if (anime.studios) {
    for (const studio of anime.studios) {
      links.push({
        name: studio.name,
        category: 'Studios',
        url: `https://myanimelist.net/anime/producer/${studio.id}`,
      });
    }
  }

  const releaseInfo: string[] = [];
  if (anime.start_season) {
    releaseInfo.push(String(anime.start_season.year));
    releaseInfo.push(anime.start_season.season);
  } else if (anime.start_date) {
    releaseInfo.push(anime.start_date.split('-')[0]);
  }

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
    genres,
    links: links.length > 0 ? links : undefined,
    releaseInfo: releaseInfo.join(' '),
    imdbRating: anime.mean ? anime.mean.toFixed(1) : undefined,
    behaviorHints: {},
  };
}

export function batchConvertToStremioMeta(
  animeList: MalAnime[],
  type: ContentType,
  artworkOptions: ArtworkOptions | null = null
): StremioMetaPreview[] {
  const results: StremioMetaPreview[] = [];
  for (const anime of animeList) {
    const meta = malToStremioMeta(anime, type, artworkOptions);
    if (meta) results.push(meta);
  }
  return results;
}
