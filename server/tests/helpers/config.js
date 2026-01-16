/**
 * Test Configuration
 *
 * Centralized configuration for all integration tests.
 * Uses environment variables with sensible defaults for local development.
 */

export const CONFIG = {
  // Server configuration
  baseUrl: process.env.TEST_BASE_URL || 'http://127.0.0.1:7000',
  port: parseInt(process.env.PORT, 10) || 7000,

  // TMDB API configuration
  tmdbApiKey: process.env.TEST_TMDB_API_KEY || process.env.TMDB_API_KEY || '',

  // Test timeouts
  serverStartTimeout: 30000, // 30 seconds to wait for server
  requestTimeout: 10000, // 10 seconds per request

  // Rate limiting protection
  requestDelay: 1000, // Delay between requests (ms) to avoid rate limits

  // Test data defaults
  defaults: {
    language: 'en-US',
    region: 'US',
  },
};

/**
 * Validates that required configuration is present
 * @returns {Object} { valid: boolean, missing: string[] }
 */
export function validateConfig() {
  const missing = [];

  if (!CONFIG.tmdbApiKey) {
    missing.push('TMDB_API_KEY or TEST_TMDB_API_KEY');
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
