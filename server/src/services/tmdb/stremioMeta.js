import { createLogger } from '../../utils/logger.js';
import { generatePosterUrl, generateBackdropUrl, isValidPosterConfig } from '../posterService.js';
import { getRpdbRating } from '../rpdb.js';
import { TMDB_IMAGE_BASE } from './constants.js';
import { getImdbRatingString } from '../imdbRatings/index.js';
import { genreCache, staticGenreMap } from './genres.js';
import { usToLocalRatings } from './certificationMappings.js';

const log = createLogger('tmdb:stremioMeta');

// ── Utility helpers ──────────────────────────────────────────────────────────

/**
 * Format minutes into "2h47min" or "58min"
 * @param {number|null} minutes
 * @returns {string|undefined}
 */
export function formatRuntime(minutes) {
  if (!minutes) return undefined;
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}min` : `${h}h`;
}

/**
 * Generate a Stremio-style slug
 * @param {string} type
 * @param {string} title
 * @param {string} id
 * @returns {string}
 */
export function generateSlug(type, title, id) {
  const safeTitle = (title || '').toLowerCase().replace(/ /g, '-');
  return `${type}/${safeTitle}-${id}`;
}

// ── Full meta conversion ─────────────────────────────────────────────────────

/**
 * Convert TMDB details to a full Stremio Meta Object.
 * @param {Object} details - TMDB details object
 * @param {string} type - Content type ('movie' or 'series')
 * @param {string|null} imdbId - IMDb ID if available
 * @param {string|null} requestedId - The ID originally requested by Stremio
 * @param {Object|null} posterOptions - Optional poster service config { apiKey, service }
 * @param {Array|null} videos - Optional array of Video objects for series episodes
 * @param {string|null} targetLanguage - Target language for localization
 * @param {Object} opts - Additional options { manifestUrl, genreCatalogId }
 * @returns {Object} Stremio meta object
 */
export async function toStremioFullMeta(
  details,
  type,
  imdbId = null,
  requestedId = null,
  posterOptions = null,
  videos = null,
  targetLanguage = null,
  { manifestUrl = null, genreCatalogId = null, allLogos = null } = {}
) {
  if (!details) return {};
  const isMovie = type === 'movie';
  const title = isMovie ? details.title : details.name;
  const releaseDate = isMovie ? details.release_date : details.first_air_date;
  const year = releaseDate ? String(releaseDate).split('-')[0] : '';

  const genres = Array.isArray(details.genres)
    ? details.genres.map((g) => g?.name).filter(Boolean)
    : [];

  // Credits (best-effort; Stremio warns these may be deprecated but still supported)
  const credits = details.credits || {};
  const cast = Array.isArray(credits.cast)
    ? credits.cast
        .slice(0, 20)
        .map((p) => p?.name)
        .filter(Boolean)
    : [];

  const crew = Array.isArray(credits.crew) ? credits.crew : [];
  const directors = crew
    .filter((p) => p?.job === 'Director')
    .map((p) => p?.name)
    .filter(Boolean);

  let runtimeMin = null;
  if (isMovie && typeof details.runtime === 'number') runtimeMin = details.runtime;
  if (!isMovie) {
    if (Array.isArray(details.episode_run_time) && details.episode_run_time.length > 0) {
      const first = details.episode_run_time.find((v) => typeof v === 'number');
      if (typeof first === 'number') runtimeMin = first;
    }
    if (!runtimeMin && details.last_episode_to_air?.runtime) {
      runtimeMin = details.last_episode_to_air.runtime;
    }
    if (!runtimeMin && details.next_episode_to_air?.runtime) {
      runtimeMin = details.next_episode_to_air.runtime;
    }
  }

  const effectiveImdbId = imdbId || details?.external_ids?.imdb_id || null;
  const status = details.status || null;

  // Age Rating / Certification - use country from language setting, fallback to US
  // Extract country code: "it" -> "IT", "en-US" -> "US", "pt-BR" -> "BR"
  const countryCode = targetLanguage
    ? targetLanguage.includes('-')
      ? targetLanguage.split('-')[1].toUpperCase()
      : targetLanguage.toUpperCase()
    : 'US';

  log.debug('Certification lookup', { targetLanguage, countryCode });

  let certification = null;
  if (isMovie && details.release_dates?.results) {
    // Try user's country first, then fallback to US
    let countryInfo = details.release_dates.results.find((r) => r.iso_3166_1 === countryCode);
    if (!countryInfo && countryCode !== 'US') {
      countryInfo = details.release_dates.results.find((r) => r.iso_3166_1 === 'US');
    }
    if (countryInfo?.release_dates?.length > 0) {
      // Find optimal rating (theatrical preferred)
      const rated =
        countryInfo.release_dates.find((d) => d.certification) || countryInfo.release_dates[0];
      if (rated?.certification) certification = rated.certification;
    }
  } else if (!isMovie && details.content_ratings?.results) {
    // Try user's country first, then fallback to US
    let countryInfo = details.content_ratings.results.find((r) => r.iso_3166_1 === countryCode);
    if (!countryInfo && countryCode !== 'US') {
      countryInfo = details.content_ratings.results.find((r) => r.iso_3166_1 === 'US');
    }
    if (countryInfo?.rating) certification = countryInfo.rating;
  }

  // Apply conversion if using fallback US rating
  const localMap = usToLocalRatings[countryCode];
  if (certification && localMap && localMap[certification]) {
    certification = localMap[certification];
  }

  // Format Release Info - Year or Year Range (like Cinemeta)
  // Ended series: "2016-2025", Ongoing: "2016-", Movies: "2016"
  let releaseInfo = year;
  if (!isMovie) {
    const endYear = details.last_air_date ? String(details.last_air_date).split('-')[0] : null;
    if (status === 'Ended' && endYear && endYear !== year) {
      releaseInfo = `${year}-${endYear}`;
    } else if (
      status === 'Returning Series' ||
      status === 'In Production' ||
      !details.last_air_date
    ) {
      releaseInfo = `${year}-`;
    }
  }

  // Add certification if present (separated with em-spaces for proper width)
  if (certification) {
    releaseInfo = releaseInfo ? `${releaseInfo}\u2003\u2003${certification}` : certification;
  }

  // Trailer
  let trailer = null;
  if (details.videos?.results?.length > 0) {
    const allVideos = details.videos.results.filter((v) => v.site === 'YouTube');

    // Prioritize:
    // 1. Language match + Trailer
    // 2. Language match + Teaser/Clip
    // 3. English + Trailer
    // 4. Any Trailer

    // Extract language code (e.g., 'it' from 'it-IT') since TMDB uses ISO 639-1
    const lang = targetLanguage ? targetLanguage.split('-')[0] : 'en';

    const trailerVideo =
      allVideos.find((v) => v.iso_639_1 === lang && v.type === 'Trailer') ||
      allVideos.find((v) => v.iso_639_1 === lang) ||
      allVideos.find((v) => v.iso_639_1 === 'en' && v.type === 'Trailer') ||
      allVideos.find((v) => v.type === 'Trailer') ||
      allVideos[0];

    if (trailerVideo) {
      trailer = `yt:${trailerVideo.key}`;
    }
  }

  // Links
  const links = [];

  let actualImdbRating = null;

  // 1. Try IMDb dataset (bulk-loaded on startup — instant, offline, near-100% coverage)
  if (effectiveImdbId) {
    try {
      const datasetRating = await getImdbRatingString(effectiveImdbId);
      if (datasetRating) {
        actualImdbRating = datasetRating;
      }
    } catch (e) {
      /* ignore */
    }
  }

  // 2. Fallback: try RPDB if the dataset didn't have it
  if (!actualImdbRating && effectiveImdbId) {
    const rpdbKey =
      posterOptions?.service === 'rpdb' && posterOptions.apiKey
        ? posterOptions.apiKey
        : process.env.RPDB_API_KEY;

    if (rpdbKey) {
      try {
        const realRating = await getRpdbRating(rpdbKey, effectiveImdbId);
        if (realRating && realRating !== 'N/A') {
          actualImdbRating = realRating;
        }
      } catch (e) {
        /* ignore */
      }
    }
  }

  if (effectiveImdbId) {
    links.push({
      name: actualImdbRating || 'IMDb',
      category: 'imdb',
      url: `https://imdb.com/title/${effectiveImdbId}`,
    });
  }

  // Genre Links — deep-link to own discover catalog when manifestUrl is available, fallback to search
  genres.forEach((genre) => {
    const genreUrl = manifestUrl && genreCatalogId
      ? `stremio:///discover/${encodeURIComponent(manifestUrl)}/${type}/${genreCatalogId}?genre=${encodeURIComponent(genre)}`
      : `stremio:///search?search=${encodeURIComponent(genre)}`;
    links.push({
      name: genre,
      category: 'Genres',
      url: genreUrl,
    });
  });

  // Cast Links
  cast.slice(0, 5).forEach((name) => {
    links.push({
      name: name,
      category: 'Cast',
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    });
  });

  // Director Links
  directors.forEach((name) => {
    links.push({
      name: name,
      category: 'Directors',
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    });
  });

  // Crew strings
  const writers = crew.filter((p) => ['Writer', 'Screenplay', 'Author'].includes(p.job));
  const writerNames = writers.map((p) => p.name);
  const writerString = writerNames.join(', ');
  const directorString = directors.join(', ');

  // Creator string for series (from TMDB created_by field)
  const creators = !isMovie && Array.isArray(details.created_by)
    ? details.created_by.map((p) => p?.name).filter(Boolean)
    : [];
  const creatorString = creators.join(', ');

  // Writer Links
  writerNames.forEach((name) => {
    links.push({
      name: name,
      category: 'Writers',
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    });
  });

  // Creator Links (series only — "Created By" credit)
  creators.forEach((name) => {
    // Avoid duplicate if creator is also a writer
    if (!writerNames.includes(name)) {
      links.push({
        name: name,
        category: 'Writers',
        url: `stremio:///search?search=${encodeURIComponent(name)}`,
      });
    }
  });

  // Network Links (series) / Studio Links (movies)
  if (!isMovie && Array.isArray(details.networks) && details.networks.length > 0) {
    const network = details.networks[0];
    if (network?.name) {
      links.push({
        name: network.name,
        category: 'Networks',
        url: `stremio:///search?search=${encodeURIComponent(network.name)}`,
      });
    }
  }
  if (isMovie && Array.isArray(details.production_companies) && details.production_companies.length > 0) {
    const studio = details.production_companies[0];
    if (studio?.name) {
      links.push({
        name: studio.name,
        category: 'Studios',
        url: `stremio:///search?search=${encodeURIComponent(studio.name)}`,
      });
    }
  }

  // Share Link
  const slugTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  links.push({
    name: title,
    category: 'share',
    url: `https://www.strem.io/s/${type}/${slugTitle}-${details.id}`,
  });

  // Trailer Streams and Trailers array
  const trailerStreams = [];
  const trailers = []; // Stremio format: { source, type }

  if (details.videos?.results) {
    const lang = targetLanguage ? targetLanguage.split('-')[0] : 'en';

    // Get all YouTube trailers
    const youtubeTrailers = details.videos.results.filter(
      (v) => v.site === 'YouTube' && v.type === 'Trailer'
    );

    // Sort: target language first, then English, then others
    youtubeTrailers.sort((a, b) => {
      const aLang = a.iso_639_1 || 'en';
      const bLang = b.iso_639_1 || 'en';
      if (aLang === lang && bLang !== lang) return -1;
      if (bLang === lang && aLang !== lang) return 1;
      if (aLang === 'en' && bLang !== 'en') return -1;
      if (bLang === 'en' && aLang !== 'en') return 1;
      return 0;
    });

    youtubeTrailers.forEach((v) => {
      trailerStreams.push({
        title: v.name,
        ytId: v.key,
        lang: v.iso_639_1 || 'en',
      });
      // Stremio format
      trailers.push({
        source: v.key,
        type: v.type,
      });
    });
  }

  // app_extras
  const app_extras = {
    cast: Array.isArray(credits.cast)
      ? credits.cast.slice(0, 15).map((p) => ({
          name: p.name,
          character: p.character,
          photo: p.profile_path ? `${TMDB_IMAGE_BASE}/w276_and_h350_face${p.profile_path}` : null,
        }))
      : [],
    directors: crew
      .filter((p) => p.job === 'Director')
      .map((p) => ({
        name: p.name,
        photo: p.profile_path ? `${TMDB_IMAGE_BASE}/w300${p.profile_path}` : null,
      })),
    writers: writers.map((p) => ({
      name: p.name,
      photo: p.profile_path ? `${TMDB_IMAGE_BASE}/w300${p.profile_path}` : null,
    })),
    seasonPosters: Array.isArray(details.seasons)
      ? details.seasons
          .map((s) => (s.poster_path ? `${TMDB_IMAGE_BASE}/w780${s.poster_path}` : null))
          .filter(Boolean)
      : [],
    releaseDates: details.release_dates || details.content_ratings || null,
    certification: certification,
  };

  /* behaviorHints */
  const behaviorHints = {
    defaultVideoId: isMovie ? effectiveImdbId || `tmdb:${details.id}` : null,
    hasScheduledVideos: !isMovie && (status === 'Returning Series' || status === 'In Production'),
  };

  // Generate poster URL (use poster service if configured, fallback to TMDB)
  let poster = details.poster_path ? `${TMDB_IMAGE_BASE}/w780${details.poster_path}` : null;
  let background = details.backdrop_path
    ? `${TMDB_IMAGE_BASE}/original${details.backdrop_path}`
    : null;

  if (isValidPosterConfig(posterOptions)) {
    const enhancedPoster = generatePosterUrl({
      ...posterOptions,
      tmdbId: details.id,
      type,
      imdbId: effectiveImdbId,
    });
    if (enhancedPoster) poster = enhancedPoster;

    // Backgrounds: Always use TMDB original backdrops. RPDB backgrounds are often low res or broken.
    // const enhancedBackdrop = generateBackdropUrl({ ... });
    // if (enhancedBackdrop) background = enhancedBackdrop;
  }

  let logo = null;
  const logoSources = details.images?.logos?.length > 0
    ? details.images.logos
    : (Array.isArray(allLogos) && allLogos.length > 0 ? allLogos : []);

  if (logoSources.length > 0) {
    const lang = targetLanguage ? targetLanguage.split('-')[0] : 'en';
    const originalLang = details.original_language || null;

    const candidates = [
      logoSources.find((l) => l.iso_639_1 === lang),
      originalLang && originalLang !== lang ? logoSources.find((l) => l.iso_639_1 === originalLang) : null,
      lang !== 'en' ? logoSources.find((l) => l.iso_639_1 === 'en') : null,
      logoSources.find((l) => l.iso_639_1 === null),
      logoSources[0],
    ];

    const best = candidates.find(Boolean);
    if (best) logo = best.file_path;
  }

  // Fallbacks for Poster/Backdrop if main path is missing
  if (!poster && details.images?.posters?.length > 0) {
    poster = `${TMDB_IMAGE_BASE}/w780${details.images.posters[0].file_path}`;
  }
  if (!background && details.images?.backdrops?.length > 0) {
    background = `${TMDB_IMAGE_BASE}/original${details.images.backdrops[0].file_path}`;
  }

  const responseId = requestedId || `tmdb:${details.id}`;

  const meta = {
    id: responseId,
    tmdbId: details.id,
    imdbId: effectiveImdbId,
    imdb_id: effectiveImdbId,
    type: type === 'series' ? 'series' : 'movie',
    name: title,
    slug: generateSlug(
      type === 'series' ? 'series' : 'movie',
      title,
      effectiveImdbId || `tmdb:${details.id}`
    ),
    poster,
    posterShape: 'poster',
    background,
    fanart: background, // Compatibility alias
    landscapePoster: background, // Landscape preview for TV clients
    logo: logo ? `${TMDB_IMAGE_BASE}/original${logo}` : undefined,
    description: details.overview || '',
    year: year || undefined,
    releaseInfo,
    imdbRating: actualImdbRating || undefined,
    genres,
    cast: cast.length > 0 ? cast : undefined,
    director: directorString || undefined,
    writer: isMovie ? (writerString || undefined) : (creatorString || writerString || undefined),
    runtime: formatRuntime(runtimeMin),
    language: details.original_language || undefined,
    country: Array.isArray(details.origin_country) ? details.origin_country.join(', ') : undefined,
    released: releaseDate ? new Date(releaseDate).toISOString() : undefined,
    links: links.length > 0 ? links : undefined,
    trailer: trailer || undefined,
    trailers: trailers.length > 0 ? trailers : undefined, // Stremio format
    trailerStreams: trailerStreams.length > 0 ? trailerStreams : undefined,
    app_extras,
    behaviorHints,
    status: status || undefined,
  };

  // Add videos (episodes) for series
  if (!isMovie && Array.isArray(videos) && videos.length > 0) {
    meta.videos = videos;
  }

  return meta;
}

