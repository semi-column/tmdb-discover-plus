import { createLogger } from '../utils/logger.ts';
import type {
  PosterOptions,
  PosterUrlOptions,
  PosterServiceType,
  UserPreferences,
} from '../types/index.ts';

const log = createLogger('posterService');

const RPDB_BASE_URL = 'https://api.ratingposterdb.com';
const TOP_POSTERS_BASE_URL = 'https://api.top-streaming.stream';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export const PosterService = {
  NONE: 'none',
  RPDB: 'rpdb',
  TOP_POSTERS: 'topPosters',
} as const;

function getServiceBaseUrl(service: string): string | null {
  switch (service) {
    case PosterService.RPDB:
      return RPDB_BASE_URL;
    case PosterService.TOP_POSTERS:
      return TOP_POSTERS_BASE_URL;
    default:
      return null;
  }
}

export function generatePosterUrl(options: PosterUrlOptions): string | null {
  const { apiKey, service, tmdbId, type, imdbId = null } = options;

  if (!apiKey || !service || service === PosterService.NONE) {
    return null;
  }

  if (!tmdbId && !imdbId) {
    log.debug('Cannot generate poster URL: no ID provided');
    return null;
  }

  const baseUrl = getServiceBaseUrl(service);
  if (!baseUrl) {
    log.debug('Unknown poster service', { service });
    return null;
  }

  if (imdbId && typeof imdbId === 'string' && imdbId.startsWith('tt')) {
    return `${baseUrl}/${apiKey}/imdb/poster-default/${imdbId}.jpg?fallback=true`;
  }

  const prefix = type === 'series' ? 'series' : 'movie';
  return `${baseUrl}/${apiKey}/tmdb/poster-default/${prefix}-${tmdbId}.jpg?fallback=true`;
}

export function generateBackdropUrl(options: PosterUrlOptions): string | null {
  const { apiKey, service, tmdbId, type, imdbId = null } = options;

  if (!apiKey || !service || service === PosterService.NONE) {
    return null;
  }

  if (!tmdbId && !imdbId) {
    return null;
  }

  const baseUrl = getServiceBaseUrl(service);
  if (!baseUrl) {
    return null;
  }

  if (imdbId && typeof imdbId === 'string' && imdbId.startsWith('tt')) {
    return `${baseUrl}/${apiKey}/imdb/backdrop-default/${imdbId}.jpg?fallback=true`;
  }

  const prefix = type === 'series' ? 'series' : 'movie';
  return `${baseUrl}/${apiKey}/tmdb/backdrop-default/${prefix}-${tmdbId}.jpg?fallback=true`;
}

export function isValidPosterConfig(posterOptions: PosterOptions | null): boolean {
  if (!posterOptions) return false;
  const { apiKey, service } = posterOptions;
  return Boolean(apiKey && service && service !== PosterService.NONE);
}

export function createPosterOptions(
  preferences: UserPreferences | null | undefined,
  decryptFn: (encrypted: string) => string | null
): PosterOptions | null {
  if (
    !preferences ||
    !preferences.posterService ||
    preferences.posterService === PosterService.NONE
  ) {
    return null;
  }

  if (!preferences.posterApiKeyEncrypted) {
    return null;
  }

  const apiKey = decryptFn(preferences.posterApiKeyEncrypted);
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    service: preferences.posterService,
  };
}
