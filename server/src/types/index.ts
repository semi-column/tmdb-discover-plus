// Domain-specific type modules — barrel re-export
export * from './common.ts';
export * from './config.ts';
export * from './tmdb.ts';
export * from './stremio.ts';
export * from './cache.ts';
export * from './storage.ts';

// Express global augmentation (side-effect import)
import './express.ts';
