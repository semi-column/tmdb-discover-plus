import { ImdbRatingsAdapter } from './ImdbRatingsAdapter.ts';
import { createLogger } from '../../utils/logger.ts';

const log = createLogger('ImdbRatings:Memory');

export class MemoryAdapter extends ImdbRatingsAdapter {
  private ratings: Map<string, string>;
  private meta: Map<string, string>;

  constructor() {
    super();
    this.ratings = new Map();
    this.meta = new Map();
  }

  async set(imdbId: string, value: string): Promise<void> {
    this.ratings.set(imdbId, value);
  }

  async get(imdbId: string): Promise<string | null> {
    return this.ratings.get(imdbId) ?? null;
  }

  async getMany(imdbIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const id of imdbIds) {
      const val = this.ratings.get(id);
      if (val) result.set(id, val);
    }
    return result;
  }

  async setBatch(entries: [string, string][]): Promise<void> {
    for (const [id, val] of entries) {
      this.ratings.set(id, val);
    }
  }

  async clear(): Promise<void> {
    this.ratings.clear();
  }

  async replaceAll(entries: [string, string][]): Promise<void> {
    const newRatings = new Map<string, string>();
    for (const [id, val] of entries) {
      newRatings.set(id, val);
    }
    this.ratings = newRatings;
  }

  async count(): Promise<number> {
    return this.ratings.size;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.meta.set(key, value);
  }

  async getMeta(key: string): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }

  async delMeta(key: string): Promise<void> {
    this.meta.delete(key);
  }

  async destroy(): Promise<void> {
    this.ratings.clear();
    this.meta.clear();
    log.info('Memory adapter destroyed');
  }
}
