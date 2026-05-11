import crypto from 'crypto';
import { stableStringify } from '../../utils/stableStringify.ts';
import type { ArtworkOptions, ContentType, PosterOptions } from '../../types/index.ts';

function buildSingleArtworkScope(option: PosterOptions | null | undefined): string {
  const service = option?.service || 'none';
  const fingerprintSource = option?.apiKey || option?.customUrlPattern;
  if (!fingerprintSource) return `${service}:none`;

  const keyHash = crypto
    .createHash('sha256')
    .update(`${service}:${fingerprintSource}`)
    .digest('hex')
    .slice(0, 16);
  return `${service}:${keyHash}`;
}

export function buildArtworkIntegrationScope(
  artworkOptions: ArtworkOptions | null | undefined
): string {
  const posterScope = buildSingleArtworkScope(artworkOptions?.poster || null);
  const backdropScope = buildSingleArtworkScope(artworkOptions?.backdrop || null);
  const logoScope = buildSingleArtworkScope(artworkOptions?.logo || null);
  const landscapeScope = buildSingleArtworkScope(artworkOptions?.landscape || null);
  const episodeScope = buildSingleArtworkScope(artworkOptions?.episode || null);
  return `poster:${posterScope}|backdrop:${backdropScope}|logo:${logoScope}|landscape:${landscapeScope}|episode:${episodeScope}`;
}

export function buildPosterIntegrationScope(
  posterService: string | null | undefined,
  posterApiKey: string | null | undefined,
  posterCustomUrlPattern: string | null | undefined = null
): string {
  return buildSingleArtworkScope({
    service: (posterService || 'none') as PosterOptions['service'],
    apiKey: posterApiKey || undefined,
    customUrlPattern: posterCustomUrlPattern || undefined,
  });
}

export function buildImdbEnrichmentCacheKey(
  type: ContentType,
  listType: string,
  filters: Record<string, unknown>,
  searchParams: Record<string, unknown> | null,
  skip: number,
  posterIntegrationScope: string,
  genre: string
): string {
  const genreSlug =
    genre && genre !== 'All' ? genre.slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_') : '';
  if (listType === 'top250' || listType === 'popular') {
    return `catalog-imdb:${type}:${listType}:${skip}:${posterIntegrationScope}`;
  }
  if (listType === 'imdb_list' && filters.imdbListId) {
    const listId = String(filters.imdbListId).slice(0, 40);
    return `catalog-imdb:imdb_list:${listId}:${skip}:${posterIntegrationScope}`;
  }
  const filterHash = crypto
    .createHash('sha256')
    .update(stableStringify(searchParams))
    .digest('hex')
    .slice(0, 20);
  return `catalog-imdb:${type}:discover:${filterHash}:${skip}:${genreSlug}:${posterIntegrationScope}`;
}
