/**
 * Stremio Addon Client Simulator - Integration Tests
 * 
 * This test suite simulates how the Stremio client calls addon endpoints.
 * It tests the complete addon protocol including:
 * - Manifest retrieval
 * - Catalog requests with pagination (skip)
 * - Genre filtering
 * - Search functionality
 * 
 * Based on Stremio Addon Protocol:
 * https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md
 * 
 * Usage:
 *   1. Start the server: npm start (or have it running)
 *   2. Run tests: npm test
 * 
 * Environment Variables:
 *   - TEST_BASE_URL: Base URL of the addon (default: http://localhost:7000)
 *   - TEST_USER_ID: User ID to test with (will create test user if not provided)
 *   - TMDB_API_KEY: TMDB API key for testing (required)
 */

import http from 'http';
import https from 'https';

// Handle TLS certificate issues (for corporate proxies)
if (process.env.DISABLE_TLS_VERIFY === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// ============================================
// Configuration
// ============================================
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:7000';
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TEST_TIMEOUT = 30000; // 30 seconds for API calls

// Test state
let testUserId = null;
let testCatalogId = null;
let manifest = null;

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

// ============================================
// HTTP Client Helper (simulates Stremio client)
// ============================================
function stremioFetch(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const timeout = setTimeout(() => {
      reject(new Error(`Request timeout: ${path}`));
    }, TEST_TIMEOUT);

    const req = client.request(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        // Simulate Stremio client
        'User-Agent': 'Stremio/4.4.0 (Test Suite)',
        ...options.headers
      },
      // Handle self-signed certs in dev
      rejectUnauthorized: false,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const json = data ? JSON.parse(data) : null;
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: json,
            raw: data
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: null,
            raw: data
          });
        }
      });
    });

    req.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

// ============================================
// Test Assertion Helpers
// ============================================
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
}

function assertType(value, type, message) {
  if (typeof value !== type) {
    throw new Error(`${message}: expected type ${type}, got ${typeof value}`);
  }
}

function assertArray(value, message) {
  if (!Array.isArray(value)) {
    throw new Error(`${message}: expected array, got ${typeof value}`);
  }
}

// ============================================
// Test Runner
// ============================================
async function runTest(name, testFn) {
  process.stdout.write(`  ⏳ ${name}...`);
  const start = Date.now();
  
  try {
    await testFn();
    const duration = Date.now() - start;
    process.stdout.write(`\r  ✅ ${name} (${duration}ms)\n`);
    results.passed++;
    results.tests.push({ name, status: 'passed', duration });
  } catch (error) {
    const duration = Date.now() - start;
    process.stdout.write(`\r  ❌ ${name} (${duration}ms)\n`);
    console.error(`     Error: ${error.message}`);
    results.failed++;
    results.tests.push({ name, status: 'failed', duration, error: error.message });
  }
}

// ============================================
// Setup: Create Test User with Catalog
// ============================================
async function setup() {
  console.log('\n📋 Setting up test environment...\n');

  // Check if API key is available
  if (!TMDB_API_KEY) {
    console.error('❌ TMDB_API_KEY environment variable is required');
    console.log('   Set it with: $env:TMDB_API_KEY="your-api-key"');
    process.exit(1);
  }

  // Check server is running
  try {
    const health = await stremioFetch('/health');
    if (health.status !== 200) {
      throw new Error('Health check failed');
    }
    console.log(`✅ Server is running at ${BASE_URL}`);
    console.log(`   Version: ${health.data?.version || 'unknown'}`);
    console.log(`   Database: ${health.data?.database || 'unknown'}`);
  } catch (error) {
    console.error(`❌ Cannot connect to server at ${BASE_URL}`);
    console.log('   Start the server with: npm start');
    process.exit(1);
  }

  // Create or get test user configuration
  try {
    // Create a new test user config
    const configResponse = await stremioFetch('/api/config', {
      method: 'POST',
      body: {
        tmdbApiKey: TMDB_API_KEY,
        catalogs: [
          {
            name: 'Test Movies - Popular',
            type: 'movie',
            enabled: true,
            filters: {
              listType: 'popular',
              sortBy: 'popularity.desc'
            }
          },
          {
            name: 'Test Series - Trending',
            type: 'series',
            enabled: true,
            filters: {
              listType: 'trending_day'
            }
          },
          {
            name: 'Test Movies - Action Genre',
            type: 'movie',
            enabled: true,
            filters: {
              listType: 'discover',
              genres: ['28'], // Action genre ID
              sortBy: 'popularity.desc'
            }
          }
        ]
      }
    });

    if (configResponse.status !== 200 && configResponse.status !== 201) {
      throw new Error(`Failed to create config: ${configResponse.raw}`);
    }

    testUserId = configResponse.data?.userId;
    if (!testUserId) {
      throw new Error('No userId returned from config creation');
    }

    console.log(`✅ Test user created: ${testUserId}`);
    console.log(`   Catalogs: ${configResponse.data?.catalogs?.length || 0}`);
  } catch (error) {
    console.error(`❌ Failed to setup test user: ${error.message}`);
    process.exit(1);
  }

  console.log('');
}

