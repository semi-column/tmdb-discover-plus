import { tmdbFetch } from './client.js';
import { shuffleArray } from '../../utils/helpers.js';

/**
 * Discover movies or TV shows with filters
 */
export async function discover(apiKey, options = {}) {
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
    genreMatchMode = 'any', // 'any' (OR) or 'all' (AND)
    randomize = false,
    // Movie-specific
    releaseDateFrom,
    releaseDateTo,
    releaseTypes = [],
    releaseType, // singular (new)
    certification,
    certifications = [], // multiple (new)
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
    region, // For regional release date filtering (movies)
    // TV-specific
    airDateFrom,
    airDateTo,
    firstAirDateFrom, // When show first premiered
    firstAirDateTo,
    firstAirDateYear,
    includeNullFirstAirDates,
    screenedTheatrically,
    timezone,
    withNetworks,
    tvStatus,
    tvType,
    // Watch providers
    watchRegion,
    watchProviders = [],
    watchMonetizationTypes = [],
    watchMonetizationType, // singular (new)
  } = options;

  const mediaType = type === 'series' ? 'tv' : 'movie';
  const endpoint = `/discover/${mediaType}`;

  const params = {
    sort_by: sortBy,
    page,
    include_adult: includeAdult,
    'vote_count.gte': voteCountMin,
  };

  if (mediaType === 'movie' && includeVideo) params.include_video = true;

  // Genres: use pipe-separated list for OR, comma for AND
  // TMDB accepts comma (,) for AND logic, pipe (|) for OR logic
  // Default to OR (pipe) for backward compatibility unless explicitly set to 'all'
  if (genres.length > 0) {
    const separator = genreMatchMode === 'all' ? ',' : '|';
    params.with_genres = genres.join(separator);
  }
  if (excludeGenres.length > 0) {
    params.without_genres = excludeGenres.join(',');
  }

  // Year filters (legacy - uses date filters internally)
  // When region is set, use release_date to filter by regional release
  // Without region, use primary_release_date to filter by global release
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

  // Rating filters
  if (ratingMin) params['vote_average.gte'] = ratingMin;
  if (ratingMax) params['vote_average.lte'] = ratingMax;

  // Original language filter
  if (language) params.with_original_language = language;

  // Display language (localize titles/overviews where available)
  if (displayLanguage) {
    params.language = displayLanguage;
    // Also request localized images, fallback to null (no text)
    params.include_image_language = `${displayLanguage},null`;
  }

  // Origin country
  // TMDB supports pipe (|) for OR logic
  if (originCountry) {
    params.with_origin_country = Array.isArray(originCountry)
      ? originCountry.join('|')
      : String(originCountry).replace(/,/g, '|');
  }

  // Runtime filters
  if (runtimeMin) params['with_runtime.gte'] = runtimeMin;
  if (runtimeMax) params['with_runtime.lte'] = runtimeMax;

  // Movie-specific filters
  if (mediaType === 'movie') {
    // Region for regional release dates
    if (region) params.region = region;

    // Release date filters
    // When region is set, use release_date to filter by regional release
    // Without region, use primary_release_date to filter by global/original release
    // Note: Release types only work with region parameter according to TMDB docs
    const useRegionalRelease = Boolean(region);
    const dateKey = useRegionalRelease ? 'release_date' : 'primary_release_date';
    if (releaseDateFrom) params[`${dateKey}.gte`] = releaseDateFrom;
    if (releaseDateTo) params[`${dateKey}.lte`] = releaseDateTo;

    // Release type filter (1=Premiere, 2=Limited, 3=Theatrical, 4=Digital, 5=Physical, 6=TV)
    // Only apply release type filter when region is specified (TMDB API requirement)
    if (region && releaseType) {
      params.with_release_type = releaseType;
    } else if (region && releaseTypes.length > 0) {
      params.with_release_type = releaseTypes.join('|');
    }

    // Certification (age rating) - supports multiple values with pipe separator
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

  // TV-specific filters
  if (mediaType === 'tv') {
    // Air date filters (when episodes air)
    if (airDateFrom) params['air_date.gte'] = airDateFrom;
    if (airDateTo) params['air_date.lte'] = airDateTo;

    // First air date filters (when show premiered) - separate from episode air dates
    if (firstAirDateFrom) params['first_air_date.gte'] = firstAirDateFrom;
    if (firstAirDateTo) params['first_air_date.lte'] = firstAirDateTo;

    if (firstAirDateYear) params.first_air_date_year = firstAirDateYear;
    if (includeNullFirstAirDates) params.include_null_first_air_dates = true;
    if (screenedTheatrically) params.screened_theatrically = true;
    if (timezone) params.timezone = timezone;

    // Networks
    if (withNetworks) params.with_networks = withNetworks;

    // Status (0=Returning, 1=Planned, 2=Pilot, 3=Ended, 4=Cancelled, 5=Production)
    if (tvStatus) params.with_status = tvStatus;

    // Type (0=Documentary, 1=News, 2=Miniseries, 3=Reality, 4=Scripted, 5=Talk, 6=Video)
    if (tvType) params.with_type = tvType;
  }

  // People filters (cast, crew, or any person)
  // TMDB uses pipe (|) for OR logic
  if (withCast) params.with_cast = String(withCast).replace(/,/g, '|');
  if (withCrew) params.with_crew = String(withCrew).replace(/,/g, '|');
  if (withPeople) params.with_people = String(withPeople).replace(/,/g, '|');

  // Company filter
  if (withCompanies) params.with_companies = String(withCompanies).replace(/,/g, '|');
  if (excludeCompanies) params.without_companies = excludeCompanies;

  // Keyword filters
  if (withKeywords) {
    // TMDB uses pipe (|) for OR, comma (,) for AND. Default to OR.
    params.with_keywords = String(withKeywords).replace(/,/g, '|');
  }
  if (excludeKeywords) params.without_keywords = excludeKeywords;

  // Watch provider filters
  if (watchRegion && watchProviders.length > 0) {
    params.watch_region = watchRegion;
    params.with_watch_providers = watchProviders.join('|');
  }
  // Watch monetization type
  if (watchMonetizationType) {
    params.with_watch_monetization_types = watchMonetizationType;
  } else if (watchMonetizationTypes.length > 0) {
    params.with_watch_monetization_types = watchMonetizationTypes.join('|');
  }

  if (randomize) {
    const discoverResult = await tmdbFetch(endpoint, apiKey, { ...params, page: 1 });
    const maxPage = Math.min(discoverResult.total_pages || 1, 500);
    const randomPage = Math.floor(Math.random() * maxPage) + 1;

    const result = await tmdbFetch(endpoint, apiKey, { ...params, page: randomPage });
    if (result?.results) {
      result.results = shuffleArray(result.results);
    }
    return result;
  }

  return tmdbFetch(endpoint, apiKey, params);
}

