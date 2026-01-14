import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as tmdb from './tmdb.js';
import { normalizeGenreName, parseIdArray } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('manifestService');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADDON_ID = 'community.tmdb.discover.plus';
const ADDON_NAME = 'TMDB Discover+';
const ADDON_DESCRIPTION = 'Create custom movie and TV catalogs with powerful TMDB filters';
const ADDON_VERSION = '2.1.0';
const TMDB_PAGE_SIZE = 20;

/**
 * Build base Stremio manifest for a user
 * @param {Object} userConfig 
 * @param {string} baseUrl 
 * @returns {Object}
 */
export function buildManifest(userConfig, baseUrl) {
    const catalogs = (userConfig?.catalogs || [])
        .filter(c => c.enabled !== false)
        .map(catalog => ({
            id: `tmdb-${catalog._id || catalog.name.toLowerCase().replace(/\s+/g, '-')}`,
            type: catalog.type === 'series' ? 'series' : 'movie',
            name: catalog.name,
            pageSize: TMDB_PAGE_SIZE,
            extra: [{ name: 'skip' }, { name: 'search' }],
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

/**
 * Enrich manifest catalogs with genre options
 * @param {Object} manifest 
 * @param {Object} config 
 */
export async function enrichManifestWithGenres(manifest, config) {
    if (!manifest.catalogs || !Array.isArray(manifest.catalogs) || !config) return;

    await Promise.all(manifest.catalogs.map(async (catalog) => {
        try {
            const helperType = catalog.type === 'series' ? 'series' : 'movie';
            const staticKey = catalog.type === 'series' ? 'tv' : 'movie';

            let idToName = {};
            let fullNames = null;

            // Try fetching live genres first
            try {
                if (config.tmdbApiKey) {
                    const live = await tmdb.getGenres(config.tmdbApiKey, helperType);
                    if (Array.isArray(live) && live.length > 0) {
                        live.forEach(g => { idToName[String(g.id)] = g.name; });
                        fullNames = live.map(g => g.name);
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

                if (savedCatalog && savedCatalog.filters) {
                    const selected = parseIdArray(savedCatalog.filters.genres);
                    const excluded = parseIdArray(savedCatalog.filters.excludeGenres);

                    if (selected.length > 0) {
                        // If specific genres selected, only show those as options + fuzzy matches
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
                        // If exclude genres present, show all EXCEPT those
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
