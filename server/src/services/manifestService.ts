import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as tmdb from './tmdb/index.ts';
import * as imdb from './imdb/index.ts';
import * as anilist from './anilist/index.ts';
import * as mal from './mal/index.ts';
import * as simkl from './simkl/index.ts';
import * as trakt from './trakt/index.ts';
import { getSource, getAllSources } from './sources/registry.ts';
import { normalizeGenreName, parseIdArray } from '../utils/helpers.ts';
import { stableStringify } from '../utils/stableStringify.ts';
import { resolveDynamicDatePreset } from '../utils/dateHelpers.ts';
import { createLogger } from '../utils/logger.ts';
import { getApiKeyFromConfig, updateCatalogGenres } from './configService.ts';
import { config } from '../config.ts';
import { SORT_OPTIONS } from './tmdb/referenceData.ts';
import type { UserConfig, StremioManifest, ManifestCatalog, TmdbGenre } from '../types/index.ts';

const log = createLogger('manifestService');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADDON_VARIANT = config.addon.variant;
const ADDON_ID = ADDON_VARIANT
  ? `community.tmdb.discover.plus.${ADDON_VARIANT}`
  : 'community.tmdb.discover.plus';
const BASE_ADDON_NAME = 'TMDB Discover+';
const ADDON_DESCRIPTION = 'Create custom movie and TV catalogs with powerful TMDB filters';
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
const ADDON_VERSION = pkg.version;

type StremioExtraMode = 'genre' | 'year' | 'sortBy' | 'certification';
type ManifestExtra = NonNullable<ManifestCatalog['extra']>[number];
const STREMIO_EXTRA_MODES: StremioExtraMode[] = ['genre', 'year', 'sortBy', 'certification'];
const TMDB_STREMIO_EXTRA_MODES: StremioExtraMode[] = ['genre', 'year', 'sortBy', 'certification'];
const GENRE_ONLY_STREMIO_EXTRA_MODES: StremioExtraMode[] = ['genre'];
const SUPPORTED_ID_PREFIXES = ['tmdb:', 'tt', 'mal:', 'kitsu:', 'anilist:', 'anidb:'];

const MIN_DROPDOWN_YEAR = 1900;

function buildManifestVersion(userConfig: UserConfig | null): string {
  if (!userConfig) {
    return ADDON_VERSION;
  }

  const signaturePayload = {
    variant: ADDON_VARIANT || 'stable',
    configName: userConfig.configName || '',
    catalogs: (userConfig.catalogs || []).map((catalog) => ({
      id: catalog._id,
      name: catalog.name,
      type: catalog.type,
      source: catalog.source || 'tmdb',
      enabled: catalog.enabled !== false,
      filters: catalog.filters || {},
    })),
    preferences: userConfig.preferences || {},
  };

  const hash = crypto
    .createHash('sha256')
    .update(stableStringify(signaturePayload))
    .digest('hex')
    .slice(0, 12);

  return `${ADDON_VERSION}+${hash}`;
}

function parseNumericYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseYearFromDateLike(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.trim().match(/^(\d{4})/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDropdownYearBounds(
  lower: number,
  upper: number,
  maxYear: number
): { lower: number; upper: number } {
  const boundedUpper = Math.min(Math.max(upper, MIN_DROPDOWN_YEAR), maxYear);
  const boundedLower = Math.min(Math.max(lower, MIN_DROPDOWN_YEAR), boundedUpper);

  return { lower: boundedLower, upper: boundedUpper };
}

function buildYearDropdownOptions(
  filters: Record<string, unknown> | undefined,
  catalogType: 'movie' | 'series'
): string[] {
  const nowYear = new Date().getFullYear();
  const maxYear = filters?.releasedOnly === true ? nowYear : nowYear + 2;
  const resolved = resolveDynamicDatePreset(filters || {}, catalogType);

  const isMovie = catalogType === 'movie';
  const fromDateField = isMovie ? 'releaseDateFrom' : 'airDateFrom';
  const toDateField = isMovie ? 'releaseDateTo' : 'airDateTo';
  const exactYearField = isMovie ? 'primaryReleaseYear' : 'firstAirDateYear';

  const lowerCandidates: number[] = [];
  const upperCandidates: number[] = [];

  const yearFrom = parseNumericYear(resolved.yearFrom);
  if (yearFrom != null) lowerCandidates.push(yearFrom);

  const yearTo = parseNumericYear(resolved.yearTo);
  if (yearTo != null) upperCandidates.push(yearTo);

  const dateFrom = parseYearFromDateLike(resolved[fromDateField]);
  if (dateFrom != null) lowerCandidates.push(dateFrom);

  const dateTo = parseYearFromDateLike(resolved[toDateField]);
  if (dateTo != null) upperCandidates.push(dateTo);

  if (!isMovie) {
    const firstAirFrom = parseYearFromDateLike(resolved.firstAirDateFrom);
    if (firstAirFrom != null) lowerCandidates.push(firstAirFrom);

    const firstAirTo = parseYearFromDateLike(resolved.firstAirDateTo);
    if (firstAirTo != null) upperCandidates.push(firstAirTo);
  }

  const exactYear = parseNumericYear(resolved[exactYearField]);
  if (exactYear != null) {
    lowerCandidates.push(exactYear);
    upperCandidates.push(exactYear);
  }

  const candidateLower =
    lowerCandidates.length > 0 ? Math.max(...lowerCandidates) : MIN_DROPDOWN_YEAR;
  const candidateUpper = upperCandidates.length > 0 ? Math.min(...upperCandidates) : maxYear;
  const { lower, upper } = normalizeDropdownYearBounds(candidateLower, candidateUpper, maxYear);

  const options = ['All'];
  for (let year = upper; year >= lower; year -= 1) {
    options.push(String(year));
  }

  return options;
}

function buildCertificationDropdownOptions(
  filters: Record<string, unknown> | undefined,
  countryCerts: { certification: string }[]
): string[] {
  const available = Array.from(
    new Set(
      (countryCerts || [])
        .map((entry) => entry?.certification)
        .filter((cert): cert is string => typeof cert === 'string' && cert.trim().length > 0)
    )
  );

  const selectedValues = [
    ...(Array.isArray(filters?.certifications) ? filters.certifications : []),
    ...(typeof filters?.certification === 'string' ? [filters.certification] : []),
  ]
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);

  const selectedSet = new Set(selectedValues.map((value) => value.toLowerCase()));
  const selectedOnly =
    selectedSet.size > 0
      ? available.filter((value) => selectedSet.has(value.toLowerCase()))
      : available;

  const fallbackSelectedOnly =
    selectedSet.size > 0 && selectedOnly.length === 0
      ? Array.from(new Set(selectedValues))
      : selectedOnly;

  return ['All', ...fallbackSelectedOnly];
}

function getStremioExtraMode(
  filters: Record<string, unknown> | undefined,
  supportedModes: StremioExtraMode[] = STREMIO_EXTRA_MODES
): StremioExtraMode {
  const firstSupportedMode = supportedModes[0] || 'genre';
  const rawMode = filters?.stremioExtraMode;
  if (
    (rawMode === 'genre' ||
      rawMode === 'year' ||
      rawMode === 'sortBy' ||
      rawMode === 'certification') &&
    supportedModes.includes(rawMode)
  ) {
    return rawMode;
  }

  const legacy = Array.isArray(filters?.stremioExtras) ? filters?.stremioExtras[0] : undefined;
  if (
    (legacy === 'genre' ||
      legacy === 'year' ||
      legacy === 'sortBy' ||
      legacy === 'certification') &&
    supportedModes.includes(legacy)
  ) {
    return legacy;
  }

  return firstSupportedMode;
}

function upsertCatalogGenreExtra(catalog: ManifestCatalog, genreExtra: ManifestExtra): void {
  const nonGenreExtras = (catalog.extra || []).filter((extra) => extra.name !== 'genre');
  catalog.extra = [genreExtra, ...nonGenreExtras];
}

function upsertGenreExtra(
  catalog: ManifestCatalog,
  rawOptions: string[],
  isRequired: boolean = false
): void {
  const options = Array.from(
    new Set(
      (rawOptions || [])
        .map((value) => String(value).trim())
        .filter((value) => value.length > 0 && value.toLowerCase() !== 'all')
    )
  ).sort((a, b) => a.localeCompare(b));

  if (options.length === 0) return;

  upsertCatalogGenreExtra(catalog, {
    name: 'genre',
    options: ['All', ...options],
    optionsLimit: 1,
    isRequired,
  });
}

export function buildManifest(userConfig: UserConfig | null, baseUrl: string): StremioManifest {
  const resolvedBaseUrl = config.baseUrl || baseUrl;
  const addonName = userConfig?.configName
    ? `${BASE_ADDON_NAME} - ${userConfig.configName}`
    : BASE_ADDON_NAME;
  const catalogs: ManifestCatalog[] = (userConfig?.catalogs || [])
    .filter((c) => c.enabled !== false)
    .map((catalog) => {
      const source = getSource(catalog.source ?? 'tmdb');
      const prefix = source.catalogIdPrefix;
      const pageSize = source.defaultPageSize;

      return {
        id: `${prefix}-${catalog._id || catalog.name.toLowerCase().replace(/\s+/g, '-')}`,
        type:
          catalog.type === 'collection'
            ? 'collection'
            : catalog.type === 'anime'
              ? 'anime'
              : catalog.type === 'series'
                ? 'series'
                : 'movie',
        name: catalog.name,
        pageSize,
        extra: [{ name: 'skip' }],
      };
    });

  if (userConfig?.preferences?.disableSearch !== true) {
    // Each source owns its own search catalog definitions.
    // The preference key convention is `disable<SourceId>Search`.
    const SEARCH_PREF_MAP: Record<string, keyof import('../types/config.ts').UserPreferences> = {
      tmdb: 'disableTmdbSearch',
      imdb: 'disableImdbSearch',
      anilist: 'disableAnilistSearch',
      mal: 'disableMalSearch',
      kitsu: 'disableKitsuSearch',
      simkl: 'disableSimklSearch',
      trakt: 'disableTraktSearch',
    };

    for (const source of getAllSources()) {
      const prefKey = SEARCH_PREF_MAP[source.sourceId];
      // TMDB search is enabled by default; others are opt-in (disabled by default).
      const isDisabled = prefKey
        ? source.sourceId === 'tmdb'
          ? userConfig?.preferences?.[prefKey] === true
          : userConfig?.preferences?.[prefKey] !== false
        : true;

      if (isDisabled) continue;
      // Some sources can be enabled via per-user credentials even when
      // global env credentials are not configured.
      const hasUserScopedCredential =
        (source.sourceId === 'mal' && !!userConfig?.malClientIdEncrypted) ||
        (source.sourceId === 'simkl' && !!userConfig?.simklApiKeyEncrypted) ||
        (source.sourceId === 'trakt' && !!userConfig?.traktClientIdEncrypted);
      if (!source.isEnabled() && !hasUserScopedCredential) continue;

      const searchCatalogs = source.getSearchCatalogs();
      catalogs.push(...searchCatalogs);
    }
  }

  return {
    id: ADDON_ID,
    name: addonName,
    description: ADDON_DESCRIPTION,
    version: buildManifestVersion(userConfig),
    logo: `${resolvedBaseUrl.replace(/\/$/, '')}/logo.png`,
    idPrefixes: SUPPORTED_ID_PREFIXES,
    resources: ['catalog', 'meta'],
    types: ['movie', 'series', 'anime'],
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
        if (catalog.id.includes('-search-')) return;

        if (catalog.id.startsWith('imdb-')) {
          const savedCatalog = (config.catalogs || []).find((c) => {
            const idFromStored = `imdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
            return idFromStored === catalog.id;
          });
          if (!savedCatalog) return;

          const dropdownMode = getStremioExtraMode(
            savedCatalog.filters as Record<string, unknown> | undefined,
            GENRE_ONLY_STREMIO_EXTRA_MODES
          );
          if (dropdownMode !== 'genre') return;

          const imdbGenres = await imdb.getGenres();
          upsertGenreExtra(catalog, imdbGenres, savedCatalog.filters?.discoverOnly === true);
          return;
        }

        if (catalog.id.startsWith('anilist-')) {
          const savedCatalog = (config.catalogs || []).find((c) => {
            const idFromStored = `anilist-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
            return idFromStored === catalog.id;
          });
          if (!savedCatalog) return;

          const dropdownMode = getStremioExtraMode(
            savedCatalog.filters as Record<string, unknown> | undefined,
            GENRE_ONLY_STREMIO_EXTRA_MODES
          );
          if (dropdownMode !== 'genre') return;

          upsertGenreExtra(
            catalog,
            [...anilist.getGenres()],
            savedCatalog.filters?.discoverOnly === true
          );
          return;
        }

        if (catalog.id.startsWith('mal-')) {
          const savedCatalog = (config.catalogs || []).find((c) => {
            const idFromStored = `mal-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
            return idFromStored === catalog.id;
          });
          if (!savedCatalog) return;

          const dropdownMode = getStremioExtraMode(
            savedCatalog.filters as Record<string, unknown> | undefined,
            GENRE_ONLY_STREMIO_EXTRA_MODES
          );
          if (dropdownMode !== 'genre') return;

          upsertGenreExtra(
            catalog,
            mal.getGenres().map((genre) => genre.name),
            savedCatalog.filters?.discoverOnly === true
          );
          return;
        }

        if (catalog.id.startsWith('simkl-')) {
          const savedCatalog = (config.catalogs || []).find((c) => {
            const idFromStored = `simkl-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
            return idFromStored === catalog.id;
          });
          if (!savedCatalog) return;

          const dropdownMode = getStremioExtraMode(
            savedCatalog.filters as Record<string, unknown> | undefined,
            GENRE_ONLY_STREMIO_EXTRA_MODES
          );
          if (dropdownMode !== 'genre') return;

          upsertGenreExtra(
            catalog,
            [...simkl.getGenres()],
            savedCatalog.filters?.discoverOnly === true
          );
          return;
        }

        if (catalog.id.startsWith('trakt-')) {
          const savedCatalog = (config.catalogs || []).find((c) => {
            const idFromStored = `trakt-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
            return idFromStored === catalog.id;
          });
          if (!savedCatalog) return;

          const dropdownMode = getStremioExtraMode(
            savedCatalog.filters as Record<string, unknown> | undefined,
            GENRE_ONLY_STREMIO_EXTRA_MODES
          );
          if (dropdownMode !== 'genre') return;

          const traktGenresByType = await trakt.getGenresByType();
          const scopedGenres =
            catalog.type === 'series' ? traktGenresByType.series : traktGenresByType.movie;
          upsertGenreExtra(
            catalog,
            scopedGenres.map((genre) => genre.name),
            savedCatalog.filters?.discoverOnly === true
          );
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

          if (
            savedCatalog?.filters?.listType === 'collection' ||
            savedCatalog?.filters?.listType === 'studio'
          ) {
            return;
          }

          const dropdownMode = getStremioExtraMode(
            savedCatalog?.filters as Record<string, unknown> | undefined,
            TMDB_STREMIO_EXTRA_MODES
          );
          if (dropdownMode !== 'genre') {
            return;
          }

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
                          genres: selected.map(Number),
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
          upsertGenreExtra(catalog, options, isDiscoverOnly);
        }
      } catch (err) {
        log.warn('Error injecting genre options into manifest catalog', {
          error: (err as Error).message,
        });
      }
    })
  );
}

export async function enrichManifestWithExtras(
  manifest: StremioManifest,
  userConfig: UserConfig
): Promise<void> {
  if (!manifest.catalogs || !Array.isArray(manifest.catalogs) || !userConfig) return;

  const apiKey = getApiKeyFromConfig(userConfig);
  const certCache: Record<string, Record<string, { certification: string }[]>> = {};

  for (const catalog of manifest.catalogs) {
    if (catalog.id.includes('-search-')) continue;
    if (!catalog.id.startsWith('tmdb-')) continue;

    const savedCatalog = (userConfig.catalogs || []).find((c) => {
      const idFromStored = `tmdb-${c._id || c.name.toLowerCase().replace(/\s+/g, '-')}`;
      const idFromIdOnly = `tmdb-${String(c._id)}`;
      return idFromStored === catalog.id || idFromIdOnly === catalog.id;
    });
    if (!savedCatalog) continue;
    if (
      savedCatalog.filters?.listType === 'collection' ||
      savedCatalog.filters?.listType === 'studio'
    ) {
      continue;
    }

    const dropdownMode = getStremioExtraMode(
      savedCatalog.filters as Record<string, unknown> | undefined,
      TMDB_STREMIO_EXTRA_MODES
    );
    if (dropdownMode === 'genre') continue;

    const isDiscoverOnly = savedCatalog.filters?.discoverOnly === true;
    const catalogType = catalog.type === 'series' ? 'series' : 'movie';

    if (dropdownMode === 'year') {
      const years = buildYearDropdownOptions(
        savedCatalog.filters as Record<string, unknown> | undefined,
        catalogType
      );
      upsertCatalogGenreExtra(catalog, {
        name: 'genre',
        options: years,
        optionsLimit: 1,
        isRequired: isDiscoverOnly,
      });
    }

    if (dropdownMode === 'sortBy') {
      const sortOpts = SORT_OPTIONS[catalogType] || SORT_OPTIONS.movie;
      upsertCatalogGenreExtra(catalog, {
        name: 'genre',
        options: ['All', ...sortOpts.map((s) => s.label)],
        optionsLimit: 1,
        isRequired: isDiscoverOnly,
      });
    }

    if (dropdownMode === 'certification') {
      try {
        const country = String(savedCatalog.filters?.certificationCountry || 'US').toUpperCase();
        if (!certCache[catalogType] && apiKey) {
          const allCerts = await tmdb.getCertifications(apiKey, catalogType);
          certCache[catalogType] = allCerts as Record<string, { certification: string }[]>;
        }
        const countryMap = certCache[catalogType] || {};
        const countryCerts = countryMap[country] || [];
        const certOptions = buildCertificationDropdownOptions(
          savedCatalog.filters as Record<string, unknown> | undefined,
          countryCerts
        );
        upsertCatalogGenreExtra(catalog, {
          name: 'genre',
          options: certOptions,
          optionsLimit: 1,
          isRequired: isDiscoverOnly,
        });
      } catch (err) {
        log.warn('Error building certification extras', { error: (err as Error).message });
      }
    }
  }
}
