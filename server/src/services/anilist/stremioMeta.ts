import { anilistIdToStremioId, getEntryByAnilistId } from '../animeIdMap/index.ts';
import type { AnilistMedia } from './types.ts';
import type { StremioMetaPreview } from '../../types/stremio.ts';
import type { ContentType } from '../../types/common.ts';

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

export function anilistToStremioMeta(
  media: AnilistMedia,
  type: ContentType
): StremioMetaPreview | null {
  const stremioId = anilistIdToStremioId(media.id);
  if (!stremioId) return null;

  const title = media.title?.english || media.title?.romaji || media.title?.native || 'Unknown';

  const poster = media.coverImage?.extraLarge || media.coverImage?.large || '';
  const background = media.bannerImage || '';
  const description = media.description ? stripHtml(media.description) : '';

  const genres = media.genres || [];

  const links: Array<{ name: string; category: string; url: string }> = [];
  const animationStudios = media.studios?.nodes?.filter((s) => s.isAnimationStudio) || [];
  for (const studio of animationStudios) {
    links.push({
      name: studio.name,
      category: 'Studios',
      url: `https://anilist.co/studio/${studio.id}`,
    });
  }

  const releaseInfo: string[] = [];
  if (media.seasonYear) releaseInfo.push(String(media.seasonYear));
  else if (media.startDate?.year) releaseInfo.push(String(media.startDate.year));
  if (media.season) releaseInfo.push(media.season);

  const meta: StremioMetaPreview = {
    id: stremioId,
    type,
    name: title,
    poster,
    background,
    description,
    genres,
    links,
    releaseInfo: releaseInfo.join(' ') || undefined,
    imdbRating: media.averageScore ? (media.averageScore / 10).toFixed(1) : undefined,
  };

  if (media.trailer?.site === 'youtube' && media.trailer.id) {
    (meta as Record<string, unknown>).trailers = [{ source: media.trailer.id, type: 'Trailer' }];
  }

  return meta;
}

export function batchConvertToStremioMeta(
  mediaList: AnilistMedia[],
  type: ContentType
): StremioMetaPreview[] {
  const results: StremioMetaPreview[] = [];
  for (const media of mediaList) {
    const meta = anilistToStremioMeta(media, type);
    if (meta) results.push(meta);
  }
  return results;
}