// ============================================
// Cleanup: Remove Test User
// ============================================
async function cleanup() {
  if (testUserId) {
    try {
      await stremioFetch(`/api/config/${testUserId}`, { method: 'DELETE' });
      console.log(`\n🧹 Cleaned up test user: ${testUserId}`);
    } catch (error) {
      console.warn(`⚠️  Could not cleanup test user: ${error.message}`);
    }
  }
}

// ============================================
// TEST SUITE: Manifest
// ============================================
async function testManifest() {
  console.log('\n📦 Manifest Tests\n');

  await runTest('GET manifest.json returns valid manifest', async () => {
    const res = await stremioFetch(`/${testUserId}/manifest.json`);
    assertEqual(res.status, 200, 'Status code');
    assert(res.data, 'Response should have data');
    
    manifest = res.data;
    
    // Required fields per Stremio protocol
    assertType(manifest.id, 'string', 'manifest.id');
    assertType(manifest.name, 'string', 'manifest.name');
    assertType(manifest.version, 'string', 'manifest.version');
    assertType(manifest.description, 'string', 'manifest.description');
    assertArray(manifest.resources, 'manifest.resources');
    assertArray(manifest.types, 'manifest.types');
    assertArray(manifest.catalogs, 'manifest.catalogs');
  });

  await runTest('Manifest has correct addon ID', async () => {
    assertEqual(manifest.id, 'community.tmdb.discover.plus', 'Addon ID');
  });

  await runTest('Manifest includes catalog resource', async () => {
    assert(manifest.resources.includes('catalog'), 'Should include catalog resource');
  });

  await runTest('Manifest catalogs have required fields', async () => {
    assert(manifest.catalogs.length >= 1, 'Should have at least one catalog');
    
    const catalog = manifest.catalogs[0];
    assertType(catalog.id, 'string', 'catalog.id');
    assertType(catalog.type, 'string', 'catalog.type');
    assertType(catalog.name, 'string', 'catalog.name');
    
    // Store for later tests
    testCatalogId = catalog.id;
  });

  await runTest('Manifest catalogs have pageSize for pagination', async () => {
    const catalog = manifest.catalogs[0];
    assertEqual(catalog.pageSize, 20, 'pageSize should be 20 (TMDB page size)');
  });

  await runTest('Manifest catalogs have extra parameters', async () => {
    const catalog = manifest.catalogs[0];
    assertArray(catalog.extra, 'catalog.extra');
    
    // Should support skip and search
    const extraNames = catalog.extra.map(e => e.name);
    assert(extraNames.includes('skip'), 'Should support skip parameter');
    assert(extraNames.includes('search'), 'Should support search parameter');
  });

  await runTest('Manifest has idPrefixes for streams', async () => {
    assertArray(manifest.idPrefixes, 'manifest.idPrefixes');
  });

  await runTest('Manifest has behaviorHints for configuration', async () => {
    assert(manifest.behaviorHints, 'Should have behaviorHints');
    assertEqual(manifest.behaviorHints.configurable, true, 'Should be configurable');
  });

  await runTest('Manifest CORS headers are set', async () => {
    // CORS headers are only sent when Origin header is present
    const res = await stremioFetch(`/${testUserId}/manifest.json`, {
      headers: {
        'Origin': 'https://stremio.example.com'
      }
    });
    // Check that CORS is enabled (allow-origin header present)
    assert(
      res.headers['access-control-allow-origin'],
      'Should have Access-Control-Allow-Origin header'
    );
  });
}

