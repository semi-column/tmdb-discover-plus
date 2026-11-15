import type { UserConfig } from '../types/config.ts';

export interface WatchRegion {
  country: string;
  subscriptionProviders: Set<number>;
}

export interface WatchTitle {
  mediaType: 'movie' | 'tv';
  tmdbId: number | null;
  imdbId: string | null;
  episode: boolean;
}

/** Only subscription-only catalogs identify services the user treats as included. */
export function getWatchLinkRegions(userConfig: UserConfig | null): WatchRegion[] {
  if (userConfig?.preferences?.enableWatchLinks !== true) return [];
  const regions = new Map<string, WatchRegion>();
  for (const catalog of userConfig.catalogs || []) {
    if (
      catalog.enabled === false ||
      (catalog.source && catalog.source !== 'tmdb') ||
      !['movie', 'series'].includes(catalog.type)
    )
      continue;
    const filters = catalog.filters || {};
    // Popular/trending/collection modes do not apply provider filters. Do not
    // interpret leftover hidden filters in those catalogs as subscriptions.
    if (filters.listType && filters.listType !== 'discover') continue;
    const country =
      typeof filters.watchRegion === 'string' ? filters.watchRegion.trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(country)) continue;
    let region = regions.get(country);
    if (!region) {
      region = { country, subscriptionProviders: new Set() };
      regions.set(country, region);
    }
    // Match discover.ts's precedence for the legacy singular setting.
    const monetization =
      typeof filters.watchMonetizationType === 'string' && filters.watchMonetizationType
        ? filters.watchMonetizationType.split('|')
        : filters.watchMonetizationTypes;
    if (!Array.isArray(monetization) || monetization.length !== 1 || monetization[0] !== 'flatrate')
      continue;
    for (const provider of Array.isArray(filters.watchProviders) ? filters.watchProviders : []) {
      if (Number.isSafeInteger(provider) && provider > 0) {
        region.subscriptionProviders.add(provider);
      }
    }
  }
  return [...regions.values()];
}

/** Accept exact IMDb/TMDB IDs, with optional season/episode components for series. */
export function parseWatchTitle(type: string, id: string): WatchTitle | null {
  if (type !== 'movie' && type !== 'series') return null;
  const match = /^(tt\d{5,12}|tmdb:([1-9]\d{0,11}))(?::(\d{1,4}):([1-9]\d{0,3}))?$/.exec(id);
  if (!match || (match[3] !== undefined && type !== 'series')) return null;
  return {
    mediaType: type === 'series' ? 'tv' : 'movie',
    tmdbId: match[2] ? Number(match[2]) : null,
    imdbId: match[2] ? null : match[1],
    episode: match[3] !== undefined,
  };
}
