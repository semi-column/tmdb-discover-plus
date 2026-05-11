import { anilistIdToStremioId, getEntryByAnilistId } from '../animeIdMap/index.ts';
import type { AnilistMedia } from './types.ts';
import type { StremioMetaPreview } from '../../types/stremio.ts';
import type { StremioLink, StremioTrailer } from '../../types/stremio.ts';
import type { ContentType } from '../../types/common.ts';
import type { ArtworkOptions } from '../../types/config.ts';
import { generateSlug } from '../common/stremioHelpers.ts';
import { applyArtworkOverridesSync } from '../artworkService.ts';
import type { ArtworkContext, NativeArtworkUrls } from '../artworkService.ts';

function stripHtml(text: string): string {
  let out = '';
  let inTag = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '<') {
      inTag = true;
      continue;
    }
    if (ch === '>') {
      inTag = false;
      continue;
    }
    if (!inTag) out += ch;
  }

  return out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function anilistToStremioMeta(
  media: AnilistMedia,
  type: ContentType,
  artworkOptions: ArtworkOptions | null = null
): StremioMetaPreview | null {
  const stremioId = anilistIdToStremioId(media.id);
  if (!stremioId) return null;

  const mapEntry = getEntryByAnilistId(media.id);
  const imdbId = mapEntry?.imdb_id || (stremioId.startsWith('tt') ? stremioId : null);
  const primaryId = imdbId || stremioId;
  const tmdbId = mapEntry?.themoviedb_id ?? 0;

  const title = media.title?.english || media.title?.romaji || media.title?.native || 'Unknown';

  const nativePoster = media.coverImage?.extraLarge || media.coverImage?.large || null;
  const nativeBackground = media.bannerImage || null;
  const description = media.description ? stripHtml(media.description) : '';

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
  const poster = resolved.poster;
  const background = resolved.backdrop;

  const genres = media.genres || [];

  const links: StremioLink[] = [];
  const animationStudios = media.studios?.nodes?.filter((s) => s.isAnimationStudio) || [];
  for (const studio of animationStudios) {
    links.push({
      name: studio.name,
      category: 'Studios',
      url: `https://anilist.co/studio/${studio.id}`,
    });
  }

  const staffEdges = media.staff?.edges || [];
  for (const edge of staffEdges) {
    if (edge.node?.name?.full && edge.role) {
      const role = edge.role.toLowerCase();
      let category: 'Directors' | 'Writers' | 'Cast' | undefined;
      if (role.includes('director')) category = 'Directors';
      else if (
        role.includes('script') ||
        role.includes('writer') ||
        role.includes('story') ||
        role.includes('composition')
      )
        category = 'Writers';
      if (category) {
        links.push({
          name: edge.node.name.full,
          category,
          url: `https://anilist.co/staff/${edge.node.id}`,
        });
      }
    }
  }

  const releaseInfo: string[] = [];
  if (media.seasonYear) releaseInfo.push(String(media.seasonYear));
  else if (media.startDate?.year) releaseInfo.push(String(media.startDate.year));
  if (media.season) releaseInfo.push(media.season);

  const meta: StremioMetaPreview & { trailers?: StremioTrailer[] } = {
    id: primaryId,
    tmdbId,
    imdbId,
    imdb_id: imdbId,
    type,
    name: title,
    slug: generateSlug(type, title, primaryId),
    poster,
    posterShape: 'poster',
    background,
    fanart: resolved.landscape || background,
    landscapePoster: resolved.landscape || background,
    logo: resolved.logo || undefined,
    description,
    genres,
    links: links.length > 0 ? links : undefined,
    releaseInfo: releaseInfo.join(' '),
    imdbRating: media.averageScore ? (media.averageScore / 10).toFixed(1) : undefined,
    behaviorHints: {},
  };

  if (media.trailer?.site === 'youtube' && media.trailer.id) {
    meta.trailers = [{ source: media.trailer.id, type: 'Trailer' }];
  }

  return meta;
}

export function batchConvertToStremioMeta(
  mediaList: AnilistMedia[],
  type: ContentType,
  artworkOptions: ArtworkOptions | null = null
): StremioMetaPreview[] {
  const results: StremioMetaPreview[] = [];
  for (const media of mediaList) {
    const meta = anilistToStremioMeta(media, type, artworkOptions);
    if (meta) results.push(meta);
  }
  return results;
}
