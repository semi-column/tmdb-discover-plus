import { imdbFetch } from './client.ts';
import { config } from '../../config.ts';

import type { ImdbTitle } from './types.ts';

export async function getTitle(imdbId: string): Promise<ImdbTitle> {
  const sanitizedId = imdbId.replace(/[^a-zA-Z0-9]/g, '');
  if (!/^tt\d+$/.test(sanitizedId)) {
    throw new Error('Invalid IMDb title ID format');
  }
  const ttl = config.imdbApi.cacheTtlDetail;
  const data = (await imdbFetch(`/api/imdb/${sanitizedId}`, {}, ttl)) as ImdbTitle;
  return data;
}