// ============================================
// TEST SUITE: Catalog - Basic Requests
// ============================================
async function testCatalogBasic() {
  console.log('\n📚 Catalog Basic Tests\n');

  await runTest('GET catalog without extra returns metas', async () => {
    // Stremio format: /:userId/catalog/:type/:catalogId.json
    const catalogType = manifest.catalogs[0].type;
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}.json`);
    
    assertEqual(res.status, 200, 'Status code');
    assert(res.data, 'Response should have data');
    assertArray(res.data.metas, 'Response should have metas array');
  });

  await runTest('Catalog returns Meta Preview objects with required fields', async () => {
    const catalogType = manifest.catalogs[0].type;
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}.json`);
    
    assert(res.data.metas.length > 0, 'Should return some metas');
    
    const meta = res.data.metas[0];
    // Required fields per Stremio protocol
    assertType(meta.id, 'string', 'meta.id');
    assertType(meta.type, 'string', 'meta.type');
    assertType(meta.name, 'string', 'meta.name');
    // Poster is required for catalog metas
    assert(meta.poster === null || typeof meta.poster === 'string', 'meta.poster should be string or null');
  });

  await runTest('Catalog metas have IMDB IDs when available', async () => {
    const catalogType = manifest.catalogs[0].type;
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}.json`);
    
    // At least some items should have IMDB IDs (tt prefix)
    const itemsWithImdb = res.data.metas.filter(m => m.id && m.id.startsWith('tt'));
    console.log(`     (${itemsWithImdb.length}/${res.data.metas.length} have IMDB IDs)`);
    // We expect most items to have IMDB IDs, but not all
    assert(itemsWithImdb.length > 0, 'At least some metas should have IMDB IDs');
  });

  await runTest('Catalog returns ~20 items (TMDB page size)', async () => {
    const catalogType = manifest.catalogs[0].type;
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}.json`);
    
    // TMDB returns 20 per page, but some might be filtered out
    const count = res.data.metas.length;
    console.log(`     (Got ${count} items)`);
    assert(count > 0 && count <= 20, 'Should return between 1 and 20 items');
  });

  await runTest('Invalid catalog ID returns empty metas', async () => {
    const res = await stremioFetch(`/${testUserId}/catalog/movie/invalid-catalog-id.json`);
    
    assertEqual(res.status, 200, 'Status code should still be 200');
    assertArray(res.data.metas, 'Should have metas array');
    assertEqual(res.data.metas.length, 0, 'Should return empty metas');
  });

  await runTest('Invalid user ID returns empty metas', async () => {
    const res = await stremioFetch(`/invalid-user-id/catalog/movie/${testCatalogId}.json`);
    
    assertEqual(res.status, 200, 'Status code should still be 200');
    assertArray(res.data.metas, 'Should have metas array');
    assertEqual(res.data.metas.length, 0, 'Should return empty metas');
  });
}

// ============================================
// TEST SUITE: Catalog - Pagination
// ============================================
async function testCatalogPagination() {
  console.log('\n📄 Catalog Pagination Tests\n');
  
  let page1Metas = [];
  let page2Metas = [];

  await runTest('GET catalog with skip=0 (page 1)', async () => {
    const catalogType = manifest.catalogs[0].type;
    // Stremio format: /:userId/catalog/:type/:catalogId/:extra.json
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}/skip=0.json`);
    
    assertEqual(res.status, 200, 'Status code');
    assertArray(res.data.metas, 'Should have metas array');
    
    page1Metas = res.data.metas;
    console.log(`     (Got ${page1Metas.length} items)`);
  });

  await runTest('GET catalog with skip=20 (page 2)', async () => {
    const catalogType = manifest.catalogs[0].type;
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}/skip=20.json`);
    
    assertEqual(res.status, 200, 'Status code');
    assertArray(res.data.metas, 'Should have metas array');
    
    page2Metas = res.data.metas;
    console.log(`     (Got ${page2Metas.length} items)`);
  });

  await runTest('Page 1 and Page 2 have different items', async () => {
    assert(page1Metas.length > 0, 'Page 1 should have items');
    assert(page2Metas.length > 0, 'Page 2 should have items');
    
    const page1Ids = new Set(page1Metas.map(m => m.id));
    const page2Ids = new Set(page2Metas.map(m => m.id));
    
    // Check that there's minimal overlap (some duplicates possible with different IDs)
    let overlap = 0;
    for (const id of page2Ids) {
      if (page1Ids.has(id)) overlap++;
    }
    
    console.log(`     (Overlap: ${overlap} items)`);
    assert(overlap < page2Metas.length, 'Pages should have mostly different items');
  });

  await runTest('GET catalog with skip=40 (page 3)', async () => {
    const catalogType = manifest.catalogs[0].type;
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}/skip=40.json`);
    
    assertEqual(res.status, 200, 'Status code');
    assertArray(res.data.metas, 'Should have metas array');
    console.log(`     (Got ${res.data.metas.length} items)`);
  });

  await runTest('Pagination works with very high skip value', async () => {
    const catalogType = manifest.catalogs[0].type;
    // TMDB allows up to 500 pages
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}/skip=9980.json`);
    
    assertEqual(res.status, 200, 'Status code');
    assertArray(res.data.metas, 'Should have metas array');
    // Might return empty at very high skip values
    console.log(`     (Got ${res.data.metas.length} items at skip=9980)`);
  });
}

