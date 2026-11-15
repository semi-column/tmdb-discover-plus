import type { UserConfig, StremioStream } from '../types/index.ts';
import { tmdbFetch, isInvalidApiKeyError } from './tmdb/client.ts';
import { throwIfRequestAborted } from '../utils/requestContext.ts';
import { createLogger } from '../utils/logger.ts';
import { CACHE_TTLS } from '../cacheTtls.ts';
import {
  getWatchLinkRegions,
  parseWatchTitle,
  type WatchRegion,
  type WatchTitle,
} from '../utils/watchLinkConfig.ts';

const log = createLogger('watchLinks');

interface Provider {
  provider_id: number;
  provider_name: string;
}

interface Offers {
  flatrate?: Provider[];
  free?: Provider[];
  ads?: Provider[];
  rent?: Provider[];
  buy?: Provider[];
}

interface WatchResponse {
  id: number;
  results: Record<string, Offers>;
}

function providers(value: unknown): Provider[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value.filter((item): item is Provider => {
    if (
      !Number.isSafeInteger(item?.provider_id) ||
      item.provider_id <= 0 ||
      typeof item.provider_name !== 'string' ||
      !item.provider_name.trim() ||
      seen.has(item.provider_id)
    )
      return false;
    seen.add(item.provider_id);
    return true;
  });
}

function watchUrl(title: WatchTitle, country: string): string {
  // TMDB's documented watch/providers API has no provider deep links. Use its
  // exact title/region watch page, never guess a Netflix/Prime/etc. title URL.
  return title.tmdbId
    ? `https://www.themoviedb.org/${title.mediaType}/${title.tmdbId}/watch?locale=${country}`
    : `https://www.imdb.com/title/${title.imdbId}/`;
}

function checkStreams(title: WatchTitle, regions: WatchRegion[]): StremioStream[] {
  return regions.map(({ country }) => ({
    name: 'CHECK · Where to watch',
    description: `${country} · Availability could not be confirmed\nCheck the title's viewing options`,
    externalUrl: watchUrl(title, country),
  }));
}

/** Buckets come from the title's current offers, never from catalog membership. */
export function buildWatchStreams(
  title: WatchTitle,
  regions: WatchRegion[],
  data: WatchResponse
): StremioStream[] {
  return regions.flatMap(({ country, subscriptionProviders }) => {
    const offers = data.results[country] || {};
    const externalUrl = watchUrl(title, country);
    const included = providers(offers.flatrate).filter((item) =>
      subscriptionProviders.has(item.provider_id)
    );
    const free = providers(offers.free);
    const ads = providers(offers.ads).filter(
      (item) => !free.some((other) => other.provider_id === item.provider_id)
    );
    const paid = providers([...providers(offers.rent), ...providers(offers.buy)]);
    const rows: StremioStream[] = [];
    const add = (label: string, items: Provider[], detail: string) => {
      if (!items.length) return;
      rows.push({
        name: `${label} · ${items.length === 1 ? items[0].provider_name : `${items.length} services`}`,
        description: [
          `${country} · ${items.map((item) => item.provider_name).join(', ')}`,
          title.episode ? 'Series availability; confirm this episode and your plan' : detail,
          'Opens TMDB viewing options · JustWatch data',
        ].join('\n'),
        externalUrl,
      });
    };
    add(title.episode ? 'SERIES' : 'INCLUDED', included, 'Subscription offer; confirm your plan');
    add('FREE', free, 'Free offer');
    add('FREE WITH ADS', ads, 'Free offer with advertising');
    add('RENT / BUY', paid, 'Costs extra');
    rows.push({
      name: 'MORE · All viewing options',
      description: `${country} · All services, plans and prices\nOpens TMDB viewing options · JustWatch data`,
      externalUrl,
    });
    return rows;
  });
}

export async function getWatchStreams(
  userConfig: UserConfig,
  apiKey: string,
  type: string,
  id: string
): Promise<{ streams: StremioStream[]; cacheMaxAge: number }> {
  const regions = getWatchLinkRegions(userConfig);
  const title = parseWatchTitle(type, id);
  if (!title || !regions.length) return { streams: [], cacheMaxAge: 0 };
  try {
    if (!title.tmdbId) {
      // Select the exact media type on every request, including cached /find
      // responses. A title-name search cannot establish an identity.
      const found = (await tmdbFetch(`/find/${title.imdbId}`, apiKey, {
        external_source: 'imdb_id',
      })) as Record<string, Array<{ id: number }>>;
      const matches = found[title.mediaType === 'movie' ? 'movie_results' : 'tv_results'];
      if (
        !Array.isArray(matches) ||
        matches.length !== 1 ||
        !Number.isSafeInteger(matches[0]?.id) ||
        matches[0].id <= 0
      )
        return { streams: checkStreams(title, regions), cacheMaxAge: 0 };
      title.tmdbId = matches[0].id;
    }
    const data = (await tmdbFetch(
      `/${title.mediaType}/${title.tmdbId}/watch/providers`,
      apiKey
    )) as WatchResponse;
    if (
      data?.id !== title.tmdbId ||
      !data.results ||
      typeof data.results !== 'object' ||
      Array.isArray(data.results)
    )
      throw new Error('Invalid availability response');
    return {
      streams: buildWatchStreams(title, regions, data),
      cacheMaxAge: CACHE_TTLS.WATCH_LINKS,
    };
  } catch (error) {
    throwIfRequestAborted();
    if (isInvalidApiKeyError(error)) throw error;
    log.debug('Availability lookup failed', { type, id });
    return { streams: checkStreams(title, regions), cacheMaxAge: 0 };
  }
}
