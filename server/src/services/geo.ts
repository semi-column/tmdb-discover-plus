import fetch from 'node-fetch';
import { getCache } from './cache/index.ts';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('geo');
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

export interface GeoCity {
  id: string;
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  state: string;
  country: string;
  countryCode: string;
  locationLabel: string;
}

let lastRequestTime = 0;

export async function searchCities(query: string, limit: number = 10): Promise<GeoCity[]> {
  if (!query || query.length < 2) return [];

  const cacheKey = `geo_cities_${query.toLowerCase().trim()}_${limit}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached as GeoCity[];
  } catch (_e) {
    /* ignore cache miss */
  }

  // Nominatim requires max 1 request per second
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1100) {
    await new Promise((resolve) => setTimeout(resolve, 1100 - elapsed));
  }
  lastRequestTime = Date.now();

  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(Math.min(limit, 20)));
  url.searchParams.set('featuretype', 'city');
  url.searchParams.set('addressdetails', '1');

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'TMDB-Discover-Plus/1.0',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`Nominatim HTTP ${response.status}`);
    }

    const data = (await response.json()) as Array<{
      place_id: number;
      display_name: string;
      lat: string;
      lon: string;
      address?: {
        city?: string;
        town?: string;
        village?: string;
        state?: string;
        region?: string;
        county?: string;
        country?: string;
        country_code?: string;
      };
      name?: string;
    }>;

    const cities: GeoCity[] = data.map((item) => {
      const name =
        item.address?.city ||
        item.address?.town ||
        item.address?.village ||
        item.name ||
        item.display_name.split(',')[0];

      const state = item.address?.state || item.address?.region || item.address?.county || '';
      const country = item.address?.country || '';

      const locationParts = [state, country].filter(Boolean);

      return {
        id: String(item.place_id),
        name,
        displayName: item.display_name,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
        state,
        country,
        countryCode: (item.address?.country_code || '').toUpperCase(),
        locationLabel: locationParts.join(', '),
      };
    });

    await cache.set(cacheKey, cities, 86400); // cache 24h
    return cities;
  } catch (err) {
    log.warn('Failed to search cities', { query, error: (err as Error).message });
    return [];
  }
}