// ============================================
// TEST SUITE: Catalog - Search
// ============================================
async function testCatalogSearch() {
  console.log('\n🔍 Catalog Search Tests\n');

  await runTest('Search for "Matrix" returns relevant results', async () => {
    const catalogType = manifest.catalogs[0].type;
    const searchQuery = encodeURIComponent('Matrix');
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}/search=${searchQuery}.json`);
    
    assertEqual(res.status, 200, 'Status code');
    assertArray(res.data.metas, 'Should have metas array');
    assert(res.data.metas.length > 0, 'Should find Matrix movies');
    
    // Check that results are relevant
    const hasMatrix = res.data.metas.some(m => 
      m.name && m.name.toLowerCase().includes('matrix')
    );
    assert(hasMatrix, 'Results should include Matrix');
    console.log(`     (Found ${res.data.metas.length} results)`);
  });

  await runTest('Search with pagination (search + skip)', async () => {
    const catalogType = manifest.catalogs[0].type;
    const searchQuery = encodeURIComponent('love');
    // Stremio format for multiple params: search=love&skip=20
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}/search=${searchQuery}&skip=20.json`);
    
    assertEqual(res.status, 200, 'Status code');
    assertArray(res.data.metas, 'Should have metas array');
    console.log(`     (Got ${res.data.metas.length} items for "love" page 2)`);
  });

  await runTest('Search with no results returns empty metas', async () => {
    const catalogType = manifest.catalogs[0].type;
    const searchQuery = encodeURIComponent('xyznonexistentmovie123456789');
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}/search=${searchQuery}.json`);
    
    assertEqual(res.status, 200, 'Status code should still be 200');
    assertArray(res.data.metas, 'Should have metas array');
    assertEqual(res.data.metas.length, 0, 'Should return empty results');
  });

  await runTest('Search with special characters is handled', async () => {
    const catalogType = manifest.catalogs[0].type;
    const searchQuery = encodeURIComponent('Star Wars: Episode');
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}/search=${searchQuery}.json`);
    
    assertEqual(res.status, 200, 'Status code');
    assertArray(res.data.metas, 'Should have metas array');
    console.log(`     (Found ${res.data.metas.length} results)`);
  });
}

