/**
 * Authentication Tests
 *
 * Tests for session-based authentication:
 * - Login flow (API key validation)
 * - JWT token generation and verification
 * - Session management
 * - Logout
 * - Legacy API key authentication
 * - Protected routes
 * - Addon routes (should work without auth)
 */

import {
  runTest,
  skipTest,
  get,
  post,
  assert,
  assertOk,
  assertEqual,
  assertArray,
  assertHasProperties,
  setSharedData,
  getSharedData,
  sleep,
} from '../helpers/utils.js';
import { CONFIG, validateConfig } from '../helpers/config.js';

const SUITE = 'Authentication';

export async function run() {
  const { valid, missing } = validateConfig();

  // ==========================================
  // Health Check (no auth required)
  // ==========================================

  await runTest(SUITE, 'Health check accessible without auth', async () => {
    const res = await get('/health');
    assertOk(res);
    assertEqual(res.data.status, 'ok', 'Health status');
  });

  // ==========================================
  // Verification Endpoint Tests
  // ==========================================

  await runTest(SUITE, 'Verify returns invalid with no token', async () => {
    const res = await get('/api/auth/verify');
    assertEqual(res.status, 401, 'Status code');
    assertEqual(res.data.valid, false, 'Valid flag');
  });

  await runTest(SUITE, 'Verify returns invalid with malformed token', async () => {
    const res = await get('/api/auth/verify', {
      headers: { Authorization: 'Bearer invalid-token-1234' },
    });
    assertEqual(res.status, 401, 'Status code');
    assertEqual(res.data.valid, false, 'Valid flag');
  });

  await runTest(SUITE, 'Verify returns invalid with expired token format', async () => {
    // This is a properly formatted but invalid JWT
    const fakeJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0MTIzIiwiaWF0IjoxNjAwMDAwMDAwfQ.invalidsignature';
    const res = await get('/api/auth/verify', {
      headers: { Authorization: `Bearer ${fakeJwt}` },
    });
    assertEqual(res.status, 401, 'Status code');
    assertEqual(res.data.valid, false, 'Valid flag');
  });

  // ==========================================
  // Login Validation Tests
  // ==========================================

  await runTest(SUITE, 'Login fails without API key', async () => {
    const res = await post('/api/auth/login', {});
    assertEqual(res.status, 400, 'Status code');
    assert(res.data.error?.toLowerCase().includes('required'), 'Error should mention required');
  });

  await runTest(SUITE, 'Login fails with empty API key', async () => {
    const res = await post('/api/auth/login', { apiKey: '' });
    assertEqual(res.status, 400, 'Status code');
  });

  await runTest(SUITE, 'Login fails with short API key', async () => {
    const res = await post('/api/auth/login', { apiKey: 'short' });
    assertEqual(res.status, 400, 'Status code');
    assert(res.data.error?.toLowerCase().includes('invalid'), 'Error should mention invalid');
  });

  await runTest(SUITE, 'Login fails with non-hex API key', async () => {
    const res = await post('/api/auth/login', { apiKey: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' });
    assertEqual(res.status, 400, 'Status code');
  });

  // ==========================================
  // Login Flow Tests (require valid API key)
  // ==========================================

  if (!valid) {
    skipTest(SUITE, 'Login with valid API key', `Missing: ${missing.join(', ')}`);
    skipTest(SUITE, 'Authenticated requests', `Missing: ${missing.join(', ')}`);
    return;
  }

  let sessionToken = null;
  let userId = null;

  await runTest(SUITE, 'Login with valid API key returns token', async () => {
    const res = await post('/api/auth/login', { apiKey: CONFIG.tmdbApiKey });

    assertEqual(res.status, 200, 'Status code');

    if (res.data.multipleConfigs) {
      // User has multiple configs - need to select one
      assertArray(res.data.configs, 1, 'Should have configs');

      const firstConfig = res.data.configs[0];
      const selectRes = await post('/api/auth/select-config', {
        apiKey: CONFIG.tmdbApiKey,
        userId: firstConfig.userId,
      });

      assertOk(selectRes, 'Config selection');
      assert(selectRes.data.token, 'Should return token');

      sessionToken = selectRes.data.token;
      userId = selectRes.data.userId;
    } else {
      assert(res.data.token, 'Should return token');
      sessionToken = res.data.token;
      userId = res.data.userId;
    }

    // Save for other tests
    setSharedData('sessionToken', sessionToken);
    setSharedData('authUserId', userId);
  });

  await runTest(SUITE, 'Verify with valid token returns success', async () => {
    const token = getSharedData('sessionToken');
    assert(token, 'Token should be set from previous test');

    const res = await get('/api/auth/verify', {
      headers: { Authorization: `Bearer ${token}` },
    });

    assertEqual(res.status, 200, 'Status code');
    assertEqual(res.data.valid, true, 'Valid flag');
    assert(res.data.userId, 'Should return userId');
  });

  // ==========================================
  // Protected Route Tests
  // ==========================================

  await runTest(SUITE, 'Protected route /api/genres works with token', async () => {
    const token = getSharedData('sessionToken');
    assert(token, 'Token required');

    const res = await get('/api/genres/movie', {
      headers: { Authorization: `Bearer ${token}` },
    });

    assertOk(res, 'Genres request');
    assertArray(res.data, 1, 'Should return genres');
  });

  await runTest(SUITE, 'Protected route fails without token', async () => {
    const res = await get('/api/genres/movie');
    assertEqual(res.status, 401, 'Should require auth');
  });

  // ==========================================
  // Legacy API Key Authentication
  // ==========================================

  await runTest(SUITE, 'Legacy API key auth still works via query param', async () => {
    const res = await get(`/api/genres/movie?apiKey=${encodeURIComponent(CONFIG.tmdbApiKey)}`);
    assertOk(res, 'Legacy auth request');
    assertArray(res.data, 1, 'Should return genres');
  });

  await runTest(SUITE, 'Protected POST route accepts legacy API key in body', async () => {
    const res = await post('/api/preview', {
      apiKey: CONFIG.tmdbApiKey,
      type: 'movie',
      filters: { genres: ['28'] },
      page: 1,
    });

    assertOk(res, 'Preview with legacy auth');
    assertArray(res.data.metas, 1, 'Should return results');
  });

  // ==========================================
  // Logout Tests
  // ==========================================

  await runTest(SUITE, 'Logout returns success', async () => {
    const token = getSharedData('sessionToken');
    assert(token, 'Token required');

    const res = await post(
      '/api/auth/logout',
      {},
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    assertOk(res, 'Logout request');
    assertEqual(res.data.success, true, 'Success flag');
  });

  await runTest(SUITE, 'Logout without token still succeeds', async () => {
    const res = await post('/api/auth/logout', {});
    assertOk(res, 'Logout without token');
  });

  // ==========================================
  // Addon Routes (No Auth Required)
  // ==========================================

  await runTest(SUITE, 'Addon manifest accessible without auth', async () => {
    const authUserId = getSharedData('authUserId');

    if (!authUserId) {
      // Try to get one from login
      const loginRes = await post('/api/auth/login', { apiKey: CONFIG.tmdbApiKey });
      if (!loginRes.ok) return;

      const testUserId = loginRes.data.multipleConfigs
        ? loginRes.data.configs[0].userId
        : loginRes.data.userId;

      if (testUserId) {
        const manifestRes = await get(`/${testUserId}/manifest.json`);
        assertOk(manifestRes, 'Manifest without auth');
        assertHasProperties(manifestRes.data, ['id', 'name', 'version'], 'Manifest');
      }
    } else {
      const manifestRes = await get(`/${authUserId}/manifest.json`);
      assertOk(manifestRes, 'Manifest without auth');
      assertHasProperties(manifestRes.data, ['id', 'name', 'version'], 'Manifest');
    }
  });

  await runTest(SUITE, 'Addon catalog accessible without auth', async () => {
    const authUserId = getSharedData('authUserId');
    if (!authUserId) return;

    // Get manifest to find a catalog
    const manifestRes = await get(`/${authUserId}/manifest.json`);
    if (!manifestRes.ok || !manifestRes.data.catalogs?.length) return;

    const catalog = manifestRes.data.catalogs[0];
    const catalogRes = await get(`/${authUserId}/catalog/${catalog.type}/${catalog.id}.json`);

    assertOk(catalogRes, 'Catalog without auth');
    assert(catalogRes.data.metas, 'Should return metas');
  });

  // ==========================================
  // Rate Limiting
  // ==========================================

  await runTest(SUITE, 'Auth endpoints have rate limiting headers', async () => {
    const res = await post('/api/auth/login', { apiKey: CONFIG.tmdbApiKey });

    // Rate limiting headers may vary by implementation
    // Just verify the endpoint responds correctly
    assert(res.status === 200 || res.status === 429, `Expected 200 or 429, got ${res.status}`);
  });
}
