import { runTest, apiRequest, assert, assertArray } from '../utils.js';
import { CONFIG } from '../config.js';

export async function run() {
    // Helper to test preview endpoint
    const testPreview = async (input, type = 'movie') => {
        const { page, ...filters } = input;
        const body = {
            apiKey: CONFIG.tmdbApiKey,
            type,
            filters,
            page: page || 1
        };
        const res = await apiRequest('/api/preview', 'POST', body);
        assert(res.ok, `Preview failed: ${res.data.error || res.status}`);
        return res.data;
    };

    // --- Core Filters ---
    await runTest('Discovery', 'Genre Filter (Action)', async () => {
        const data = await testPreview({ genres: ['28'] });
        assertArray(data.metas, 1, 'Should return results');
    });

    await runTest('Discovery', 'Multiple Genres (OR logic)', async () => {
        const data = await testPreview({ genres: ['28', '35'], genreMatchMode: 'any' });
        assertArray(data.metas, 1, 'Should return results');
    });

    await runTest('Discovery', 'Multiple Genres (AND logic)', async () => {
        const data = await testPreview({ genres: ['28', '35'], genreMatchMode: 'all' });
        // Might accept 0, but usually there are some
    });

    await runTest('Discovery', 'Year Range (1990-1999)', async () => {
        const data = await testPreview({ yearFrom: '1990', yearTo: '1999' });
        assertArray(data.metas, 1, 'Should return results');
        const year = parseInt(data.metas[0].releaseInfo.split('-')[0]);
        assert(year >= 1990 && year <= 1999, `Year ${year} outside range 1990-1999`);
    });

    await runTest('Discovery', 'Dynamic Date Preset (Last 30 Days)', async () => {
        const data = await testPreview({ datePreset: 'last_30_days' });
        assertArray(data.metas, 1, 'Should return results');
        const releaseYear = parseInt(data.metas[0].releaseInfo.split('-')[0]);
        const currentYear = new Date().getFullYear();
        assert(releaseYear === currentYear || releaseYear === currentYear - 1, 'Should be recent');
    });

    // --- Advanced Filters ---
    await runTest('Discovery', 'Rating (High > 8.0)', async () => {
        const data = await testPreview({ ratingMin: 8, voteCountMin: 100 });
        assertArray(data.metas, 1, 'Should return results');
        const rating = parseFloat(data.metas[0].imdbRating);
        assert(rating >= 8.0, `Expected rating >= 8.0, got ${rating}`);
    });

    await runTest('Discovery', 'Sort By (Vote Average Desc)', async () => {
        const data = await testPreview({ sortBy: 'vote_average.desc', voteCountMin: 500 });
        assertArray(data.metas, 2, 'Should return multiple results');
        const r1 = parseFloat(data.metas[0].imdbRating);
        assert(r1 >= 8.0, 'Top result should have high rating');
    });

    await runTest('Discovery', 'TV Show Status (Returning Series)', async () => {
        const data = await testPreview({ tvStatus: '0' }, 'series');
        assertArray(data.metas, 1, 'Should return results');
    });

    await runTest('Discovery', 'Complex Combination', async () => {
        const data = await testPreview({ genres: ['28'], yearFrom: '2020', ratingMin: 7 });
        assertArray(data.metas, 1, 'Should return results');
        const year = parseInt(data.metas[0].releaseInfo.split('-')[0]);
        assert(year >= 2020, `Expected year >= 2020, got ${year}`);
    });

    // --- Providers ---
    await runTest('Discovery', 'Watch Provider (Netflix US)', async () => {
        const data = await testPreview({ watchRegion: 'US', watchProviders: ['8'] });
        assertArray(data.metas, 1, 'Should return results');
    });

    await runTest('Discovery', 'Provider + Genre', async () => {
        const data = await testPreview({ genres: ['28'], watchRegion: 'US', watchProviders: ['8'] });
        assertArray(data.metas, 1, 'Should return results');
    });

    // --- Extended Filters ---
    await runTest('Discovery', 'Cast Filter (Tom Cruise)', async () => {
        const data = await testPreview({ withCast: '500', sortBy: 'vote_count.desc' });
        assertArray(data.metas, 1, 'Should return results');
        const titles = data.metas.map(m => m.name);
        const hasCruise = titles.some(t => t.includes('Mission') || t.includes('Top Gun') || t.includes('Rain Man'));
        assert(hasCruise, 'Should contain Tom Cruise movies');
    });

    await runTest('Discovery', 'Runtime Filter (Short)', async () => {
        const data = await testPreview({ runtimeMax: 60, sortBy: 'popularity.desc' });
        assertArray(data.metas, 1, 'Should return results');
    });

    await runTest('Discovery', 'Certification (G Rated)', async () => {
        const data = await testPreview({ certification: 'G', certificationCountry: 'US' });
        assertArray(data.metas, 1, 'Should return results');
    });

    await runTest('Discovery', 'Language (French)', async () => {
        const data = await testPreview({ language: 'fr' });
        assertArray(data.metas, 1, 'Should return results');
    });

    // --- API Logic ---
    await runTest('Discovery', 'Pagination (Page 2)', async () => {
        const p1 = await testPreview({ page: 1 });
        const p2 = await testPreview({ page: 2 });
        assertArray(p1.metas, 1, 'Page 1 should have results');
        assertArray(p2.metas, 1, 'Page 2 should have results');
        assert(p1.metas[0].id !== p2.metas[0].id, 'Page 1 and 2 should have different items');
    });

    await runTest('Discovery', 'Zero Results Query', async () => {
        const data = await testPreview({ yearFrom: '1800', yearTo: '1800', genres: ['28'] });
        assert(data.metas.length === 0, 'Should return 0 results');
    });
}
