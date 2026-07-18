import { createLogger } from '../../utils/logger.ts';
import { MARKETPLACE_RANKING, MARKETPLACE_PAGINATION } from '../../constants.ts';
import {
  nameSimilarity,
  matchesFacets,
  resolveSort,
  clampLimit,
  sortMatches,
} from './searchHelpers.ts';
import type {
  UserConfig,
  PublicStats,
  MarketplaceEntry,
  MarketplaceSearchParams,
  IStorageAdapter,
} from '../../types/index.ts';

const log = createLogger('MemoryAdapter');

const { FUZZY_THRESHOLD } = MARKETPLACE_RANKING;

const { TOTAL_COUNT_CAP, ADAPTER_RESPONSE_CAP } = MARKETPLACE_PAGINATION;

function isSearchable(entry: MarketplaceEntry): boolean {
  return entry.visibility === 'public' && entry.moderation === 'active';
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function originKey(originUserId: string, originCatalogId: string): string {
  return `${originUserId}\u0000${originCatalogId}`;
}

export class MemoryAdapter implements IStorageAdapter {
  private users: Map<string, UserConfig>;
  private configs: Map<string, UserConfig[]>;
  // Marketplace state
  private entries: Map<string, MarketplaceEntry>; // marketplaceId -> entry
  private originIndex: Map<string, string>; // originKey -> marketplaceId (one per origin pair)
  private likes: Map<string, Set<string>>; // marketplaceId -> set of actorUserId

  constructor() {
    this.users = new Map();
    this.configs = new Map();
    this.entries = new Map();
    this.originIndex = new Map();
    this.likes = new Map();
  }

  async connect(): Promise<void> {
    log.info('Connected to In-Memory Storage');
  }

  async disconnect(): Promise<void> {
    this.users.clear();
    this.configs.clear();
    this.entries.clear();
    this.originIndex.clear();
    this.likes.clear();
  }

  async getUserConfig(userId: string): Promise<UserConfig | null> {
    return this.users.get(userId) || null;
  }

  async saveUserConfig(config: UserConfig): Promise<UserConfig> {
    this.users.set(config.userId, config);

    if (config.apiKeyId) {
      const oldList = this.configs.get(config.apiKeyId) || [];
      const newList = oldList.filter((c) => c.userId !== config.userId);
      newList.push(config);
      newList.sort(
        (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
      );
      this.configs.set(config.apiKeyId, newList);
    }

    return config;
  }

  async getConfigsByApiKeyId(apiKeyId: string): Promise<UserConfig[]> {
    return this.configs.get(apiKeyId) || [];
  }

  async getAllConfigs(): Promise<UserConfig[]> {
    return Array.from(this.users.values());
  }

  async deleteUserConfig(userId: string): Promise<boolean> {
    const config = this.users.get(userId);
    if (!config) return false;

    this.users.delete(userId);
    if (config.apiKeyId) {
      const list = this.configs.get(config.apiKeyId) || [];
      this.configs.set(
        config.apiKeyId,
        list.filter((c) => c.userId !== userId)
      );
    }
    return true;
  }

  async getPublicStats(): Promise<PublicStats> {
    const allConfigs = Array.from(this.users.values());
    const totalUsers = new Set(allConfigs.map((c) => c.apiKeyId)).size;

    let totalCatalogs = 0;
    for (const config of allConfigs) {
      if (Array.isArray(config.catalogs)) {
        for (const cat of config.catalogs) {
          const type = cat.filters?.listType;
          if (!type || type === 'discover') {
            totalCatalogs++;
          }
        }
      }
    }

    return { totalUsers, totalCatalogs };
  }

  // --- Marketplace persistence ---

  /**
   * Insert or update an entry, enforcing one entry per (originUserId, originCatalogId).
   * When an entry already exists for the origin pair, the stable marketplaceId, the
   * original publish time, and the engagement counters are preserved while the
   * searchable content is replaced.
   */
  async upsertMarketplaceEntry(entry: MarketplaceEntry): Promise<MarketplaceEntry> {
    const key = originKey(entry.provenance.originUserId, entry.provenance.originCatalogId);
    const existingId = this.originIndex.get(key);

    if (existingId !== undefined) {
      const existing = this.entries.get(existingId);
      if (existing) {
        const merged: MarketplaceEntry = {
          ...clone(entry),
          marketplaceId: existing.marketplaceId,
          publishedAt: existing.publishedAt,
          engagement: { ...existing.engagement },
        };
        this.entries.set(existing.marketplaceId, merged);
        return clone(merged);
      }
      // Index pointed at a missing entry; fall through to fresh insert.
    }

    const stored = clone(entry);
    this.entries.set(stored.marketplaceId, stored);
    this.originIndex.set(key, stored.marketplaceId);
    if (!this.likes.has(stored.marketplaceId)) {
      this.likes.set(stored.marketplaceId, new Set());
    }
    return clone(stored);
  }

  async deleteMarketplaceEntryByOrigin(
    originUserId: string,
    originCatalogId: string
  ): Promise<boolean> {
    const key = originKey(originUserId, originCatalogId);
    const id = this.originIndex.get(key);
    if (id === undefined) return false;

    this.entries.delete(id);
    this.originIndex.delete(key);
    this.likes.delete(id);
    return true;
  }

  async getMarketplaceEntry(marketplaceId: string): Promise<MarketplaceEntry | null> {
    const entry = this.entries.get(marketplaceId);
    return entry ? clone(entry) : null;
  }

  async searchMarketplaceEntries(params: MarketplaceSearchParams): Promise<MarketplaceEntry[]> {
    const query = (params.q ?? '').trim();
    const matched = this.selectMatches(params, query);
    const sort = resolveSort(params.sort, query.length > 0);
    const sorted = sortMatches(matched, sort, query);

    const limit = clampLimit(params.limit);
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const start = (page - 1) * limit;
    const paged = sorted.slice(start, start + limit);

    return paged.slice(0, ADAPTER_RESPONSE_CAP).map((entry) => clone(entry));
  }

  async countMarketplaceEntries(params: MarketplaceSearchParams): Promise<number> {
    const query = (params.q ?? '').trim();
    const matched = this.selectMatches(params, query);
    return Math.min(matched.length, TOTAL_COUNT_CAP);
  }

  async incrementMarketplaceCounter(
    marketplaceId: string,
    field: 'installs' | 'likes' | 'views',
    delta: 1 | -1
  ): Promise<number> {
    const entry = this.entries.get(marketplaceId);
    if (!entry) {
      throw new Error(`Marketplace entry not found: ${marketplaceId}`);
    }
    // Single-tick read-modify-write: atomic for the in-process model.
    const current = Math.max(0, entry.engagement[field] ?? 0);
    const next = Math.max(0, current + delta);
    entry.engagement[field] = next;
    return next;
  }

  async setTrendingScore(marketplaceId: string, score: number): Promise<number> {
    const entry = this.entries.get(marketplaceId);
    if (!entry) {
      throw new Error(`Marketplace entry not found: ${marketplaceId}`);
    }
    // Persist only finite, non-negative scores; anything else is stored as 0.
    const next = Number.isFinite(score) && score > 0 ? score : 0;
    entry.engagement.trendingScore = next;
    return next;
  }

  async recordLike(marketplaceId: string, actorUserId: string): Promise<boolean> {
    let set = this.likes.get(marketplaceId);
    if (!set) {
      set = new Set();
      this.likes.set(marketplaceId, set);
    }
    if (set.has(actorUserId)) return false;
    set.add(actorUserId);
    return true;
  }

  async removeLike(marketplaceId: string, actorUserId: string): Promise<boolean> {
    const set = this.likes.get(marketplaceId);
    if (!set || !set.has(actorUserId)) return false;
    set.delete(actorUserId);
    return true;
  }

  async hasLiked(marketplaceId: string, actorUserId: string): Promise<boolean> {
    return this.likes.get(marketplaceId)?.has(actorUserId) ?? false;
  }

  // --- Internal search helpers ---

  /** Filter entries by visibility/moderation, facets, and fuzzy name gate. */
  private selectMatches(params: MarketplaceSearchParams, query: string): MarketplaceEntry[] {
    const out: MarketplaceEntry[] = [];
    for (const entry of this.entries.values()) {
      if (!isSearchable(entry)) continue;
      if (!matchesFacets(entry, params.facets)) continue;
      if (query && nameSimilarity(entry.name, query) < FUZZY_THRESHOLD) continue;
      out.push(entry);
    }
    return out;
  }
}
