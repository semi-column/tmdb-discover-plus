import { createLogger } from '../../utils/logger.ts';
import { generatePosterUrl, isValidPosterConfig } from '../posterService.ts';
import { getRpdbRating } from '../rpdb.ts';
import { TMDB_IMAGE_BASE } from './constants.ts';
import { getImdbRatingString } from '../imdbRatings/index.ts';
import { genreCache, staticGenreMap } from './genres.ts';
import { usToLocalRatings } from './certificationMappings.ts';
import { config } from '../../config.ts';
import type {
  ContentType,
  TmdbDetails,
  TmdbMovieDetails,
  TmdbTvDetails,
  TmdbResult,
  TmdbMovieResult,
  TmdbTvResult,
  StremioMeta,
  StremioMetaPreview,
  StremioVideo,
  PosterOptions,
  TmdbImage,
  GenreMap,
  StremioLink,
  TmdbCredits,
  StremioTrailer,
  TrailerStream,
} from '../../types/index.ts';

type AnyTmdbDetails = TmdbMovieDetails & TmdbTvDetails;
type AnyTmdbResult = TmdbMovieResult & TmdbTvResult;

const log = createLogger('tmdb:stremioMeta');
export function formatRuntime(minutes: number | null): string | undefined {
  if (!minutes) return undefined;
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}min` : `${h}h`;
}

export function generateSlug(type: string, title: string, id: string | number): string {
  const safeTitle = (title || '').toLowerCase().replace(/ /g, '-');
  return `${type}/${safeTitle}-${id}`;
}

function buildCredits(details: AnyTmdbDetails, isMovie: boolean) {
  const credits: TmdbCredits = details.credits || { cast: [], crew: [] };
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

  const writers = crew.filter((p) => ['Writer', 'Screenplay', 'Author'].includes(p.job));
  const writerNames = writers.map((p) => p.name);
  const writerString = writerNames.join(', ');
  const directorString = directors.join(', ');

  const creators =
    !isMovie && Array.isArray(details.created_by)
      ? details.created_by.map((p) => p?.name).filter(Boolean)
      : [];
  const creatorString = creators.join(', ');

  return {
    cast,
    crew,
    directors,
    writers,
    writerNames,
    writerString,
    directorString,
    creators,
    creatorString,
  };
}

function buildCertification(
  details: AnyTmdbDetails,
  isMovie: boolean,
  targetLanguage: string | null,
  userRegion: string | null
): string | null {
  let countryCode = userRegion && typeof userRegion === 'string' ? userRegion.toUpperCase() : 'US';

  if (!userRegion && targetLanguage) {
    countryCode = targetLanguage.includes('-')
      ? targetLanguage.split('-')[1].toUpperCase()
      : targetLanguage.toUpperCase();
    if (countryCode.length !== 2 || countryCode === 'EN') countryCode = 'US';
  }

  log.debug('Certification lookup', { targetLanguage, countryCode });

  let certification = null;
  if (isMovie && details.release_dates?.results) {
    let countryInfo = details.release_dates.results.find((r) => r.iso_3166_1 === countryCode);
    if (!countryInfo && countryCode !== 'US') {
      countryInfo = details.release_dates.results.find((r) => r.iso_3166_1 === 'US');
    }
    if (countryInfo && countryInfo.release_dates && countryInfo.release_dates.length > 0) {
      const rated =
        countryInfo.release_dates.find((d) => d.certification) || countryInfo.release_dates[0];
      if (rated?.certification) certification = rated.certification;
    }
  } else if (!isMovie && details.content_ratings?.results) {
    let countryInfo = details.content_ratings.results.find((r) => r.iso_3166_1 === countryCode);
    if (!countryInfo && countryCode !== 'US') {
      countryInfo = details.content_ratings.results.find((r) => r.iso_3166_1 === 'US');
    }
    if (countryInfo?.rating) certification = countryInfo.rating;
  }

  const localMap = usToLocalRatings[countryCode];
  if (certification && localMap && localMap[certification]) {
    certification = localMap[certification];
  }

  return certification;
}

function buildTrailers(details: AnyTmdbDetails, targetLanguage: string | null) {
  const lang = targetLanguage ? targetLanguage.split('-')[0] : 'en';

  let trailer: string | null = null;
  if (details.videos?.results && details.videos.results.length > 0) {
    const allVideos = details.videos.results.filter((v) => v.site === 'YouTube');
    const trailerVideo =
      allVideos.find((v) => v.iso_639_1 === lang && v.type === 'Trailer') ||
      allVideos.find((v) => v.iso_639_1 === lang) ||
      allVideos.find((v) => v.iso_639_1 === 'en' && v.type === 'Trailer') ||
      allVideos.find((v) => v.type === 'Trailer') ||
      allVideos[0];
    if (trailerVideo) trailer = `yt:${trailerVideo.key}`;
  }

  const trailerStreams: TrailerStream[] = [];
  const trailers: StremioTrailer[] = [];
  if (details.videos?.results) {
    const youtubeTrailers = details.videos.results.filter(
      (v) => v.site === 'YouTube' && v.type === 'Trailer'
    );
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
      trailerStreams.push({ title: v.name, ytId: v.key, lang: v.iso_639_1 || 'en' });
      trailers.push({ source: v.key, type: v.type });
    });
  }

  return { trailer, trailerStreams, trailers };
}

async function buildLinks({
  effectiveImdbId,
  genres,
  cast,
  directors,
  writerNames,
  creators,
  title,
  type,
  details,
  posterOptions,
  manifestUrl,
  genreCatalogId,
}: {
  effectiveImdbId: string | null;
  genres: string[];
  cast: string[];
  directors: string[];
  writerNames: string[];
  creators: string[];
  title: string;
  type: ContentType;
  details: AnyTmdbDetails;
  posterOptions: PosterOptions | null;
  manifestUrl: string | null;
  genreCatalogId: string | null;
}): Promise<{ links: StremioLink[]; actualImdbRating: string | null }> {
  const links: StremioLink[] = [];

  let actualImdbRating: string | null = null;

  if (effectiveImdbId) {
    try {
      const datasetRating = await getImdbRatingString(effectiveImdbId);
      if (datasetRating) actualImdbRating = datasetRating;
    } catch (e) {}
  }

  if (!actualImdbRating && effectiveImdbId) {
    const rpdbKey =
      posterOptions?.service === 'rpdb' && posterOptions.apiKey
        ? posterOptions.apiKey
        : config.rpdb.apiKey;
    if (rpdbKey) {
      try {
        const realRating = await getRpdbRating(rpdbKey, effectiveImdbId);
        if (realRating && realRating !== 'N/A') actualImdbRating = realRating;
      } catch (e) {}
    }
  }

  if (effectiveImdbId) {
    links.push({
      name: actualImdbRating || 'IMDb',
      category: 'imdb',
      url: `https://imdb.com/title/${effectiveImdbId}`,
    });
  }

  genres.forEach((genre) => {
    const genreUrl =
      manifestUrl && genreCatalogId
        ? `stremio:///discover/${encodeURIComponent(manifestUrl)}/${type}/${genreCatalogId}?genre=${encodeURIComponent(genre)}`
        : `stremio:///search?search=${encodeURIComponent(genre)}`;
    links.push({ name: genre, category: 'Genres', url: genreUrl });
  });

  cast.slice(0, 5).forEach((name) => {
    links.push({
      name,
      category: 'Cast',
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    });
  });

  directors.forEach((name) => {
    links.push({
      name,
      category: 'Directors',
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    });
  });

  writerNames.forEach((name) => {
    links.push({
      name,
      category: 'Writers',
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    });
  });

  creators.forEach((name) => {
    if (!writerNames.includes(name)) {
      links.push({
        name,
        category: 'Writers',
        url: `stremio:///search?search=${encodeURIComponent(name)}`,
      });
    }
  });

  if (type !== 'movie' && Array.isArray(details.networks) && details.networks.length > 0) {
    const network = details.networks[0];
    if (network?.name) {
      links.push({
        name: network.name,
        category: 'Networks',
        url: `stremio:///search?search=${encodeURIComponent(network.name)}`,
      });
    }
  }
  if (
    type === 'movie' &&
    Array.isArray(details.production_companies) &&
    details.production_companies.length > 0
  ) {
    const studio = details.production_companies[0];
    if (studio?.name) {
      links.push({
        name: studio.name,
        category: 'Studios',
        url: `stremio:///search?search=${encodeURIComponent(studio.name)}`,
      });
    }
  }

  const slugTitle = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  links.push({
    name: title,
    category: 'share',
    url: `https://www.strem.io/s/${type}/${slugTitle}-${details.id}`,
  });

  return { links, actualImdbRating };
}
export async function toStremioFullMeta(
  rawDetails: TmdbDetails | null,
  type: ContentType,
  imdbId: string | null = null,
  requestedId: string | null = null,
  posterOptions: PosterOptions | null = null,
  videos: StremioVideo[] | null = null,
  targetLanguage: string | null = null,
  {
    manifestUrl = null,
    genreCatalogId = null,
    allLogos = null,
    userRegion = null,
  }: {
    manifestUrl?: string | null;
    genreCatalogId?: string | null;
    allLogos?: TmdbImage[] | null;
    userRegion?: string | null;
  } = {}
): Promise<Partial<StremioMeta>> {
  if (!rawDetails) return {};
  const details = rawDetails as AnyTmdbDetails;
  const isMovie = type === 'movie';
  const title = (isMovie ? details.title : details.name) || '';
  const releaseDate = isMovie ? details.release_date : details.first_air_date;
  const year = releaseDate ? String(releaseDate).split('-')[0] : '';

  const genres = Array.isArray(details.genres)
    ? details.genres.map((g) => g?.name).filter(Boolean)
    : [];

  const {
    cast,
    crew,
    directors,
    writers,
    writerNames,
    writerString,
    directorString,
    creators,
    creatorString,
  } = buildCredits(details, isMovie);

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

  const certification = buildCertification(details, isMovie, targetLanguage, userRegion);

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

  if (certification) {
    releaseInfo = releaseInfo ? `${releaseInfo}\u2003\u2003${certification}` : certification;
  }

  const { trailer, trailerStreams, trailers } = buildTrailers(details, targetLanguage);
  const { links, actualImdbRating } = await buildLinks({
    effectiveImdbId,
    genres,
    cast,
    directors,
    writerNames,
    creators,
    title,
    type,
    details,
    posterOptions,
    manifestUrl,
    genreCatalogId,
  });

  const credits: TmdbCredits = details.credits || { cast: [], crew: [] };
  const app_extras = {
    cast: credits.cast.slice(0, 15).map((p) => ({
      name: p.name,
      character: p.character,
      photo: p.profile_path ? `${TMDB_IMAGE_BASE}/w276_and_h350_face${p.profile_path}` : null,
    })),
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
          .filter((s): s is string => s !== null)
      : [],
    releaseDates: details.release_dates || details.content_ratings || null,
    certification: certification,
  };
  const behaviorHints = {
    defaultVideoId: isMovie ? effectiveImdbId || `tmdb:${details.id}` : null,
    hasScheduledVideos: !isMovie && (status === 'Returning Series' || status === 'In Production'),
  };
  let poster = details.poster_path ? `${TMDB_IMAGE_BASE}/w780${details.poster_path}` : null;
  let background = details.backdrop_path
    ? `${TMDB_IMAGE_BASE}/original${details.backdrop_path}`
    : null;

  if (posterOptions && isValidPosterConfig(posterOptions)) {
    const enhancedPoster = generatePosterUrl({
      ...posterOptions,
      tmdbId: details.id,
      type,
      imdbId: effectiveImdbId,
    });
    if (enhancedPoster) poster = enhancedPoster;
  }

  let logo: string | null = null;
  const logoSources =
    details.images && details.images.logos && details.images.logos.length > 0
      ? details.images.logos
      : Array.isArray(allLogos) && allLogos.length > 0
        ? allLogos
        : [];

  if (logoSources.length > 0) {
    const lang = targetLanguage ? targetLanguage.split('-')[0] : 'en';
    const originalLang = details.original_language || null;

    const candidates = [
      logoSources.find((l) => l.iso_639_1 === lang),
      lang !== 'en' ? logoSources.find((l) => l.iso_639_1 === 'en') : null,
      originalLang && originalLang !== lang && originalLang !== 'en'
        ? logoSources.find((l) => l.iso_639_1 === originalLang)
        : null,
      logoSources.find((l) => l.iso_639_1 === null),
      [...logoSources].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))[0],
    ];

    const best = candidates.find(Boolean);
    if (best) logo = best.file_path;
  }
  if (!poster && details.images?.posters && details.images.posters.length > 0) {
    poster = `${TMDB_IMAGE_BASE}/w780${details.images.posters[0].file_path}`;
  }
  if (!background && details.images?.backdrops && details.images.backdrops.length > 0) {
    background = `${TMDB_IMAGE_BASE}/original${details.images.backdrops[0].file_path}`;
  }

  const responseId = requestedId || `tmdb:${details.id}`;

  const meta: Partial<StremioMeta> = {
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
    fanart: background,
    landscapePoster: background,
    logo: logo ? `${TMDB_IMAGE_BASE}/original${logo}` : undefined,
    description: details.overview || '',
    year: year || undefined,
    releaseInfo,
    imdbRating: actualImdbRating || undefined,
    genres,
    cast: cast.length > 0 ? cast : undefined,
    director: directorString || undefined,
    writer: isMovie ? writerString || undefined : creatorString || writerString || undefined,
    runtime: formatRuntime(runtimeMin),
    language: details.original_language || undefined,
    country: Array.isArray(details.origin_country) ? details.origin_country.join(', ') : undefined,
    released: releaseDate ? new Date(releaseDate).toISOString() : undefined,
    links: links.length > 0 ? links : undefined,
    trailer: trailer || undefined,
    trailers: trailers.length > 0 ? trailers : undefined,
    trailerStreams: trailerStreams.length > 0 ? trailerStreams : undefined,
    app_extras,
    behaviorHints,
    status: status || undefined,
  };

  if (!isMovie && Array.isArray(videos) && videos.length > 0) {
    meta.videos = videos;
  }

  return meta;
}
export function toStremioMeta(
  rawItem: TmdbResult,
  type: ContentType,
  imdbId: string | null = null,
  posterOptions: PosterOptions | null = null,
  genreMap: GenreMap | null = null,
  ratingsMap: Map<string, string> | null = null
): StremioMetaPreview {
  const item = rawItem as AnyTmdbResult;
  const isMovie = type === 'movie';
  const title = (isMovie ? item.title : item.name) || '';
  const releaseDate = isMovie ? item.release_date : item.first_air_date;
  const year = releaseDate ? releaseDate.split('-')[0] : '';

  const mappedGenres: string[] = [];
  const ids = item.genre_ids || item.genres?.map((g) => g.id) || [];
  const mediaKey = isMovie ? 'movie' : 'tv';

  const cachedList = genreCache[mediaKey]?.['en']; // Default fallback
  const staticList = staticGenreMap[mediaKey] || {};

  ids.forEach((id) => {
    const key = String(id);
    let name = null;
    if (genreMap && genreMap[key]) {
      name = genreMap[key];
    }
    if (!name && cachedList) {
      const hit = cachedList.find((g) => String(g.id) === key);
      if (hit) name = hit.name;
    }
    if (!name && staticList[key]) name = staticList[key];

    if (name) mappedGenres.push(name);
  });
  let poster = item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : null;
  let background = item.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${item.backdrop_path}` : null;

  const effectiveImdbId = imdbId || item.imdb_id || null;

  if (posterOptions && isValidPosterConfig(posterOptions)) {
    const enhancedPoster = generatePosterUrl({
      ...posterOptions,
      tmdbId: item.id,
      type,
      imdbId: effectiveImdbId,
    });
    if (enhancedPoster) poster = enhancedPoster;
  }
  const primaryId = effectiveImdbId || `tmdb:${item.id}`;

  const imdbRating =
    ratingsMap && effectiveImdbId && ratingsMap.has(effectiveImdbId)
      ? ratingsMap.get(effectiveImdbId)
      : undefined;

  const links: StremioLink[] = [];
  if (effectiveImdbId) {
    links.push({
      name: imdbRating || 'IMDb',
      category: 'imdb',
      url: `https://imdb.com/title/${effectiveImdbId}`,
    });
  }
  mappedGenres.forEach((genre) => {
    links.push({
      name: genre,
      category: 'Genres',
      url: `stremio:///search?search=${encodeURIComponent(genre)}`,
    });
  });

  const meta: StremioMetaPreview = {
    id: primaryId,
    tmdbId: item.id,
    imdbId: effectiveImdbId,
    imdb_id: effectiveImdbId,
    type: type === 'series' ? 'series' : 'movie',
    name: title,
    slug: generateSlug(type === 'series' ? 'series' : 'movie', title, primaryId),
    poster,
    posterShape: 'poster',
    background,
    fanart: background,
    landscapePoster: background,
    logo: effectiveImdbId
      ? `https://images.metahub.space/logo/medium/${effectiveImdbId}/img`
      : undefined,
    description: item.overview || '',
    releaseInfo: year,
    imdbRating,
    genres: mappedGenres,
    links: links.length > 0 ? links : undefined,
    behaviorHints: {},
  };

  return meta;
}

