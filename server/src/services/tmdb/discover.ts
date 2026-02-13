import { tmdbFetch } from './client.ts';
import { shuffleArray } from '../../utils/helpers.js';
import { getCache } from '../cache/index.js';
import { stableStringify } from '../../utils/stableStringify.ts';

import type { ContentType, DiscoverOptions, SpecialListOptions, SpecialListType } from '../../types/index.ts';

export async function discover(apiKey: string, options: DiscoverOptions = {}): Promise<unknown> {
  const {
    type = 'movie',
    genres = [],
    excludeGenres = [],
    yearFrom,
    yearTo,
    ratingMin,
    ratingMax,
    sortBy = 'popularity.desc',
    language,
    displayLanguage,
    originCountry,
    includeAdult = false,
    includeVideo,
    voteCountMin = 0,
    page = 1,
    genreMatchMode = 'any',
    randomize = false,
    releaseDateFrom,
    releaseDateTo,
    releaseTypes = [],
    releaseType,
    certification,
    certifications = [],
    certificationMin,
    certificationMax,
    certificationCountry,
    primaryReleaseYear,
    runtimeMin,
    runtimeMax,
    withCast,
    withCrew,
    withPeople,
    withCompanies,
    withKeywords,
    excludeKeywords,
    excludeCompanies,
    region,
    airDateFrom,
    airDateTo,
    firstAirDateFrom,
    firstAirDateTo,
    firstAirDateYear,
    includeNullFirstAirDates,
    screenedTheatrically,
    timezone,
    withNetworks,
    tvStatus,
    tvType,
    watchRegion,
    watchProviders = [],
    watchMonetizationTypes = [],
    watchMonetizationType,
  } = options;

  const mediaType = type === 'series' ? 'tv' : 'movie';
  const endpoint = `/discover/${mediaType}`;

  const params: Record<string, string | number | boolean | undefined> = {
    sort_by: sortBy,
    page,
    include_adult: includeAdult,
    'vote_count.gte': voteCountMin,
  };

  if (mediaType === 'movie' && includeVideo) params.include_video = true;

  if (genres.length > 0) {
    const separator = genreMatchMode === 'all' ? ',' : '|';
    params.with_genres = genres.join(separator);
  }
  if (excludeGenres.length > 0) {
    params.without_genres = excludeGenres.join(',');
  }

  if (mediaType === 'movie') {
    const useRegionalRelease = Boolean(region);
    const dateKey = useRegionalRelease ? 'release_date' : 'primary_release_date';
    if (yearFrom && !releaseDateFrom) params[`${dateKey}.gte`] = `${yearFrom}-01-01`;
    if (yearTo && !releaseDateTo) params[`${dateKey}.lte`] = `${yearTo}-12-31`;
    if (primaryReleaseYear) params.primary_release_year = primaryReleaseYear;
  } else {
    if (yearFrom && !airDateFrom) params['first_air_date.gte'] = `${yearFrom}-01-01`;
    if (yearTo && !airDateTo) params['first_air_date.lte'] = `${yearTo}-12-31`;
  }

  if (ratingMin) params['vote_average.gte'] = ratingMin;
  if (ratingMax) params['vote_average.lte'] = ratingMax;

  if (language) params.with_original_language = language;

  if (displayLanguage) {
    params.language = displayLanguage;
    params.include_image_language = `${displayLanguage},null`;
  }

  if (originCountry) {
    params.with_origin_country = Array.isArray(originCountry)
      ? originCountry.join('|')
      : String(originCountry).replace(/,/g, '|');
  }

  if (runtimeMin) params['with_runtime.gte'] = runtimeMin;
  if (runtimeMax) params['with_runtime.lte'] = runtimeMax;

  if (mediaType === 'movie') {
    if (region) params.region = region;

    const useRegionalRelease = Boolean(region);
    const dateKey = useRegionalRelease ? 'release_date' : 'primary_release_date';
    if (releaseDateFrom) params[`${dateKey}.gte`] = releaseDateFrom;
    if (releaseDateTo) params[`${dateKey}.lte`] = releaseDateTo;

    if (region && releaseType) {
      params.with_release_type = releaseType;
    } else if (region && releaseTypes.length > 0) {
      params.with_release_type = releaseTypes.join('|');
    }

    if (certifications.length > 0) {
      params.certification = certifications.join('|');
      params.certification_country = certificationCountry || 'US';
    } else if (certification) {
      params.certification = certification;
      params.certification_country = certificationCountry || 'US';
    } else if (certificationMin || certificationMax) {
      if (certificationMin) params['certification.gte'] = certificationMin;
      if (certificationMax) params['certification.lte'] = certificationMax;
      params.certification_country = certificationCountry || 'US';
    } else if (certificationCountry) {
      params.certification_country = certificationCountry;
    }
  }

  if (mediaType === 'tv') {
    if (airDateFrom) params['air_date.gte'] = airDateFrom;
    if (airDateTo) params['air_date.lte'] = airDateTo;

    if (firstAirDateFrom) params['first_air_date.gte'] = firstAirDateFrom;
    if (firstAirDateTo) params['first_air_date.lte'] = firstAirDateTo;

    if (firstAirDateYear) params.first_air_date_year = firstAirDateYear;
    if (includeNullFirstAirDates) params.include_null_first_air_dates = true;
    if (screenedTheatrically) params.screened_theatrically = true;
    if (timezone) params.timezone = timezone;

    if (withNetworks) params.with_networks = withNetworks;

    if (tvStatus) params.with_status = tvStatus;

    if (tvType) params.with_type = tvType;
  }

  if (withCast) params.with_cast = String(withCast).replace(/,/g, '|');
  if (withCrew) params.with_crew = String(withCrew).replace(/,/g, '|');
  if (withPeople) params.with_people = String(withPeople).replace(/,/g, '|');

  if (withCompanies) params.with_companies = String(withCompanies).replace(/,/g, '|');
  if (excludeCompanies) params.without_companies = excludeCompanies;

  if (withKeywords) {
    params.with_keywords = String(withKeywords).replace(/,/g, '|');
  }
  if (excludeKeywords) params.without_keywords = excludeKeywords;

  if (watchRegion && watchProviders.length > 0) {
    params.watch_region = watchRegion;
    params.with_watch_providers = watchProviders.join('|');
  }
  if (watchMonetizationType) {
    params.with_watch_monetization_types = watchMonetizationType;
  } else if (watchMonetizationTypes.length > 0) {
    params.with_watch_monetization_types = watchMonetizationTypes.join('|');
  }

  if (randomize) {
    const totalPagesCacheKey = `total_pages:${endpoint}:${stableStringify(params)}`;
    const cache = getCache();
    let maxPage = 0;

    try {
      const cached = await cache.get(totalPagesCacheKey);
      if (cached && typeof cached === 'object' && '__cacheWrapper' in (cached as Record<string, unknown>)) {
        maxPage = ((cached as Record<string, unknown>).data as number) || 0;
      } else if (typeof cached === 'number') {
        maxPage = cached;
      }
    } catch {
      /* best effort */
    }

    if (!maxPage) {
      const discoverResult = (await tmdbFetch(endpoint, apiKey, { ...params, page: 1 })) as {
        total_pages?: number;
        results?: unknown[];
      };
      maxPage = Math.min(discoverResult.total_pages || 1, 500);
      try {
        await cache.set(totalPagesCacheKey, maxPage, 86400);
      } catch {
        /* best effort */
      }
    }

    const randomPage = Math.floor(Math.random() * maxPage) + 1;
    const result = (await tmdbFetch(endpoint, apiKey, { ...params, page: randomPage })) as {
      results?: unknown[];
    };
    if (result?.results) {
      result.results = shuffleArray(result.results);
    }
    return result;
  }

  return tmdbFetch(endpoint, apiKey, params);
}

