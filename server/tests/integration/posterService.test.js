/**
 * Poster Service Tests
 */

import { runTest, assert } from '../helpers/utils.js';
import {
  generatePosterUrl,
  generateBackdropUrl,
  generateLogoUrl,
  generateEpisodeThumbnailUrl,
  isValidPosterConfig,
  PosterService,
} from '../../src/services/artworkService.ts';

const SUITE = 'Poster Service';

export async function run() {
  const testApiKey = 'test-api-key-123';

  await runTest(SUITE, 'should return null when no apiKey provided', async () => {
    const result = generatePosterUrl({
      apiKey: null,
      service: PosterService.RPDB,
      tmdbId: 12345,
      type: 'movie',
    });
    assert(result === null);
  });

  await runTest(SUITE, 'should return null when service is none', async () => {
    const result = generatePosterUrl({
      apiKey: testApiKey,
      service: PosterService.NONE,
      tmdbId: 12345,
      type: 'movie',
    });
    assert(result === null);
  });

  await runTest(SUITE, 'should generate RPDB URL with IMDb ID', async () => {
    const result = generatePosterUrl({
      apiKey: testApiKey,
      service: PosterService.RPDB,
      tmdbId: 12345,
      type: 'movie',
      imdbId: 'tt1234567',
    });
    assert(
      result ===
        'https://api.ratingposterdb.com/test-api-key-123/imdb/poster-default/tt1234567.jpg?fallback=true'
    );
  });

  await runTest(SUITE, 'should generate RPDB URL with TMDb movie ID', async () => {
    const result = generatePosterUrl({
      apiKey: testApiKey,
      service: PosterService.RPDB,
      tmdbId: 12345,
      type: 'movie',
    });
    assert(
      result ===
        'https://api.ratingposterdb.com/test-api-key-123/tmdb/poster-default/movie-12345.jpg?fallback=true'
    );
  });

  await runTest(SUITE, 'should generate Top Posters URL with TMDb ID', async () => {
    const result = generatePosterUrl({
      apiKey: testApiKey,
      service: PosterService.TOP_POSTERS,
      tmdbId: 55555,
      type: 'series',
    });
    assert(
      result ===
        'https://api.top-streaming.stream/test-api-key-123/tmdb/poster-default/series-55555.jpg?fallback=true'
    );
  });

  await runTest(SUITE, 'should generate Top Posters logo URL with IMDb ID', async () => {
    const result = generateLogoUrl({
      apiKey: testApiKey,
      service: PosterService.TOP_POSTERS,
      imdbId: 'tt0111161',
      type: 'movie',
    });
    assert(
      result ===
        'https://api.top-streaming.stream/test-api-key-123/imdb/logo/tt0111161.png?fallback=true'
    );
  });

  await runTest(
    SUITE,
    'should generate Top Posters episode thumbnail URL for Premium flow',
    async () => {
      const result = generateEpisodeThumbnailUrl({
        apiKey: testApiKey,
        service: PosterService.TOP_POSTERS,
        tmdbId: 1396,
        type: 'series',
        season: 1,
        episode: 1,
      });
      assert(
        result ===
          'https://api.top-streaming.stream/test-api-key-123/tmdb/thumbnail/series-1396/S1E1.jpg?fallback=true'
      );
    }
  );

  await runTest(SUITE, 'should generate custom URL using placeholders', async () => {
    const result = generatePosterUrl({
      service: PosterService.CUSTOM_URL,
      customUrlPattern: 'https://img.example.com/{type}/{rating_id}?lang={language_short}',
      tmdbId: 222,
      type: 'movie',
      language: 'en-US',
    });
    assert(result === 'https://img.example.com/movie/movie-222?lang=en');
  });

  await runTest(SUITE, 'should generate RPDB backdrop URL with IMDb ID', async () => {
    const result = generateBackdropUrl({
      apiKey: testApiKey,
      service: PosterService.RPDB,
      tmdbId: 12345,
      type: 'movie',
      imdbId: 'tt1234567',
    });
    assert(
      result ===
        'https://api.ratingposterdb.com/test-api-key-123/imdb/backdrop-default/tt1234567.jpg?fallback=true'
    );
  });

  await runTest(SUITE, 'should generate RPDB backdrop URL with TMDb series ID', async () => {
    const result = generateBackdropUrl({
      apiKey: testApiKey,
      service: PosterService.RPDB,
      tmdbId: 54321,
      type: 'series',
    });
    assert(
      result ===
        'https://api.ratingposterdb.com/test-api-key-123/tmdb/backdrop-default/series-54321.jpg?fallback=true'
    );
  });

  await runTest(
    SUITE,
    'should not generate Top Posters backdrop URL (unsupported by provider)',
    async () => {
      const result = generateBackdropUrl({
        apiKey: testApiKey,
        service: PosterService.TOP_POSTERS,
        tmdbId: 99999,
        type: 'movie',
      });
      assert(result === null);
    }
  );

  await runTest(SUITE, 'should validate poster config', async () => {
    assert(isValidPosterConfig({ apiKey: 'test-key', service: PosterService.RPDB }) === true);
    assert(isValidPosterConfig({ apiKey: null, service: PosterService.RPDB }) === false);
    assert(isValidPosterConfig({ apiKey: 'test-key', service: PosterService.NONE }) === false);
    assert(
      isValidPosterConfig({
        service: PosterService.CUSTOM_URL,
        customUrlPattern: 'https://img.example.com/{rating_id}.jpg',
      }) === true
    );
  });
}
