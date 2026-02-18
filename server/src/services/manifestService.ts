import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as tmdb from './tmdb/index.ts';
import { isImdbApiEnabled } from './imdb/index.ts';
import { normalizeGenreName, parseIdArray } from '../utils/helpers.ts';
import { createLogger } from '../utils/logger.ts';
import { getApiKeyFromConfig, updateCatalogGenres } from './configService.ts';
import { config } from '../config.ts';
import type { UserConfig, StremioManifest, ManifestCatalog, TmdbGenre } from '../types/index.ts';

const log = createLogger('manifestService');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADDON_VARIANT = config.addon.variant;
const ADDON_ID = ADDON_VARIANT
  ? `community.tmdb.discover.plus.${ADDON_VARIANT}`
  : 'community.tmdb.discover.plus';
const ADDON_NAME = 'TMDB Discover+';
const ADDON_DESCRIPTION = 'Create custom movie and TV catalogs with powerful TMDB filters';
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
const ADDON_VERSION = pkg.version;
const TMDB_PAGE_SIZE = 20;

export function buildManifest(userConfig: UserConfig | null, baseUrl: string): StremioManifest {
  const resolvedBaseUrl = config.baseUrl || baseUrl;
  const IMDB_PAGE_SIZE = 100;
  const catalogs: ManifestCatalog[] = (userConfig?.catalogs || [])
    .filter((c) => c.enabled !== false)
    .map((catalog) => {
      const isImdb = catalog.source === 'imdb';
      const prefix = isImdb ? 'imdb' : 'tmdb';
      const pageSize = isImdb ? IMDB_PAGE_SIZE : TMDB_PAGE_SIZE;

      return {
        id: `${prefix}-${catalog._id || catalog.name.toLowerCase().replace(/\s+/g, '-')}`,
        type: catalog.type === 'series' ? 'series' : 'movie',
        name: catalog.name,
        pageSize,
        extra: [{ name: 'skip' }],
      };
    });

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

    if (isImdbApiEnabled() && userConfig?.preferences?.disableImdbSearch !== true) {
      catalogs.push({
        id: 'imdb-search-movie',
        type: 'movie',
        name: 'IMDb Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      });
      catalogs.push({
        id: 'imdb-search-series',
        type: 'series',
        name: 'IMDb Search',
        extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
      });
    }
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

export async function enrichManifestWithGenres(
  manifest: StremioManifest,
  config: UserConfig
): Promise<void> {
  if (!manifest.catalogs || !Array.isArray(manifest.catalogs) || !config) return;

  await Promise.all(
    manifest.catalogs.map(async (catalog) => {
      try {
        if (catalog.id.startsWith('tmdb-search-') || catalog.id.startsWith('imdb-search-')) return;

        if (catalog.id.startsWith('imdb-')) {
          const savedCatalog = (config.catalogs || []).find((c) => {
            const idFromStored = `imdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
            return idFromStored === catalog.id;
          });
          if (savedCatalog?.filters?.genres?.length) {
            const sortedGenres = [...(savedCatalog.filters.genres as unknown as string[])].sort(
              (a, b) => a.localeCompare(b)
            );
            sortedGenres.unshift('All');
            catalog.extra = catalog.extra || [];
            catalog.extra = catalog.extra.filter((e) => e.name !== 'genre');
            catalog.extra.push({
              name: 'genre',
              options: sortedGenres,
              optionsLimit: 1,
            });
          }
          return;
        }

        const helperType = catalog.type === 'series' ? 'series' : 'movie';
        const staticKey = catalog.type === 'series' ? 'tv' : 'movie';

        let idToName: Record<string, string> = {};
        let fullNames: string[] | null = null;

        try {
          const resolvedApiKey = getApiKeyFromConfig(config);
          if (resolvedApiKey) {
            const live = await tmdb.getGenres(resolvedApiKey, helperType);
            if (Array.isArray(live) && live.length > 0) {
              live.forEach((g) => {
                idToName[String(g.id)] = g.name;
              });
              fullNames = live.map((g) => g.name);
            }
          }
        } catch (err) {}

        if (!fullNames) {
          try {
            const genresPath = path.join(__dirname, '..', 'data', 'tmdb_genres.json');
            const raw = fs.readFileSync(genresPath, 'utf8');
            const staticGenreMap = JSON.parse(raw);
            const mapping = staticGenreMap[staticKey] || {};
            Object.entries(mapping).forEach(([id, name]) => {
              idToName[String(id)] = name as string;
            });
            fullNames = Object.values(mapping || {}) as string[];
          } catch (err) {
            idToName = {};
            fullNames = null;
          }
        }

        let isDiscoverOnly = false;
        let options: string[] | null = null;
        let healedFixes: Record<string, { genres: number[]; genreNames: string[] }> | null = null;

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
              options = selected.map((gid) => idToName[String(gid)]).filter(Boolean);

              if (options.length === 0) {
                log.info('Genre mapping failed, attempting self-healing', {
                  catalogId: catalog.id,
                });

                const apiKey = getApiKeyFromConfig(config);
                if (apiKey) {
                  try {
                    const freshGenres = await tmdb.getGenres(apiKey, helperType);
                    if (Array.isArray(freshGenres) && freshGenres.length > 0) {
                      const freshMap: Record<string, string> = {};
                      freshGenres.forEach((g) => (freshMap[String(g.id)] = g.name));

                      const healedOptions = selected
                        .map((gid) => freshMap[String(gid)])
                        .filter(Boolean);

                      if (healedOptions.length > 0) {
                        options = healedOptions;
                        healedFixes = healedFixes || {};
                        healedFixes[savedCatalog.id!] = {
                          genres: selected as unknown as number[],
                          genreNames: healedOptions,
                        };
                        log.info('Self-healing successful', {
                          catalogId: catalog.id,
                          genres: healedOptions,
                        });
                      }
                    }
                  } catch (healErr) {
                    log.error('Self-healing failed', { error: (healErr as Error).message });
                  }
                }
              }

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

        if (healedFixes) {
          updateCatalogGenres(config.userId, healedFixes).catch((e) =>
            log.error('Failed to persist healed genres', { error: (e as Error).message })
          );
        }

        if (options && options.length > 0) {
          const sortedOptions = [...options].sort((a, b) => a.localeCompare(b));
          sortedOptions.unshift('All');

          catalog.extra = catalog.extra || [];
          catalog.extra = catalog.extra.filter((e) => e.name !== 'genre');

          catalog.extra.push({
            name: 'genre',
            options: sortedOptions,
            optionsLimit: 1,
            isRequired: isDiscoverOnly,
          });
        }
      } catch (err) {
        log.warn('Error injecting genre options into manifest catalog', {
          error: (err as Error).message,
        });
      }
    })
  );
}