export async function fetchSpecialList(
  apiKey: string,
  listType: SpecialListType | string,
  type: ContentType = 'movie',
  options: SpecialListOptions = {},
): Promise<unknown> {
  const { page = 1, language, displayLanguage, region } = options;
  const mediaType = type === 'series' ? 'tv' : 'movie';

  const params: Record<string, string | number | boolean | undefined> = { page };
  const languageParam = displayLanguage || language;
  if (languageParam) params.language = languageParam;
  if (region) params.region = region;

  let endpoint!: string;

  switch (listType) {
    case 'trending_day':
      endpoint = `/trending/${mediaType}/day`;
      break;
    case 'trending_week':
      endpoint = `/trending/${mediaType}/week`;
      break;
    case 'now_playing':
      endpoint = '/movie/now_playing';
      break;
    case 'upcoming':
      endpoint = '/movie/upcoming';
      break;
    case 'airing_today':
      endpoint = '/tv/airing_today';
      break;
    case 'on_the_air':
      endpoint = '/tv/on_the_air';
      break;
    case 'top_rated':
      endpoint = `/${mediaType}/top_rated`;
      break;
    case 'popular':
      endpoint = `/${mediaType}/popular`;
      break;
    case 'random':
      return discover(apiKey, { type, page, ...options, randomize: true });
    default:
      break;
  }

  if (options.randomize) {
    const totalPagesCacheKey = `total_pages:${endpoint}:${stableStringify(params)}`;
    const cache = getCache();
    let maxPage = 0;

    try {
      const cached = await cache.get(totalPagesCacheKey);
      if (cached && typeof cached === 'object' && '__cacheWrapper' in (cached as Record<string, unknown>)) {
        maxPage = ((cached as Record<string, unknown>).data as number) || 0;
      } else if (typeof cached === 'number') {
        maxPage = cached;
      }
    } catch {
      /* best effort */
    }

    if (!maxPage) {
      const discoverResult = (await tmdbFetch(endpoint, apiKey, { ...params, page: 1 })) as {
        total_pages?: number;
        results?: unknown[];
      };
      maxPage = Math.min(discoverResult.total_pages || 1, 500);
      try {
        await cache.set(totalPagesCacheKey, maxPage, 86400);
      } catch {
        /* best effort */
      }
    }

    const randomPage = Math.floor(Math.random() * maxPage) + 1;
    const result = (await tmdbFetch(endpoint, apiKey, { ...params, page: randomPage })) as {
      results?: unknown[];
    };
    if (result?.results) {
      result.results = shuffleArray(result.results);
    }
    return result;
  }

  return tmdbFetch(endpoint, apiKey, params);
}