export async function toStremioMetaPreview(
  rawDetails: TmdbDetails | null,
  type: ContentType,
  posterOptions: PosterOptions | null = null,
  targetLanguage: string | null = null,
  ratingsMap: Map<string, string> | null = null
): Promise<StremioMetaPreview | null> {
  if (!rawDetails) return null;
  const details = rawDetails as AnyTmdbDetails;
  const isMovie = type === 'movie';
  const title = (isMovie ? details.title : details.name) || '';
  const releaseDate = isMovie ? details.release_date : details.first_air_date;
  const year = releaseDate ? String(releaseDate).split('-')[0] : '';

  const genres = Array.isArray(details.genres)
    ? details.genres.map((g) => g?.name).filter(Boolean)
    : [];

  const { cast, directors, writerNames, creators, directorString, writerString, creatorString } =
    buildCredits(details, isMovie);

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
  }

  const effectiveImdbId = details?.external_ids?.imdb_id || null;

  let logo: string | undefined;
  const logoList = details.images?.logos;
  if (logoList && logoList.length > 0) {
    const lang = targetLanguage ? targetLanguage.split('-')[0] : 'en';
    const originalLang = details.original_language || null;

    const candidates = [
      logoList.find((l) => l.iso_639_1 === lang),
      lang !== 'en' ? logoList.find((l) => l.iso_639_1 === 'en') : null,
      originalLang && originalLang !== lang && originalLang !== 'en'
        ? logoList.find((l) => l.iso_639_1 === originalLang)
        : null,
      logoList.find((l) => l.iso_639_1 === null),
      [...logoList].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))[0],
    ];
    const best = candidates.find(Boolean);
    if (best) logo = `${TMDB_IMAGE_BASE}/original${best.file_path}`;
  }
  if (!logo && effectiveImdbId) {
    logo = `https://images.metahub.space/logo/medium/${effectiveImdbId}/img`;
  }

  let poster = details.poster_path ? `${TMDB_IMAGE_BASE}/w500${details.poster_path}` : null;
  let background = details.backdrop_path
    ? `${TMDB_IMAGE_BASE}/w1280${details.backdrop_path}`
    : null;

  if (posterOptions && isValidPosterConfig(posterOptions)) {
    const enhancedPoster = generatePosterUrl({
      ...posterOptions,
      tmdbId: details.id,
      type,
      imdbId: effectiveImdbId,
    });
    if (enhancedPoster) poster = enhancedPoster;
  }

  const primaryId = effectiveImdbId || `tmdb:${details.id}`;

  let imdbRating: string | undefined;
  if (ratingsMap && effectiveImdbId && ratingsMap.has(effectiveImdbId)) {
    imdbRating = ratingsMap.get(effectiveImdbId);
  }

  const links: StremioLink[] = [];
  if (effectiveImdbId) {
    links.push({
      name: imdbRating || 'IMDb',
      category: 'imdb',
      url: `https://imdb.com/title/${effectiveImdbId}`,
    });
  }
  genres.forEach((genre) => {
    links.push({
      name: genre,
      category: 'Genres',
      url: `stremio:///search?search=${encodeURIComponent(genre)}`,
    });
  });
  cast.slice(0, 5).forEach((name) => {
    links.push({
      name,
      category: 'Cast',
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    });
  });
  directors.forEach((name) => {
    links.push({
      name,
      category: 'Directors',
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    });
  });
  writerNames.forEach((name) => {
    links.push({
      name,
      category: 'Writers',
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    });
  });
  if (!isMovie) {
    creators.forEach((name) => {
      if (!writerNames.includes(name)) {
        links.push({
          name,
          category: 'Writers',
          url: `stremio:///search?search=${encodeURIComponent(name)}`,
        });
      }
    });
  }

  return {
    id: primaryId,
    tmdbId: details.id,
    imdbId: effectiveImdbId,
    imdb_id: effectiveImdbId,
    type: type === 'series' ? 'series' : 'movie',
    name: title,
    slug: generateSlug(type === 'series' ? 'series' : 'movie', title, primaryId),
    poster,
    posterShape: 'poster',
    background,
    fanart: background,
    landscapePoster: background,
    logo,
    description: details.overview || '',
    releaseInfo: year,
    imdbRating,
    genres,
    cast: cast.length > 0 ? cast : undefined,
    director: directorString || undefined,
    writer: isMovie ? writerString || undefined : creatorString || writerString || undefined,
    runtime: formatRuntime(runtimeMin),
    links: links.length > 0 ? links : undefined,
    behaviorHints: {},
  };
}
