process.env.JWT_SECRET = 'test-jwt-secret-key-for-unit-tests';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

// Clear provider keys so a developer's local .env cannot leak into tests
// (dotenv does not override pre-set process.env values).
for (const key of [
  'TOP_POSTERS_API_KEY',
  'FANART_API_KEY',
  'TVDB_API_KEY',
  'IMDB_DATA_KEY',
  'MAL_CLIENT_ID',
  'SIMKL_CLIENT_ID',
  'TRAKT_CLIENT_ID',
  'TRAKT_CLIENT_SECRET',
]) {
  process.env[key] = '';
}
