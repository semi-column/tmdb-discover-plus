/**
 * TMDB Service — Thin re-export proxy.
 *
 * All implementation has been split into focused modules under ./tmdb/.
 * This file exists solely so that existing consumers can keep their
 * `import * as tmdb from '../services/tmdb.js'` import unchanged.
 *
 * @see ./tmdb/index.js for the barrel that aggregates every sub-module.
 */
export * from './tmdb/index.js';
