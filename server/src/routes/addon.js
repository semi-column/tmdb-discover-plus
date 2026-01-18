import { Router } from 'express';
import { getUserConfig, getApiKeyFromConfig } from '../services/configService.js';
import * as tmdb from '../services/tmdb.js';
import { shuffleArray, getBaseUrl, normalizeGenreName, parseIdArray } from '../utils/helpers.js';
import { resolveDynamicDatePreset } from '../utils/dateHelpers.js';
import { createLogger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const log = createLogger('addon');

const router = Router();

import { buildManifest, enrichManifestWithGenres } from '../services/manifestService.js';

// Constants
const TMDB_PAGE_SIZE = 20;

function pickPreferredMetaLanguage(config) {
  const pref = config?.preferences?.defaultLanguage;
  if (pref) return pref;

  const enabled = (config?.catalogs || []).filter((c) => c?.enabled !== false);
  const langs = enabled
    .map((c) => c?.filters?.displayLanguage)
    .filter(Boolean)
    .map(String);

  // If user has a single displayLanguage across catalogs, treat that as preference.
  const uniq = Array.from(new Set(langs));
  if (uniq.length === 1) return uniq[0];
  return 'en';
}

router.get('/:userId/manifest.json', async (req, res) => {
  try {
    const { userId } = req.params;
    const config = await getUserConfig(userId);
    const baseUrl = getBaseUrl(req);

    const manifest = buildManifest(config || {}, baseUrl);

    // Enrich catalogs with dynamic genre choices (if applicable)
    if (config) {
      await enrichManifestWithGenres(manifest, config);

      // Shuffle catalogs if enabled in preferences
      if (config.preferences?.shuffleCatalogs) {
        manifest.catalogs = shuffleArray(manifest.catalogs);
        // Force no-store to ensure re-shuffling on reload
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
    
    // Fallback headers if config not loaded (should generally not happen here if resolved)
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

/** Parse extra parameters from Stremio's path format */
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



/**
 * Catalog handler - shared logic for both route formats
 */
async function handleCatalogRequest(userId, type, catalogId, extra, res) {
  try {
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

    let catalogConfig = config.catalogs.find((c) => {
      const id = `tmdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
      return id === catalogId;
    });

    // Handle dedicated search catalogs
    if (!catalogConfig && (catalogId === 'tmdb-search-movie' || catalogId === 'tmdb-search-series')) {
      catalogConfig = {
        name: 'TMDB Search',
        type: catalogId === 'tmdb-search-movie' ? 'movie' : 'series',
        filters: {} // Use defaults
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
    const randomize = resolvedFilters?.randomize || catalogConfig.filters?.randomize || (resolvedFilters?.sortBy === 'random');

    if (search) {
      result = await tmdb.search(apiKey, search, type, page, {
        displayLanguage: resolvedFilters?.displayLanguage || catalogConfig.filters?.displayLanguage,
      });
    } else {
      if (listType && listType !== 'discover') {
        result = await tmdb.fetchSpecialList(apiKey, listType, type, {
          page,
          displayLanguage:
            resolvedFilters?.displayLanguage || catalogConfig.filters?.displayLanguage,
          language: resolvedFilters?.language || catalogConfig.filters?.language,
          region: resolvedFilters?.originCountry || catalogConfig.filters?.originCountry,
          randomize,
        });
      } else {
        result = await tmdb.discover(apiKey, {
          type,
          ...resolvedFilters,
          page,
          randomize,
        });
      }
    }

    const allItems = result?.results || [];

    const metas = allItems.map((item) => {
      // Direct mapping without extra fetching or filtering
      return tmdb.toStremioMeta(item, type, null);
    });

    const filteredMetas = metas.filter((m) => m !== null);

    log.debug('Returning catalog results', { count: filteredMetas.length, page, skip });

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

/**
 * Meta handler
 * Supports both IDs:
 * - IMDB: tt123...
 * - TMDB: tmdb:123
 */
async function handleMetaRequest(userId, type, id, extra, res) {
  try {
    const config = await getUserConfig(userId);
    if (!config) return res.json({ meta: {} });

    const apiKey = getApiKeyFromConfig(config);
    if (!apiKey) return res.json({ meta: {} });

    const requestedId = String(id || '');
    const language = extra?.displayLanguage || extra?.language || pickPreferredMetaLanguage(config);

    let tmdbId = null;
    let imdbId = null;

    if (/^tt\d+/i.test(requestedId)) {
      imdbId = requestedId;
      const found = await tmdb.findByImdbId(apiKey, imdbId, type, { language });
      tmdbId = found?.tmdbId || null;
    } else if (requestedId.startsWith('tmdb:')) {
      tmdbId = Number(requestedId.replace('tmdb:', ''));
    } else if (/^\d+$/.test(requestedId)) {
      // Fallback: allow raw numeric TMDB id
      tmdbId = Number(requestedId);
    }

    if (!tmdbId) return res.json({ meta: {} });

    const details = await tmdb.getDetails(apiKey, tmdbId, type, { language });
    const detailsImdb = details?.external_ids?.imdb_id || null;
    imdbId = imdbId || detailsImdb;

    const meta = tmdb.toStremioFullMeta(details, type, imdbId);

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

// Meta handler with extra args in path
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
  await handleMetaRequest(userId, type, id, extraParams, res);
});

// Meta handler without extra args
router.get('/:userId/meta/:type/:id.json', async (req, res) => {
  const { userId, type, id } = req.params;
  await handleMetaRequest(userId, type, id, { ...req.query }, res);
});

/** Catalog handler with extra params in path */
router.get('/:userId/catalog/:type/:catalogId/:extra.json', async (req, res) => {
  const { userId, type, catalogId } = req.params;
  // Prefer original URL to preserve percent-encoded separators in the extra segment.
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
  await handleCatalogRequest(userId, type, catalogId, extraParams, res);
});

/** Catalog handler without extra params */
router.get('/:userId/catalog/:type/:catalogId.json', async (req, res) => {
  const { userId, type, catalogId } = req.params;
  const extra = {
    skip: req.query.skip || '0',
    search: req.query.search || null,
  };
  await handleCatalogRequest(userId, type, catalogId, extra, res);
});

export { router as addonRouter };
