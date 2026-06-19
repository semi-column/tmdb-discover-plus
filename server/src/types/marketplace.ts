import type { SourceType, CatalogFilters, CatalogFormState, CatalogConfig } from './config.ts';
import type { ContentType } from './common.ts';

// --- Lifecycle / governance enums ---

export type Visibility = 'public' | 'unlisted' | 'private';
export type ModerationStatus = 'active' | 'flagged' | 'removed';

// --- Marketplace entry (secret-free public projection of a published catalog) ---

export interface MarketplaceProvenance {
  originUserId: string; // short userId of the author (public-safe identifier)
  originCatalogId: string; // catalog _id within the author's config
  originConfigName?: string; // optional display label, sanitized
}

export interface MarketplaceEngagement {
  likes: number; // monotonic, >= 0
  installs: number; // monotonic, >= 0 (a.k.a downloads)
  views: number; // monotonic, >= 0
  trendingScore: number; // derived, recomputed on counter change / decay job
  lastEngagedAt?: Date;
}

export interface MarketplaceEntry {
  marketplaceId: string; // crypto.randomUUID(), stable public id
  provenance: MarketplaceProvenance;

  // Denormalized searchable fields (NO secrets ever)
  name: string;
  description?: string; // optional author blurb, sanitized
  tags: string[]; // normalized lowercase tokens
  type: ContentType; // movie | series | anime | collection
  source: SourceType; // tmdb | imdb | anilist | mal | simkl | trakt | kitsu
  genres: string[]; // resolved genre NAMES for faceting (source-agnostic)
  filterFacets: string[]; // flattened facet tokens, e.g. "sort:popularity.desc"
  filters: CatalogFilters; // full filter definition needed for preview + clone
  formState?: CatalogFormState; // UI hydration on clone (secret-free)

  // Lifecycle / governance
  visibility: Visibility; // only 'public' is searchable
  moderation: ModerationStatus; // only 'active' is searchable
  engagement: MarketplaceEngagement;

  // Sync bookkeeping
  contentHash: string; // hash of {name,type,source,filters} for dedupe + change detection
  publishedAt: Date;
  updatedAt: Date;
  schemaVersion: number; // for forward-compatible migrations
}

// --- Per-user like ledger (idempotency) ---

export interface MarketplaceLike {
  marketplaceId: string;
  actorUserId: string; // who liked
  createdAt: Date;
}

// --- Search ---

export type MarketplaceSort = 'relevance' | 'popular' | 'most-installed' | 'newest' | 'trending';

// Normalized facets used internally by the storage layer.
export interface MarketplaceSearchFacets {
  source?: SourceType;
  type?: ContentType;
  genres?: string[];
}

// Normalized params passed to the storage adapter (post-sanitization).
export interface MarketplaceSearchParams {
  q?: string;
  facets?: MarketplaceSearchFacets;
  sort?: MarketplaceSort;
  page?: number;
  limit?: number;
}

// Raw query received on GET /marketplace/search (pre-normalization).
export interface MarketplaceSearchQuery {
  q?: string;
  source?: SourceType;
  type?: ContentType;
  genres?: string; // comma-separated, parsed to string[]
  sort?: MarketplaceSort;
  page?: number;
  limit?: number;
}

// Wire projection — no filters internals beyond what preview needs.
export interface MarketplaceSearchCard {
  marketplaceId: string;
  name: string;
  description?: string;
  tags: string[];
  type: ContentType;
  source: SourceType;
  genres: string[];
  engagement: { likes: number; installs: number; trendingScore: number };
  provenance: { originUserId: string; originConfigName?: string };
  publishedAt: string;
}

export interface MarketplaceSearchResult {
  items: MarketplaceSearchCard[];
  page: number;
  limit: number;
  total: number;
  sort: string;
}

// --- Request / response shapes ---

// POST /marketplace/publish
export interface PublishRequest {
  userId: string;
  catalogId: string;
  description?: string;
  tags?: string[];
}

// POST /marketplace/:id/install
export interface InstallRequest {
  targetUserId: string;
}

export interface InstallResult {
  catalog: CatalogConfig;
  installs: number;
  alreadyInstalled: boolean;
}

// POST/DELETE /marketplace/:id/like
export interface LikeResult {
  liked: boolean;
  likes: number;
}
