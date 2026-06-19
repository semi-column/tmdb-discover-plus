import { StorageInterface } from './StorageInterface.ts';
import { createLogger } from '../../utils/logger.ts';
import { MARKETPLACE_RANKING, MARKETPLACE_PAGINATION } from '../../constants.ts';
import type {
  UserConfig,
  PublicStats,
  MarketplaceEntry,
  MarketplaceSearchParams,
  MarketplaceSearchFacets,
  MarketplaceSort,
} from '../../types/index.ts';

const log = createLogger('MemoryAdapter');

const { W_TEXT, W_FUZZY, W_FACET, W_POP, POP_INSTALLS_WEIGHT, POP_LIKES_WEIGHT, FUZZY_THRESHOLD } =
  MARKETPLACE_RANKING;

const { DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_PAGE_SIZE, TOTAL_COUNT_CAP, ADAPTER_RESPONSE_CAP } =
  MARKETPLACE_PAGINATION;

// --- Self-contained text/fuzzy helpers (dev/test parity, not perf-optimized) ---

/** Lowercase, strip diacritics + control chars, collapse whitespace. */
function normalizeText(value: string): string {
  return (
    (value ?? '')
      .normalize('NFKD')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0300-\u036f\u0000-\u001f\u007f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
  );
}

/** Classic Levenshtein edit distance with a rolling two-row buffer. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Normalized 0..1 Levenshtein similarity ratio (1 = identical). */
function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Substring-aware fuzzy similarity between a catalog name and the query, on a
 * 0.00–1.00 scale. A normalized substring match scores 1.0; otherwise the best
 * Levenshtein ratio over a sliding window of the query length is returned, which
 * gives typo tolerance while keeping the single 0.70 inclusion gate meaningful.
 */
function nameSimilarity(name: string, query: string): number {
  const a = normalizeText(name);
  const b = normalizeText(query);
  if (!a || !b) return 0;
  if (a.includes(b)) return 1;
  if (b.length >= a.length) return levenshteinRatio(a, b);

  let best = 0;
  for (let i = 0; i + b.length <= a.length; i++) {
    const ratio = levenshteinRatio(a.slice(i, i + b.length), b);
    if (ratio > best) best = ratio;
    if (best >= 1) break;
  }
  return best;
}

/**
 * Weighted text relevance over name (highest), tags, genres, and description.
 * Returns a normalized 0..1 value so the name signal always outranks the others.
 */
function textRelevance(entry: MarketplaceEntry, query: string): number {
  const nq = normalizeText(query);
  if (!nq) return 0;
  const tokens = nq.split(' ').filter(Boolean);

  const fields: Array<{ text: string; weight: number }> = [
    { text: normalizeText(entry.name), weight: 1.0 },
    { text: normalizeText((entry.tags ?? []).join(' ')), weight: 0.5 },
    { text: normalizeText((entry.genres ?? []).join(' ')), weight: 0.4 },
    { text: normalizeText(entry.description ?? ''), weight: 0.3 },
  ];

  let totalWeight = 0;
  let accumulated = 0;
  for (const field of fields) {
    totalWeight += field.weight;
    const phraseHit = field.text.includes(nq) ? 1 : 0;
    const tokenHit = tokens.length
      ? tokens.filter((t) => field.text.includes(t)).length / tokens.length
      : 0;
    accumulated += field.weight * Math.max(phraseHit, tokenHit);
  }
  return totalWeight > 0 ? accumulated / totalWeight : 0;
}

/** Fraction of query tokens overlapping the entry's facet tokens (0..1). */
function facetOverlap(entry: MarketplaceEntry, query: string): number {
  const nq = normalizeText(query);
  if (!nq) return 0;
  const tokens = nq.split(' ').filter(Boolean);
  if (!tokens.length) return 0;

  const facetText = normalizeText(
    [entry.source, entry.type, ...(entry.genres ?? []), ...(entry.filterFacets ?? [])].join(' ')
  );
  const hits = tokens.filter((t) => facetText.includes(t)).length;
  return hits / tokens.length;
}

