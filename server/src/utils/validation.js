/**
 * Input validation utilities
 * Provides sanitization and validation for API inputs
 */

/**
 * Validate TMDB API key format
 * TMDB API keys are 32 character hexadecimal strings
 * @param {string} apiKey - The API key to validate
 * @returns {boolean} Whether the format is valid
 */
export function isValidApiKeyFormat(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return false;
  // TMDB API v3 keys are 32 hex characters
  return /^[a-f0-9]{32}$/i.test(apiKey);
}

/**
 * Validate user ID format
 * User IDs are nanoid strings (alphanumeric, typically 10-21 chars)
 * @param {string} userId - The user ID to validate
 * @returns {boolean} Whether the format is valid
 */
export function isValidUserId(userId) {
  if (!userId || typeof userId !== 'string') return false;
  // nanoid uses URL-safe characters: A-Za-z0-9_-
  // Length is typically 10-21 characters
  return /^[A-Za-z0-9_-]{6,30}$/.test(userId);
}

/**
 * Validate catalog ID format
 * Catalog IDs are UUIDs or custom strings
 * @param {string} catalogId - The catalog ID to validate
 * @returns {boolean} Whether the format is valid
 */
export function isValidCatalogId(catalogId) {
  if (!catalogId || typeof catalogId !== 'string') return false;
  // Allow UUIDs, nanoid, and custom alphanumeric IDs with hyphens/underscores
  return /^[A-Za-z0-9_-]{1,64}$/.test(catalogId);
}

/**
 * Sanitize string input by removing control characters and trimming
 * @param {string} input - The string to sanitize
 * @param {number} maxLength - Maximum allowed length (default: 1000)
 * @returns {string} Sanitized string
 */
export function sanitizeString(input, maxLength = 1000) {
  if (!input || typeof input !== 'string') return '';
  // Remove control characters except newlines/tabs, trim whitespace
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Validate and sanitize page number
 * @param {any} page - The page number to validate
 * @returns {number} Valid page number (1-500)
 */
export function sanitizePage(page) {
  const num = parseInt(page, 10);
  if (isNaN(num) || num < 1) return 1;
  // TMDB limits to 500 pages max
  return Math.min(num, 500);
}

/**
 * Validate content type (movie or series)
 * @param {string} type - The content type
 * @returns {boolean} Whether it's a valid type
 */
export function isValidContentType(type) {
  return type === 'movie' || type === 'series' || type === 'tv';
}

/**
 * Normalize content type to TMDB format
 * Stremio uses 'series' but TMDB uses 'tv'
 * @param {string} type - The content type
 * @returns {string} Normalized type
 */
export function normalizeContentType(type) {
  if (type === 'series') return 'tv';
  return type;
}

/**
 * Validate catalog filters object
 * Ensures filters don't contain malicious content
 * @param {object} filters - The filters object
 * @returns {object} Sanitized filters
 */
export function sanitizeFilters(filters) {
  if (!filters || typeof filters !== 'object') return {};
  
  const sanitized = {};
  const allowedKeys = [
    'sortBy', 'listType', 'genres', 'excludeGenres', 'language', 'displayLanguage',
    'originCountry', 'year', 'yearFrom', 'yearTo', 'voteAverage',
    'voteAverageFrom', 'voteAverageTo', 'voteCount', 'runtime',
    'runtimeFrom', 'runtimeTo', 'certifications', 'watchProviders',
    'watchRegion', 'monetization', 'withPeople', 'withCompanies',
    'withKeywords', 'releaseTypes', 'networks', 'status', 'type',
    'imdbOnly', 'includeAdult'
  ];
  
  for (const key of allowedKeys) {
    if (filters[key] !== undefined) {
      const value = filters[key];
      
      // Handle arrays
      if (Array.isArray(value)) {
        sanitized[key] = value
          .slice(0, 50) // Limit array length
          .map(v => typeof v === 'string' ? sanitizeString(v, 100) : v);
      }
      // Handle booleans
      else if (typeof value === 'boolean') {
        sanitized[key] = value;
      }
      // Handle numbers
      else if (typeof value === 'number') {
        sanitized[key] = value;
      }
      // Handle strings
      else if (typeof value === 'string') {
        sanitized[key] = sanitizeString(value, 500);
      }
    }
  }
  
  return sanitized;
}

/**
 * Create validation middleware for common patterns
 */
export const validateRequest = {
  /**
   * Validate userId parameter
   */
  userId: (req, res, next) => {
    const { userId } = req.params;
    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    next();
  },
  
  /**
   * Validate catalogId parameter
   */
  catalogId: (req, res, next) => {
    const { catalogId } = req.params;
    if (!isValidCatalogId(catalogId)) {
      return res.status(400).json({ error: 'Invalid catalog ID format' });
    }
    next();
  },
  
  /**
   * Validate apiKey in query or body
   */
  apiKey: (req, res, next) => {
    const apiKey = req.query?.apiKey || req.body?.apiKey;
    if (apiKey && !isValidApiKeyFormat(apiKey)) {
      return res.status(400).json({ error: 'Invalid API key format' });
    }
    next();
  },
};
