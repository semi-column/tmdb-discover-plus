import fetch from 'node-fetch';
import { getCache } from './cache/index.ts';
import { createLogger } from '../utils/logger.ts';
import { TIMEOUTS, CACHE_TTLS } from '../constants.ts';
import { logSwallowedError } from '../utils/helpers.ts';

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

interface NominatimCityResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  addresstype?: string;
  type?: string;
  place_rank?: number;
  importance?: number;
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
}

interface CityCandidate {
  city: GeoCity;
  dedupeKey: string;
  score: number;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function getPlaceTypeScore(result: NominatimCityResult): number {
  const addresstype = (result.addresstype || '').toLowerCase();
  const type = (result.type || '').toLowerCase();

  const highPriority = new Set(['city', 'town', 'village', 'municipality', 'hamlet']);
  const midPriority = new Set(['suburb', 'city_district', 'district', 'borough']);
  const lowPriority = new Set(['county', 'province', 'state', 'region']);

  if (highPriority.has(addresstype) || highPriority.has(type)) return 100;
  if (midPriority.has(addresstype) || midPriority.has(type)) return 70;
  if (lowPriority.has(addresstype) || lowPriority.has(type)) return 35;
  if (addresstype === 'country' || type === 'country') return 20;
  if (addresstype === 'administrative' || type === 'administrative') return 30;
  return 40;
}

function getCityScore(result: NominatimCityResult): number {
  const placeTypeScore = getPlaceTypeScore(result);
  const importanceScore = (result.importance || 0) * 10;
  const placeRank = result.place_rank || 0;
  const cityNameBonus =
    result.address?.city || result.address?.town || result.address?.village ? 5 : 0;
  return placeTypeScore + importanceScore + placeRank / 100 + cityNameBonus;
}

function buildCityCandidate(item: NominatimCityResult): CityCandidate {
  const name =
    item.address?.city ||
    item.address?.town ||
    item.address?.village ||
    item.name ||
    item.display_name.split(',')[0];

  const state = item.address?.state || item.address?.region || item.address?.county || '';
  const country = item.address?.country || '';

  const locationParts = [state, country].filter(Boolean);
  const countryCode = (item.address?.country_code || '').toUpperCase();
  const displayName = item.display_name;

  return {
    city: {
      id: String(item.place_id),
      name,
      displayName,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      state,
      country,
      countryCode,
      locationLabel: locationParts.join(', '),
    },
    dedupeKey: `${normalizeText(displayName)}|${countryCode}`,
    score: getCityScore(item),
  };
}

function dedupeCityCandidates(candidates: CityCandidate[], limit: number): GeoCity[] {
  const grouped = new Map<string, CityCandidate[]>();

  for (const candidate of candidates) {
    const list = grouped.get(candidate.dedupeKey) || [];
    list.push(candidate);
    grouped.set(candidate.dedupeKey, list);
  }

  const winners: CityCandidate[] = [];
  for (const group of grouped.values()) {
    group.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aId = Number(a.city.id) || 0;
      const bId = Number(b.city.id) || 0;
      return aId - bId;
    });
    winners.push(group[0]);
  }

  winners.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.city.displayName.localeCompare(b.city.displayName);
  });

  return winners.slice(0, Math.min(limit, 20)).map((entry) => entry.city);
}

let lastRequestTime = 0;

export async function searchCities(query: string, limit: number = 10): Promise<GeoCity[]> {
  if (!query || query.length < 2) return [];

  const cacheKey = `geo_cities_${query.toLowerCase().trim()}_${limit}`;
  const cache = getCache();

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return cached as GeoCity[];
  } catch (err) {
    logSwallowedError('geo:cache-get', err);
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
      signal: AbortSignal.timeout(TIMEOUTS.NOMINATIM_FETCH_MS),
    });

    if (!response.ok) {
      throw new Error(`Nominatim HTTP ${response.status}`);
    }

    const data = (await response.json()) as NominatimCityResult[];
    const candidates = data.map(buildCityCandidate);
    const cities = dedupeCityCandidates(candidates, limit);

    await cache.set(cacheKey, cities, CACHE_TTLS.DETAIL);
    return cities;
  } catch (err) {
    log.warn('Failed to search cities', { query, error: (err as Error).message });
    return [];
  }
}
