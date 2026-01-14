import { runTest, apiRequest, assert, setSharedUserId } from '../utils.js';
import { CONFIG } from '../config.js';

export async function run() {
    await runTest('Setup', 'Health Check', async () => {
        const res = await apiRequest('/health');
        assert(res.ok, `Health check failed: ${res.status}`);
        assert(res.data.status === 'ok', 'Status should be ok');
    });

    await runTest('Setup', 'Create User Config', async () => {
        const configData = {
            tmdbApiKey: CONFIG.tmdbApiKey,
            catalogs: [
                {
                    id: 'test-basic-movie',
                    name: 'Test Basic Movie',
                    type: 'movie',
                    filters: {
                        genres: ['28'], // Action
                        sortBy: 'popularity.desc'
                    }
                }
            ],
            preferences: {
                language: 'en-US'
            }
        };

        const res = await apiRequest('/api/config', 'POST', configData);
        assert(res.ok, `Create config failed: ${res.data.error || res.status}`);
        assert(res.data.userId, 'Response should contain userId');

        // Save userId for other tests
        setSharedUserId(res.data.userId);
    });

    await runTest('Setup', 'Get User Config', async () => {
        // Use the userId we just created
        const importUserId = (await import('../utils.js')).getSharedUserId();
        assert(importUserId, 'User ID not set from previous test');

        const res = await apiRequest(`/api/config/${importUserId}?apiKey=${CONFIG.tmdbApiKey}`);
        assert(res.ok, `Get config failed: ${res.status}`);
        assert(res.data.userId === importUserId, 'User ID mismatch');
        assert(res.data.catalogs.length > 0, 'Should have catalogs');
    });

    await runTest('Setup', 'Update User Config (PUT)', async () => {
        const importUserId = (await import('../utils.js')).getSharedUserId();
        assert(importUserId, 'User ID not set from previous test');

        const updateData = {
            tmdbApiKey: CONFIG.tmdbApiKey,
            catalogs: [
                {
                    id: 'test-basic-movie',
                    name: 'Test Basic Movie Updated',
                    type: 'movie',
                    filters: {
                        genres: ['28', '12'], // Action + Adventure
                        sortBy: 'popularity.desc'
                    }
                }
            ],
            preferences: {
                language: 'en-US'
            }
        };

        const res = await apiRequest(`/api/config/${importUserId}`, 'PUT', updateData);
        assert(res.ok, `Update config failed: ${res.data.error || res.status}`);
        assert(res.data.userId === importUserId, 'User ID should match');
        assert(res.data.installUrl, 'Response should contain installUrl');
        assert(res.data.stremioUrl, 'Response should contain stremioUrl');
    });

    await runTest('Setup', 'DatePreset Persistence', async () => {
        const importUserId = (await import('../utils.js')).getSharedUserId();
        assert(importUserId, 'User ID not set from previous test');

        // First get existing config to preserve catalogs
        const existingRes = await apiRequest(`/api/config/${importUserId}?apiKey=${CONFIG.tmdbApiKey}`);
        assert(existingRes.ok, `Get existing config failed: ${existingRes.status}`);
        const existingCatalogs = existingRes.data.catalogs || [];

        // Add datePreset catalog to existing ones
        const configData = {
            tmdbApiKey: CONFIG.tmdbApiKey,
            catalogs: [
                ...existingCatalogs,
                {
                    id: 'test-date-preset',
                    name: 'Date Preset Test',
                    type: 'movie',
                    filters: {
                        datePreset: 'last_30_days',
                        sortBy: 'popularity.desc'
                    }
                }
            ],
            preferences: {}
        };

        const saveRes = await apiRequest(`/api/config/${importUserId}`, 'PUT', configData);
        assert(saveRes.ok, `Save config with datePreset failed: ${saveRes.data.error || saveRes.status}`);

        // Verify datePreset is persisted
        const getRes = await apiRequest(`/api/config/${importUserId}?apiKey=${CONFIG.tmdbApiKey}`);
        assert(getRes.ok, `Get config failed: ${getRes.status}`);

        const savedCatalog = getRes.data.catalogs.find(c => c.id === 'test-date-preset' || c.name === 'Date Preset Test');
        assert(savedCatalog, 'Date preset catalog not found');
        assert(savedCatalog.filters?.datePreset === 'last_30_days',
            `datePreset not persisted: expected 'last_30_days', got '${savedCatalog.filters?.datePreset}'`);
    });
}