// ============================================
// TEST SUITE: Catalog - Genre Filtering
// ============================================
async function testCatalogGenre() {
  console.log('\n🎭 Catalog Genre Filtering Tests\n');

  // Find a catalog with genre options
  const catalogWithGenres = manifest.catalogs.find(c => 
    c.extra && c.extra.some(e => e.name === 'genre' && e.options && e.options.length > 0)
  );

  if (!catalogWithGenres) {
    console.log('  ⚠️  No catalogs with genre options found, skipping genre tests');
    return;
  }

  const genreExtra = catalogWithGenres.extra.find(e => e.name === 'genre');
  const firstGenre = genreExtra.options[0];
  console.log(`  📝 Testing with catalog: ${catalogWithGenres.name}`);
  console.log(`     Available genres: ${genreExtra.options.slice(0, 5).join(', ')}...`);

  await runTest(`Filter by genre: ${firstGenre}`, async () => {
    const genreQuery = encodeURIComponent(firstGenre);
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogWithGenres.type}/${catalogWithGenres.id}/genre=${genreQuery}.json`);
    
    assertEqual(res.status, 200, 'Status code');
    assertArray(res.data.metas, 'Should have metas array');
    assert(res.data.metas.length > 0, `Should find ${firstGenre} content`);
    console.log(`     (Found ${res.data.metas.length} ${firstGenre} items)`);
  });

  await runTest('Genre filter with pagination', async () => {
    const genreQuery = encodeURIComponent(firstGenre);
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogWithGenres.type}/${catalogWithGenres.id}/genre=${genreQuery}&skip=20.json`);
    
    assertEqual(res.status, 200, 'Status code');
    assertArray(res.data.metas, 'Should have metas array');
    console.log(`     (Found ${res.data.metas.length} ${firstGenre} items on page 2)`);
  });

  await runTest('Invalid genre returns fallback results', async () => {
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogWithGenres.type}/${catalogWithGenres.id}/genre=InvalidGenre123.json`);
    
    assertEqual(res.status, 200, 'Status code should still be 200');
    assertArray(res.data.metas, 'Should have metas array');
    // Should either return results (falling back to stored filters) or empty
    console.log(`     (Got ${res.data.metas.length} items with invalid genre)`);
  });
}

// ============================================
// TEST SUITE: Different Content Types
// ============================================
async function testContentTypes() {
  console.log('\n🎬 Content Type Tests\n');

  // Find movie and series catalogs
  const movieCatalog = manifest.catalogs.find(c => c.type === 'movie');
  const seriesCatalog = manifest.catalogs.find(c => c.type === 'series');

  if (movieCatalog) {
    await runTest('Movie catalog returns movie type metas', async () => {
      const res = await stremioFetch(`/${testUserId}/catalog/movie/${movieCatalog.id}.json`);
      
      assertEqual(res.status, 200, 'Status code');
      assert(res.data.metas.length > 0, 'Should have movie metas');
      
      // All returned items should be movies
      const allMovies = res.data.metas.every(m => m.type === 'movie');
      assert(allMovies, 'All metas should have type "movie"');
      console.log(`     (Got ${res.data.metas.length} movies)`);
    });
  }

  if (seriesCatalog) {
    await runTest('Series catalog returns series type metas', async () => {
      const res = await stremioFetch(`/${testUserId}/catalog/series/${seriesCatalog.id}.json`);
      
      assertEqual(res.status, 200, 'Status code');
      assert(res.data.metas.length > 0, 'Should have series metas');
      
      // All returned items should be series
      const allSeries = res.data.metas.every(m => m.type === 'series');
      assert(allSeries, 'All metas should have type "series"');
      console.log(`     (Got ${res.data.metas.length} series)`);
    });
  }
}

// ============================================
// TEST SUITE: Meta Preview Object Validation
// ============================================
async function testMetaObjects() {
  console.log('\n🏷️  Meta Object Validation Tests\n');

  await runTest('Meta objects have optional enhanced fields', async () => {
    const catalogType = manifest.catalogs[0].type;
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}.json`);
    
    assert(res.data.metas.length > 0, 'Should have metas');
    
    const meta = res.data.metas[0];
    
    // These are optional but should be present for good UX
    const hasDescription = typeof meta.description === 'string';
    const hasReleaseInfo = typeof meta.releaseInfo === 'string';
    const hasRating = meta.imdbRating !== undefined;
    const hasGenres = Array.isArray(meta.genres);
    
    console.log(`     description: ${hasDescription ? '✓' : '✗'}`);
    console.log(`     releaseInfo: ${hasReleaseInfo ? '✓' : '✗'}`);
    console.log(`     imdbRating: ${hasRating ? '✓' : '✗'}`);
    console.log(`     genres: ${hasGenres ? '✓' : '✗'}`);
    
    // At least some of these should be present
    assert(hasDescription || hasReleaseInfo || hasRating, 
      'Metas should have at least some enhanced fields');
  });

  await runTest('Poster URLs are valid TMDB image URLs', async () => {
    const catalogType = manifest.catalogs[0].type;
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}.json`);
    
    const metasWithPoster = res.data.metas.filter(m => m.poster);
    assert(metasWithPoster.length > 0, 'At least some metas should have posters');
    
    for (const meta of metasWithPoster.slice(0, 5)) {
      assert(
        meta.poster.includes('image.tmdb.org'),
        `Poster URL should be TMDB: ${meta.poster}`
      );
    }
    console.log(`     (${metasWithPoster.length}/${res.data.metas.length} have posters)`);
  });

  await runTest('Background URLs use higher resolution', async () => {
    const catalogType = manifest.catalogs[0].type;
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}.json`);
    
    const metasWithBg = res.data.metas.filter(m => m.background);
    
    for (const meta of metasWithBg.slice(0, 3)) {
      // Background should use w1280 size
      assert(
        meta.background.includes('w1280') || meta.background.includes('original'),
        `Background should use high res: ${meta.background}`
      );
    }
    console.log(`     (${metasWithBg.length}/${res.data.metas.length} have backgrounds)`);
  });
}

