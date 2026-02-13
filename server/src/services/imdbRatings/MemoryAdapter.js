import { ImdbRatingsAdapter } from './ImdbRatingsAdapter.ts';
import { createLogger } from '../../utils/logger.ts';

const log = createLogger('ImdbRatings:Memory');

/**
 * In-memory adapter for IMDb ratings using a plain Map.
 *
 * Best for environments without Redis (e.g. BeamUp / Dokku).
 * Typical heap cost: ~50–100 MB depending on MIN_VOTES threshold.
 * Data is NOT persistent across restarts — the dataset is re-downloaded on boot.
 */
export class MemoryAdapter extends ImdbRatingsAdapter {
  constructor() {
    super();
    /** @type {Map<string, string>} imdbId → "rating|votes" */
    this.ratings = new Map();
    /** @type {Map<string, string>} metadata key-value store */
    this.meta = new Map();
  }

  async set(imdbId, value) {
    this.ratings.set(imdbId, value);
  }

  async get(imdbId) {
    return this.ratings.get(imdbId) ?? null;
  }

  async getMany(imdbIds) {
    const result = new Map();
    for (const id of imdbIds) {
      const val = this.ratings.get(id);
      if (val) result.set(id, val);
    }
    return result;
  }

  async setBatch(entries) {
    for (const [id, val] of entries) {
      this.ratings.set(id, val);
    }
  }

  async clear() {
    this.ratings.clear();
  }

  async count() {
    return this.ratings.size;
  }

  async setMeta(key, value) {
    this.meta.set(key, value);
  }

  async getMeta(key) {
    return this.meta.get(key) ?? null;
  }

  async delMeta(key) {
    this.meta.delete(key);
  }

  async destroy() {
    this.ratings.clear();
    this.meta.clear();
    log.info('Memory adapter destroyed');
  }
}
