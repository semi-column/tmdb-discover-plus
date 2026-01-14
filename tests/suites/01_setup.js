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
}
