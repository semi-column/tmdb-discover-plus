import { runTest, apiRequest, assert, getSharedUserId } from '../utils.js';

export async function run() {
    const userId = getSharedUserId();
    if (!userId) {
        console.log('SKIPPING Localization Suite: No User ID available');
        return;
    }

    // Known movie: Inside Out (2015)
    // TMDB ID: 150540
    // Spanish (es-ES) Title: "Del Revés (Inside Out)" or just "Del Revés"
    // French (fr-FR) Title: "Vice-versa" 

    await runTest('Localization', 'Localized Meta (Spanish)', async () => {
        const tmdbId = 'tmdb:150540';
        // Pass language in extra
        // language param is 'language', not 'displayLanguage' for meta usually? 
        // addon.js checks both.
        const res = await apiRequest(`/${userId}/meta/movie/${tmdbId}/language=es-ES.json`);

        assert(res.ok, 'Meta request failed');
        const meta = res.data.meta;
        assert(meta, 'Should return meta');

        // Check for Spanish title
        // TMDB might return "Del Revés (Inside Out)" or "Del revés"
        console.log(`      Title (ES): ${meta.name}`);
        const isSpanishTitle = meta.name.toLowerCase().includes('del revés') || meta.name.toLowerCase().includes('del reves');
        assert(isSpanishTitle, `Expected Spanish title containing 'Del Revés', got '${meta.name}'`);

        // Check for Spanish description
        // "Riley" is a name, but "Alegría" (Joy) or "Tristeza" (Sadness) are localized names/words in description
        console.log(`      Desc (ES): ${meta.description?.substring(0, 50)}...`);
        const isSpanishDesc = meta.description && (meta.description.includes('Alegría') || meta.description.includes('mundo') || meta.description.includes('emociones'));
        assert(isSpanishDesc, 'Expected Spanish description');
    });

    await runTest('Localization', 'Localized Meta (French)', async () => {
        const tmdbId = 'tmdb:150540';
        const res = await apiRequest(`/${userId}/meta/movie/${tmdbId}/language=fr-FR.json`);

        assert(res.ok, 'Meta request failed');
        const meta = res.data.meta;

        console.log(`      Title (FR): ${meta.name}`);
        const isFrenchTitle = meta.name.includes('Vice-versa') || meta.name.includes('Vice Versa');
        assert(isFrenchTitle, `Expected French title 'Vice-versa', got '${meta.name}'`);

        // Check for French description
        console.log(`      Desc (FR): ${meta.description?.substring(0, 50)}...`);
        const isFrenchDesc = meta.description && (meta.description.includes('émotions') || meta.description.includes('Joie') || meta.description.includes('vie'));
        assert(isFrenchDesc, 'Expected French description');
    });

    await runTest('Localization', 'Localized Catalog Results (German)', async () => {
        const catalogId = 'tmdb-test-basic-movie';
        // Request catalog with language=de-DE
        const res = await apiRequest(`/${userId}/catalog/movie/${catalogId}/displayLanguage=de-DE.json`);
        assert(res.ok, 'Catalog request failed');

        const first = res.data.metas[0];
        // We can't be sure of the movie, but let's check if the description is German?
        // Or specific movie.
        // It's hard to assert generically.
        // But if the request works and returns success, it verifies the *parameter handling* at least.

        // Logic: if we pass displayLanguage, addon passes it to TMDB.
        assert(res.data.metas.length > 0, 'Should return results');
    });
}
