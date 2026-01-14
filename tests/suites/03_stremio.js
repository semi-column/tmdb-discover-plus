import { runTest, apiRequest, assert, assertArray, getSharedUserId } from '../utils.js';

export async function run() {
    const userId = getSharedUserId();
    if (!userId) {
        console.log('SKIPPING Addon Suite: No User ID available (Config creation failed in 01_setup)');
        return;
    }

    const catalogId = 'tmdb-test-basic-movie'; // From config created in suite 01

    // --- Core Protocol ---
    await runTest('Stremio', 'Manifest Check', async () => {
        const res = await apiRequest(`/${userId}/manifest.json`);
        assert(res.ok, 'Manifest request failed');
        assert(res.data.id, 'Manifest missing ID');
        assert(res.data.catalogs.length > 0, 'Manifest missing catalogs');
        // Ensure our custom catalog is present
        const hasCatalog = res.data.catalogs.some(c => c.id === catalogId);
        assert(hasCatalog, `Manifest missing created catalog ${catalogId}`);
    });

    await runTest('Stremio', 'Catalog Request', async () => {
        const res = await apiRequest(`/${userId}/catalog/movie/${catalogId}.json`);
        assert(res.ok, 'Catalog request failed');
        assertArray(res.data.metas, 1, 'Catalog should return items');
    });

    await runTest('Stremio', 'Meta Details (TMDB ID)', async () => {
        // Get an ID from catalog
        const catRes = await apiRequest(`/${userId}/catalog/movie/${catalogId}.json`);
        const item = catRes.data.metas[0];
        const res = await apiRequest(`/${userId}/meta/movie/${item.id}.json`);

        assert(res.ok, 'Meta request failed');
        assert(res.data.meta, 'Meta should return object');
        assert(res.data.meta.id === item.id, 'Meta ID mismatch');
    });

    await runTest('Stremio', 'Search', async () => {
        const query = 'Deadpool';
        const res = await apiRequest(`/${userId}/catalog/movie/${catalogId}/search=${query}.json`);
        assert(res.ok, 'Search request failed');
        assertArray(res.data.metas, 1, 'Search should return results');
        const first = res.data.metas[0];
        assert(first.name.toLowerCase().includes('deadpool'), 'Search result mismatch');
    });

    // --- Edge Cases / Protocol Variations ---
    await runTest('Stremio', 'Fuzzy Genre Match', async () => {
        // Request with 'Science Fiction' (name) -> Should map to 878
        const genre = 'Science Fiction';
        const path = `/${userId}/catalog/movie/${catalogId}/genre=${encodeURIComponent(genre)}.json`;
        const res = await apiRequest(path);

        assert(res.ok, 'Fuzzy genre request failed');
        assertArray(res.data.metas, 1, 'Should return results for Science Fiction');
    });

    await runTest('Stremio', 'Pagination via Skip', async () => {
        // Page 1 (skip=0)
        const res1 = await apiRequest(`/${userId}/catalog/movie/${catalogId}.json`);

        // Page 2 (skip=20)
        const res2 = await apiRequest(`/${userId}/catalog/movie/${catalogId}/skip=20.json`);
        assert(res2.ok, 'Skip request failed');
        assertArray(res2.data.metas, 1, 'Page 2 should have results');

        const id1 = res1.data.metas[0].id;
        const id2 = res2.data.metas[0].id;
        assert(id1 !== id2, `Pagination failed: Items identical`);
    });

    await runTest('Stremio', 'ID Resolution (IMDB tt)', async () => {
        const imdbId = 'tt1375666'; // Inception
        const res = await apiRequest(`/${userId}/meta/movie/${imdbId}.json`);
        assert(res.ok, 'IMDB ID request failed');
        assert(res.data.meta.name === 'Inception', `Expected Inception, got ${res.data.meta?.name}`);
    });

    await runTest('Stremio', 'ID Resolution (TMDB prefix)', async () => {
        const tmdbId = 'tmdb:27205'; // Inception
        const res = await apiRequest(`/${userId}/meta/movie/${tmdbId}.json`);
        assert(res.ok, 'TMDB ID request failed');
        assert(res.data.meta.name === 'Inception', `Expected Inception`);
    });

    await runTest('Stremio', 'Invalid ID', async () => {
        const res = await apiRequest(`/${userId}/meta/movie/tmdb:999999999.json`);
        assert(res.ok, 'Request should not crash');
        assert(!res.data.meta || Object.keys(res.data.meta).length === 0, 'Should return empty meta');
    });
}
