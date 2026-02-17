import { getImdbRatingString, batchGetImdbRatings } from '../imdbRatings/index.ts';
export async function getCinemetaRating(imdbId: string, _type?: string): Promise<string | null> {
  return getImdbRatingString(imdbId);
}

export async function batchGetCinemetaRatings(
  items: Array<{ imdb_id?: string }>,
  type?: string
): Promise<Map<string, string>> {
  return batchGetImdbRatings(items, type);
}