// ── Preview meta conversion ──────────────────────────────────────────────────

/**
 * Convert TMDB result to Stremio meta preview format
 * @param {Object} item - TMDB item object
 * @param {string} type - Content type ('movie' or 'series')
 * @param {string|null} imdbId - IMDb ID if available
 * @param {Object|null} posterOptions - Optional poster service config { apiKey, service }
 * @param {Object|null} genreMap - Optional map of ID -> Name for localized genres
 * @param {Map|null} ratingsMap - Optional Map of imdbId → rating string
 * @returns {Object} Stremio meta preview object
 */
export function toStremioMeta(item, type, imdbId = null, posterOptions = null, genreMap = null, ratingsMap = null) {
  const isMovie = type === 'movie';
  const title = isMovie ? item.title : item.name;
  const releaseDate = isMovie ? item.release_date : item.first_air_date;
  const year = releaseDate ? releaseDate.split('-')[0] : '';

  const mappedGenres = [];
  const ids = item.genre_ids || item.genres?.map((g) => g.id) || [];
  const mediaKey = isMovie ? 'movie' : 'tv';

  const cachedList = genreCache[mediaKey]?.['en']; // Default fallback
  const staticList = staticGenreMap[mediaKey] || {};

  ids.forEach((id) => {
    const key = String(id);
    let name = null;

    // 1. Try provided localized map first
    if (genreMap && genreMap[key]) {
      name = genreMap[key];
    }

    // 2. Try cached English list
    if (!name && cachedList) {
      const hit = cachedList.find((g) => String(g.id) === key);
      if (hit) name = hit.name;
    }

    // 3. Try static fallback
    if (!name && staticList[key]) name = staticList[key];

    if (name) mappedGenres.push(name);
  });

  // Generate poster URL (use poster service if configured, fallback to TMDB)
  let poster = item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : null;
  let background = item.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${item.backdrop_path}` : null;

  const effectiveImdbId = imdbId || item.imdb_id || null;

  if (isValidPosterConfig(posterOptions)) {
    const enhancedPoster = generatePosterUrl({
      ...posterOptions,
      tmdbId: item.id,
      type,
      imdbId: effectiveImdbId,
    });
    if (enhancedPoster) poster = enhancedPoster;

    // Backgrounds: Always use TMDB original backdrops.
    // const enhancedBackdrop = generateBackdropUrl({ ... });
    // if (enhancedBackdrop) background = enhancedBackdrop;
  }
  const primaryId = effectiveImdbId || `tmdb:${item.id}`;

  const meta = {
    id: primaryId,
    tmdbId: item.id,
    imdbId: effectiveImdbId,
    imdb_id: effectiveImdbId, // Some addons/clients expect this format
    type: type === 'series' ? 'series' : 'movie',
    name: title,
    poster,
    posterShape: 'poster',
    background,
    fanart: background, // Compatibility alias
    landscapePoster: background, // Landscape preview for TV clients
    description: item.overview || '',
    releaseInfo: year,
    // Only genuine IMDb ratings — never show TMDB vote_average as imdbRating
    imdbRating: ratingsMap && effectiveImdbId && ratingsMap.has(effectiveImdbId)
      ? ratingsMap.get(effectiveImdbId)
      : undefined,
    genres: mappedGenres,
    behaviorHints: {},
  };

  return meta;
}