/**
 * Fetch special lists (trending, now playing, upcoming, etc.)
 * These use dedicated TMDB endpoints instead of /discover
 */
export async function fetchSpecialList(apiKey, listType, type = 'movie', options = {}) {
  const { page = 1, language, displayLanguage, region } = options;
  const mediaType = type === 'series' ? 'tv' : 'movie';

  const params = { page };
  const languageParam = displayLanguage || language;
  if (languageParam) params.language = languageParam;
  if (region) params.region = region;

  let endpoint;

  switch (listType) {
    case 'trending_day':
      endpoint = `/trending/${mediaType}/day`;
      break;
    case 'trending_week':
      endpoint = `/trending/${mediaType}/week`;
      break;
    case 'now_playing':
      // Movies only
      endpoint = '/movie/now_playing';
      break;
    case 'upcoming':
      // Movies only
      endpoint = '/movie/upcoming';
      break;
    case 'airing_today':
      // TV only
      endpoint = '/tv/airing_today';
      break;
    case 'on_the_air':
      // TV only
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
    const discoverResult = await tmdbFetch(endpoint, apiKey, { ...params, page: 1 });
    const maxPage = Math.min(discoverResult.total_pages || 1, 500);
    const randomPage = Math.floor(Math.random() * maxPage) + 1;

    const result = await tmdbFetch(endpoint, apiKey, { ...params, page: randomPage });
    if (result?.results) {
      result.results = shuffleArray(result.results);
    }
    return result;
  }

  return tmdbFetch(endpoint, apiKey, params);
}
