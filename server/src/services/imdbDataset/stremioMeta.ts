import type { ImdbTitle } from '../../types/imdbDataset.ts';

const METAHUB_BASE = 'https://images.metahub.space/poster/small';

interface PosterOptions {
  service?: string;
  apiKey?: string;
}

function generateSlug(type: string, title: string, id: string): string {
  if (!title) return id;
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${type}-${base}-${id}`;
}

export function imdbTitleToStremioMeta(
  title: ImdbTitle,
  posterOptions: PosterOptions | null = null
) {
  const type =
    title.titleType === 'tvSeries' || title.titleType === 'tvMiniSeries' ? 'series' : 'movie';

  let poster = `${METAHUB_BASE}/${title.tconst}/img`;

  if (posterOptions?.service === 'rpdb' && posterOptions?.apiKey) {
    poster = `https://api.ratingposterdb.com/${posterOptions.apiKey}/imdb/poster-default/${title.tconst}.jpg`;
  } else if (posterOptions?.service === 'topPosters' && posterOptions?.apiKey) {
    poster = `https://api.topposters.com/${posterOptions.apiKey}/imdb/poster-default/${title.tconst}.jpg`;
  }

  const primaryId = title.tconst;

  return {
    id: primaryId,
    imdb_id: primaryId,
    imdbId: primaryId,
    type,
    name: title.primaryTitle,
    slug: generateSlug(type, title.primaryTitle, primaryId),
    poster,
    posterShape: 'poster',
    description: '',
    releaseInfo: title.startYear > 0 ? String(title.startYear) : '',
    imdbRating: title.averageRating > 0 ? String(title.averageRating) : undefined,
    genres: title.genres || [],
    runtime: title.runtimeMinutes > 0 ? `${title.runtimeMinutes} min` : undefined,
    behaviorHints: {},
  };
}
