import crypto from 'crypto';
import mongoose from 'mongoose';
import { StorageInterface } from './StorageInterface.ts';
import { UserConfig } from '../../models/UserConfig.ts';
import { MarketplaceEntryModel, MarketplaceLikeModel } from '../../models/MarketplaceEntry.ts';
import { createLogger } from '../../utils/logger.ts';
import { MARKETPLACE_RANKING, MARKETPLACE_PAGINATION } from '../../constants.ts';
import {
  nameSimilarity,
  matchesFacets,
  resolveSort,
  clampLimit,
  sortMatches,
  LEGACY_ANIME_SOURCES,
} from './searchHelpers.ts';
import type {
  UserConfig as UserConfigType,
  PublicStats,
  MarketplaceEntry,
  MarketplaceSearchParams,
  ContentType,
  SourceType,
  CatalogFilters,
  CatalogFormState,
} from '../../types/index.ts';

const log = createLogger('MongoAdapter');

const { FUZZY_THRESHOLD } = MARKETPLACE_RANKING;

const { TOTAL_COUNT_CAP, ADAPTER_RESPONSE_CAP } = MARKETPLACE_PAGINATION;

type CounterField = 'installs' | 'likes' | 'views';

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
    const sorted = sortMatches(matched, sort, query);

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
    if (params.facets?.source) {
      const sources = Array.isArray(params.facets.source)
        ? params.facets.source
        : [params.facets.source];
      match.source = sources.length > 1 ? { $in: sources } : sources[0];
    }
    if (params.facets?.type === 'anime') {
      match.$or = [
        { type: 'anime' },
        { type: 'series', source: { $in: [...LEGACY_ANIME_SOURCES] } },
      ];
    } else if (params.facets?.type) {
      match.type = params.facets.type;
    }

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
}
