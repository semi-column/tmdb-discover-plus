import crypto from 'crypto';
import mongoose from 'mongoose';
import { StorageInterface } from './StorageInterface.ts';
import { UserConfig } from '../../models/UserConfig.ts';
import { MarketplaceEntryModel, MarketplaceLikeModel } from '../../models/MarketplaceEntry.ts';
import { createLogger } from '../../utils/logger.ts';
import { MARKETPLACE_RANKING, MARKETPLACE_PAGINATION } from '../../constants.ts';
import type {
  UserConfig as UserConfigType,
  PublicStats,
  MarketplaceEntry,
  MarketplaceSearchParams,
  MarketplaceSearchFacets,
  MarketplaceSort,
  ContentType,
  SourceType,
  CatalogFilters,
  CatalogFormState,
} from '../../types/index.ts';

const log = createLogger('MongoAdapter');

const { W_TEXT, W_FUZZY, W_FACET, W_POP, POP_INSTALLS_WEIGHT, POP_LIKES_WEIGHT, FUZZY_THRESHOLD } =
  MARKETPLACE_RANKING;

const { DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_PAGE_SIZE, TOTAL_COUNT_CAP, ADAPTER_RESPONSE_CAP } =
  MARKETPLACE_PAGINATION;

type CounterField = 'installs' | 'likes' | 'views';

// --- Text / fuzzy scoring helpers (kept in lock-step with MemoryAdapter so all
// adapters produce equivalent fuzzy inclusion and composite ranking). The Mongo
// weighted `$text` index backs the same name/tags/genres/description signal; the
// in-process composite score additionally provides typo tolerance for short and
// partial queries that the text index alone would miss. ---

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

/** Substring-aware fuzzy similarity between a catalog name and the query (0..1). */
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

/** Weighted text relevance over name (highest), tags, genres, and description. */
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

