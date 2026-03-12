import type { Request, Response, NextFunction } from 'express';

export function isValidApiKeyFormat(apiKey: unknown): boolean {
  if (!apiKey || typeof apiKey !== 'string') return false;
  return /^[a-f0-9]{32}$/i.test(apiKey);
}

export function isValidUserId(userId: unknown): boolean {
  if (!userId || typeof userId !== 'string') return false;
  return /^[A-Za-z0-9_-]{6,30}$/.test(userId);
}

export function isValidCatalogId(catalogId: unknown): boolean {
  if (!catalogId || typeof catalogId !== 'string') return false;
  return /^[A-Za-z0-9_-]{1,64}$/.test(catalogId);
}

export function sanitizeString(input: unknown, maxLength: number = 1000): string {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function sanitizePage(page: unknown): number {
  const num = parseInt(String(page), 10);
  if (isNaN(num) || num < 1) return 1;
  return Math.min(num, 500);
}

export function isValidContentType(type: string): boolean {
  return type === 'movie' || type === 'series' || type === 'tv';
}

export function normalizeContentType(type: string): string {
  if (type === 'series') return 'tv';
  return type;
}

const VALID_FILTER_KEY = /^[a-zA-Z0-9_]+$/;

export function sanitizeFilters(filters: unknown): Record<string, unknown> {
  if (!filters || typeof filters !== 'object') return {};

  const filtersObj = filters as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  const allowedKeys = [
    'sortBy',
    'listType',
    'genres',
    'excludeGenres',
    'genreMatchMode',
    'language',
    'displayLanguage',
    'countries',
    'imdbCountries',
    'year',
    'yearFrom',
    'yearTo',
    'voteAverage',
    'voteAverageFrom',
    'voteAverageTo',
    'voteCount',
    'voteCountMin',
    'runtime',
    'runtimeFrom',
    'runtimeTo',
    'runtimeMin',
    'runtimeMax',
    'certifications',
    'certification',
    'certificationCountry',
    'certificationMin',
    'certificationMax',
    'watchProviders',
    'watchRegion',
    'watchMonetizationType',
    'watchMonetizationTypes',
    'monetization',
    'monetizationTypes',
    'withPeople',
    'withCompanies',
    'withKeywords',
    'excludeKeywords',
    'excludeCompanies',
    'withCast',
    'withCrew',
    'releaseTypes',
    'networks',
    'withNetworks',
    'status',
    'type',
    'imdbOnly',
    'includeAdult',
    'includeVideo',
    'datePreset',
    'releaseDateFrom',
    'releaseDateTo',
    'airDateFrom',
    'airDateTo',
    'firstAirDateFrom',
    'firstAirDateTo',
    'firstAirDateYear',
    'primaryReleaseYear',
    'includeNullFirstAirDates',
    'screenedTheatrically',
    'region',
    'timezone',
    'tvStatus',
    'tvType',
    'ratingMin',
    'ratingMax',
    'randomize',
    'discoverOnly',
    'releasedOnly',
    'cacheTTL',
  ];

  for (const key of allowedKeys) {
    if (filtersObj[key] !== undefined && VALID_FILTER_KEY.test(key)) {
      sanitized[key] = sanitizeFilterValue(filtersObj[key]);
    }
  }

  if (sanitized.certification && !sanitized.certificationCountry) {
    delete sanitized.certification;
  }
  if (sanitized.watchProviders && !sanitized.watchRegion) {
    delete sanitized.watchProviders;
    delete sanitized.watchMonetizationTypes;
  }
  if (typeof sanitized.voteCountMin === 'number') {
    sanitized.voteCountMin = Math.min(Math.max(sanitized.voteCountMin as number, 0), 10000);
  }
  if (typeof sanitized.ratingMin === 'number') {
    sanitized.ratingMin = Math.min(Math.max(sanitized.ratingMin as number, 0), 10);
  }
  if (typeof sanitized.ratingMax === 'number') {
    sanitized.ratingMax = Math.min(Math.max(sanitized.ratingMax as number, 0), 10);
  }
  if (typeof sanitized.runtimeMin === 'number') {
    sanitized.runtimeMin = Math.min(Math.max(sanitized.runtimeMin as number, 0), 400);
  }
  if (typeof sanitized.runtimeMax === 'number') {
    sanitized.runtimeMax = Math.min(Math.max(sanitized.runtimeMax as number, 0), 400);
  }

  return sanitized;
}

const IMDB_ALLOWED_KEYS = [
  'source',
  'listType',
  'imdbListId',
  'query',
  'genres',
  'excludeGenres',
  'sortBy',
  'sortOrder',
  'imdbRatingMin',
  'imdbRatingMax',
  'totalVotesMin',
  'totalVotesMax',
  'releaseDateStart',
  'releaseDateEnd',
  'runtimeMin',
  'runtimeMax',
  'languages',
  'countries',
  'imdbCountries',
  'keywords',
  'excludeKeywords',
  'awardsWon',
  'awardsNominated',
  'types',
  // Phase 1: Companies, People, In Theatres, Certificates
  'companies',
  'excludeCompanies',
  'creditedNames',
  'inTheatersLat',
  'inTheatersLong',
  'inTheatersRadius',
  'certificateRating',
  'certificateCountry',
  'certificates',
  'explicitContent',
  // Phase 2: Ranked Lists, Text Search
  'rankedList',
  'rankedLists',
  'excludeRankedLists',
  'rankedListMaxRank',
  'plot',
  'filmingLocations',
  // Phase 3: Metadata Availability
  'withData',
];

const VALID_IMDB_LIST_ID = /^ls\d{1,15}$/;

const VALID_IMDB_SORT_VALUES = [
  'POPULARITY',
  'TITLE_REGIONAL',
  'USER_RATING',
  'USER_RATING_COUNT',
  'BOX_OFFICE_GROSS_DOMESTIC',
  'RUNTIME',
  'YEAR',
  'RELEASE_DATE',
];
const VALID_IMDB_SORT_ORDERS = ['ASC', 'DESC'];

const VALID_IMDB_COMPANY_ID = /^co\d+$/;
const VALID_IMDB_PERSON_ID = /^nm\d+$/;
const VALID_IMDB_CERTIFICATE = /^[A-Z]{2}:.+$/;
const VALID_IMDB_RANKED_LISTS = ['TOP_250', 'TOP_250_TV', 'BOTTOM_100'];
const VALID_IMDB_WITH_DATA = [
  'PLOT',
  'TRIVIA',
  'GOOF',
  'SOUNDTRACK',
  'ALTERNATE_VERSION',
  'CRAZY_CREDIT',
  'QUOTE',
  'BUSINESS_INFO',
  'TECHNICAL',
  'LOCATION',
  'AWARD',
];

function sanitizeFilterValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((v: unknown) => (typeof v === 'string' ? sanitizeString(v, 100) : v));
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return sanitizeString(value, 500);
  return value;
}

