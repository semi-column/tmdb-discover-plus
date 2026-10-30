import crypto from 'node:crypto';
import { stableStringify } from '../../utils/stableStringify.ts';
import type { ArtworkOptions, ContentType } from '../../types/index.ts';

export function buildMetaCacheKey(input: {
  userId: string;
  type: ContentType;
  requestedId: string;
  language: string;
  baseUrl: string;
  manifestUrl: string;
  genreCatalogId: string | null;
  userRegion: string | null;
  artworkOptions: ArtworkOptions;
}): string {
  const digest = crypto.createHash('sha256').update(stableStringify(input)).digest('hex');
  return `meta:full:${digest}`;
}
