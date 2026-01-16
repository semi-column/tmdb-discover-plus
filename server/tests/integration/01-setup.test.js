/**
 * Setup & Configuration Tests
 *
 * Tests for the configuration API endpoints:
 * - Health check
 * - Create configuration
 * - Read configuration
 * - Update configuration
 * - Delete configuration
 * - Configuration validation
 */

import {
  runTest,
  get,
  post,
  put,
  del,
  assert,
  assertOk,
  assertString,
  assertArray,
  assertHasProperties,
  setSharedData,
  getSharedData,
  createTestConfig,
  createTestCatalog,
} from '../helpers/utils.js';
import { CONFIG } from '../helpers/config.js';

const SUITE = 'Setup & Config';

export async function run() {
  // ==========================================
  // Health Check
  // ==========================================

  await runTest(SUITE, 'Health check returns OK', async () => {
    const res = await get('/health');
    assertOk(res, 'Health check');
    assert(res.data.status === 'ok', 'Status should be "ok"');
  });

  // ==========================================
  // Create Configuration
  // ==========================================

  await runTest(SUITE, 'Create new configuration', async () => {
    const configData = createTestConfig({
      catalogs: [
        createTestCatalog({
          name: 'Integration Test Movies',
          type: 'movie',
          filters: {
            genres: ['28'], // Action
            sortBy: 'popularity.desc',
          },
        }),
      ],
    });

    const res = await post('/api/config', configData);
    assertOk(res, 'Create config');

    assertHasProperties(res.data, ['userId', 'installUrl', 'stremioUrl'], 'Response');
    assertString(res.data.userId, 'userId');

    // Save userId for subsequent tests
    setSharedData('userId', res.data.userId);
    setSharedData('configData', configData);
  });

  await runTest(SUITE, 'Create config fails without API key', async () => {
    const res = await post('/api/config', {
      catalogs: [createTestCatalog()],
    });

    assert(!res.ok, 'Should fail without API key');
    assert(res.status === 400, 'Should return 400');
    assert(res.data.error?.includes('API key'), 'Error should mention API key');
  });

  await runTest(SUITE, 'Create config fails with invalid API key format', async () => {
    const res = await post('/api/config', {
      tmdbApiKey: 'invalid-key',
      catalogs: [createTestCatalog()],
    });

    assert(!res.ok, 'Should fail with invalid API key');
    assert(res.status === 400, 'Should return 400');
  });

  // ==========================================
  // Read Configuration
  // ==========================================

  await runTest(SUITE, 'Get existing configuration', async () => {
    const userId = getSharedData('userId');
    assert(userId, 'userId should be set from previous test');

    const res = await get(`/api/config/${userId}?apiKey=${CONFIG.tmdbApiKey}`);
    assertOk(res, 'Get config');

    assert(res.data.userId === userId, 'userId should match');
    assertArray(res.data.catalogs, 1, 'Should have at least 1 catalog');
  });

  await runTest(SUITE, 'Get non-existent configuration returns 404', async () => {
    const res = await get(`/api/config/nonexistent123?apiKey=${CONFIG.tmdbApiKey}`);
    assert(res.status === 404, 'Should return 404');
  });

  // ==========================================
  // Update Configuration
  // ==========================================

  await runTest(SUITE, 'Update existing configuration', async () => {
    const userId = getSharedData('userId');

    const updateData = createTestConfig({
      catalogs: [
        createTestCatalog({
          name: 'Updated Integration Test',
          type: 'movie',
          filters: {
            genres: ['28', '12'], // Action + Adventure
            sortBy: 'vote_average.desc',
            voteCountMin: 500,
          },
        }),
      ],
    });

    const res = await put(`/api/config/${userId}`, updateData);
    assertOk(res, 'Update config');

    assert(res.data.userId === userId, 'userId should match');
    assertHasProperties(res.data, ['installUrl', 'stremioUrl', 'configureUrl'], 'Response');

    // Verify update persisted
    const getRes = await get(`/api/config/${userId}?apiKey=${CONFIG.tmdbApiKey}`);
    assertOk(getRes, 'Get updated config');

    const catalog = getRes.data.catalogs[0];
    assert(catalog.name === 'Updated Integration Test', 'Catalog name should be updated');
  });

  // ==========================================
  // Date Preset Persistence
  // ==========================================

  await runTest(SUITE, 'Date presets are persisted correctly', async () => {
    const userId = getSharedData('userId');

    const existingRes = await get(`/api/config/${userId}?apiKey=${CONFIG.tmdbApiKey}`);
    assertOk(existingRes);

    const configData = createTestConfig({
      catalogs: [
        ...existingRes.data.catalogs,
        createTestCatalog({
          id: 'date-preset-test',
          name: 'Date Preset Test',
          filters: {
            datePreset: 'last_30_days',
            sortBy: 'release_date.desc',
          },
        }),
      ],
    });

    const saveRes = await put(`/api/config/${userId}`, configData);
    assertOk(saveRes, 'Save config with datePreset');

    const getRes = await get(`/api/config/${userId}?apiKey=${CONFIG.tmdbApiKey}`);
    assertOk(getRes);

    const presetCatalog = getRes.data.catalogs.find((c) => c.name === 'Date Preset Test');
    assert(presetCatalog, 'Date preset catalog should exist');
    assert(
      presetCatalog.filters?.datePreset === 'last_30_days',
      `datePreset should be persisted: got '${presetCatalog.filters?.datePreset}'`
    );
  });

  // ==========================================
  // Config Name Persistence
  // ==========================================

  await runTest(SUITE, 'Config name is persisted', async () => {
    const userId = getSharedData('userId');

    const configData = createTestConfig({
      configName: 'My Test Configuration',
      catalogs: [createTestCatalog()],
    });

    const res = await put(`/api/config/${userId}`, configData);
    assertOk(res);

    const getRes = await get(`/api/config/${userId}?apiKey=${CONFIG.tmdbApiKey}`);
    assertOk(getRes);
    assert(getRes.data.configName === 'My Test Configuration', 'Config name should be persisted');
  });

  // ==========================================
  // Preferences Persistence
  // ==========================================

  await runTest(SUITE, 'Preferences are persisted', async () => {
    const userId = getSharedData('userId');

    const configData = createTestConfig({
      catalogs: [createTestCatalog()],
      preferences: {
        showAdultContent: false,
        defaultLanguage: 'es',
      },
    });

    const res = await put(`/api/config/${userId}`, configData);
    assertOk(res);

    const getRes = await get(`/api/config/${userId}?apiKey=${CONFIG.tmdbApiKey}`);
    assertOk(getRes);
    assert(getRes.data.preferences?.defaultLanguage === 'es', 'Preferences should be persisted');
  });

  // ==========================================
  // Delete Configuration (run last)
  // ==========================================

  await runTest(SUITE, 'Delete configuration', async () => {
    // Create a new config specifically for deletion test
    const createRes = await post('/api/config', createTestConfig());
    assertOk(createRes, 'Create config for deletion');

    const deleteUserId = createRes.data.userId;

    const delRes = await del(`/api/config/${deleteUserId}?apiKey=${CONFIG.tmdbApiKey}`);
    assertOk(delRes, 'Delete config');

    // Verify deletion
    const getRes = await get(`/api/config/${deleteUserId}?apiKey=${CONFIG.tmdbApiKey}`);
    assert(getRes.status === 404, 'Config should be deleted');
  });
}