/** Coerce a stored counter to a non-negative integer. */
function toCounter(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Coerce a derived score to a finite non-negative float (0 for NaN/±Infinity). */
function toScore(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

interface MarketplaceEntryDoc {
  marketplaceId: string;
  provenance?: {
    originUserId?: string;
    originCatalogId?: string;
    originConfigName?: string;
  };
  name: string;
  description?: string;
  tags?: string[];
  type: string;
  source: string;
  genres?: string[];
  filterFacets?: string[];
  filters?: CatalogFilters;
  formState?: CatalogFormState;
  visibility?: string;
  moderation?: string;
  engagement?: {
    likes?: number;
    installs?: number;
    views?: number;
    trendingScore?: number;
    lastEngagedAt?: Date;
  };
  contentHash?: string;
  publishedAt?: Date;
  updatedAt?: Date;
  schemaVersion?: number;
}

/** Map a stored Mongo document to the canonical MarketplaceEntry shape. */
function toEntry(doc: MarketplaceEntryDoc): MarketplaceEntry {
  const engagement = doc.engagement ?? {};
  return {
    marketplaceId: String(doc.marketplaceId),
    provenance: {
      originUserId: String(doc.provenance?.originUserId ?? ''),
      originCatalogId: String(doc.provenance?.originCatalogId ?? ''),
      originConfigName: doc.provenance?.originConfigName ?? '',
    },
    name: doc.name,
    description: doc.description ?? '',
    tags: doc.tags ?? [],
    type: doc.type as ContentType,
    source: doc.source as SourceType,
    genres: doc.genres ?? [],
    filterFacets: doc.filterFacets ?? [],
    filters: (doc.filters ?? {}) as CatalogFilters,
    formState: doc.formState,
    visibility: (doc.visibility ?? 'public') as MarketplaceEntry['visibility'],
    moderation: (doc.moderation ?? 'active') as MarketplaceEntry['moderation'],
    engagement: {
      likes: toCounter(engagement.likes),
      installs: toCounter(engagement.installs),
      views: toCounter(engagement.views),
      trendingScore: toScore(engagement.trendingScore),
      lastEngagedAt: engagement.lastEngagedAt,
    },
    contentHash: String(doc.contentHash ?? ''),
    publishedAt: doc.publishedAt ?? new Date(0),
    updatedAt: doc.updatedAt ?? new Date(0),
    schemaVersion: doc.schemaVersion ?? 1,
  };
}

export class MongoAdapter extends StorageInterface {
  private uri: string;

  constructor(uri: string) {
    super();
    this.uri = uri;
  }

  async connect(): Promise<void> {
    if (!this.uri) {
      log.warn('No MongoDB URI provided');
      return;
    }
    try {
      await mongoose.connect(this.uri);
      log.info('Connected to MongoDB');
    } catch (error) {
      log.error('MongoDB connection error', { error: (error as Error).message });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await mongoose.disconnect();
  }

  async getUserConfig(userId: string): Promise<UserConfigType | null> {
    if (!userId) return null;
    return UserConfig.findOne({ userId: String(userId) })
      .lean<UserConfigType>()
      .exec();
  }

  async saveUserConfig(config: UserConfigType): Promise<UserConfigType> {
    return UserConfig.findOneAndUpdate(
      { userId: String(config.userId) },
      { $set: config },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    )
      .lean<UserConfigType>()
      .exec() as Promise<UserConfigType>;
  }

  async getConfigsByApiKeyId(apiKeyId: string): Promise<UserConfigType[]> {
    if (!apiKeyId) return [];
    return UserConfig.find({ apiKeyId: String(apiKeyId) })
      .sort({ updatedAt: -1 })
      .lean<UserConfigType[]>()
      .exec();
  }

  async deleteUserConfig(userId: string): Promise<boolean> {
    if (!userId) return false;
    const res = await UserConfig.findOneAndDelete({ userId: String(userId) });
    return !!res;
  }

  async getPublicStats(): Promise<PublicStats> {
    const totalUsers = await UserConfig.distinct('apiKeyId').then((ids: string[]) => ids.length);
    const catalogStats = await UserConfig.aggregate([
      { $unwind: '$catalogs' },
      {
        $match: {
          'catalogs.filters.listType': { $in: ['discover', null] },
        },
      },
      { $count: 'total' },
    ]);
    const totalCatalogs = catalogStats[0]?.total || 0;
    return { totalUsers, totalCatalogs };
  }

  // --- Marketplace persistence ---

  /**
   * Insert or update an entry keyed by (provenance.originUserId,
   * provenance.originCatalogId). On an existing entry the stable `marketplaceId`,
   * the original `publishedAt`, and the engagement counters are preserved via
   * `$setOnInsert` (which only applies on insert), while the searchable content is
   * replaced via `$set`.
   */
  async upsertMarketplaceEntry(entry: MarketplaceEntry): Promise<MarketplaceEntry> {
    const filter = {
      'provenance.originUserId': String(entry.provenance.originUserId),
      'provenance.originCatalogId': String(entry.provenance.originCatalogId),
    };

    const now = new Date();

    const set: Record<string, unknown> = {
      name: entry.name,
      description: entry.description ?? '',
      tags: entry.tags ?? [],
      type: entry.type,
      source: entry.source,
      genres: entry.genres ?? [],
      filterFacets: entry.filterFacets ?? [],
      filters: entry.filters ?? {},
      visibility: entry.visibility,
      moderation: entry.moderation,
      contentHash: entry.contentHash,
      updatedAt: now,
      schemaVersion: entry.schemaVersion ?? 1,
      'provenance.originConfigName': entry.provenance.originConfigName ?? '',
    };
    if (entry.formState !== undefined) {
      set.formState = entry.formState;
    }

    const setOnInsert: Record<string, unknown> = {
      marketplaceId: entry.marketplaceId || crypto.randomUUID(),
      publishedAt: entry.publishedAt ?? now,
      'engagement.likes': toCounter(entry.engagement?.likes),
      'engagement.installs': toCounter(entry.engagement?.installs),
      'engagement.views': toCounter(entry.engagement?.views),
      'engagement.trendingScore': toScore(entry.engagement?.trendingScore),
    };

    const updated = await MarketplaceEntryModel.findOneAndUpdate(
      filter,
      { $set: set, $setOnInsert: setOnInsert },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    )
      .lean<MarketplaceEntryDoc>()
      .exec();

    return toEntry(updated as MarketplaceEntryDoc);
  }

  async deleteMarketplaceEntryByOrigin(
    originUserId: string,
    originCatalogId: string
  ): Promise<boolean> {
    const res = await MarketplaceEntryModel.findOneAndDelete({
      'provenance.originUserId': String(originUserId),
      'provenance.originCatalogId': String(originCatalogId),
    })
      .lean<MarketplaceEntryDoc>()
      .exec();

    if (!res) return false;
    // Clean up the like ledger for the removed entry.
    await MarketplaceLikeModel.deleteMany({ marketplaceId: String(res.marketplaceId) }).exec();
    return true;
  }

  async getMarketplaceEntry(marketplaceId: string): Promise<MarketplaceEntry | null> {
    if (!marketplaceId) return null;
    const doc = await MarketplaceEntryModel.findOne({ marketplaceId: String(marketplaceId) })
      .lean<MarketplaceEntryDoc>()
      .exec();
    return doc ? toEntry(doc) : null;
  }

  async searchMarketplaceEntries(params: MarketplaceSearchParams): Promise<MarketplaceEntry[]> {
    const query = (params.q ?? '').trim();
    const matched = await this.selectMatches(params, query);
    const sort = resolveSort(params.sort, query.length > 0);
    const sorted = this.sortMatches(matched, sort, query);

    const limit = clampLimit(params.limit);
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const start = (page - 1) * limit;
    const paged = sorted.slice(start, start + limit);

    return paged.slice(0, ADAPTER_RESPONSE_CAP);
  }

  async countMarketplaceEntries(params: MarketplaceSearchParams): Promise<number> {
    const query = (params.q ?? '').trim();
    const matched = await this.selectMatches(params, query);
    return Math.min(matched.length, TOTAL_COUNT_CAP);
  }

  async incrementMarketplaceCounter(
    marketplaceId: string,
    field: CounterField,
    delta: 1 | -1
  ): Promise<number> {
    const path = `engagement.${field}`;
    const now = new Date();

    if (delta < 0) {
      // Guarded decrement: only apply when the counter is strictly positive so it
      // can never go negative. If it is already at 0 there is nothing to change.
      const doc = await MarketplaceEntryModel.findOneAndUpdate(
        { marketplaceId: String(marketplaceId), [path]: { $gt: 0 } },
        { $inc: { [path]: delta }, $set: { 'engagement.lastEngagedAt': now } },
        { new: true }
      )
        .lean<MarketplaceEntryDoc>()
        .exec();
      if (doc) return toCounter(doc.engagement?.[field]);

      // No positive counter to decrement: confirm the entry exists and report 0.
      const current = await MarketplaceEntryModel.findOne({ marketplaceId: String(marketplaceId) })
        .lean<MarketplaceEntryDoc>()
        .exec();
      if (!current) throw new Error(`Marketplace entry not found: ${marketplaceId}`);
      return toCounter(current.engagement?.[field]);
    }

    const doc = await MarketplaceEntryModel.findOneAndUpdate(
      { marketplaceId: String(marketplaceId) },
      { $inc: { [path]: delta }, $set: { 'engagement.lastEngagedAt': now } },
      { new: true }
    )
      .lean<MarketplaceEntryDoc>()
      .exec();
    if (!doc) throw new Error(`Marketplace entry not found: ${marketplaceId}`);
    return toCounter(doc.engagement?.[field]);
  }

  /**
   * Persist a recomputed trending score for an entry. Only finite, non-negative
   * values are stored; anything else is coerced to 0. Returns the stored value.
   */
  async setTrendingScore(marketplaceId: string, score: number): Promise<number> {
    const safe = Number.isFinite(score) && score > 0 ? score : 0;
    const doc = await MarketplaceEntryModel.findOneAndUpdate(
      { marketplaceId: String(marketplaceId) },
      { $set: { 'engagement.trendingScore': safe } },
      { new: true }
    )
      .lean<MarketplaceEntryDoc>()
      .exec();
    if (!doc) throw new Error(`Marketplace entry not found: ${marketplaceId}`);
    return toScore(doc.engagement?.trendingScore);
  }

  async recordLike(marketplaceId: string, actorUserId: string): Promise<boolean> {
    try {
      await MarketplaceLikeModel.create({
        marketplaceId: String(marketplaceId),
        actorUserId: String(actorUserId),
      });
      return true;
    } catch (error) {
      // Duplicate key (unique compound index) => the like already exists.
      if ((error as { code?: number }).code === 11000) return false;
      throw error;
    }
  }

  async removeLike(marketplaceId: string, actorUserId: string): Promise<boolean> {
    const res = await MarketplaceLikeModel.deleteOne({
      marketplaceId: String(marketplaceId),
      actorUserId: String(actorUserId),
    }).exec();
    return (res.deletedCount ?? 0) > 0;
  }

  async hasLiked(marketplaceId: string, actorUserId: string): Promise<boolean> {
    const doc = await MarketplaceLikeModel.findOne({
      marketplaceId: String(marketplaceId),
      actorUserId: String(actorUserId),
    })
      .lean()
      .exec();
    return !!doc;
  }

  // --- Internal search helpers ---

  /**
   * Fetch searchable candidates via an indexed `$match` on visibility/moderation
   * (plus source/type facets where present), then apply the genre facet and the
   * fuzzy name gate in-process so fuzzy inclusion matches the other adapters.
   */
  private async selectMatches(
    params: MarketplaceSearchParams,
    query: string
  ): Promise<MarketplaceEntry[]> {
    const match: Record<string, unknown> = {
      visibility: 'public',
      moderation: 'active',
    };
    if (params.facets?.source) match.source = params.facets.source;
    if (params.facets?.type) match.type = params.facets.type;

    const docs = await MarketplaceEntryModel.find(match).lean<MarketplaceEntryDoc[]>().exec();

    const out: MarketplaceEntry[] = [];
    for (const doc of docs) {
      const entry = toEntry(doc);
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
