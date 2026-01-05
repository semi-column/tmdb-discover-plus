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
const ADDON_VERSION = '2.0.0';

/**
 * Resolve dynamic date presets to actual dates.
 * This allows "Last 30 days" to always mean 30 days from NOW, not from when the catalog was created.
 * @param {Object} filters - The filters object containing datePreset
 * @param {string} type - 'movie' or 'series'/'tv'
 * @returns {Object} - Filters with resolved date values
 */
function resolveDynamicDatePreset(filters, type) {
  if (!filters?.datePreset) {
    return filters;
  }

  const resolved = { ...filters };
  const today = new Date();
  const formatDate = (d) => d.toISOString().split('T')[0]; // YYYY-MM-DD

  // Determine which date fields to set based on content type
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
      // Only for movies - next 6 months
      if (isMovie) {
        const sixMonthsLater = new Date(today);
        sixMonthsLater.setMonth(today.getMonth() + 6);
        resolved[fromField] = formatDate(today);
        resolved[toField] = formatDate(sixMonthsLater);
      }
      break;
    }
    default:
      // Unknown preset, leave unchanged
      log.debug('Unknown date preset', { preset: filters.datePreset });
  }

  // Remove datePreset from filters (not needed for TMDB API)
  delete resolved.datePreset;

  log.debug('Resolved dynamic date preset', { 
    preset: filters.datePreset, 
    from: resolved[fromField], 
    to: resolved[toField] 
  });

  return resolved;
}

