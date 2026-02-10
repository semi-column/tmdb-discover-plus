import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as tmdb from './tmdb.js';
import { normalizeGenreName, parseIdArray } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';
import { getApiKeyFromConfig, updateCatalogGenres } from './configService.js';

const log = createLogger('manifestService');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADDON_VARIANT = process.env.ADDON_VARIANT || '';
const ADDON_ID = ADDON_VARIANT
  ? `community.tmdb.discover.plus.${ADDON_VARIANT}`
  : 'community.tmdb.discover.plus';
const ADDON_NAME = 'TMDB Discover+';
const ADDON_DESCRIPTION = 'Create custom movie and TV catalogs with powerful TMDB filters';
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
const ADDON_VERSION = pkg.version;
const TMDB_PAGE_SIZE = 20;

/**
 * Build base Stremio manifest for a user
 * @param {Object} userConfig
 * @param {string} baseUrl
 * @returns {Object}
 */
export function buildManifest(userConfig, baseUrl) {
  const resolvedBaseUrl = process.env.BASE_URL || baseUrl;
  const catalogs = (userConfig?.catalogs || [])
    .filter((c) => c.enabled !== false)
    .map((catalog) => ({
      id: `tmdb-${catalog._id || catalog.name.toLowerCase().replace(/\s+/g, '-')}`,
      type: catalog.type === 'series' ? 'series' : 'movie',
      name: catalog.name,
      pageSize: TMDB_PAGE_SIZE,
      extra: [{ name: 'skip' }],
    }));

  if (userConfig?.preferences?.disableSearch !== true) {
    catalogs.push({
      id: 'tmdb-search-movie',
      type: 'movie',
      name: 'TMDB Search',
      extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
    });
    catalogs.push({
      id: 'tmdb-search-series',
      type: 'series',
      name: 'TMDB Search',
      extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
    });
  }

  return {
    id: ADDON_ID,
    name: ADDON_NAME,
    description: ADDON_DESCRIPTION,
    version: ADDON_VERSION,
    logo: `${resolvedBaseUrl.replace(/\/$/, '')}/logo.png`,
    idPrefixes: ['tmdb:', 'tt'],
    resources: ['catalog', 'meta'],
    types: ['movie', 'series'],
    catalogs,
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
      newEpisodeNotifications: true,
    },
  };
}

/**
 * Enrich manifest catalogs with genre options
 * @param {Object} manifest
 * @param {Object} config
 */
