import { Router } from 'express';
import { getUserConfig } from '../services/userConfig.js';
import * as tmdb from '../services/tmdb.js';
import { shuffleArray, getBaseUrl, normalizeGenreName, parseIdArray } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('addon');

const router = Router();

const ADDON_ID = 'community.tmdb.discover.plus';
const ADDON_NAME = 'TMDB Discover+';
const ADDON_DESCRIPTION = 'Create custom movie and TV catalogs with powerful TMDB filters';
const ADDON_VERSION = '2.1.0';

/**
 * Resolve dynamic date presets to actual dates.
 * @param {Object} filters
 * @param {string} type
 * @returns {Object}
 */
function resolveDynamicDatePreset(filters, type) {
  if (!filters?.datePreset) {
    return filters;
  }

  const resolved = { ...filters };
  const today = new Date();
  const formatDate = (d) => d.toISOString().split('T')[0];
  const isMovie = type === 'movie';
  const fromField = isMovie ? 'releaseDateFrom' : 'airDateFrom';
  const toField = isMovie ? 'releaseDateTo' : 'airDateTo';

  switch (filters.datePreset) {
    case 'last_30_days': {
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);
      resolved[fromField] = formatDate(thirtyDaysAgo);
      resolved[toField] = formatDate(today);
      break;
    }
    case 'last_90_days': {
      const ninetyDaysAgo = new Date(today);
      ninetyDaysAgo.setDate(today.getDate() - 90);
      resolved[fromField] = formatDate(ninetyDaysAgo);
      resolved[toField] = formatDate(today);
      break;
    }
    case 'last_180_days': {
      const sixMonthsAgo = new Date(today);
      sixMonthsAgo.setDate(today.getDate() - 180);
      resolved[fromField] = formatDate(sixMonthsAgo);
      resolved[toField] = formatDate(today);
      break;
    }
    case 'this_year': {
      const startOfYear = new Date(today.getFullYear(), 0, 1);
      resolved[fromField] = formatDate(startOfYear);
      resolved[toField] = formatDate(today);
      break;
    }
    case 'last_year': {
      const lastYear = today.getFullYear() - 1;
      resolved[fromField] = `${lastYear}-01-01`;
      resolved[toField] = `${lastYear}-12-31`;
      break;
    }
    case 'upcoming': {
      if (isMovie) {
        const sixMonthsLater = new Date(today);
        sixMonthsLater.setMonth(today.getMonth() + 6);
        resolved[fromField] = formatDate(today);
        resolved[toField] = formatDate(sixMonthsLater);
      }
      break;
    }
    default:
      log.debug('Unknown date preset', { preset: filters.datePreset });
  }

  delete resolved.datePreset;

  log.debug('Resolved dynamic date preset', { 
    preset: filters.datePreset, 
    from: resolved[fromField], 
    to: resolved[toField] 
  });

  return resolved;
}

/** TMDB list page size */
const TMDB_PAGE_SIZE = 20;

/**
 * Build Stremio manifest for a user
 */
function buildManifest(userConfig, baseUrl) {
  const catalogs = (userConfig?.catalogs || [])
    .filter(c => c.enabled !== false)
    .map(catalog => ({
      id: `tmdb-${catalog._id || catalog.name.toLowerCase().replace(/\s+/g, '-')}`,
      type: catalog.type === 'series' ? 'series' : 'movie',
      name: catalog.name,
      pageSize: TMDB_PAGE_SIZE,
      extra: [ { name: 'skip' }, { name: 'search' } ],
    }));

  return {
    id: ADDON_ID,
    name: ADDON_NAME,
    description: ADDON_DESCRIPTION,
    version: ADDON_VERSION,
    logo: `${baseUrl.replace(/^http:/, 'https:')}/logo.png`,
    resources: ['catalog', 'meta'],
    types: ['movie', 'series'],
    catalogs,
    // We return IMDB IDs when available (tt...), and fallback to tmdb:{id}.
    // Include both so Stremio can route meta requests correctly.
    idPrefixes: ['tmdb-', 'tmdb:', 'tt'],
    behaviorHints: {
      configurable: true,
    },
    config: [
      {
        key: 'tmdbApiKey',
        type: 'password',
        title: 'TMDB API Key',
        default: '',
        required: false
      }
    ],
  };
}

