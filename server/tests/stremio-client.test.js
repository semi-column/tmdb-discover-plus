/**
 * Minimal integration tests for TMDB Discover+
 *
 * These tests simulate a small subset of Stremio client behavior:
 * - create a config via /api/config
 * - fetch manifest
 * - fetch catalog (page 1)
 * - fetch catalog search
 *
 * Requirements:
 * - TMDB_API_KEY env var must be set to a valid TMDB v3 API key
 *
 * Optional env vars:
 * - TEST_BASE_URL (default http://localhost:7000)
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:7000';
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TEST_TIMEOUT_MS = 30000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJson(path, options = {}) {
  const url = new URL(path, BASE_URL);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    const data = text ? (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })() : null;

    return { status: res.status, headers: res.headers, data, raw: text };
  } finally {
    clearTimeout(t);
  }
}

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < TEST_TIMEOUT_MS) {
    try {
      const res = await fetchJson('/health');
      if (res.status === 200) return res;
    } catch {
      // ignore
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Server not ready at ${BASE_URL}`);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║          TMDB Discover+ - Minimal Integration Tests            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\n🌐 Target: ${BASE_URL}`);

  if (!TMDB_API_KEY) {
    console.warn('⚠️  TMDB_API_KEY not set; skipping integration tests');
    console.warn('   To run them: $env:TMDB_API_KEY="your-api-key"');
    process.exit(0);
  }

  let userId = null;

  try {
    const health = await waitForServer();
    console.log(`✅ Server is up (version: ${health.data?.version || 'unknown'})`);

    // 1) Create config (also validates TMDB key server-side)
    const create = await fetchJson('/api/config', {
      method: 'POST',
      body: {
        tmdbApiKey: TMDB_API_KEY,
        catalogs: [
          {
            name: 'Test Movies - Popular',
            type: 'movie',
            enabled: true,
            filters: { listType: 'popular' },
          },
        ],
      },
    });

    assert(create.status === 200, `POST /api/config expected 200, got ${create.status}: ${create.raw}`);
    userId = create.data?.userId;
    assert(typeof userId === 'string' && userId.length > 0, 'POST /api/config should return userId');
    console.log(`✅ Created test user: ${userId}`);

    // 2) Fetch manifest
    const manifest = await fetchJson(`/${encodeURIComponent(userId)}/manifest.json`);
    assert(manifest.status === 200, `GET manifest expected 200, got ${manifest.status}`);
    assert(typeof manifest.data?.id === 'string', 'manifest.id missing');
    assert(Array.isArray(manifest.data?.catalogs), 'manifest.catalogs should be array');
    assert(manifest.data.catalogs.length > 0, 'manifest.catalogs should not be empty');

    const firstCatalog = manifest.data.catalogs[0];
    assert(firstCatalog?.id, 'manifest first catalog missing id');
    assert(firstCatalog?.type, 'manifest first catalog missing type');
    console.log(`✅ Manifest OK (catalogs: ${manifest.data.catalogs.length})`);

    // 3) Fetch catalog page 1
    const cat = await fetchJson(`/${encodeURIComponent(userId)}/catalog/${encodeURIComponent(firstCatalog.type)}/${encodeURIComponent(firstCatalog.id)}.json`);
    assert(cat.status === 200, `GET catalog expected 200, got ${cat.status}`);
    assert(Array.isArray(cat.data?.metas), 'catalog response metas should be array');
    console.log(`✅ Catalog OK (items: ${cat.data.metas.length})`);

    // 4) Catalog search
    const q = encodeURIComponent('Matrix');
    const catSearch = await fetchJson(`/${encodeURIComponent(userId)}/catalog/${encodeURIComponent(firstCatalog.type)}/${encodeURIComponent(firstCatalog.id)}/search=${q}.json`);
    assert(catSearch.status === 200, `GET catalog search expected 200, got ${catSearch.status}`);
    assert(Array.isArray(catSearch.data?.metas), 'catalog search metas should be array');
    console.log(`✅ Search OK (items: ${catSearch.data.metas.length})`);

    console.log('\n🎉 All minimal integration tests passed!');
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Tests failed: ${err.message}`);
    process.exit(1);
  } finally {
    if (userId) {
      try {
        await fetchJson(`/api/config/${encodeURIComponent(userId)}?apiKey=${encodeURIComponent(TMDB_API_KEY)}`, {
          method: 'DELETE',
        });
        console.log(`🧹 Cleaned up test user: ${userId}`);
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

main();
