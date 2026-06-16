import { createLogger } from '../../utils/logger.ts';
import { anilistFetch } from './client.ts';
import { DETAIL_QUERY } from './queries.ts';
import { anilistToStremioFullMeta } from './stremioMeta.ts';
import type { AnilistMediaDetail, AnilistMediaResponse } from './types.ts';
import type { ContentType } from '../../types/common.ts';
import type { ArtworkOptions, StremioMeta } from '../../types/index.ts';

const log = createLogger('anilist:detail');

export interface AnilistMediaLookup {
  anilistId?: number | null;
  malId?: number | null;
}

/**
 * Fetches a single full media entry from AniList by its native id or its MAL
 * id. AniList natively supports both lookups, so a MAL id resolves without the
 * anime-id map. Returns null when neither id is provided or no match exists.
 */
export async function fetchAnilistMedia(
  lookup: AnilistMediaLookup
): Promise<AnilistMediaDetail | null> {
  const anilistId =
    typeof lookup.anilistId === 'number' && lookup.anilistId > 0 ? lookup.anilistId : null;
  const malId = typeof lookup.malId === 'number' && lookup.malId > 0 ? lookup.malId : null;

  if (!anilistId && !malId) return null;

  const variables: Record<string, unknown> = anilistId ? { id: anilistId } : { idMal: malId };
  log.debug('AniList media lookup', { anilistId, malId });

  const response = await anilistFetch<AnilistMediaResponse>(DETAIL_QUERY, variables);
  return response.data.Media ?? null;
}

/**
 * Resolves a full Stremio meta object for an anime entry from AniList. Used as
 * the metadata fallback when an anime item has no TMDB/IMDB mapping.
 */
export async function getAnimeMeta(params: {
  anilistId?: number | null;
  malId?: number | null;
  type: ContentType;
  requestedId: string;
  artworkOptions?: ArtworkOptions | null;
}): Promise<Partial<StremioMeta> | null> {
  const media = await fetchAnilistMedia({ anilistId: params.anilistId, malId: params.malId });
  if (!media) return null;

  return anilistToStremioFullMeta(
    media,
    params.type,
    params.requestedId,
    params.artworkOptions ?? null
  );
}
