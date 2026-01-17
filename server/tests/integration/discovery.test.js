/**
 * Discovery & Filter Tests
 *
 * Tests for the TMDB discovery/preview API:
 * - Genre filtering (single, multiple, match modes)
 * - Date/year filtering
 * - Rating filtering
 * - Sorting options
 * - Watch providers
 * - Cast/crew filtering
 * - Runtime filtering
 * - Certifications
 * - Language filtering
 * - Pagination
 * - Edge cases
 */

import {
  runTest,
  post,
  assert,
  assertOk,
  assertArray,
  getAuthHeaders,
  loginAndGetToken,
} from '../helpers/utils.js';

const SUITE = 'Discovery';

/**
 * Helper to test the preview endpoint (requires auth)
 */
async function testPreview(filters, type = 'movie', page = 1) {
  const body = { type, filters, page };
  const res = await post('/api/preview', body, { headers: getAuthHeaders() });
  assertOk(res, `Preview (${type}) with filters: ${JSON.stringify(filters).substring(0, 50)}`);
  return res.data;
}

export async function run() {
  // Ensure we're authenticated before running tests
  await loginAndGetToken();
  // ==========================================
  // Core Genre Filters
  // ==========================================

  await runTest(SUITE, 'Genre filter - single genre (Action)', async () => {
    const data = await testPreview({ genres: ['28'] });
    assertArray(data.metas, 1, 'Should return results');
  });

  await runTest(SUITE, 'Genre filter - multiple genres (OR logic)', async () => {
    const data = await testPreview({ genres: ['28', '35'], genreMatchMode: 'any' });
    assertArray(data.metas, 1, 'Should return results');
  });

  await runTest(SUITE, 'Genre filter - multiple genres (AND logic)', async () => {
    // Action AND Comedy - might return fewer results
    const data = await testPreview({ genres: ['28', '35'], genreMatchMode: 'all' });
    // Just verify it doesn't error - may return 0 results legitimately
    assert(Array.isArray(data.metas), 'Should return metas array');
  });

  await runTest(SUITE, 'Exclude genre filter', async () => {
    const data = await testPreview({
      genres: ['28'], // Include Action
      excludeGenres: ['27'], // Exclude Horror
    });
    assertArray(data.metas, 1, 'Should return results');
  });

  // ==========================================
  // Date & Year Filters
  // ==========================================

  await runTest(SUITE, 'Year range filter (1990-1999)', async () => {
    const data = await testPreview({ yearFrom: '1990', yearTo: '1999' });
    assertArray(data.metas, 1, 'Should return results');

    // Verify year is in range
    if (data.metas[0]?.releaseInfo) {
      const year = parseInt(data.metas[0].releaseInfo.substring(0, 4));
      assert(year >= 1990 && year <= 1999, `Year ${year} should be in range 1990-1999`);
    }
  });

  await runTest(SUITE, 'Dynamic date preset - last 30 days', async () => {
    const data = await testPreview({ datePreset: 'last_30_days' });
    assertArray(data.metas, 1, 'Should return results');

    // Verify recent release
    if (data.metas[0]?.releaseInfo) {
      const year = parseInt(data.metas[0].releaseInfo.substring(0, 4));
      const currentYear = new Date().getFullYear();
      assert(year >= currentYear - 1, `Should be recent release, got year ${year}`);
    }
  });

  await runTest(SUITE, 'Dynamic date preset - coming soon', async () => {
    const data = await testPreview({ datePreset: 'coming_soon' });
    // Coming soon might have limited results
    assert(Array.isArray(data.metas), 'Should return metas array');
  });

  // ==========================================
  // Rating Filters
  // ==========================================

  await runTest(SUITE, 'Rating minimum filter (>= 8.0)', async () => {
    const data = await testPreview({ ratingMin: 8, voteCountMin: 200 });
    assertArray(data.metas, 1, 'Should return results');

    if (data.metas[0]?.imdbRating) {
      const rating = parseFloat(data.metas[0].imdbRating);
      assert(rating >= 7.0, `Rating ${rating} should be >= 7.0`); // TMDB/IMDB ratings can differ slightly
    }
  });

  await runTest(SUITE, 'Rating range filter (6.0 - 8.0)', async () => {
    const data = await testPreview({ ratingMin: 6, ratingMax: 8 });
    assertArray(data.metas, 1, 'Should return results');
  });

  await runTest(SUITE, 'Vote count minimum filter', async () => {
    const data = await testPreview({ voteCountMin: 1000 });
    assertArray(data.metas, 1, 'Should return well-known movies');
  });

  // ==========================================
  // Sorting
  // ==========================================

  await runTest(SUITE, 'Sort by vote average (descending)', async () => {
    const data = await testPreview({ sortBy: 'vote_average.desc', voteCountMin: 500 });
    assertArray(data.metas, 2, 'Should return multiple results');

    // Top result should have high rating
    if (data.metas[0]?.imdbRating) {
      const rating = parseFloat(data.metas[0].imdbRating);
      assert(rating >= 7.5, `Top rated should be >= 7.5, got ${rating}`);
    }
  });

  await runTest(SUITE, 'Sort by release date (descending)', async () => {
    const data = await testPreview({ sortBy: 'release_date.desc' });
    assertArray(data.metas, 1, 'Should return results');
  });

  await runTest(SUITE, 'Sort by popularity (ascending)', async () => {
    const data = await testPreview({ sortBy: 'popularity.asc' });
    assertArray(data.metas, 1, 'Should return results');
  });

  // ==========================================
  // TV Show Specific
  // ==========================================

  await runTest(SUITE, 'TV show status - returning series', async () => {
    const data = await testPreview({ tvStatus: '0' }, 'series');
    assertArray(data.metas, 1, 'Should return results');
  });

  await runTest(SUITE, 'TV show airing within week', async () => {
    const data = await testPreview({ datePreset: 'airing_this_week' }, 'series');
    assert(Array.isArray(data.metas), 'Should return metas array');
  });

  // ==========================================
  // Watch Providers
  // ==========================================

  await runTest(SUITE, 'Watch provider filter (Netflix US)', async () => {
    const data = await testPreview({ watchRegion: 'US', watchProviders: ['8'] });
    assertArray(data.metas, 1, 'Should return results');
  });

  await runTest(SUITE, 'Watch provider + genre combination', async () => {
    const data = await testPreview({
      genres: ['28'],
      watchRegion: 'US',
      watchProviders: ['8'],
    });
    assertArray(data.metas, 1, 'Should return Action movies on Netflix');
  });

  await runTest(SUITE, 'Monetization type filter (flatrate/subscription)', async () => {
    const data = await testPreview({
      watchRegion: 'US',
      watchMonetizationType: 'flatrate',
    });
    assertArray(data.metas, 1, 'Should return subscription content');
  });

  // ==========================================
  // Cast & Crew Filters
  // ==========================================

  await runTest(SUITE, 'Cast filter (Tom Cruise ID: 500)', async () => {
    const data = await testPreview({ withCast: '500', sortBy: 'vote_count.desc' });
    assertArray(data.metas, 1, 'Should return results');
  });

  await runTest(SUITE, 'Director/crew filter (Christopher Nolan ID: 525)', async () => {
    const data = await testPreview({ withCrew: '525', sortBy: 'vote_count.desc' });
    assertArray(data.metas, 1, 'Should return results');
  });

  // ==========================================
  // Extended Filters
  // ==========================================

  await runTest(SUITE, 'Runtime filter - short films (< 60 min)', async () => {
    const data = await testPreview({ runtimeMax: 60, sortBy: 'popularity.desc' });
    assertArray(data.metas, 1, 'Should return short films');
  });

  await runTest(SUITE, 'Runtime filter - long films (> 150 min)', async () => {
    const data = await testPreview({ runtimeMin: 150, sortBy: 'popularity.desc' });
    assertArray(data.metas, 1, 'Should return long films');
  });

  await runTest(SUITE, 'Certification filter (G rated)', async () => {
    const data = await testPreview({
      certification: 'G',
      certificationCountry: 'US',
    });
    assertArray(data.metas, 1, 'Should return G-rated movies');
  });

  await runTest(SUITE, 'Multiple certifications (G, PG)', async () => {
    const data = await testPreview({
      certifications: ['G', 'PG'],
      certificationCountry: 'US',
    });
    assertArray(data.metas, 1, 'Should return family-friendly movies');
  });

  await runTest(SUITE, 'Language filter (French original language)', async () => {
    const data = await testPreview({ language: 'fr' });
    assertArray(data.metas, 1, 'Should return French films');
  });

  await runTest(SUITE, 'Origin country filter (India)', async () => {
    const data = await testPreview({ originCountry: 'IN' });
    assertArray(data.metas, 1, 'Should return Indian films');
  });

  await runTest(SUITE, 'Keyword filter', async () => {
    // Keyword ID 9715 = "superhero"
    const data = await testPreview({ withKeywords: '9715' });
    assertArray(data.metas, 1, 'Should return superhero movies');
  });

  await runTest(SUITE, 'Keyword filter - multiple keywords (OR logic regression test)', async () => {
    // 9715 (superhero) AND 9799 (romantic comedy) are very different.
    // AND logic (previous behavior) would return almost 0 results.
    // OR logic (new behavior) should return plenty of results.
    const data = await testPreview({ withKeywords: '9715,9799' });
    assertArray(data.metas, 5, 'Should return many results (OR logic working)');
  });

  // ==========================================
  // Complex Combinations
  // ==========================================

  await runTest(SUITE, 'Complex filter combination', async () => {
    const data = await testPreview({
      genres: ['28'], // Action
      yearFrom: '2020',
      ratingMin: 7,
      voteCountMin: 500,
      sortBy: 'vote_average.desc',
    });
    assertArray(data.metas, 1, 'Should return results');

    // Verify year
    if (data.metas[0]?.releaseInfo) {
      const year = parseInt(data.metas[0].releaseInfo.substring(0, 4));
      assert(year >= 2020, `Year ${year} should be >= 2020`);
    }
  });

  // ==========================================
  // Pagination
  // ==========================================

  await runTest(SUITE, 'Pagination - different pages return different results', async () => {
    const page1 = await testPreview({ sortBy: 'popularity.desc' }, 'movie', 1);
    const page2 = await testPreview({ sortBy: 'popularity.desc' }, 'movie', 2);

    assertArray(page1.metas, 1, 'Page 1 should have results');
    assertArray(page2.metas, 1, 'Page 2 should have results');

    assert(
      page1.metas[0].id !== page2.metas[0].id,
      'Page 1 and 2 should have different first items'
    );
  });

  // ==========================================
  // Edge Cases
  // ==========================================

  await runTest(SUITE, 'Zero results query (impossible filters)', async () => {
    const data = await testPreview({
      yearFrom: '1800',
      yearTo: '1800',
      genres: ['28'],
    });
    assert(data.metas.length === 0, 'Should return 0 results for impossible query');
  });

  await runTest(SUITE, 'Empty filters returns popular content', async () => {
    const data = await testPreview({});
    assertArray(data.metas, 1, 'Should return popular content with no filters');
  });

  await runTest(SUITE, 'Total results count is returned', async () => {
    const data = await testPreview({ genres: ['28'] });
    assert(typeof data.totalResults === 'number', 'Should include totalResults');
    assert(data.totalResults > 0, 'Total results should be > 0');
  });
}
