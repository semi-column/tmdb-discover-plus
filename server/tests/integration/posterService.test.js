/**
 * Poster Service Tests
 */

import { runTest, assert } from '../helpers/utils.js';
import {
  generatePosterUrl,
  generateBackdropUrl,
  isValidPosterConfig,
  PosterService,
} from '../../src/services/posterService.ts';

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

  await runTest(SUITE, 'should generate Top Posters backdrop URL with TMDb ID', async () => {
    const result = generateBackdropUrl({
      apiKey: testApiKey,
      service: PosterService.TOP_POSTERS,
      tmdbId: 99999,
      type: 'movie',
    });
    assert(
      result ===
        'https://api.top-streaming.stream/test-api-key-123/tmdb/backdrop-default/movie-99999.jpg?fallback=true'
    );
  });

  await runTest(SUITE, 'should validate poster config', async () => {
    assert(isValidPosterConfig({ apiKey: 'test-key', service: PosterService.RPDB }) === true);
    assert(isValidPosterConfig({ apiKey: null, service: PosterService.RPDB }) === false);
    assert(isValidPosterConfig({ apiKey: 'test-key', service: PosterService.NONE }) === false);
  });
}
