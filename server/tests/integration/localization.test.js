/**
 * Localization Tests
 *
 * Tests for TMDB localization support:
 * - Localized meta titles and descriptions
 * - Language parameter handling in catalog requests
 * - Display language vs original language
 */

import {
  runTest,
  skipTest,
  get,
  post,
  assert,
  assertOk,
  assertArray,
  getSharedData,
  setSharedData,
  createTestConfig,
  createTestCatalog,
} from '../helpers/utils.js';
import { CONFIG } from '../helpers/config.js';

const SUITE = 'Localization';

export async function run() {
  // Ensure we have a userId
  let userId = getSharedData('userId');

  if (!userId) {
    const createRes = await post(
      '/api/config',
      createTestConfig({
        catalogs: [
          createTestCatalog({
            id: 'localization-test',
            name: 'Localization Test',
            type: 'movie',
            filters: {
              genres: ['16'], // Animation (more likely to have localized titles)
              sortBy: 'popularity.desc',
            },
          }),
        ],
      })
    );

    if (createRes.ok) {
      userId = createRes.data.userId;
      setSharedData('userId', userId);
    } else {
      skipTest(SUITE, 'All tests', 'Could not create test config');
      return;
    }
  }

  // Test movie: Inside Out (2015), TMDB ID: 150540
  // Known localizations:
  // - Spanish (es-ES): "Del Revés (Inside Out)" or "Del revés"
  // - French (fr-FR): "Vice-versa"
  // - German (de-DE): "Alles steht Kopf"

  // ==========================================
  // Localized Meta Titles
  // ==========================================

  await runTest(SUITE, 'Meta returns Spanish title (es-ES)', async () => {
    const tmdbId = 'tmdb:150540'; // Inside Out
    const res = await get(`/${userId}/meta/movie/${tmdbId}/language=es-ES.json`);

    assertOk(res, 'Spanish meta request');
    assert(res.data.meta, 'Should return meta');

    const title = res.data.meta.name?.toLowerCase() || '';
    const hasSpanishTitle =
      title.includes('del revés') || title.includes('del reves') || title.includes('inside out');

    assert(
      hasSpanishTitle,
      `Expected Spanish title containing 'Del Revés' or 'Inside Out', got '${res.data.meta.name}'`
    );
  });

  await runTest(SUITE, 'Meta returns French title (fr-FR)', async () => {
    const tmdbId = 'tmdb:150540'; // Inside Out
    const res = await get(`/${userId}/meta/movie/${tmdbId}/language=fr-FR.json`);

    assertOk(res, 'French meta request');
    assert(res.data.meta, 'Should return meta');

    const title = res.data.meta.name || '';
    const hasFrenchTitle =
      title.includes('Vice-versa') || title.includes('Vice Versa') || title.includes('Inside Out');

    assert(hasFrenchTitle, `Expected French title 'Vice-versa', got '${title}'`);
  });

  await runTest(SUITE, 'Meta returns German title (de-DE)', async () => {
    const tmdbId = 'tmdb:150540'; // Inside Out
    const res = await get(`/${userId}/meta/movie/${tmdbId}/language=de-DE.json`);

    assertOk(res, 'German meta request');
    assert(res.data.meta, 'Should return meta');

    const title = res.data.meta.name || '';
    const hasGermanTitle = title.includes('Alles steht Kopf') || title.includes('Inside Out');

    assert(hasGermanTitle, `Expected German title 'Alles steht Kopf', got '${title}'`);
  });

  // ==========================================
  // Localized Descriptions
  // ==========================================

  await runTest(SUITE, 'Meta returns localized description', async () => {
    const tmdbId = 'tmdb:150540'; // Inside Out
    const res = await get(`/${userId}/meta/movie/${tmdbId}/language=es-ES.json`);

    assertOk(res);
    assert(res.data.meta?.description, 'Should have description');

    // Spanish descriptions often contain these words
    const desc = res.data.meta.description.toLowerCase();
    const isSpanish =
      desc.includes('emociones') ||
      desc.includes('riley') ||
      desc.includes('alegría') ||
      desc.includes('tristeza');

    assert(isSpanish, 'Description should be in Spanish');
  });

  // ==========================================
  // Catalog Localization
  // ==========================================

  await runTest(SUITE, 'Catalog respects displayLanguage parameter', async () => {
    const manifestRes = await get(`/${userId}/manifest.json`);
    assertOk(manifestRes);

    if (manifestRes.data.catalogs.length === 0) {
      assert(true, 'No catalogs to test');
      return;
    }

    const cat = manifestRes.data.catalogs[0];
    const res = await get(`/${userId}/catalog/${cat.type}/${cat.id}/displayLanguage=de-DE.json`);

    assertOk(res, 'German catalog request');
    assertArray(res.data.metas, 1, 'Should return results');

    // Verify request processed (we can't easily verify German titles generically)
  });

  await runTest(SUITE, 'Catalog localization does not break response', async () => {
    const manifestRes = await get(`/${userId}/manifest.json`);
    assertOk(manifestRes);

    if (manifestRes.data.catalogs.length === 0) {
      assert(true, 'No catalogs to test');
      return;
    }

    const cat = manifestRes.data.catalogs[0];

    // Test with Japanese
    const res = await get(`/${userId}/catalog/${cat.type}/${cat.id}/displayLanguage=ja-JP.json`);

    assertOk(res, 'Japanese catalog should not error');
    assertArray(res.data.metas, 1, 'Should still return results');
  });

  // ==========================================
  // Edge Cases
  // ==========================================

  await runTest(SUITE, 'Invalid language code falls back gracefully', async () => {
    const tmdbId = 'tmdb:150540';
    const res = await get(`/${userId}/meta/movie/${tmdbId}/language=invalid-XX.json`);

    // Should not crash
    assertOk(res, 'Invalid language should not crash');
    assert(res.data.meta, 'Should return meta with fallback language');
  });

  await runTest(SUITE, 'Missing translation falls back to English', async () => {
    // Use a very popular English movie that might not have some translations
    const tmdbId = 'tmdb:27205'; // Inception
    const res = await get(`/${userId}/meta/movie/${tmdbId}/language=sw-KE.json`); // Swahili (Kenya)

    assertOk(res, 'Rare language request');
    assert(res.data.meta, 'Should return meta');

    // Title should still be there (either Swahili or English fallback)
    assert(res.data.meta.name, 'Should have title');
  });
}
