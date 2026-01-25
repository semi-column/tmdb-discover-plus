/**
 * Stremio Protocol Tests
 *
 * Tests for Stremio addon protocol compliance:
 * - Manifest structure and format
 * - Catalog endpoints
 * - Meta endpoints
 * - Search functionality
 * - Pagination via skip parameter
 * - ID resolution (IMDB, TMDB prefixes)
 * - Genre filtering
 * - Edge cases
 */

import {
  runTest,
  skipTest,
  get,
  post,
  put,
  assert,
  assertOk,
  assertArray,
  assertHasProperties,
  assertString,
  getSharedData,
  setSharedData,
  createTestCatalog,
  loginAndGetToken,
  getAuthHeaders,
} from '../helpers/utils.js';

const SUITE = 'Stremio Protocol';

export async function run() {
  // Ensure we're authenticated
  await loginAndGetToken();

  // Get userId from setup tests or create a config with catalog
  let userId = getSharedData('testConfigUserId') || getSharedData('userId');

  // Ensure we have a config with at least one catalog for testing
  if (userId) {
    // Check if this config has catalogs
    const checkRes = await get(`/${userId}/manifest.json`);
    if (!checkRes.ok || !checkRes.data.catalogs || checkRes.data.catalogs.length === 0) {
      // Save a catalog to this config
      const updateRes = await put(`/api/config/${userId}`, {
        catalogs: [
          createTestCatalog({
            id: 'stremio-test',
            name: 'Stremio Test Catalog',
            type: 'movie',
            filters: {
              genres: ['28'],
              sortBy: 'popularity.desc',
            },
          }),
        ],
      }, { headers: getAuthHeaders() });

      if (!updateRes.ok) {
        // Create a new config instead
        userId = null;
      }
    }
  }

  // If we still don't have a userId with catalogs, create one
  if (!userId) {
    const createRes = await post('/api/config', {
      catalogs: [
        createTestCatalog({
          id: 'stremio-test',
          name: 'Stremio Test Catalog',
          type: 'movie',
          filters: {
            genres: ['28'],
            sortBy: 'popularity.desc',
          },
        }),
      ],
    }, { headers: getAuthHeaders() });

    if (createRes.ok) {
      userId = createRes.data.userId;
      setSharedData('stremioUserId', userId);
    } else {
      skipTest(SUITE, 'All tests', 'Could not create test config');
      return;
    }
  }

  // ==========================================
  // Manifest Tests
  // ==========================================

  await runTest(SUITE, 'Manifest returns valid structure', async () => {
    const res = await get(`/${userId}/manifest.json`);
    assertOk(res, 'Manifest request');

    assertHasProperties(
      res.data,
      ['id', 'name', 'version', 'description', 'resources', 'types', 'catalogs'],
      'Manifest'
    );
  });

  await runTest(SUITE, 'Manifest has correct addon ID', async () => {
    const res = await get(`/${userId}/manifest.json`);
    assertOk(res);

    assertString(res.data.id, 'Addon ID');
    assert(
      res.data.id === 'community.tmdb.discover.plus',
      `Expected addon ID 'community.tmdb.discover.plus', got '${res.data.id}'`
    );
  });

  await runTest(SUITE, 'Manifest includes user catalogs', async () => {
    const res = await get(`/${userId}/manifest.json`);
    assertOk(res);

    assertArray(res.data.catalogs, 1, 'Should have at least 1 catalog');

    const catalog = res.data.catalogs[0];
    assertHasProperties(catalog, ['id', 'type', 'name'], 'Catalog');
  });

  await runTest(SUITE, 'Manifest catalogs have extra properties', async () => {
    const res = await get(`/${userId}/manifest.json`);
    assertOk(res);

    const catalog = res.data.catalogs[0];
    assertArray(catalog.extra, 1, 'Catalog should have extra properties');

    // Should support skip pagination on regular catalogs
    const extraNames = catalog.extra.map((e) => e.name);
    assert(extraNames.includes('skip'), 'Should support skip pagination');
    
    // Check that AT LEAST one catalog supports search (dedicated search catalog)
    const searchCatalog = res.data.catalogs.find(c => 
      c.extra && c.extra.some(e => e.name === 'search')
    );
    assert(searchCatalog, 'Should have a dedicated search catalog');
  });

  await runTest(SUITE, 'Manifest has behaviorHints.configurable', async () => {
    const res = await get(`/${userId}/manifest.json`);
    assertOk(res);

    assert(
      res.data.behaviorHints?.configurable === true,
      'behaviorHints.configurable should be true'
    );
  });

  await runTest(SUITE, 'Manifest includes idPrefixes', async () => {
    const res = await get(`/${userId}/manifest.json`);
    assertOk(res);

    assertArray(res.data.idPrefixes, 1, 'Should have idPrefixes');
    assert(res.data.idPrefixes.includes('tt'), 'Should support IMDB IDs (tt prefix)');
  });

  await runTest(SUITE, 'Discover Only catalog is hidden from board', async () => {
    // Create a specific config for this test
    const res = await post('/api/config', {
      catalogs: [
        createTestCatalog({
          id: 'discover-only-test',
          name: 'Discover Only Catalog',
          type: 'movie',
          filters: {
            discoverOnly: true,
          },
        }),
      ],
    }, { headers: getAuthHeaders() });
    
    assertOk(res);
    const testUserId = res.data.userId;
    
    const manifestRes = await get(`/${testUserId}/manifest.json`);
    assertOk(manifestRes);
    
    const catalog = manifestRes.data.catalogs[0];
    const genreFilter = catalog.extra.find(e => e.name === 'genre');
    
    assert(genreFilter, 'Should have genre filter');
    assert(genreFilter.isRequired === true, 'Genre filter should be required (hidden from board)');
  });

  await runTest(SUITE, 'Shuffle Catalogs preference randomizes order', async () => {
    // 1. Create config with shuffling enabled and multiple catalogs
    const catalog1 = createTestCatalog({ id: 'cat-1', name: 'Cat 1', type: 'movie' });
    const catalog2 = createTestCatalog({ id: 'cat-2', name: 'Cat 2', type: 'movie' });
    const catalog3 = createTestCatalog({ id: 'cat-3', name: 'Cat 3', type: 'movie' });

    const configRes = await post('/api/config', {
      catalogs: [catalog1, catalog2, catalog3],
      preferences: { shuffleCatalogs: true },
    }, { headers: getAuthHeaders() });

    assertOk(configRes);
    const testUserId = configRes.data.userId;

    // 2. Fetch manifest multiple times and check for order variation
    const orders = new Set();
    const attempts = 5;

    for (let i = 0; i < attempts; i++) {
      const res = await get(`/${testUserId}/manifest.json`);
      assertOk(res);
      const currentOrder = res.data.catalogs.map((c) => c.name).join(',');
      orders.add(currentOrder);

      // Check headers for no-store on at least one response
      if (i === 0) {
        const cacheControl = res.headers['cache-control'] || '';
        assert(cacheControl.includes('no-store'), 'Should have no-store cache control');
      }
    }

    assert(orders.size > 1, 'Catalogs should be shuffled (more than 1 unique order in 5 attempts)');
  });

  // ==========================================
  // Catalog Endpoint Tests
  // ==========================================

  let catalogId;

  await runTest(SUITE, 'Catalog returns metas array', async () => {
    const manifestRes = await get(`/${userId}/manifest.json`);
    assertOk(manifestRes);

    catalogId = manifestRes.data.catalogs[0].id;
    const catalogType = manifestRes.data.catalogs[0].type;

    const res = await get(`/${userId}/catalog/${catalogType}/${catalogId}.json`);
    assertOk(res, 'Catalog request');

    assertHasProperties(res.data, ['metas'], 'Catalog response');
    assertArray(res.data.metas, 1, 'Should return metas');
  });

  await runTest(SUITE, 'Catalog meta has required fields', async () => {
    const manifestRes = await get(`/${userId}/manifest.json`);
    const cat = manifestRes.data.catalogs[0];

    const res = await get(`/${userId}/catalog/${cat.type}/${cat.id}.json`);
    assertOk(res);

    const meta = res.data.metas[0];
    assertHasProperties(meta, ['id', 'type', 'name', 'poster'], 'Meta preview');
  });

  await runTest(SUITE, 'Catalog pagination via skip parameter', async () => {
    const manifestRes = await get(`/${userId}/manifest.json`);
    const cat = manifestRes.data.catalogs[0];

    // Page 1 (no skip)
    const page1 = await get(`/${userId}/catalog/${cat.type}/${cat.id}.json`);
    assertOk(page1);
    assertArray(page1.data.metas, 1);

    // Page 2 (skip=20)
    const page2 = await get(`/${userId}/catalog/${cat.type}/${cat.id}/skip=20.json`);
    assertOk(page2);
    assertArray(page2.data.metas, 1);

    // Should be different items
    assert(
      page1.data.metas[0].id !== page2.data.metas[0].id,
      'Page 1 and 2 should have different items'
    );
  });

  await runTest(SUITE, 'Catalog search functionality', async () => {
    const manifestRes = await get(`/${userId}/manifest.json`);
    const cat = manifestRes.data.catalogs[0];

    const query = 'Avengers';
    const res = await get(
      `/${userId}/catalog/${cat.type}/${cat.id}/search=${encodeURIComponent(query)}.json`
    );
    assertOk(res);

    assertArray(res.data.metas, 1, 'Search should return results');

    // At least one result should contain 'Avengers'
    const hasMatch = res.data.metas.some((m) => m.name.toLowerCase().includes('avenger'));
    assert(hasMatch, 'Search results should include matching titles');
  });

  await runTest(SUITE, 'Catalog genre filtering', async () => {
    const manifestRes = await get(`/${userId}/manifest.json`);
    const cat = manifestRes.data.catalogs[0];

    // Get available genres from extra
    const genreExtra = cat.extra?.find((e) => e.name === 'genre');

    if (genreExtra?.options?.length > 0) {
      const genre = genreExtra.options[0];
      const res = await get(
        `/${userId}/catalog/${cat.type}/${cat.id}/genre=${encodeURIComponent(genre)}.json`
      );
      assertOk(res, `Genre filter for '${genre}'`);
      assertArray(res.data.metas, 1, 'Should return genre-filtered results');
    } else {
      // Genre filtering not available for this catalog
      assert(true, 'Genre filtering not applicable');
    }
  });

  // ==========================================
  // Meta Endpoint Tests
  // ==========================================

  await runTest(SUITE, 'Meta endpoint returns full details', async () => {
    const manifestRes = await get(`/${userId}/manifest.json`);
    const cat = manifestRes.data.catalogs[0];

    // Get an ID from catalog
    const catalogRes = await get(`/${userId}/catalog/${cat.type}/${cat.id}.json`);
    assertOk(catalogRes);

    const itemId = catalogRes.data.metas[0].id;
    const res = await get(`/${userId}/meta/${cat.type}/${itemId}.json`);
    assertOk(res, 'Meta request');

    assert(res.data.meta, 'Should return meta object');
    assertHasProperties(res.data.meta, ['id', 'type', 'name'], 'Meta');
  });

  await runTest(SUITE, 'Meta resolves IMDB ID (tt prefix)', async () => {
    const imdbId = 'tt1375666'; // Inception
    const res = await get(`/${userId}/meta/movie/${imdbId}.json`);

    assertOk(res, 'IMDB ID resolution');
    assert(res.data.meta, 'Should return meta');
    // Accept any valid title (Inception, Origen, etc.) due to potential localization
    assert(res.data.meta.name && res.data.meta.name.length > 0, 'Should return a valid title');
    assert(res.data.meta.id, 'Should have an id');
    
    // Verify final parity fields
    assertString(res.data.meta.year, 'year');
    assert(res.data.meta.year.length === 4, 'year should be 4 digits');
    assert(res.data.meta.imdb_id === imdbId, 'imdb_id (snake_case) should match');
    assertString(res.data.meta.slug, 'slug');
    assert(res.data.meta.slug.startsWith('movie/'), 'slug should start with movie/');
    assert(res.data.meta.slug.endsWith(imdbId), 'slug should end with ID');
    
    if (res.data.meta.director) {
        assertString(res.data.meta.director, 'director should be a string');
    }
    if (res.data.meta.writer) {
        assertString(res.data.meta.writer, 'writer should be a string');
    }

    // Verify enhanced metadata
    if (res.data.meta.trailer) {
        assert(res.data.meta.trailer.startsWith('yt:'), 'Trailer should be a YouTube ID (yt:)');
    }
    
    if (res.data.meta.trailerStreams) {
        assertArray(res.data.meta.trailerStreams, 1, 'Should have trailerStreams');
        assert(res.data.meta.trailerStreams[0].ytId, 'TrailerStream should have ytId');
    }

    if (res.data.meta.app_extras) {
        assert(res.data.meta.app_extras.cast, 'Should have app_extras.cast');
        assert(res.data.meta.app_extras.directors, 'Should have app_extras.directors');
    }
    
    if (res.data.meta.links) {
        assertArray(res.data.meta.links, 1, 'Should have links');
        const imdbLink = res.data.meta.links.find(l => l.category === 'imdb');
        assert(imdbLink, 'Should have IMDb link');
        
        const genreLink = res.data.meta.links.find(l => l.category === 'Genres');
        assert(genreLink, 'Should have Genres links');

        const castLink = res.data.meta.links.find(l => l.category === 'Cast');
        assert(castLink, 'Should have Cast links');
    }

    if (res.data.meta.behaviorHints) {
        assert(res.data.meta.behaviorHints.defaultVideoId, 'Should have defaultVideoId behavior hint');
    }

    // Check age rating formatting in releaseInfo
    if (res.data.meta.releaseInfo && res.data.meta.releaseInfo.includes('•')) {
        // e.g. "2010 • PG-13"
        const parts = res.data.meta.releaseInfo.split('•');
        assert(parts.length === 2, 'Release info should have year and rating');
        assert(parts[1].trim().length > 0, 'Rating should not be empty');
    }
  });

  await runTest(SUITE, 'Meta resolves TMDB ID (tmdb: prefix)', async () => {
    const tmdbId = 'tmdb:27205'; // Inception
    const res = await get(`/${userId}/meta/movie/${tmdbId}.json`);

    assertOk(res, 'TMDB ID resolution');
    assert(res.data.meta, 'Should return meta');
    // Accept any valid title due to potential localization
    assert(res.data.meta.name && res.data.meta.name.length > 0, 'Should return a valid title');
    assert(res.data.meta.id, 'Should have an id');
  });

  await runTest(SUITE, 'Meta handles unknown ID gracefully', async () => {
    const invalidId = 'tmdb:999999999';
    const res = await get(`/${userId}/meta/movie/${invalidId}.json`);

    // Should not crash
    assertOk(res, 'Should handle gracefully');

    // Should return empty or minimal meta
    assert(
      !res.data.meta || Object.keys(res.data.meta).length <= 1,
      'Should return empty meta for unknown ID'
    );
  });

  // ==========================================
  // Series Specific Tests
  // ==========================================

  await runTest(SUITE, 'Series meta includes video list', async () => {
    const seriesImdbId = 'tt0944947'; // Game of Thrones
    const res = await get(`/${userId}/meta/series/${seriesImdbId}.json`);

    assertOk(res, 'Series meta request');

    if (res.data.meta?.videos) {
      assertArray(res.data.meta.videos, 1, 'Should have episodes');

      const video = res.data.meta.videos[0];
      assertHasProperties(video, ['id', 'season', 'episode'], 'Video entry');
    }
  });

  // ==========================================
  // Edge Cases
  // ==========================================

  await runTest(SUITE, 'Non-existent userId returns fallback manifest', async () => {
    const res = await get('/nonexistent123/manifest.json');
    // Should still return a valid manifest structure (just empty catalogs)
    assertOk(res);
    assertHasProperties(res.data, ['id', 'name', 'version'], 'Fallback manifest');
  });

  await runTest(SUITE, 'Invalid catalog ID returns error or empty', async () => {
    const res = await get(`/${userId}/catalog/movie/invalid-catalog-id.json`);
    // Should either return 404 or empty metas
    assert(!res.ok || res.data.metas?.length === 0, 'Invalid catalog should return error or empty');
  });
}
