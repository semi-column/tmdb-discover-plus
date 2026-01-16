/**
 * Shared utility functions for TMDB Discover+
 */

/**
 * Shuffle array using Fisher-Yates algorithm
 * @param {Array} array - Array to shuffle
 * @returns {Array} New shuffled array
 */
export function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Build base URL from request, handling reverse proxy correctly
 * @param {Object} req - Express request object
 * @returns {string} Base URL
 */
export function getBaseUrl(req) {
  // Use environment variable if set, otherwise build from request
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }

  // Use X-Forwarded headers if behind proxy, otherwise use req values
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
  let host = req.get('x-forwarded-host') || req.get('host') || 'localhost';

  // Handle Beamup/Dokku partial hostnames if configured
  const beamupDomain = process.env.BEAMUP_DOMAIN || 'baby-beamup.club';
  const appName = process.env.BEAMUP_APP_NAME || 'tmdb-discover-plus';

  if (host.includes(appName) && !host.includes(beamupDomain)) {
    host = `${host}.${beamupDomain}`;
  }

  return `${protocol}://${host}`;
}

/**
 * Normalize genre names for reliable matching
 * Lowercase, trim, replace '&' with 'and', remove punctuation
 * @param {string} name - Genre name to normalize
 * @returns {string} Normalized genre name
 */
export function normalizeGenreName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[\u2013\u2014]/g, ' ') // dashes
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse comma-separated values or array into string array
 * @param {string|Array} val - Value to parse
 * @returns {string[]} Array of strings
 */
export function parseIdArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  return String(val)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
