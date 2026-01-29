export function isValidApiKeyFormat(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return false;
  // TMDB API v3 keys are 32 hex characters
  return /^[a-f0-9]{32}$/i.test(apiKey);
}

export function isValidUserId(userId) {
  if (!userId || typeof userId !== 'string') return false;
  // nanoid format: URL-safe characters A-Za-z0-9_-
  return /^[A-Za-z0-9_-]{6,30}$/.test(userId);
}

export function isValidCatalogId(catalogId) {
  if (!catalogId || typeof catalogId !== 'string') return false;
  return /^[A-Za-z0-9_-]{1,64}$/.test(catalogId);
}

export function sanitizeString(input, maxLength = 1000) {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function sanitizePage(page) {
  const num = parseInt(page, 10);
  if (isNaN(num) || num < 1) return 1;
  // TMDB Discovery API limits to 500 pages max
  return Math.min(num, 500);
}

export function isValidContentType(type) {
  return type === 'movie' || type === 'series' || type === 'tv';
}

export function normalizeContentType(type) {
  // Stremio uses 'series', TMDB uses 'tv'
  if (type === 'series') return 'tv';
  return type;
}

export function sanitizeFilters(filters) {
  if (!filters || typeof filters !== 'object') return {};

  const sanitized = {};
  const allowedKeys = [
    'sortBy',
    'listType',
    'genres',
    'excludeGenres',
    'language',
    'displayLanguage',
    'originCountry',
    'year',
    'yearFrom',
    'yearTo',
    'voteAverage',
    'voteAverageFrom',
    'voteAverageTo',
    'voteCount',
    'runtime',
    'runtimeFrom',
    'runtimeTo',
    'certifications',
    'watchProviders',
    'watchRegion',
    'monetization',
    'withPeople',
    'withCompanies',
    'withKeywords',
    'releaseTypes',
    'networks',
    'status',
    'type',
    'imdbOnly',
    'includeAdult',
  ];

  for (const key of allowedKeys) {
    if (filters[key] !== undefined) {
      const value = filters[key];

      if (Array.isArray(value)) {
        sanitized[key] = value
          .slice(0, 50)
          .map((v) => (typeof v === 'string' ? sanitizeString(v, 100) : v));
      } else if (typeof value === 'boolean') {
        sanitized[key] = value;
      } else if (typeof value === 'number') {
        sanitized[key] = value;
      } else if (typeof value === 'string') {
        sanitized[key] = sanitizeString(value, 500);
      }
    }
  }

  return sanitized;
}

export const validateRequest = {
  userId: (req, res, next) => {
    const { userId } = req.params;
    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    next();
  },

  catalogId: (req, res, next) => {
    const { catalogId } = req.params;
    if (!isValidCatalogId(catalogId)) {
      return res.status(400).json({ error: 'Invalid catalog ID format' });
    }
    next();
  },

  apiKey: (req, res, next) => {
    const apiKey = req.query?.apiKey || req.body?.apiKey;
    if (apiKey && !isValidApiKeyFormat(apiKey)) {
      return res.status(400).json({ error: 'Invalid API key format' });
    }
    next();
  },
};