export async function enrichManifestWithGenres(manifest, config) {
  if (!manifest.catalogs || !Array.isArray(manifest.catalogs) || !config) return;

  await Promise.all(
    manifest.catalogs.map(async (catalog) => {
      try {
        // Skip genre enrichment for dedicated search catalogs
        if (catalog.id.startsWith('tmdb-search-')) return;

        const helperType = catalog.type === 'series' ? 'series' : 'movie';
        const staticKey = catalog.type === 'series' ? 'tv' : 'movie';

        let idToName = {};
        let fullNames = null;

        // Try fetching live genres first
        try {
          if (config.tmdbApiKey) {
            const live = await tmdb.getGenres(config.tmdbApiKey, helperType);
            if (Array.isArray(live) && live.length > 0) {
              live.forEach((g) => {
                idToName[String(g.id)] = g.name;
              });
              fullNames = live.map((g) => g.name);
            }
          }
        } catch (err) {
          // Fallback to static
        }

        // Fallback to static JSON if needed
        if (!fullNames) {
          try {
            const genresPath = path.join(__dirname, 'tmdb_genres.json');
            const raw = fs.readFileSync(genresPath, 'utf8');
            const staticGenreMap = JSON.parse(raw);
            const mapping = staticGenreMap[staticKey] || {};
            Object.entries(mapping).forEach(([id, name]) => {
              idToName[String(id)] = name;
            });
            fullNames = Object.values(mapping || {});
          } catch (err) {
            idToName = {};
            fullNames = null;
          }
        }

        let isDiscoverOnly = false;
        let options = null;
        let healedFixes = null;

        try {
          const savedCatalog = (config.catalogs || []).find((c) => {
            const idFromStored = `tmdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
            const idFromIdOnly = `tmdb-${String(c._id)}`;
            return idFromStored === catalog.id || idFromIdOnly === catalog.id;
          });

          if (savedCatalog) {
            isDiscoverOnly = savedCatalog.filters?.discoverOnly === true;
          }

          if (savedCatalog && savedCatalog.filters) {
            const selected = parseIdArray(savedCatalog.filters.genres);
            const excluded = parseIdArray(savedCatalog.filters.excludeGenres);

            if (selected.length > 0) {
              // Try mapping with available names
              options = selected.map((gid) => idToName[String(gid)]).filter(Boolean);

              // If mapping failed, try self-healing
              if (options.length === 0) {
                log.info('Genre mapping failed, attempting self-healing', {
                  catalogId: catalog.id,
                });

                const apiKey = getApiKeyFromConfig(config);
                if (apiKey) {
                  try {
                    const freshGenres = await tmdb.getGenres(apiKey, helperType);
                    if (Array.isArray(freshGenres) && freshGenres.length > 0) {
                      const freshMap = {};
                      freshGenres.forEach((g) => (freshMap[String(g.id)] = g.name));

                      // Retry mapping with fresh data
                      const healedOptions = selected
                        .map((gid) => freshMap[String(gid)])
                        .filter(Boolean);

                      if (healedOptions.length > 0) {
                        options = healedOptions;
                        healedFixes = healedFixes || {};
                        healedFixes[savedCatalog.id] = {
                          genres: selected,
                          genreNames: healedOptions,
                        };
                        log.info('Self-healing successful', {
                          catalogId: catalog.id,
                          genres: healedOptions,
                        });
                      }
                    }
                  } catch (healErr) {
                    log.error('Self-healing failed', { error: healErr.message });
                  }
                }
              }

              // Final check/fallback
              if ((!options || options.length === 0) && fullNames && fullNames.length > 0) {
                const wantedNorm = selected.map((s) => normalizeGenreName(s));
                const matched = fullNames.filter((name) =>
                  wantedNorm.includes(normalizeGenreName(name))
                );
                if (matched.length > 0) {
                  options = matched;
                }
              }

              if (!options || options.length === 0) {
                log.warn('Could not map saved genres after all attempts', {
                  catalogId: catalog.id,
                  selectedCount: selected.length,
                });
              }
            } else if (fullNames && fullNames.length > 0) {
              if (excluded.length > 0) {
                const excludeNames = excluded.map((gid) => idToName[String(gid)]).filter(Boolean);
                const excludeSet = new Set(excludeNames);
                options = fullNames.filter((name) => !excludeSet.has(name));
              } else {
                options = fullNames;
              }
            }
          } else if (fullNames && fullNames.length > 0) {
            options = fullNames;
          }
        } catch (err) {
          options = null;
        }

        // Persist fixes if any
        if (healedFixes) {
          updateCatalogGenres(config.userId, healedFixes).catch((e) =>
            log.error('Failed to persist healed genres', { error: e.message })
          );
        }

        if (options && options.length > 0) {
          // If discoverOnly is enabled, we MUST have a genre selected (isRequired=true).
          // To allow the user to see "everything" (default view), we explicitly add "All".
          // The addon.js handler gracefully ignores "All" as it doesn't match a TMDB genre ID.
          // Sort genres alphabetically for better UX
          const sortedOptions = [...options].sort((a, b) => a.localeCompare(b));

          if (isDiscoverOnly) {
            sortedOptions.unshift('All');
          }

          catalog.extra = catalog.extra || [];
          catalog.extra = catalog.extra.filter((e) => e.name !== 'genre');

          // If discoverOnly is true, marking 'genre' as required hides it from the Board
          // because the Board does not provide required filters.
          catalog.extra.push({
            name: 'genre',
            options: sortedOptions,
            optionsLimit: 1,
            isRequired: isDiscoverOnly,
          });
        }
      } catch (err) {
        log.warn('Error injecting genre options into manifest catalog', { error: err.message });
      }
    })
  );
}