// ============================================
// TEST SUITE: Caching Headers
// ============================================
async function testCaching() {
  console.log('\n⚡ Caching Tests\n');

  await runTest('Manifest has no-cache headers', async () => {
    const res = await stremioFetch(`/${testUserId}/manifest.json`);
    
    const cacheControl = res.headers['cache-control'];
    assert(cacheControl, 'Should have Cache-Control header');
    assert(
      cacheControl.includes('no-cache') || cacheControl.includes('no-store'),
      'Manifest should not be cached'
    );
  });

  await runTest('Catalog has cache hints', async () => {
    const catalogType = manifest.catalogs[0].type;
    const res = await stremioFetch(`/${testUserId}/catalog/${catalogType}/${testCatalogId}.json`);
    
    // Check for Stremio cache hints in response body
    if (res.data.cacheMaxAge !== undefined) {
      console.log(`     cacheMaxAge: ${res.data.cacheMaxAge}s`);
    }
    if (res.data.staleRevalidate !== undefined) {
      console.log(`     staleRevalidate: ${res.data.staleRevalidate}s`);
    }
  });
}

// ============================================
// TEST SUITE: Error Handling
// ============================================
async function testErrorHandling() {
  console.log('\n🚨 Error Handling Tests\n');

  await runTest('Malformed URL returns graceful error', async () => {
    const res = await stremioFetch(`/${testUserId}/catalog/movie/.json`);
    // Should not crash, should return some response
    assert(res.status >= 200 && res.status < 600, 'Should return valid HTTP status');
  });

  await runTest('Very long catalog ID is handled', async () => {
    const longId = 'a'.repeat(1000);
    const res = await stremioFetch(`/${testUserId}/catalog/movie/${longId}.json`);
    
    assertEqual(res.status, 200, 'Should return 200');
    assertArray(res.data.metas, 'Should have metas array');
    assertEqual(res.data.metas.length, 0, 'Should return empty metas');
  });

  await runTest('Special characters in path are handled', async () => {
    // URL-encode special characters
    const specialId = encodeURIComponent('test<script>alert(1)</script>');
    const res = await stremioFetch(`/${testUserId}/catalog/movie/${specialId}.json`);
    
    assertEqual(res.status, 200, 'Should return 200');
    assertArray(res.data.metas, 'Should have metas array');
  });
}

// ============================================
// Main Test Runner
// ============================================
async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     Stremio Addon Client Simulator - Integration Tests         ║');
  console.log('║     Testing TMDB Discover+ addon endpoints                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\n🌐 Target: ${BASE_URL}`);

  try {
    await setup();

    // Run all test suites
    await testManifest();
    await testCatalogBasic();
    await testCatalogPagination();
    await testCatalogSearch();
    await testCatalogGenre();
    await testContentTypes();
    await testMetaObjects();
    await testCaching();
    await testErrorHandling();

  } catch (error) {
    console.error(`\n💥 Fatal error: ${error.message}`);
    console.error(error.stack);
  } finally {
    await cleanup();
  }

  // Print summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                         TEST SUMMARY                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\n  ✅ Passed: ${results.passed}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log(`  📊 Total:  ${results.passed + results.failed}`);

  if (results.failed > 0) {
    console.log('\n  Failed tests:');
    results.tests
      .filter(t => t.status === 'failed')
      .forEach(t => console.log(`    - ${t.name}: ${t.error}`));
    console.log('');
    process.exit(1);
  } else {
    console.log('\n  🎉 All tests passed!\n');
    process.exit(0);
  }
}

main();