/** Log-dampened popularity boost from installs + likes. */
function popularityBoost(entry: MarketplaceEntry): number {
  const installs = Math.max(0, entry.engagement?.installs ?? 0);
  const likes = Math.max(0, entry.engagement?.likes ?? 0);
  return Math.log10(1 + installs) * POP_INSTALLS_WEIGHT + Math.log10(1 + likes) * POP_LIKES_WEIGHT;
}

/** Composite relevance score per the design's Search & Matching Strategy. */
function compositeScore(entry: MarketplaceEntry, query: string): number {
  return (
    W_TEXT * textRelevance(entry, query) +
    W_FUZZY * nameSimilarity(entry.name, query) +
    W_FACET * facetOverlap(entry, query) +
    W_POP * popularityBoost(entry)
  );
}

function isSearchable(entry: MarketplaceEntry): boolean {
  return entry.visibility === 'public' && entry.moderation === 'active';
}

function matchesFacets(entry: MarketplaceEntry, facets?: MarketplaceSearchFacets): boolean {
  if (!facets) return true;
  if (facets.source && entry.source !== facets.source) return false;
  if (facets.type && entry.type !== facets.type) return false;
  if (facets.genres && facets.genres.length) {
    const entryGenres = new Set((entry.genres ?? []).map((g) => normalizeText(g)));
    for (const genre of facets.genres) {
      if (!entryGenres.has(normalizeText(genre))) return false;
    }
  }
  return true;
}

function resolveSort(sort: MarketplaceSort | undefined, hasQuery: boolean): MarketplaceSort {
  if (sort) return sort;
  return hasQuery ? 'relevance' : 'trending';
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(limit)));
}

function toTime(value: Date | string | undefined): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function originKey(originUserId: string, originCatalogId: string): string {
  return `${originUserId}\u0000${originCatalogId}`;
}

export class MemoryAdapter extends StorageInterface {
  private users: Map<string, UserConfig>;
  private configs: Map<string, UserConfig[]>;
  // Marketplace state
  private entries: Map<string, MarketplaceEntry>; // marketplaceId -> entry
  private originIndex: Map<string, string>; // originKey -> marketplaceId (one per origin pair)
  private likes: Map<string, Set<string>>; // marketplaceId -> set of actorUserId

  constructor() {
    super();
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
    const sorted = this.sortMatches(matched, sort, query);

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

  /** Sort matches by the active sort mode with a stable marketplaceId tiebreak. */
  private sortMatches(
    entries: MarketplaceEntry[],
    sort: MarketplaceSort,
    query: string
  ): MarketplaceEntry[] {
    const scored = entries.map((entry) => ({
      entry,
      score: sort === 'relevance' ? compositeScore(entry, query) : 0,
    }));

    scored.sort((a, b) => {
      let cmp = 0;
      switch (sort) {
        case 'relevance':
          cmp = b.score - a.score;
          break;
        case 'popular':
          cmp = b.entry.engagement.likes - a.entry.engagement.likes;
          if (cmp === 0) cmp = b.entry.engagement.installs - a.entry.engagement.installs;
          break;
        case 'most-installed':
          cmp = b.entry.engagement.installs - a.entry.engagement.installs;
          break;
        case 'newest':
          cmp = toTime(b.entry.publishedAt) - toTime(a.entry.publishedAt);
          break;
        case 'trending':
          cmp = b.entry.engagement.trendingScore - a.entry.engagement.trendingScore;
          break;
      }
      if (cmp !== 0) return cmp;
      // Deterministic secondary ordering: marketplaceId ascending.
      if (a.entry.marketplaceId < b.entry.marketplaceId) return -1;
      if (a.entry.marketplaceId > b.entry.marketplaceId) return 1;
      return 0;
    });

    return scored.map((s) => s.entry);
  }
}