export function sanitizeImdbFilters(filters: unknown): Record<string, unknown> {
  if (!filters || typeof filters !== 'object') return {};

  const filtersObj = filters as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const key of IMDB_ALLOWED_KEYS) {
    if (filtersObj[key] !== undefined) {
      sanitized[key] = sanitizeFilterValue(filtersObj[key]);
    }
  }

  if (sanitized.imdbListId && !VALID_IMDB_LIST_ID.test(String(sanitized.imdbListId))) {
    delete sanitized.imdbListId;
  }

  if (sanitized.sortBy && !VALID_IMDB_SORT_VALUES.includes(String(sanitized.sortBy))) {
    delete sanitized.sortBy;
  }

  if (sanitized.sortOrder && !VALID_IMDB_SORT_ORDERS.includes(String(sanitized.sortOrder))) {
    delete sanitized.sortOrder;
  }

  // Validate company IDs: must be co + digits
  if (Array.isArray(sanitized.companies)) {
    sanitized.companies = (sanitized.companies as string[]).filter(
      (id) => typeof id === 'string' && VALID_IMDB_COMPANY_ID.test(id)
    );
    if ((sanitized.companies as string[]).length === 0) delete sanitized.companies;
  }
  if (Array.isArray(sanitized.excludeCompanies)) {
    sanitized.excludeCompanies = (sanitized.excludeCompanies as string[]).filter(
      (id) => typeof id === 'string' && VALID_IMDB_COMPANY_ID.test(id)
    );
    if ((sanitized.excludeCompanies as string[]).length === 0) delete sanitized.excludeCompanies;
  }

  // Validate person IDs: must be nm + digits
  if (Array.isArray(sanitized.creditedNames)) {
    sanitized.creditedNames = (sanitized.creditedNames as string[]).filter(
      (id) => typeof id === 'string' && VALID_IMDB_PERSON_ID.test(id)
    );
    if ((sanitized.creditedNames as string[]).length === 0) delete sanitized.creditedNames;
  }

  // Validate lat/long bounds
  if (typeof sanitized.inTheatersLat === 'number') {
    if (sanitized.inTheatersLat < -90 || sanitized.inTheatersLat > 90) {
      delete sanitized.inTheatersLat;
      delete sanitized.inTheatersLong;
      delete sanitized.inTheatersRadius;
    }
  }
  if (typeof sanitized.inTheatersLong === 'number') {
    if (sanitized.inTheatersLong < -180 || sanitized.inTheatersLong > 180) {
      delete sanitized.inTheatersLat;
      delete sanitized.inTheatersLong;
      delete sanitized.inTheatersRadius;
    }
  }
  if (typeof sanitized.inTheatersRadius === 'number') {
    sanitized.inTheatersRadius = Math.min(
      Math.max(sanitized.inTheatersRadius as number, 1000),
      500000
    );
  }

  // Validate certificates: must be XX:RATING format
  if (Array.isArray(sanitized.certificates)) {
    sanitized.certificates = (sanitized.certificates as string[]).filter(
      (c) => typeof c === 'string' && VALID_IMDB_CERTIFICATE.test(c)
    );
    if ((sanitized.certificates as string[]).length === 0) delete sanitized.certificates;
  }

  // Validate ranked lists
  if (sanitized.rankedList && !VALID_IMDB_RANKED_LISTS.includes(String(sanitized.rankedList))) {
    delete sanitized.rankedList;
  }
  if (Array.isArray(sanitized.rankedLists)) {
    sanitized.rankedLists = (sanitized.rankedLists as string[]).filter((r) =>
      VALID_IMDB_RANKED_LISTS.includes(r)
    );
    if ((sanitized.rankedLists as string[]).length === 0) delete sanitized.rankedLists;
  }
  if (Array.isArray(sanitized.excludeRankedLists)) {
    sanitized.excludeRankedLists = (sanitized.excludeRankedLists as string[]).filter((r) =>
      VALID_IMDB_RANKED_LISTS.includes(r)
    );
    if ((sanitized.excludeRankedLists as string[]).length === 0)
      delete sanitized.excludeRankedLists;
  }
  if (typeof sanitized.rankedListMaxRank === 'number') {
    sanitized.rankedListMaxRank = Math.min(Math.max(sanitized.rankedListMaxRank as number, 1), 250);
  }

  // Validate withData
  if (Array.isArray(sanitized.withData)) {
    sanitized.withData = (sanitized.withData as string[]).filter((d) =>
      VALID_IMDB_WITH_DATA.includes(d)
    );
    if ((sanitized.withData as string[]).length === 0) delete sanitized.withData;
  }

  return sanitized;
}

export const validateRequest = {
  userId: (req: Request, res: Response, next: NextFunction): void => {
    const { userId } = req.params;
    if (!isValidUserId(userId)) {
      res.status(400).json({ error: 'Invalid user ID format' });
      return;
    }
    next();
  },

  catalogId: (req: Request, res: Response, next: NextFunction): void => {
    const { catalogId } = req.params;
    if (!isValidCatalogId(catalogId)) {
      res.status(400).json({ error: 'Invalid catalog ID format' });
      return;
    }
    next();
  },

  apiKey: (req: Request, res: Response, next: NextFunction): void => {
    const apiKey =
      (req.query as Record<string, unknown>)?.apiKey ||
      (req.body as Record<string, unknown>)?.apiKey;
    if (apiKey && !isValidApiKeyFormat(apiKey)) {
      res.status(400).json({ error: 'Invalid API key format' });
      return;
    }
    next();
  },
};