/**
 * TMDB returns 20 items per page.
/**
 * TMDB returns 20 items per page.
 * This constant is used in the manifest (pageSize) to tell Stremio
 * how many items to expect per page, enabling proper infinite scroll.
 */
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
      // pageSize tells Stremio how many items we return per page
      // This is CRITICAL for pagination - without it, Stremio assumes 100 and stops loading
      pageSize: TMDB_PAGE_SIZE,
      // Match the official TMDB addon format exactly - no isRequired property
      extra: [ { name: 'skip' }, { name: 'search' } ],
    }));

  return {
    id: ADDON_ID,
    name: ADDON_NAME,
    description: ADDON_DESCRIPTION,
    version: ADDON_VERSION,
    // Logo must be absolute HTTPS URL for Stremio clients
    logo: `${baseUrl.replace(/^http:/, 'https:')}/logo.png`,
    resources: ['catalog', 'meta', 'stream', 'subtitles'],
    types: ['movie', 'series'],
    catalogs,
    idPrefixes: ['tmdb-'],
    // Allow Stremio to show a Configure button and provide an auto-generated config page
    behaviorHints: {
      configurable: true,
      // configurationRequired: false // leave false so Install still appears
    },
    // Expose minimal config schema so Stremio will open the auto-generated configuration page
    // This will allow users to set their TMDB API key via Stremio's Configure UI
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


// Manifest route - async because we may fetch genre lists per-catalog
router.get('/:userId/manifest.json', async (req, res) => {
  try {
    const { userId } = req.params;
    const config = await getUserConfig(userId);
    const baseUrl = getBaseUrl(req);

    const manifest = buildManifest(config || {}, baseUrl);

    // Inject per-catalog genre options when possible
    if (manifest.catalogs && Array.isArray(manifest.catalogs) && config) {
        await Promise.all(manifest.catalogs.map(async (catalog) => {
          try {
            // Determine the type the tmdb helper expects ('movie' or 'series')
            const helperType = catalog.type === 'series' ? 'series' : 'movie';
            // And determine the static mapping key which uses TMDB media types ('movie'|'tv')
            const staticKey = catalog.type === 'series' ? 'tv' : 'movie';

            // Build a mapping id -> name (try live TMDB first, fall back to static file)
            let idToName = {};
            let fullNames = null;
            try {
              if (config.tmdbApiKey) {
                // tmdb.getGenres expects 'movie' or 'series' and internally maps 'series' -> 'tv'
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
              // Fallback to static file (resolved relative to this module)
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

            // Build options according to rules:
            // - If user explicitly selected genres for this catalog (filters.genres), send only those
            // - Otherwise start with the full list of genres and remove any excluded ones (filters.excludeGenres)
            // - Always respect media type (movie vs tv)
            let options = null;
            try {
              // Robust matching for saved catalog: try _id-based id, normalized-name id, and plain name match
              const savedCatalog = (config.catalogs || []).find(c => {
                const idFromStored = `tmdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
                const idFromIdOnly = `tmdb-${String(c._id)}`;
                const nameMatch = c.name && catalog.name && c.name.toLowerCase() === catalog.name.toLowerCase();
                return idFromStored === catalog.id || idFromIdOnly === catalog.id || nameMatch;
              });

              // Helper to normalize arrays/csv into string id arrays
              const parseIdArray = (val) => {
                if (!val) return [];
                if (Array.isArray(val)) return val.map(String).filter(Boolean);
                return String(val).split(',').map(s => s.trim()).filter(Boolean);
              };

              if (savedCatalog && savedCatalog.filters) {
                const selected = parseIdArray(savedCatalog.filters.genres);
                const excluded = parseIdArray(savedCatalog.filters.excludeGenres);

                if (selected.length > 0) {
                  // Map selected ids to names (preserve order and filter unknowns)
                  options = selected.map(gid => idToName[String(gid)]).filter(Boolean);
                  // If mapping by id produced no results, maybe the saved values are genre NAMES
                  // Try to match by normalized names against the fullNames list
                  if ((options.length === 0) && fullNames && fullNames.length > 0) {
                    const wantedNorm = selected.map(s => normalizeGenreName(s));
                    const matched = fullNames.filter(name => wantedNorm.includes(normalizeGenreName(name)));
                    if (matched.length > 0) {
                      options = matched;
                    }
                  }

                  // If we still have no options, log a helpful warning for debugging
                  if (!options || options.length === 0) {
                    log.warn('Could not map saved genres', { catalogId: catalog.id, selectedCount: selected.length });
                  }
                } else if (fullNames && fullNames.length > 0) {
                  // Start with full list and remove any excluded genre names
                  if (excluded.length > 0) {
                    const excludeNames = excluded.map(gid => idToName[String(gid)]).filter(Boolean);
                    const excludeSet = new Set(excludeNames);
                    options = fullNames.filter(name => !excludeSet.has(name));
                  } else {
                    options = fullNames;
                  }
                }
              } else {
                // No saved catalog info: fall back to full list
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

    // Prevent caching so per-user manifests update immediately when configuration changes
    // This ensures clients (and any intermediate proxies) always fetch the latest manifest
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(manifest);
  } catch (error) {
    log.error('Manifest error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});
/**
 * Pagination approach: Match the official TMDB addon.
 * 
 * Stremio passes extra parameters in the URL PATH, not query string!
 * Example: /catalog/movie/tmdb-xxx/skip=20.json (NOT ?skip=20)
 * 
 * The official TMDB addon uses: page = Math.floor(skip / 20) + 1
 * They return ~20 items per request (one TMDB page) and Stremio handles
 * infinite scrolling by sending skip=0, skip=20, skip=40, etc.
 * 
 * IMPORTANT: pageSize: 20 in the manifest tells Stremio to expect 20 items.
 * Without this, Stremio assumes 100 items and stops loading after first page.
 */

/**
 * Parse extra parameters from Stremio's path format
 * Example: "skip=20" or "genre=Action&skip=40" or "search=matrix"
 */
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

/**
 * Catalog handler - shared logic for both route formats
 */
async function handleCatalogRequest(userId, type, catalogId, extra, res) {
  try {
    // Parse extra params (skip, search, genre, etc.)
    const skip = parseInt(extra.skip) || 0;
    const search = extra.search || null;

    // Calculate TMDB page from skip
    // skip=0 → page=1, skip=20 → page=2, skip=40 → page=3, etc.
    const page = Math.floor(skip / TMDB_PAGE_SIZE) + 1;
    
    // Debug logging for pagination troubleshooting
    log.debug('Catalog request', { catalogId, skip, page, extra });

    const config = await getUserConfig(userId);
    if (!config) {
      log.debug('No config found', { userId });
      return res.json({ metas: [] });
    }

    // Find the catalog configuration
    const catalogConfig = config.catalogs.find(c => {
      const id = `tmdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
      return id === catalogId;
    });

    if (!catalogConfig) {
      log.debug('Catalog not found', { catalogId });
      return res.json({ metas: [] });
    }

    let result = null;

    // Build request-local effective filters (do not mutate catalogConfig)
    const effectiveFilters = { ...(catalogConfig.filters || {}) };

    // If extra.genre is present (selected in Stremio UI), map to TMDB genre IDs and OVERRIDE stored genres for this request
    if (extra.genre) {
      try {
        const selected = String(extra.genre).split(',').map(s => normalizeGenreName(s)).filter(Boolean);
        const mediaType = type === 'series' ? 'tv' : 'movie';

        // Try to get authoritative list from TMDB using user's API key
        let tmdbGenres = null;
        try {
          // Pass the original 'type' ('series' or 'movie') to tmdb.getGenres so it maps correctly to TMDB's 'tv' or 'movie'.
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
          // Fallback to static file
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

        // First try exact normalized matches
        let genreIds = selected.map(name => reverse[name]).filter(Boolean);

        // If none matched exactly, try tolerant matching (partial/substring/word match)
        if (genreIds.length === 0 && Object.keys(reverse).length > 0) {
          const fuzzyMatches = [];
          for (const sel of selected) {
            let found = null;
            // 1) exact key (already tried but safe)
            if (reverse[sel]) found = reverse[sel];

            // 2) substring match (reverse key contains selected or vice versa)
            if (!found) {
              for (const k of Object.keys(reverse)) {
                if (k.includes(sel) || sel.includes(k)) { found = reverse[k]; break; }
              }
            }

            // 3) all words from selected appear in key (handles ordering/extra words)
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
          // Override only for this request
          effectiveFilters.genres = genreIds;
          log.debug('Genre filter applied', { userId, catalogId, genreCount: genreIds.length });
        } else {
          log.debug('No genre mapping found, using stored filters', { selected });
        }
      } catch (err) {
        log.warn('Error mapping extra.genre to IDs', { error: err.message });
      }
    }

    // Resolve dynamic date presets (e.g., "last_30_days" → actual dates from today)
    const resolvedFilters = resolveDynamicDatePreset(effectiveFilters, type);

    // If search query provided, use search instead of discover
    if (search) {
      result = await tmdb.search(config.tmdbApiKey, search, type, page);
    } else {
      // Check if using a special list type (trending, now playing, etc.)
      const listType = resolvedFilters?.listType || catalogConfig.filters?.listType;
      const isRandomSort = (resolvedFilters?.sortBy || catalogConfig.filters?.sortBy) === 'random';
      
      if (listType && listType !== 'discover') {
        // Use special list endpoint (pass language/region from resolvedFilters falling back to stored filters)
        result = await tmdb.fetchSpecialList(config.tmdbApiKey, listType, type, {
          page,
          language: resolvedFilters?.language || catalogConfig.filters?.language,
          region: resolvedFilters?.originCountry || catalogConfig.filters?.originCountry,
        });
      } else if (isRandomSort) {
        // Random sort - fetch from random starting page and shuffle
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
        // Shuffle the results
        if (result?.results) {
          result.results = shuffleArray(result.results);
        }
      } else {
        // Use discover with all filters
        result = await tmdb.discover(config.tmdbApiKey, {
          type,
          ...resolvedFilters,
          page,
        });
      }
    }

    const allItems = result?.results || [];

    // Convert results to Stremio format with IMDB IDs
    const metas = await Promise.all(
      allItems.map(async (item) => {
        let imdbId = null;
        
        // Fetch IMDB ID
        const externalIds = await tmdb.getExternalIds(config.tmdbApiKey, item.id, type);
        imdbId = externalIds?.imdb_id || null;

        // Skip items without IMDB ID if imdbOnly filter is set
        if (catalogConfig.filters?.imdbOnly && !imdbId) {
          return null;
        }

        return tmdb.toStremioMeta(item, type, imdbId);
      })
    );

    // Filter out nulls
    const filteredMetas = metas.filter(m => m !== null);
    
    // Log pagination results
    log.debug('Returning catalog results', { count: filteredMetas.length, page, skip });

    res.json({
      metas: filteredMetas,
      // Short cache to allow for updates
      cacheMaxAge: 300, // Cache for 5 minutes
      staleRevalidate: 600, // Stale-while-revalidate for 10 minutes
    });
  } catch (error) {
    log.error('Catalog error', { error: error.message });
    res.json({ metas: [] });
  }
}

/**
 * Catalog handler WITH extra params in path (Stremio's format)
 * URL format: /:userId/catalog/:type/:catalogId/:extra.json
 * Example: /userId/catalog/movie/tmdb-xxx/skip=20.json
 */
router.get('/:userId/catalog/:type/:catalogId/:extra.json', async (req, res) => {
  const { userId, type, catalogId } = req.params;
  // Extract the raw (still-percent-encoded) extra segment from the original URL.
  // Express decodes route params which turns %26 into '&' and breaks our simple '&' splitter.
  // Use originalUrl so values containing encoded '&' remain encoded and parseExtra can decode values safely.
  const original = req.originalUrl || req.url || '';
  let rawExtra = req.params.extra || '';
  try {
    const splitMarker = `/${catalogId}/`;
    const parts = original.split(splitMarker);
    if (parts.length > 1) {
      let after = parts[1];
      // Strip any query string
      const qIdx = after.indexOf('?');
      if (qIdx !== -1) after = after.substring(0, qIdx);
      // Strip trailing .json if present
      const jsonIdx = after.indexOf('.json');
      if (jsonIdx !== -1) after = after.substring(0, jsonIdx);
      rawExtra = after;
    }
  } catch (err) {
    // Fall back to decoded param if anything goes wrong
    rawExtra = req.params.extra || '';
  }

  const extraParams = parseExtra(rawExtra);
  await handleCatalogRequest(userId, type, catalogId, extraParams, res);
});

/**
 * Catalog handler WITHOUT extra params (first page / query string fallback)
 * URL format: /:userId/catalog/:type/:catalogId.json
 */
router.get('/:userId/catalog/:type/:catalogId.json', async (req, res) => {
  const { userId, type, catalogId } = req.params;
  // Support query params as fallback (for direct API testing)
  const extra = {
    skip: req.query.skip || '0',
    search: req.query.search || null,
  };
  await handleCatalogRequest(userId, type, catalogId, extra, res);
});

/**
 * Configure redirect - sends user to configuration page
 */
// Note: configure routes are handled centrally in server/src/index.js to ensure
// they are processed before static file serving (avoids returning any stale
// helper HTML that might be present in older builds).

export { router as addonRouter };