function pickPreferredMetaLanguage(config) {
  const pref = config?.preferences?.defaultLanguage;
  if (pref) return pref;

  const enabled = (config?.catalogs || []).filter(c => c?.enabled !== false);
  const langs = enabled
    .map(c => c?.filters?.displayLanguage)
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

    if (manifest.catalogs && Array.isArray(manifest.catalogs) && config) {
        await Promise.all(manifest.catalogs.map(async (catalog) => {
          try {
            const helperType = catalog.type === 'series' ? 'series' : 'movie';
            const staticKey = catalog.type === 'series' ? 'tv' : 'movie';

            let idToName = {};
            let fullNames = null;
            try {
              if (config.tmdbApiKey) {
                const live = await tmdb.getGenres(config.tmdbApiKey, helperType);
                if (Array.isArray(live) && live.length > 0) {
                  live.forEach(g => { idToName[String(g.id)] = g.name; });
                  fullNames = live.map(g => g.name);
                }
              }
            } catch (err) {
              idToName = {};
              fullNames = null;
            }

            if (!fullNames) {
              try {
                const genresPath = path.join(__dirname, '..', 'services', 'tmdb_genres.json');
                const raw = fs.readFileSync(genresPath, 'utf8');
                const staticGenreMap = JSON.parse(raw);
                const mapping = staticGenreMap[staticKey] || {};
                Object.entries(mapping).forEach(([id, name]) => { idToName[String(id)] = name; });
                fullNames = Object.values(mapping || {});
              } catch (err) {
                idToName = {};
                fullNames = null;
              }
            }

            let options = null;
            try {
              const savedCatalog = (config.catalogs || []).find(c => {
                const idFromStored = `tmdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
                const idFromIdOnly = `tmdb-${String(c._id)}`;
                const nameMatch = c.name && catalog.name && c.name.toLowerCase() === catalog.name.toLowerCase();
                return idFromStored === catalog.id || idFromIdOnly === catalog.id || nameMatch;
              });

              const parseIdArray = (val) => {
                if (!val) return [];
                if (Array.isArray(val)) return val.map(String).filter(Boolean);
                return String(val).split(',').map(s => s.trim()).filter(Boolean);
              };

              if (savedCatalog && savedCatalog.filters) {
                const selected = parseIdArray(savedCatalog.filters.genres);
                const excluded = parseIdArray(savedCatalog.filters.excludeGenres);

                if (selected.length > 0) {
                  options = selected.map(gid => idToName[String(gid)]).filter(Boolean);
                  if ((options.length === 0) && fullNames && fullNames.length > 0) {
                    const wantedNorm = selected.map(s => normalizeGenreName(s));
                    const matched = fullNames.filter(name => wantedNorm.includes(normalizeGenreName(name)));
                    if (matched.length > 0) {
                      options = matched;
                    }
                  }

                  if (!options || options.length === 0) {
                    log.warn('Could not map saved genres', { catalogId: catalog.id, selectedCount: selected.length });
                  }
                } else if (fullNames && fullNames.length > 0) {
                  if (excluded.length > 0) {
                    const excludeNames = excluded.map(gid => idToName[String(gid)]).filter(Boolean);
                    const excludeSet = new Set(excludeNames);
                    options = fullNames.filter(name => !excludeSet.has(name));
                  } else {
                    options = fullNames;
                  }
                }
              } else {
                if (fullNames && fullNames.length > 0) options = fullNames;
              }
            } catch (err) {
              options = null;
            }

            if (options && options.length > 0) {
              catalog.extra = catalog.extra || [];
              catalog.extra = catalog.extra.filter(e => e.name !== 'genre');
              catalog.extra.push({ name: 'genre', options, optionsLimit: 1 });
            }
          } catch (err) {
            log.warn('Error injecting genre options into manifest catalog', { error: err.message });
          }
        }));
    }

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
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
    : (Array.isArray(item?.genres) ? item.genres.map(g => g?.id).filter(Boolean) : []);
  return ids.map(String);
}

function applyGenrePostFilter(items, filters) {
  const include = parseIdArray(filters?.genres);
  const exclude = parseIdArray(filters?.excludeGenres);
  const matchMode = (filters?.genreMatchMode === 'all') ? 'all' : 'any';

  if (include.length === 0 && exclude.length === 0) return items;

  const includeSet = new Set(include.map(String));
  const excludeSet = new Set(exclude.map(String));

  return (items || []).filter(item => {
    const itemIds = extractGenreIds(item);

    if (excludeSet.size > 0) {
      for (const gid of itemIds) {
        if (excludeSet.has(String(gid))) return false;
      }
    }

    if (includeSet.size > 0) {
      if (matchMode === 'all') {
        for (const gid of includeSet) {
          if (!itemIds.includes(String(gid))) return false;
        }
        return true;
      }

      for (const gid of itemIds) {
        if (includeSet.has(String(gid))) return true;
      }
      return false;
    }

    return true;
  });
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

    const catalogConfig = config.catalogs.find(c => {
      const id = `tmdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
      return id === catalogId;
    });

    if (!catalogConfig) {
      log.debug('Catalog not found', { catalogId });
      return res.json({ metas: [] });
    }

    let result = null;

    const effectiveFilters = { ...(catalogConfig.filters || {}) };

    if (extra.genre) {
      try {
        const selected = String(extra.genre).split(',').map(s => normalizeGenreName(s)).filter(Boolean);
        const mediaType = type === 'series' ? 'tv' : 'movie';

        let tmdbGenres = null;
        try {
          tmdbGenres = await tmdb.getGenres(config.tmdbApiKey, type);
        } catch (err) {
          tmdbGenres = null;
        }

        const reverse = {};

        if (tmdbGenres && Array.isArray(tmdbGenres)) {
          tmdbGenres.forEach(g => {
            reverse[normalizeGenreName(g.name)] = String(g.id);
          });
        } else {
          try {
            const genresPath = path.join(process.cwd(), 'server', 'src', 'services', 'tmdb_genres.json');
            const raw = fs.readFileSync(genresPath, 'utf8');
            const staticGenreMap = JSON.parse(raw);
            const mapping = staticGenreMap[mediaType] || {};
            Object.entries(mapping).forEach(([id, name]) => {
              reverse[normalizeGenreName(name)] = String(id);
            });
          } catch (err) {
            log.warn('Could not load static genres for mapping extra.genre', { error: err.message });
          }
        }

        let genreIds = selected.map(name => reverse[name]).filter(Boolean);

        if (genreIds.length === 0 && Object.keys(reverse).length > 0) {
          const fuzzyMatches = [];
          for (const sel of selected) {
            let found = null;
            if (reverse[sel]) found = reverse[sel];

            if (!found) {
              for (const k of Object.keys(reverse)) {
                if (k.includes(sel) || sel.includes(k)) { found = reverse[k]; break; }
              }
            }

            if (!found) {
              const parts = sel.split(' ').filter(Boolean);
              if (parts.length > 0) {
                for (const k of Object.keys(reverse)) {
                  const hasAll = parts.every(p => k.includes(p));
                  if (hasAll) { found = reverse[k]; break; }
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
    const isRandomSort = (resolvedFilters?.sortBy || catalogConfig.filters?.sortBy) === 'random';

    if (search) {
      result = await tmdb.search(config.tmdbApiKey, search, type, page, {
        displayLanguage: resolvedFilters?.displayLanguage || catalogConfig.filters?.displayLanguage,
      });
    } else {
      if (listType && listType !== 'discover') {
        result = await tmdb.fetchSpecialList(config.tmdbApiKey, listType, type, {
          page,
          displayLanguage: resolvedFilters?.displayLanguage || catalogConfig.filters?.displayLanguage,
          language: resolvedFilters?.language || catalogConfig.filters?.language,
          region: resolvedFilters?.originCountry || catalogConfig.filters?.originCountry,
        });
      } else if (isRandomSort) {
        const discoverResult = await tmdb.discover(config.tmdbApiKey, {
          type,
          ...resolvedFilters,
          sortBy: 'popularity.desc',
          page: 1,
        });
        const maxPage = Math.min(discoverResult.total_pages || 1, 500);
        const randomPage = Math.floor(Math.random() * maxPage) + 1;
        
        result = await tmdb.discover(config.tmdbApiKey, {
          type,
          ...resolvedFilters,
          sortBy: 'popularity.desc',
          page: randomPage,
        });
        if (result?.results) {
          result.results = shuffleArray(result.results);
        }
      } else {
        result = await tmdb.discover(config.tmdbApiKey, {
          type,
          ...resolvedFilters,
          page,
        });
      }
    }

    const needsGenrePostFilter = !!search || (listType && listType !== 'discover');
    const rawItems = result?.results || [];
    const allItems = needsGenrePostFilter ? applyGenrePostFilter(rawItems, resolvedFilters) : rawItems;

    const metas = await Promise.all(
      allItems.map(async (item) => {
        let imdbId = null;
        
        const externalIds = await tmdb.getExternalIds(config.tmdbApiKey, item.id, type);
        imdbId = externalIds?.imdb_id || null;

        if (catalogConfig.filters?.imdbOnly && !imdbId) {
          return null;
        }

        return tmdb.toStremioMeta(item, type, imdbId);
      })
    );

    const filteredMetas = metas.filter(m => m !== null);
    
    log.debug('Returning catalog results', { count: filteredMetas.length, page, skip });

    res.json({
      metas: filteredMetas,
      cacheMaxAge: 300,
      staleRevalidate: 600,
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

    const apiKey = config.tmdbApiKey;
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
