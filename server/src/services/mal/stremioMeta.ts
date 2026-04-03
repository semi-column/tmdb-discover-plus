import { malIdToStremioId } from '../animeIdMap/index.ts';
import type { MalAnime } from './types.ts';
import type { StremioMetaPreview } from '../../types/stremio.ts';
import type { ContentType } from '../../types/common.ts';

export function malToStremioMeta(anime: MalAnime, type: ContentType): StremioMetaPreview | null {
  const stremioId = malIdToStremioId(anime.id);
  if (!stremioId) return null;

  const poster = anime.main_picture?.large || anime.main_picture?.medium || '';
  const title = anime.alternative_titles?.en || anime.title;
  const genres = anime.genres?.map((g) => g.name) || [];

  const links: Array<{ name: string; category: string; url: string }> = [];
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
    id: stremioId,
    type,
    name: title,
    poster,
    description: anime.synopsis || '',
    genres,
    links,
    releaseInfo: releaseInfo.join(' ') || undefined,
    imdbRating: anime.mean ? anime.mean.toFixed(1) : undefined,
  };
}

export function batchConvertToStremioMeta(
  animeList: MalAnime[],
  type: ContentType
): StremioMetaPreview[] {
  const results: StremioMetaPreview[] = [];
  for (const anime of animeList) {
    const meta = malToStremioMeta(anime, type);
    if (meta) results.push(meta);
  }
  return results;
}
