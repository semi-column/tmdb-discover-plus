// Test Configuration
export const CONFIG = {
    baseUrl: process.env.TEST_BASE_URL || 'http://localhost:7000',
    tmdbApiKey: process.env.TEST_TMDB_API_KEY || 'ba2aeea1208e5ca104cc92ec6938fab1',
    timeout: 30000,
    // Add delays between tests to avoid TMDB rate limits
    requestDelay: 500,
};
