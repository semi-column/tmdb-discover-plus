import { Router } from 'express';
import {
  getUserConfig,
  getApiKeyFromConfig,
  getPosterKeyFromConfig,
} from '../services/configService.js';
import * as tmdb from '../services/tmdb.js';
import { shuffleArray, getBaseUrl, normalizeGenreName, parseIdArray } from '../utils/helpers.js';
import { resolveDynamicDatePreset } from '../utils/dateHelpers.js';
import { createLogger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { addonRateLimit } from '../utils/rateLimit.js';

const log = createLogger('addon');

const router = Router();
router.use(addonRateLimit);

import { buildManifest, enrichManifestWithGenres } from '../services/manifestService.js';

const TMDB_PAGE_SIZE = 20;

function pickPreferredMetaLanguage(config) {
  return config?.preferences?.defaultLanguage || 'en';
}

router.get('/:userId/manifest.json', async (req, res) => {
  try {
    const { userId } = req.params;
    const config = await getUserConfig(userId);
    const baseUrl = getBaseUrl(req);

    const manifest = buildManifest(config || {}, baseUrl);

    if (config) {
      await enrichManifestWithGenres(manifest, config);

      if (config.preferences?.shuffleCatalogs) {
        manifest.catalogs = shuffleArray(manifest.catalogs);
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
      } else {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
      }
    }

    if (!res.headersSent) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }

    res.json(manifest);
  } catch (error) {
    log.error('Manifest error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

function parseExtra(extraString) {
  const params = {};
  if (!extraString) return params;

  const parts = extraString.split('&');
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key && value !== undefined) {
      params[key] = decodeURIComponent(value);
    }
  }
  return params;
}

function extractGenreIds(item) {
  const ids = Array.isArray(item?.genre_ids)
    ? item.genre_ids
    : Array.isArray(item?.genres)
      ? item.genres.map((g) => g?.id).filter(Boolean)
      : [];
  return ids.map(String);
}

async function handleCatalogRequest(req, res, userId, type, catalogId, extra) {
  try {
    const baseUrl = getBaseUrl(req);
    const skip = parseInt(extra.skip) || 0;
    const search = extra.search || null;

    const page = Math.floor(skip / TMDB_PAGE_SIZE) + 1;

    log.debug('Catalog request', { catalogId, skip, page, extra });

    const config = await getUserConfig(userId);
    if (!config) {
      log.debug('No config found', { userId });
      return res.json({ metas: [] });
    }

    const apiKey = getApiKeyFromConfig(config);
    if (!apiKey) {
      log.debug('No API key found for config', { userId });
      return res.json({ metas: [] });
    }

    // Get poster service configuration
    const posterOptions =
      config.preferences?.posterService && config.preferences.posterService !== 'none'
        ? {
            apiKey: getPosterKeyFromConfig(config),
            service: config.preferences.posterService,
          }
        : null;

    let catalogConfig = config.catalogs.find((c) => {
      const id = `tmdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
      return id === catalogId;
    });

    if (
      !catalogConfig &&
      (catalogId === 'tmdb-search-movie' || catalogId === 'tmdb-search-series')
    ) {
      catalogConfig = {
        name: 'TMDB Search',
        type: catalogId === 'tmdb-search-movie' ? 'movie' : 'series',
        filters: {},
      };
    }

    if (!catalogConfig) {
      log.debug('Catalog not found', { catalogId });
      return res.json({ metas: [] });
    }

    let result = null;

    const effectiveFilters = { ...(catalogConfig.filters || {}) };

    if (extra.genre) {
      try {
        const selected = String(extra.genre)
          .split(',')
          .map((s) => normalizeGenreName(s))
          .filter(Boolean);
        const mediaType = type === 'series' ? 'tv' : 'movie';

        let tmdbGenres = null;
        try {
          tmdbGenres = await tmdb.getGenres(apiKey, type);
        } catch (err) {
          tmdbGenres = null;
        }

        const reverse = {};

        if (tmdbGenres && Array.isArray(tmdbGenres)) {
          tmdbGenres.forEach((g) => {
            reverse[normalizeGenreName(g.name)] = String(g.id);
          });
        } else {
          try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const genresPath = path.resolve(__dirname, '..', 'services', 'tmdb_genres.json');
            const raw = fs.readFileSync(genresPath, 'utf8');
            const staticGenreMap = JSON.parse(raw);
            const mapping = staticGenreMap[mediaType] || {};
            Object.entries(mapping).forEach(([id, name]) => {
              reverse[normalizeGenreName(name)] = String(id);
            });
          } catch (err) {
            log.warn('Could not load static genres for mapping extra.genre', {
              error: err.message,
            });
          }
        }

        let genreIds = selected.map((name) => reverse[name]).filter(Boolean);

        if (genreIds.length === 0 && Object.keys(reverse).length > 0) {
          const fuzzyMatches = [];
          for (const sel of selected) {
            let found = null;
            if (reverse[sel]) found = reverse[sel];

            if (!found) {
              for (const k of Object.keys(reverse)) {
                if (k.includes(sel) || sel.includes(k)) {
                  found = reverse[k];
                  break;
                }
              }
            }

            if (!found) {
              const parts = sel.split(' ').filter(Boolean);
              if (parts.length > 0) {
                for (const k of Object.keys(reverse)) {
                  const hasAll = parts.every((p) => k.includes(p));
                  if (hasAll) {
                    found = reverse[k];
                    break;
                  }
                }
              }
            }

            if (found) {
              fuzzyMatches.push({ selected: sel, matchedId: found });
              genreIds.push(found);
            }
          }
          if (fuzzyMatches.length > 0) {
            log.debug('Fuzzy genre matches applied', { count: fuzzyMatches.length });
          }
        }

        if (genreIds.length > 0) {
          effectiveFilters.genres = genreIds;
          log.debug('Genre filter applied', { userId, catalogId, genreCount: genreIds.length });
        } else {
          log.debug('No genre mapping found, using stored filters', { selected });
        }
      } catch (err) {
        log.warn('Error mapping extra.genre to IDs', { error: err.message });
      }
    }

    const resolvedFilters = resolveDynamicDatePreset(effectiveFilters, type);

    const listType = resolvedFilters?.listType || catalogConfig.filters?.listType;
    const randomize =
      resolvedFilters?.randomize ||
      catalogConfig.filters?.randomize ||
      resolvedFilters?.sortBy === 'random';

    if (search) {
      // 1. Standard content search
      const contentPromise = tmdb.search(apiKey, search, type, page, {
        displayLanguage: config.preferences?.defaultLanguage,
      });

      // 2. Person search (only on first page to prioritize best matches)
      const personPromise =
        page === 1
          ? tmdb.searchPerson(apiKey, search, config.preferences?.defaultLanguage)
          : Promise.resolve([]);

      const [contentResults, personResults] = await Promise.all([contentPromise, personPromise]);

      let finalResults = contentResults.results || [];

      // 3. If people found, fetch their credits and merge
      if (personResults && personResults.length > 0) {
        // Use the top match
        const topPerson = personResults[0];

        try {
          const credits = await tmdb.getPersonCredits(
            apiKey,
            topPerson.id,
            type,
            config.preferences?.defaultLanguage
          );

          let works = [];

          // Add cast works
          if (credits.cast) {
            works = works.concat(credits.cast);
          }

          // Add crew works (Director, etc.)
          if (credits.crew) {
            const importantJobs = [
              'Director',
              'Screenplay',
              'Writer',
              'Creator',
              'Executive Producer',
            ];
            const crewWorks = credits.crew.filter((w) => importantJobs.includes(w.job));
            works = works.concat(crewWorks);
          }

          // Deduplicate works
          const seenIds = new Set();
          const uniqueWorks = [];
          works.forEach((w) => {
            if (!seenIds.has(w.id)) {
              seenIds.add(w.id);
              uniqueWorks.push(w);
            }
          });

          // Sort by popularity
          uniqueWorks.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

          // Merge with content results (avoiding duplicates)
          const contentIds = new Set(finalResults.map((i) => i.id));
          const newWorks = uniqueWorks.filter((w) => !contentIds.has(w.id));

          // Prepend person's works to the results
          finalResults = [...newWorks, ...finalResults];

          log.debug('Enriched search with person credits', {
            person: topPerson.name,
            worksAdded: newWorks.length,
          });
        } catch (err) {
          log.warn('Failed to fetch person credits', { error: err.message });
        }
      }

      result = {
        ...contentResults,
        results: finalResults,
      };
    } else {
      if (listType && listType !== 'discover') {
        result = await tmdb.fetchSpecialList(apiKey, listType, type, {
          page,
          displayLanguage: config.preferences?.defaultLanguage,
          language: resolvedFilters?.language || catalogConfig.filters?.language,
          region: resolvedFilters?.originCountry || catalogConfig.filters?.originCountry,
          randomize,
        });
      } else {
        result = await tmdb.discover(apiKey, {
          type,
          ...resolvedFilters,
          displayLanguage: config.preferences?.defaultLanguage,
          page,
          randomize,
        });
      }
    }

    const allItems = result?.results || [];

    try {
      await tmdb.enrichItemsWithImdbIds(apiKey, allItems, type);
    } catch (e) {
      log.warn('IMDb enrichment failed (continuing with TMDB IDs)', { error: e.message });
    }

    const displayLanguage = config.preferences?.defaultLanguage || 'en';
    let genreMap = null;

    if (allItems.length > 0 && displayLanguage && displayLanguage !== 'en') {
      try {
        const localizedGenres = await tmdb.getGenres(apiKey, type, displayLanguage);
        if (Array.isArray(localizedGenres)) {
          genreMap = {};
          localizedGenres.forEach((g) => {
            genreMap[String(g.id)] = g.name;
          });
        }
      } catch (err) {
        log.warn('Failed to fetch localized genres for catalog', {
          catalogId,
          displayLanguage,
          error: err.message,
        });
      }
    }

    // Parallel fetch for certifications and runtime to ensure immediate display
    const enrichedData = {};
    if (allItems.length > 0) {
      try {
        // Default country mapping for common languages when no region is provided
        const LANGUAGE_TO_COUNTRY = {
          // Europe
          it: 'IT',
          fr: 'FR',
          de: 'DE',
          es: 'ES',
          pt: 'PT',
          nl: 'NL',
          pl: 'PL',
          ru: 'RU',
          uk: 'UA',
          tr: 'TR',
          el: 'GR',
          sv: 'SE',
          da: 'DK',
          fi: 'FI',
          no: 'NO',
          cs: 'CZ',
          hu: 'HU',
          ro: 'RO',
          bg: 'BG',
          sk: 'SK',
          hr: 'HR',
          sr: 'RS',
          sl: 'SI',
          et: 'EE',
          lv: 'LV',
          lt: 'LT',

          // Asia
          ja: 'JP',
          ko: 'KR',
          zh: 'CN',
          hi: 'IN',
          th: 'TH',
          id: 'ID',
          vi: 'VN',
          ms: 'MY',
          tl: 'PH',

          // Middle East
          he: 'IL',
          ar: 'SA',
          fa: 'IR',

          // Americas (defaulting es/pt to Spain/Portugal, but listing defaults if needed)
          // en defaults to US via fallback logic below
        };

        // Determine country from config or default to US
        // We can't easily get the user's IP-based country here, so we rely on config or default
        let countryCode = 'US';

        if (displayLanguage) {
          if (displayLanguage.includes('-')) {
            countryCode = displayLanguage.split('-')[1];
          } else if (LANGUAGE_TO_COUNTRY[displayLanguage]) {
            countryCode = LANGUAGE_TO_COUNTRY[displayLanguage];
          }
        }

        const targetCountry = countryCode;

        // Use chunks to avoid rate limiting or timeouts
        const CHUNK_SIZE = 5;
        for (let i = 0; i < allItems.length; i += CHUNK_SIZE) {
          const chunk = allItems.slice(i, i + CHUNK_SIZE);
          await Promise.all(
            chunk.map(async (item) => {
              try {
                const data = await tmdb.getEnrichedData(
                  apiKey,
                  item,
                  type,
                  targetCountry,
                  displayLanguage
                );
                if (data) {
                  enrichedData[item.id] = data;
                  if (data.cast && data.cast.length > 0) {
                    // log.debug('Enrichment success', { id: item.id, cast: data.cast.length });
                  } else {
                    log.debug('Enrichment missing cast', {
                      id: item.id,
                      name: item.name || item.title,
                    });
                  }
                }
              } catch (err) {
                // ignore individual errors
              }
            })
          );
        }
      } catch (e) {
        log.warn('Failed to fetch enriched data', { error: e.message });
      }
    }

    const metas = allItems.map((item) => {
      const data = enrichedData[item.id] || {};
      const manifestUrl = `${baseUrl}/${userId}/manifest.json`;
      return tmdb.toStremioMeta(
        item,
        type,
        null,
        posterOptions,
        genreMap,
        data.certification,
        data.runtime,
        data.logo,
        data.yearRange,
        data.cast,
        data.directors,
        displayLanguage,
        manifestUrl,
        catalogId
      );
    });

    const filteredMetas = metas.filter((m) => m !== null);

    if (randomize) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Surrogate-Control', 'no-store');
    } else {
      res.set('Cache-Control', 'max-age=300, stale-while-revalidate=600');
    }

    log.debug('Returning catalog results', {
      count: filteredMetas.length,
      page,
      skip,
      randomize,
      cacheHeader: res.get('Cache-Control'),
    });

    res.json({
      metas: filteredMetas,
      cacheMaxAge: randomize ? 0 : 300,
      staleRevalidate: randomize ? 0 : 600,
    });
  } catch (error) {
    log.error('Catalog error', { error: error.message });
    res.json({ metas: [] });
  }
}

async function handleMetaRequest(userId, type, id, extra, res, req) {
  try {
    const config = await getUserConfig(userId);
    if (!config) return res.json({ meta: {} });

    const apiKey = getApiKeyFromConfig(config);
    if (!apiKey) return res.json({ meta: {} });

    // Get poster service configuration
    const posterOptions =
      config.preferences?.posterService && config.preferences.posterService !== 'none'
        ? {
            apiKey: getPosterKeyFromConfig(config),
            service: config.preferences.posterService,
          }
        : null;

    const requestedId = String(id || '');
    const configuredLanguage = pickPreferredMetaLanguage(config);
    const language = extra?.displayLanguage || configuredLanguage || extra?.language || 'en';

    log.info('Meta language resolution', {
      configured: configuredLanguage,
      extraDisplay: extra?.displayLanguage,
      extraLang: extra?.language,
      final: language,
    });

    let tmdbId = null;
    let imdbId = null;

    if (/^tt\d+/i.test(requestedId)) {
      imdbId = requestedId;
      const found = await tmdb.findByImdbId(apiKey, imdbId, type, { language });
      tmdbId = found?.tmdbId || null;
    } else if (requestedId.startsWith('tmdb:')) {
      tmdbId = Number(requestedId.replace('tmdb:', ''));
    } else if (/^\d+$/.test(requestedId)) {
      tmdbId = Number(requestedId);
    }

    if (!tmdbId) return res.json({ meta: {} });

    const details = await tmdb.getDetails(apiKey, tmdbId, type, { language });
    const detailsImdb = details?.external_ids?.imdb_id || null;
    imdbId = imdbId || detailsImdb;

    let videos = null;
    if (type === 'series') {
      videos = await tmdb.getSeriesEpisodes(apiKey, tmdbId, details, { language });
      log.debug('Fetched series episodes', { tmdbId, episodeCount: videos?.length || 0 });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const manifestUrl = `${baseUrl}/${userId}/manifest.json`;

    // Find a valid catalog ID to use for genre links
    // We prefer the first enabled catalog of the same type
    let catalogId = 'tmdb.top';
    if (config.catalogs && Array.isArray(config.catalogs)) {
      const validCatalog = config.catalogs.find((c) => c.type === type && c.enabled !== false);
      if (validCatalog) {
        // Replicate manifest ID generation logic
        catalogId = `tmdb-${validCatalog._id || validCatalog.name.toLowerCase().replace(/\s+/g, '-')}`;
      }
    }

    const meta = await tmdb.toStremioFullMeta(
      details,
      type,
      imdbId,
      requestedId,
      posterOptions,
      videos,
      language,
      manifestUrl,
      catalogId
    );

    res.json({
      meta,
      cacheMaxAge: 3600,
      staleRevalidate: 86400,
      staleError: 86400,
    });
  } catch (error) {
    log.error('Meta error', { error: error.message });
    res.json({ meta: {} });
  }
}

router.get('/:userId/meta/:type/:id/:extra.json', async (req, res) => {
  const { userId, type, id } = req.params;
  const original = req.originalUrl || req.url || '';
  let rawExtra = req.params.extra || '';
  try {
    const splitMarker = `/${id}/`;
    const parts = original.split(splitMarker);
    if (parts.length > 1) {
      let after = parts[1];
      const qIdx = after.indexOf('?');
      if (qIdx !== -1) after = after.substring(0, qIdx);
      const jsonIdx = after.indexOf('.json');
      if (jsonIdx !== -1) after = after.substring(0, jsonIdx);
      rawExtra = after;
    }
  } catch {
    rawExtra = req.params.extra || '';
  }

  const extraParams = parseExtra(rawExtra);
  await handleMetaRequest(userId, type, id, extraParams, res, req);
});

router.get('/:userId/meta/:type/:id.json', async (req, res) => {
  const { userId, type, id } = req.params;
  await handleMetaRequest(userId, type, id, { ...req.query }, res, req);
});

router.get('/:userId/catalog/:type/:catalogId/:extra.json', async (req, res) => {
  const { userId, type, catalogId } = req.params;
  const original = req.originalUrl || req.url || '';
  let rawExtra = req.params.extra || '';
  try {
    const splitMarker = `/${catalogId}/`;
    const parts = original.split(splitMarker);
    if (parts.length > 1) {
      let after = parts[1];
      const qIdx = after.indexOf('?');
      if (qIdx !== -1) after = after.substring(0, qIdx);
      const jsonIdx = after.indexOf('.json');
      if (jsonIdx !== -1) after = after.substring(0, jsonIdx);
      rawExtra = after;
    }
  } catch (err) {
    rawExtra = req.params.extra || '';
  }

  const extraParams = parseExtra(rawExtra);
  await handleCatalogRequest(req, res, userId, type, catalogId, extraParams);
});

router.get('/:userId/catalog/:type/:catalogId.json', async (req, res) => {
  const { userId, type, catalogId } = req.params;
  const extra = {
    skip: req.query.skip || '0',
    search: req.query.search || null,
  };
  await handleCatalogRequest(req, res, userId, type, catalogId, extra);
});

export { router as addonRouter };
