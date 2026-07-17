import crypto from 'crypto';

import { getStorage } from './storage/index.ts';
import { getUserConfig, saveUserConfig } from './configService.ts';
import { toPublicProjection, containsNoSecrets } from './marketplace/projection.ts';
import { validateMarketplaceEntry } from './marketplace/validation.ts';
import { parseSources, parseGenres } from './marketplace/facetParsing.ts';
import { getMarketplaceCache } from '../infrastructure/marketplaceCache.ts';
import {
  MARKETPLACE_LIMITS,
  MARKETPLACE_PAGINATION,
  MARKETPLACE_RANKING,
  MARKETPLACE_SORT_MODES,
  MARKETPLACE_TYPES,
} from '../constants.ts';
import { createLogger } from '../utils/logger.ts';
import { isValidUserId, isValidCatalogId, sanitizeString } from '../utils/validation.ts';
import { stableStringify } from '../utils/stableStringify.ts';
import { AppError, ErrorCodes } from '../utils/AppError.ts';
import type {
  CatalogConfig,
  CatalogFilters,
  ClonedFrom,
  SourceType,
  UserConfig,
} from '../types/config.ts';
import type { ContentType } from '../types/common.ts';
import type {
  InstallResult,
  LikeResult,
  MarketplaceEntry,
  MarketplaceSearchCard,
  MarketplaceSearchFacets,
  MarketplaceSearchParams,
  MarketplaceSearchQuery,
  MarketplaceSearchResult,
  MarketplaceSort,
} from '../types/marketplace.ts';

const log = createLogger('marketplaceService');
const DISABLED_MARKETPLACE_SOURCES = new Set<SourceType>(['mal']);

/**
 * Options accepted by {@link publishCatalog}. Author-supplied description/tags
 * are merged onto the catalog before the public projection is built so they
 * pass through the same sanitization as the rest of the entry.
 */
export interface PublishOptions {
  description?: string;
  tags?: string[];
}

/**
 * Locate a catalog within a user config by its stable `_id` (falling back to
 * the legacy `id` field). Returns `null` when no matching catalog exists.
 */
function findCatalogById(
  catalogs: CatalogConfig[] | undefined,
  catalogId: string
): CatalogConfig | null {
  if (!Array.isArray(catalogs)) return null;
  return catalogs.find((c) => c._id === catalogId || c.id === catalogId) ?? null;
}

/**
 * Publish (or re-publish) a catalog the requesting user owns to the marketplace.
 *
 * The author's config is loaded and the target catalog is located within it.
 * A secret-free Public_Projection is built, strictly validated, asserted to
 * contain no secrets, and upserted keyed by the `(originUserId, originCatalogId)`
 * pair — so a repeat publish updates the existing entry in place rather than
 * creating a duplicate, and the storage layer preserves engagement counters of
 * an existing entry. The entry-detail and search caches are then invalidated.
 *
 * Authentication (401) is enforced at the route layer; this service assumes an
 * authenticated `userId` but still rejects ownership violations (403) and
 * missing config/catalog (404).
 *
 * Requirements: 1.1, 1.2, 1.4, 1.10, 4.x (lifecycle), 10.5, 10.6, 22.2.
 */
export async function publishCatalog(
  userId: string,
  catalogId: string,
  opts: PublishOptions = {}
): Promise<MarketplaceEntry> {
  if (!isValidUserId(userId)) {
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'Invalid or missing user identity');
  }
  if (!isValidCatalogId(catalogId)) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Catalog not found');
  }

  // Load the owner's config. A missing config means there is nothing to publish.
  const config = await getUserConfig(userId);
  if (!config) {
    throw new AppError(404, ErrorCodes.CONFIG_NOT_FOUND, 'Configuration not found');
  }

  // Ownership: only catalogs that live in the requesting user's own config can
  // be published by that user. A catalog owned by someone else is a 403.
  if (config.userId !== userId) {
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'You do not own this catalog');
  }

  const catalog = findCatalogById(config.catalogs, catalogId);
  if (!catalog) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Catalog not found');
  }

  // Merge author-supplied description/tags onto the projection input so they are
  // sanitized by `toPublicProjection`. Cast widens the input past CatalogConfig,
  // whose declared shape does not include description/tags.
  const projectionInput = {
    ...catalog,
    ...(opts.description !== undefined ? { description: opts.description } : {}),
    ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
  } as CatalogConfig;

  // Build the secret-free projection (throws on filter-sanitization failure or
  // any secret), strictly validate it, then re-assert no secret leaked through.
  const entry = toPublicProjection(userId, projectionInput);
  validateMarketplaceEntry(entry);
  if (!containsNoSecrets(entry)) {
    throw new AppError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      'Public projection rejected: contains a secret field'
    );
  }

  const storage = getStorage();
  const stored = await storage.upsertMarketplaceEntry(entry);

  // Invalidate the affected entry-detail key and clear the search namespace so
  // the new/updated entry is reflected immediately.
  const cache = getMarketplaceCache();
  cache.invalidateEntry(stored.marketplaceId);
  cache.invalidateSearchNamespace();

  log.info('Published catalog to marketplace', {
    userId,
    catalogId,
    marketplaceId: stored.marketplaceId,
  });

  return stored;
}

/**
 * Unpublish a catalog the requesting user previously published.
 *
 * The entry is deleted by its `(originUserId, originCatalogId)` origin pair, so
 * a user can only ever remove their own entry (ownership is enforced by
 * construction). When no entry existed for the pair the request is rejected
 * with a 404. On success the search namespace is invalidated so the entry no
 * longer appears in subsequent search results.
 *
 * Authentication (401) is enforced at the route layer.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 10.6.
 */
export async function unpublishCatalog(userId: string, catalogId: string): Promise<void> {
  if (!isValidUserId(userId)) {
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'Invalid or missing user identity');
  }
  if (!isValidCatalogId(catalogId)) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Marketplace entry not found');
  }

  const storage = getStorage();
  const deleted = await storage.deleteMarketplaceEntryByOrigin(userId, catalogId);
  if (!deleted) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Marketplace entry not found');
  }

  // Removing an entry only affects search visibility; clearing the search
  // namespace guarantees the entry is excluded from queries received after the
  // deletion completes (consistent with reconciliation's invalidation).
  getMarketplaceCache().invalidateSearchNamespace();

  log.info('Unpublished catalog from marketplace', { userId, catalogId });
}

/**
 * Compute the effective public content hash for a published catalog.
 *
 * The hash is taken from the catalog's secret-free public projection so that a
 * previously indexed catalog and its successor are compared on identical terms
 * (sanitized name + source-sanitized filters). When the catalog can no longer
 * be projected (e.g. it lost its source), `null` is returned so any still
 * published counterpart in `next` is treated as changed and re-upserted.
 */
function effectiveContentHash(userId: string, catalog: CatalogConfig): string | null {
  try {
    return toPublicProjection(userId, catalog).contentHash;
  } catch {
    return null;
  }
}

/** Resolve a catalog's stable identifier, falling back to the legacy `id`. */
function catalogIdOf(catalog: CatalogConfig): string | null {
  return catalog?._id || catalog?.id || null;
}

/**
 * Whether a catalog should be indexed in the marketplace.
 *
 * Catalogs are PUBLIC BY DEFAULT (opt-out): a catalog is treated as published
 * unless its author explicitly marks it private with `published === false`. This
 * ensures the marketplace is populated for new users without requiring an
 * explicit publish step. Authors opt a catalog out via the per-catalog
 * Public/Private toggle, which sets `published: false`.
 */
function isPublishedCatalog(catalog: CatalogConfig): boolean {
  return catalog?.published !== false;
}

/**
 * Whether a catalog is one of the stock default "preset" catalogs (e.g. Popular,
 * Trending, Top Rated). These are identical across every user, so they are
 * excluded from automatic marketplace indexing — otherwise the marketplace fills
 * with thousands of duplicate default cards. A catalog is a preset when it has a
 * non-`discover` list type that is not a collection/studio catalog and was not
 * promoted from a preset (`presetOrigin`). Mirrors the client's `isPresetCatalog`
 * definition in CatalogEditor.
 *
 * Note: this only affects automatic reconciliation. An author can still publish
 * a preset explicitly via the publish endpoint.
 */
function isPresetCatalog(catalog: CatalogConfig): boolean {
  const filters = (catalog?.filters ?? {}) as { listType?: string; presetOrigin?: unknown };
  const listType = filters.listType;
  if (!listType || listType === 'discover') return false;
  if (listType === 'collection' || listType === 'studio') return false;
  return !filters.presetOrigin;
}

/**
 * Whether a catalog should be auto-indexed during reconciliation: public
 * (opt-out) and not a stock preset.
 */
function shouldAutoIndex(catalog: CatalogConfig): boolean {
  return isPublishedCatalog(catalog) && !isPresetCatalog(catalog);
}

/**
 * Reconcile a user's marketplace entries against a freshly-saved configuration.
 *
 * Diffs the set of published catalogs between `prev` (the configuration state
 * before the save, or `null` on first save) and `next` (the just-persisted
 * configuration) and brings the Marketplace_Index into sync with `next`:
 *
 * - A published catalog that is new, or whose Content_Hash changed since it was
 *   last indexed, is re-projected and upserted keyed by its
 *   `(originUserId, originCatalogId)` pair. The storage layer preserves the
 *   existing Engagement_Counter values across the upsert (Req 5.2, 5.5).
 * - A published catalog whose Content_Hash is unchanged is left untouched — no
 *   write is performed and its counters are preserved (Req 5.3).
 * - A previously published catalog that was deleted or toggled non-public is
 *   removed from the index by its origin pair (Req 5.4).
 *
 * The post-condition is that the indexed entries for this user equal exactly
 * the set of catalogs in `next` flagged `published` and not deleted (Req 5.1).
 *
 * Partial-failure semantics (Req 5.6): if any upsert or delete throws,
 * reconciliation stops and the error is surfaced to the caller. Successfully
 * applied operations are NOT rolled back, and every entry that was not
 * successfully modified is left in its pre-reconciliation state. The search
 * namespace is invalidated whenever at least one mutation was applied so the
 * cache never serves a state that diverges from the index.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6.
 */
export async function reconcileMarketplaceEntries(
  prev: UserConfig | null,
  next: UserConfig
): Promise<void> {
  if (!next || !isValidUserId(next.userId)) {
    throw new AppError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      'Cannot reconcile marketplace: invalid or missing configuration'
    );
  }

  const userId = next.userId;
  const storage = getStorage();

  // prevPublished: catalogId -> last-indexed content hash, for catalogs that
  // were auto-indexed (public, non-preset) in the previous configuration state.
  const prevPublished = new Map<string, string | null>();
  for (const catalog of prev?.catalogs ?? []) {
    if (!shouldAutoIndex(catalog)) continue;
    const catalogId = catalogIdOf(catalog);
    if (!catalogId) continue;
    prevPublished.set(catalogId, effectiveContentHash(prev!.userId, catalog));
  }

  // nextPublished: catalogId -> catalog, for catalogs auto-indexed (public,
  // non-preset) in the saved configuration state.
  const nextPublished = new Map<string, CatalogConfig>();
  for (const catalog of next.catalogs ?? []) {
    if (!shouldAutoIndex(catalog)) continue;
    const catalogId = catalogIdOf(catalog);
    if (!catalogId) continue;
    nextPublished.set(catalogId, catalog);
  }

  let mutated = false;
  try {
    // Upsert published catalogs that were newly published or whose content
    // changed. Unchanged catalogs (matching hash) are skipped entirely.
    for (const [catalogId, catalog] of nextPublished) {
      // Public-by-default means in-progress catalogs (e.g. no name yet, missing
      // source) can reach this loop. Such catalogs cannot be projected, so skip
      // them rather than aborting the whole reconciliation — they will be
      // indexed on a later save once they become valid.
      let entry: MarketplaceEntry;
      try {
        entry = toPublicProjection(userId, catalog);
      } catch {
        continue;
      }
      // Hard invariant: a secret must never enter the index (Req 2.2, 2.6).
      if (!containsNoSecrets(entry)) {
        throw new AppError(
          400,
          ErrorCodes.VALIDATION_ERROR,
          'Reconciliation rejected: public projection contains a secret field'
        );
      }

      const prevHash = prevPublished.get(catalogId);
      const wasPublished = prevPublished.has(catalogId);
      if (!wasPublished || prevHash !== entry.contentHash) {
        await storage.upsertMarketplaceEntry(entry);
        mutated = true;
      }
    }

    // Delete entries whose catalog was deleted or toggled non-public.
    for (const catalogId of prevPublished.keys()) {
      if (!nextPublished.has(catalogId)) {
        const deleted = await storage.deleteMarketplaceEntryByOrigin(userId, catalogId);
        if (deleted) mutated = true;
      }
    }
  } catch (err) {
    // Partial failure (Req 5.6): surface the error without rolling back already
    // applied operations. Invalidate search if anything was mutated so the
    // cache reflects the partial-but-committed index state.
    if (mutated) {
      try {
        getMarketplaceCache().invalidateSearchNamespace();
      } catch {
        // Best-effort cache invalidation; never mask the original failure.
      }
    }
    log.error('Marketplace reconciliation did not complete', {
      userId,
      error: err instanceof Error ? err.message : 'unknown error',
    });
    if (err instanceof AppError) throw err;
    throw new AppError(
      500,
      ErrorCodes.INTERNAL_ERROR,
      'Marketplace reconciliation did not complete'
    );
  }

  // Success: clear the search namespace so the index changes are visible to
  // subsequent queries.
  getMarketplaceCache().invalidateSearchNamespace();

  log.info('Reconciled marketplace entries', {
    userId,
    published: nextPublished.size,
    mutated,
  });
}

// ---------------------------------------------------------------------------
// Search orchestration
// ---------------------------------------------------------------------------

const { MAX_QUERY_LENGTH } = MARKETPLACE_LIMITS;
const { DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_PAGE_SIZE, TOTAL_COUNT_CAP } = MARKETPLACE_PAGINATION;

const VALID_TYPES = new Set<string>(MARKETPLACE_TYPES);
const VALID_SORTS = new Set<string>(MARKETPLACE_SORT_MODES);

const SEARCH_CACHE_PREFIX = 'mkt:search:';

/**
 * Normalize and truncate the raw query string.
 *
 * `sanitizeString` strips control characters, trims surrounding whitespace, and
 * caps length at `MAX_QUERY_LENGTH` (256) so the query is truncated to its first
 * 256 characters before any matching takes place (Req 6.6). Returns the empty
 * string when no usable query was supplied.
 */
function normalizeQuery(raw: unknown): string {
  return sanitizeString(raw, MAX_QUERY_LENGTH);
}

/**
 * Validate the source/type facets against their case-sensitive allow-lists and
 * parse the comma-separated genre list into trimmed, de-duplicated tokens.
 *
 * An unrecognized source or type is a 400 validation error identifying the
 * offending facet value, and no result entries are returned (Req 6.7, 6.2).
 * Genres are free-form names (no fixed allow-list), so they are split on commas,
 * trimmed, lowercased for de-duplication-by-value, emptied entries dropped, and
 * capped at a defensive maximum.
 */
function validateAndParseFacets(
  query: MarketplaceSearchQuery
): MarketplaceSearchFacets | undefined {
  const facets: MarketplaceSearchFacets = {};

  if (query.source !== undefined && query.source !== null && query.source !== ('' as SourceType)) {
    const sources = parseSources(query.source);
    if (sources?.length === 1) {
      facets.source = sources[0];
    } else if (sources && sources.length > 1) {
      facets.source = sources;
    }
  }

  if (query.type !== undefined && query.type !== null && query.type !== ('' as ContentType)) {
    const type = String(query.type);
    if (!VALID_TYPES.has(type)) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `Invalid type facet: "${type}"`);
    }
    facets.type = type as ContentType;
  }

  const genres = parseGenres(query.genres);
  if (genres.length > 0) facets.genres = genres;

  // Only attach a facets object when at least one constraint is present.
  if (facets.source === undefined && facets.type === undefined && facets.genres === undefined) {
    return undefined;
  }
  return facets;
}

/**
 * Resolve the effective sort mode. An explicit mode is honored only when it is
 * one of the allowed values; otherwise (unrecognized or omitted) the default is
 * applied — `trending` when the query string is empty, `relevance` when it is
 * not — without raising an error (Req 8.8, 8.9, 6.5).
 */
function resolveSortMode(sort: unknown, hasQuery: boolean): MarketplaceSort {
  if (typeof sort === 'string' && VALID_SORTS.has(sort)) {
    return sort as MarketplaceSort;
  }
  return hasQuery ? 'relevance' : 'trending';
}

/**
 * Clamp the requested page size to the inclusive range [1, 50], defaulting to
 * 24 when omitted or non-numeric (Req 9.1, 9.2, 9.3).
 */
function resolveLimit(limit: unknown): number {
  const value = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(value)));
}

/**
 * Resolve the zero-based page index, defaulting to 0 when omitted, non-numeric,
 * or negative (Req 9.4, 9.5).
 */
function resolvePage(page: unknown): number {
  const value = typeof page === 'number' ? page : Number(page);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/**
 * Build a stable cache key from the canonicalized search signature. Key order is
 * normalized by `stableStringify` so semantically identical queries share a key.
 */
function buildSearchCacheKey(signature: {
  q: string;
  facets?: MarketplaceSearchFacets;
  page: number;
  limit: number;
  sort: MarketplaceSort;
}): string {
  const canonical = stableStringify(signature);
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  return `${SEARCH_CACHE_PREFIX}${hash}`;
}

/**
 * Project a Marketplace_Entry onto the secret-free Search_Card wire shape. Only
 * fields that exist on the public projection are surfaced (Req 2.5).
 */
function toSearchCard(entry: MarketplaceEntry): MarketplaceSearchCard {
  const publishedAt =
    entry.publishedAt instanceof Date
      ? entry.publishedAt.toISOString()
      : new Date(entry.publishedAt).toISOString();

  return {
    marketplaceId: entry.marketplaceId,
    name: entry.name,
    description: entry.description,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    type: entry.type,
    source: entry.source,
    genres: Array.isArray(entry.genres) ? entry.genres : [],
    engagement: {
      likes: entry.engagement?.likes ?? 0,
      installs: entry.engagement?.installs ?? 0,
      trendingScore: entry.engagement?.trendingScore ?? 0,
    },
    provenance: {
      originUserId: entry.provenance?.originUserId,
      originConfigName: entry.provenance?.originConfigName,
    },
    publishedAt,
  };
}

/** Defensive guard: an entry is searchable only when public AND active. */
function isPublicActive(entry: MarketplaceEntry): boolean {
  return entry?.visibility === 'public' && entry?.moderation === 'active';
}

/**
 * Search the marketplace index and return a ranked, paginated page of
 * Search_Cards.
 *
 * The service orchestrates query normalization/truncation, facet validation,
 * sort-mode resolution, and page/limit clamping, then delegates the actual
 * ranking to the storage adapter. The adapter enforces visibility/moderation
 * filtering, the fuzzy `>= 0.70` name-similarity gate, the composite score
 * (name-weighted highest, log-dampened popularity), and the stable
 * `marketplaceId` tiebreak; this layer projects the returned rows to the
 * secret-free wire shape and reports the capped total.
 *
 * Pagination is exposed to callers as a zero-based page index (Req 9.4), while
 * the storage adapter expects a 1-based page (`start = (page - 1) * limit`); the
 * external index is converted to the adapter's convention as `externalPage + 1`.
 *
 * Results are cached per canonicalized signature with stampede protection. The
 * loader asserts every returned row is public + active before projecting it, and
 * the reported total is the estimated matched count capped at 1000 (Req 9.6).
 * When the resolved page begins at or beyond the total, the adapter naturally
 * returns no rows and the empty page is reported alongside the resolved page,
 * limit, sort, and total (Req 9.7, 9.8).
 *
 * Requirements: 6.1-6.7, 8.1-8.9, 9.1-9.8, 2.5.
 */
export async function searchMarketplace(
  query: MarketplaceSearchQuery = {}
): Promise<MarketplaceSearchResult> {
  // 1. Normalize + truncate the query, validate facets, and resolve the sort
  //    mode / pagination bounds. Facet validation may reject with a 400.
  const q = normalizeQuery(query.q);
  const facets = validateAndParseFacets(query);
  const sort = resolveSortMode(query.sort, q.length > 0);
  const limit = resolveLimit(query.limit);
  const page = resolvePage(query.page);

  if (facets?.source) {
    const requestedSources = Array.isArray(facets.source) ? facets.source : [facets.source];
    const enabledSources = requestedSources.filter(
      (source) => !DISABLED_MARKETPLACE_SOURCES.has(source)
    );
    if (enabledSources.length === 0) {
      return { items: [], page, limit, total: 0, sort };
    }
    facets.source = enabledSources.length === 1 ? enabledSources[0] : enabledSources;
  }

  // 2. Compose the normalized adapter params. The adapter is 1-based; convert
  //    the zero-based external page index accordingly.
  const params: MarketplaceSearchParams = {
    q: q.length > 0 ? q : undefined,
    facets,
    sort,
    page: page + 1,
    limit,
  };

  // 3. Cache key is derived from the external (zero-based) signature so callers
  //    paginating the same query share cached pages.
  const cacheKey = buildSearchCacheKey({ q, facets, page, limit, sort });

  const result = (await getMarketplaceCache().getOrLoad(cacheKey, async () => {
    const storage = getStorage();
    const [rows, matched] = await Promise.all([
      storage.searchMarketplaceEntries(params),
      storage.countMarketplaceEntries(params),
    ]);

    // Defensive invariant: the adapter already excludes non-public / non-active
    // rows, but never project a row that slipped through.
    const visible = rows.filter(
      (entry) => isPublicActive(entry) && !DISABLED_MARKETPLACE_SOURCES.has(entry.source)
    );

    const items = visible.map(toSearchCard);
    const total = Math.min(Math.max(0, Math.floor(matched)), TOTAL_COUNT_CAP);

    return { items, page, limit, total, sort } satisfies MarketplaceSearchResult;
  })) as MarketplaceSearchResult;

  return result;
}

// ---------------------------------------------------------------------------
// Entry detail + view counting
// ---------------------------------------------------------------------------

/**
 * Retrieve a single Marketplace_Entry's public detail by its `marketplaceId`,
 * recording exactly one view per successful retrieval.
 *
 * A Marketplace_Entry is itself the secret-free public projection of a catalog,
 * so the returned object is exactly the set of publicly visible fields — no
 * private/internal field is added (Req 11.1).
 *
 * Behavior:
 * - The identifier is validated first. A missing, empty, or malformed id is a
 *   400 and no counter is touched (Req 11.4). A `marketplaceId` is a UUID, which
 *   fits the catalog-id shape (`[A-Za-z0-9_-]{1,64}`), so `isValidCatalogId`
 *   serves as the cheap format gate.
 * - A syntactically valid id that matches no entry is a 404, and no counter is
 *   touched (Req 11.3).
 * - On a successful lookup the `views` counter is advanced atomically by exactly
 *   1 — at most once per retrieval — via `incrementMarketplaceCounter`, so the
 *   stored value stays consistent under concurrent retrievals (Req 11.2).
 * - If the increment fails, the entry's publicly visible fields are still
 *   returned with the last successfully recorded `views` value, and no partial
 *   update is applied (Req 11.5).
 *
 * Caching note: unlike search and publish/install/like (which read/invalidate
 * the `mkt:entry:{id}` cache), this read path deliberately fetches the entry
 * fresh from storage rather than serving a cached copy. Req 11.2 requires the
 * view counter to advance once *per retrieval*; serving a cache hit would
 * suppress that increment, so reading fresh keeps the persisted counter and the
 * returned `engagement.views` mutually consistent.
 *
 * Authentication, where required, is enforced at the route layer.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5.
 */
export async function getEntry(entryId: string): Promise<MarketplaceEntry> {
  // Req 11.4: reject missing/empty/malformed identifiers before any lookup or
  // counter mutation.
  if (!isValidCatalogId(entryId)) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Invalid marketplace entry identifier');
  }

  const storage = getStorage();
  const entry = await storage.getMarketplaceEntry(entryId);

  // Req 11.3: a syntactically valid id with no matching entry is a 404, and no
  // counter is incremented.
  if (!entry) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Marketplace entry not found');
  }

  // Req 11.2 / 11.5: advance views atomically by exactly 1; if the increment
  // fails, return the entry untouched with its last recorded views value rather
  // than failing the request or applying a partial update.
  try {
    const views = await storage.incrementMarketplaceCounter(entryId, 'views', 1);
    if (Number.isFinite(views)) {
      entry.engagement = { ...entry.engagement, views };
    }
  } catch (err) {
    log.warn('Failed to increment marketplace views; returning last recorded value', {
      marketplaceId: entryId,
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }

  // The entry is the secret-free public projection, so its fields are exactly
  // the publicly visible set (Req 11.1).
  return entry;
}

// ---------------------------------------------------------------------------
// Clone / install
// ---------------------------------------------------------------------------

/** An entry is installable only when it is both public and active. */
function isInstallable(entry: MarketplaceEntry): boolean {
  return entry?.visibility === 'public' && entry?.moderation === 'active';
}

/**
 * Produce a fresh {@link CatalogConfig} cloned from a Marketplace_Entry.
 *
 * The clone receives a brand-new stable identifier (`_id = crypto.randomUUID()`)
 * that is guaranteed to differ from the origin catalog identifier, copies the
 * entry's `name`/`type`/`source`/`filters`/`formState` verbatim (so previewing
 * the clone yields the same query as the origin — Req 13.2, 13.5), is force-enabled
 * (Req 13.3), and carries full `clonedFrom` provenance with a UTC clone timestamp
 * captured at creation time (Req 13.4, 22.5).
 *
 * Provenance completeness is a hard precondition (Req 22.6): if the source entry
 * lacks any of `marketplaceId`, origin user id, or origin catalog id, the clone is
 * not created and a validation error is raised instead.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 22.5, 22.6.
 */
export function cloneCatalog(entry: MarketplaceEntry): CatalogConfig {
  const marketplaceId = entry?.marketplaceId;
  const originUserId = entry?.provenance?.originUserId;
  const originCatalogId = entry?.provenance?.originCatalogId;

  // Req 22.6: incomplete provenance means we cannot record where the clone came
  // from, so the clone must not be created.
  if (!marketplaceId || !originUserId || !originCatalogId) {
    throw new AppError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      'Cannot clone marketplace entry: incomplete provenance'
    );
  }

  // Req 13.1: a fresh UUID that differs from the origin catalog identifier.
  // Collisions are astronomically unlikely, but regenerate defensively just in
  // case the origin catalog id was itself a UUID equal to the draw.
  let newId = crypto.randomUUID();
  while (newId === originCatalogId) {
    newId = crypto.randomUUID();
  }

  const clonedFrom: ClonedFrom = {
    marketplaceId,
    originUserId,
    originCatalogId,
    clonedAt: new Date().toISOString(), // Req 13.4: UTC timestamp at creation
  };

  // Req 13.2 / 13.5: copy name/type/source/filters/formState verbatim so the
  // clone previews identically to the origin entry.
  const clone: CatalogConfig = {
    _id: newId,
    name: entry.name,
    type: entry.type,
    source: entry.source,
    filters: entry.filters,
    ...(entry.formState !== undefined ? { formState: entry.formState } : {}),
    enabled: true, // Req 13.3
    // Catalogs are public-by-default, but an installed clone is private by
    // default so installing someone else's catalog does not immediately
    // re-publish a duplicate under the installer's account. The installer can
    // opt the clone back into the marketplace via the Public/Private toggle.
    published: false,
    clonedFrom,
  };

  return clone;
}

/**
 * Install a Marketplace_Entry into a target user's configuration as a cloned
 * catalog, recording exactly one install on a genuinely new install.
 *
 * Flow (design `installEntry` pseudocode is authoritative):
 * - Load the entry; if it is missing or not both public AND active, respond 404
 *   and create nothing (Req 13.9).
 * - Load the target config; a missing config is a 404 (`CONFIG_NOT_FOUND`).
 *   Ownership/authentication is enforced upstream at the route layer (Req 13.8);
 *   the service still 404s a missing target configuration.
 * - Dedupe by `clonedFrom.marketplaceId`: if the target already holds a clone of
 *   this entry, return the existing catalog with `alreadyInstalled = true` and do
 *   NOT bump the installs counter (Req 14.1, 14.2).
 * - Otherwise clone the entry, append it as the LAST catalog (Req 13.6), and
 *   persist through `saveUserConfig` (reusing its validation, encryption, and
 *   cache invalidation — install never touches secrets). If the save throws, the
 *   target configuration is left unchanged (nothing was persisted) and the
 *   counter is untouched, so its prior value is retained; an error indicating the
 *   install did not complete is surfaced (Req 13.7, 14.4).
 * - On a successful save, increment the `installs` counter atomically by exactly
 *   1 (Req 14.3). Because the increment happens only after a successful save and
 *   the dedupe check short-circuits repeat installs, concurrent installs of the
 *   same entry by the same user add at most one clone and at most one increment
 *   in aggregate (Req 14.5).
 * - Invalidate the entry-detail cache and the search namespace so the updated
 *   engagement is reflected immediately.
 *
 * Requirements: 13.1-13.9, 14.1-14.5, 22.6.
 */
export async function installEntry(entryId: string, targetUserId: string): Promise<InstallResult> {
  const storage = getStorage();

  // Req 13.9: the entry must exist and be both public + active; otherwise 404
  // and create nothing.
  const entry = await storage.getMarketplaceEntry(entryId);
  if (!entry || !isInstallable(entry)) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Catalog not available');
  }

  // The route enforces ownership/auth of targetUserId; the service still 404s a
  // missing target configuration.
  const config = await getUserConfig(targetUserId);
  if (!config) {
    throw new AppError(404, ErrorCodes.CONFIG_NOT_FOUND, 'Configuration not found');
  }

  // Req 14.1 / 14.2: idempotent dedupe by source marketplaceId. A repeat install
  // returns the existing clone untouched, flags alreadyInstalled, and never bumps
  // the counter.
  const existing = (config.catalogs ?? []).find((c) => c.clonedFrom?.marketplaceId === entryId);
  if (existing) {
    return {
      catalog: existing,
      installs: entry.engagement?.installs ?? 0,
      alreadyInstalled: true,
    };
  }

  // Req 13.1-13.5: build the clone. cloneCatalog enforces provenance completeness
  // (Req 22.6) and guarantees a fresh id distinct from the origin catalog id.
  const clone = cloneCatalog(entry);

  // Req 13.6: append as the LAST catalog and persist via the existing save path.
  // Req 13.7 / 14.4: if persistence fails, nothing was committed — the target
  // configuration is unchanged and the counter is never touched — so surface an
  // error indicating the install did not complete.
  const nextConfig: UserConfig = {
    ...config,
    catalogs: [...(config.catalogs ?? []), clone],
  };
  try {
    await saveUserConfig(nextConfig);
  } catch (err) {
    log.error('Install failed to persist cloned catalog', {
      marketplaceId: entryId,
      targetUserId,
      error: err instanceof Error ? err.message : 'unknown error',
    });
    throw new AppError(
      500,
      ErrorCodes.INTERNAL_ERROR,
      'Install did not complete: failed to save configuration'
    );
  }

  // Req 14.3: only on a genuinely new install, increment installs atomically by
  // exactly 1. If the increment itself fails the clone is already persisted (the
  // install did happen), so fall back to the last recorded value rather than
  // failing the request or rolling back the saved catalog.
  let installs = entry.engagement?.installs ?? 0;
  try {
    const next = await storage.incrementMarketplaceCounter(entryId, 'installs', 1);
    if (Number.isFinite(next)) installs = next;
  } catch (err) {
    log.warn('Install persisted but failed to increment installs counter', {
      marketplaceId: entryId,
      targetUserId,
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }

  // Recompute the Trending_Score now that the installs counter changed (Req
  // 17.1). Best-effort: a failure here must not fail the install — the clone is
  // already persisted and the counter already advanced — so we log and proceed.
  try {
    await recomputeTrending(entryId);
  } catch (err) {
    log.warn('Install persisted but failed to recompute trending score', {
      marketplaceId: entryId,
      targetUserId,
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }

  // Invalidate the affected entry-detail key and the search namespace so the new
  // install count (and the trending recompute) is reflected immediately.
  const cache = getMarketplaceCache();
  cache.invalidateEntry(entryId);
  cache.invalidateSearchNamespace();

  log.info('Installed marketplace entry', {
    marketplaceId: entryId,
    targetUserId,
    clonedCatalogId: clone._id,
  });

  return { catalog: clone, installs, alreadyInstalled: false };
}

// ---------------------------------------------------------------------------
// Engagement: likes + trending recompute
// ---------------------------------------------------------------------------

const { TRENDING_GRAVITY } = MARKETPLACE_RANKING;
const { RECENCY_WINDOW_HOURS } = MARKETPLACE_LIMITS;
const MS_PER_HOUR = 3_600_000;

/**
 * Recompute and persist the denormalized Trending_Score for a single entry.
 *
 * Formula (design "Ranking & scoring"):
 *
 *   trendingScore = (installs_window + 2 * likes_window)
 *                 / (hoursSincePublished + 2) ^ TRENDING_GRAVITY
 *
 * Window proxy (Req 17.2): per-window engagement deltas are not tracked
 * separately — only the monotonic lifetime counters exist — so the lifetime
 * `installs`/`likes` are used as the windowed-engagement proxy, gated by the
 * trailing {@link RECENCY_WINDOW_HOURS} (168h) recency window. Recency is judged
 * from `lastEngagedAt` (falling back to `publishedAt` when no engagement has
 * been recorded): if the most recent engagement is older than the window, the
 * windowed engagement decays to 0 so a long-stale entry is not treated as
 * trending. This favors recently engaged catalogs while staying deterministic.
 *
 * Time decay (Req 17.3): the divisor is `(hoursSincePublished + 2) ^ gravity`
 * with `hoursSincePublished` floored at 0 (guarding against clock skew / a
 * future `publishedAt`) and the whole divisor floored at a minimum of 1, so it
 * is never zero or negative.
 *
 * Non-finite / negative guard (Req 17.4, 17.5): if the computed score is not a
 * finite number `>= 0`, a Trending_Score of 0 is stored instead. The recompute
 * never mutates the engagement counters themselves — it only writes the derived
 * score (Req 17.6, denormalized for indexed sorting).
 *
 * A missing entry is a 404. Cache invalidation is the caller's responsibility
 * (install/like/unlike each invalidate after recomputing), so this routine only
 * reads the entry and persists the score.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6.
 */
export async function recomputeTrending(entryId: string): Promise<number> {
  const storage = getStorage();
  const entry = await storage.getMarketplaceEntry(entryId);
  if (!entry) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Marketplace entry not found');
  }

  const installs = Math.max(0, entry.engagement?.installs ?? 0);
  const likes = Math.max(0, entry.engagement?.likes ?? 0);

  // Hours since publication, floored at 0 so a future-dated publishedAt or clock
  // skew can never make the base negative.
  const publishedMs =
    entry.publishedAt instanceof Date
      ? entry.publishedAt.getTime()
      : new Date(entry.publishedAt).getTime();
  const hoursSincePublished = Number.isFinite(publishedMs)
    ? Math.max(0, (Date.now() - publishedMs) / MS_PER_HOUR)
    : 0;

  // Recency gate: judge from lastEngagedAt, falling back to publishedAt. When the
  // most recent engagement predates the recency window, the windowed engagement
  // proxy collapses to 0 (stale entries are no longer "trending").
  const lastEngagedMs =
    entry.engagement?.lastEngagedAt instanceof Date
      ? entry.engagement.lastEngagedAt.getTime()
      : Number.isFinite(publishedMs)
        ? publishedMs
        : Date.now();
  const hoursSinceEngaged = Math.max(0, (Date.now() - lastEngagedMs) / MS_PER_HOUR);
  const withinWindow = hoursSinceEngaged <= RECENCY_WINDOW_HOURS;

  // Lifetime counters as the windowed-engagement proxy, zeroed when stale.
  const windowedEngagement = withinWindow ? installs + 2 * likes : 0;

  // Time-decay divisor, floored at a minimum of 1 (Req 17.3).
  const divisor = Math.max(1, Math.pow(hoursSincePublished + 2, TRENDING_GRAVITY));

  let score = windowedEngagement / divisor;
  // Req 17.4 / 17.5: store 0 for any non-finite or negative result.
  if (!Number.isFinite(score) || score < 0) {
    score = 0;
  }

  return storage.setTrendingScore(entryId, score);
}

/**
 * Like a Marketplace_Entry on behalf of an authenticated actor, idempotently.
 *
 * Flow:
 * - The entry must exist; a missing entry is a 404 and no ledger row or counter
 *   is touched (Req 15.8).
 * - The like is recorded through the per-user Like_Ledger. `recordLike` returns
 *   `true` only when a NEW `(marketplaceId, actorUserId)` row was created — the
 *   ledger holds at most one row per pair (Req 15.6) — so the counter is bumped
 *   exactly once on first like (Req 15.1) and left untouched on a repeat like
 *   (Req 15.2). Concurrent likes by the same actor therefore add at most one row
 *   and at most one increment in aggregate (Req 15.9).
 * - On a genuine new like the `likes` counter is incremented atomically by 1
 *   (Req 15.1, Req 16.x). If the increment itself fails after the ledger row was
 *   created, the entry's last recorded `likes` value is used for the response.
 * - The Trending_Score is recomputed (Req 17.1) and the entry-detail + search
 *   caches are invalidated so the new like count and score surface immediately.
 *
 * Always returns `{ liked: true, likes }` (the entry is liked by the actor on
 * return, whether newly or already).
 *
 * Authentication (401) is enforced at the route layer.
 *
 * Requirements: 15.1, 15.2, 15.6, 15.9, 17.1.
 */
export async function likeEntry(entryId: string, actorUserId: string): Promise<LikeResult> {
  const storage = getStorage();

  // Req 15.8: the entry must exist; otherwise 404 with no mutation.
  const entry = await storage.getMarketplaceEntry(entryId);
  if (!entry) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Marketplace entry not found');
  }

  // Req 15.1 / 15.2 / 15.6 / 15.9: the ledger is the single source of truth for
  // idempotency; the counter only moves when a brand-new row was created.
  const newlyLiked = await storage.recordLike(entryId, actorUserId);

  let likes = Math.max(0, entry.engagement?.likes ?? 0);
  if (newlyLiked) {
    try {
      const next = await storage.incrementMarketplaceCounter(entryId, 'likes', 1);
      if (Number.isFinite(next)) likes = next;
    } catch (err) {
      // The ledger row already exists; fall back to the last recorded value
      // rather than failing the request.
      log.warn('Like recorded but failed to increment likes counter', {
        marketplaceId: entryId,
        actorUserId,
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  // Req 17.1: recompute the Trending_Score after the engagement change. A repeat
  // like is a no-op for the counter but recomputing is cheap and keeps the score
  // current against time decay; failures here must not fail the like.
  try {
    await recomputeTrending(entryId);
  } catch (err) {
    log.warn('Like succeeded but failed to recompute trending score', {
      marketplaceId: entryId,
      actorUserId,
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }

  const cache = getMarketplaceCache();
  cache.invalidateEntry(entryId);
  cache.invalidateSearchNamespace();

  return { liked: true, likes };
}

/**
 * Unlike a Marketplace_Entry on behalf of an authenticated actor, idempotently.
 *
 * Flow:
 * - The entry must exist; a missing entry is a 404 and no ledger row or counter
 *   is touched (Req 15.8).
 * - The like is removed through the Like_Ledger. `removeLike` returns `true`
 *   only when a row actually existed and was removed, so the counter is
 *   decremented exactly once when the actor had previously liked (Req 15.3) and
 *   left untouched when the actor had not liked (Req 15.4). The decrement is
 *   floored at 0 by the storage layer so the counter never goes negative
 *   (Req 15.5).
 * - The Trending_Score is recomputed (Req 17.1) and the entry-detail + search
 *   caches are invalidated so the updated like count and score surface
 *   immediately.
 *
 * Always returns `{ liked: false, likes }` (the entry is not liked by the actor
 * on return, whether a row was removed or it was already absent).
 *
 * Authentication (401) is enforced at the route layer.
 *
 * Requirements: 15.3, 15.4, 15.5, 17.1.
 */
export async function unlikeEntry(entryId: string, actorUserId: string): Promise<LikeResult> {
  const storage = getStorage();

  // Req 15.8: the entry must exist; otherwise 404 with no mutation.
  const entry = await storage.getMarketplaceEntry(entryId);
  if (!entry) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Marketplace entry not found');
  }

  // Req 15.3 / 15.4: only a genuine removal moves the counter.
  const removed = await storage.removeLike(entryId, actorUserId);

  let likes = Math.max(0, entry.engagement?.likes ?? 0);
  if (removed) {
    try {
      // Req 15.5: storage decrement is floored at 0 (never negative).
      const next = await storage.incrementMarketplaceCounter(entryId, 'likes', -1);
      if (Number.isFinite(next)) likes = next;
    } catch (err) {
      log.warn('Like removed but failed to decrement likes counter', {
        marketplaceId: entryId,
        actorUserId,
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  // Req 17.1: recompute the Trending_Score after the engagement change; failures
  // here must not fail the unlike.
  try {
    await recomputeTrending(entryId);
  } catch (err) {
    log.warn('Unlike succeeded but failed to recompute trending score', {
      marketplaceId: entryId,
      actorUserId,
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }

  const cache = getMarketplaceCache();
  cache.invalidateEntry(entryId);
  cache.invalidateSearchNamespace();

  return { liked: false, likes };
}

// ---------------------------------------------------------------------------
// Preview delegation
// ---------------------------------------------------------------------------

/**
 * The minimal, secret-free target needed to drive the existing per-source
 * preview pipeline. Carries only the entry's `source` + `filters` (with `type`
 * for convenience) — no engagement, provenance, or governance fields — so a
 * caller can dispatch to the matching `POST /api/{source}/preview` handler.
 */
export interface PreviewTarget {
  source: SourceType;
  filters: CatalogFilters;
  type: ContentType;
}

/**
 * Resolve the preview target (source + filters) for a public, active
 * Marketplace_Entry without introducing a new preview endpoint (Req 12.3).
 *
 * The marketplace previews a result by delegating to the *existing* per-source
 * preview pipeline (`POST /api/{tmdb|imdb|anilist|mal|kitsu|simkl|trakt}/preview`)
 * keyed by the entry's `source`, feeding it the entry's `filters` (Req 12.1).
 * This helper is the single governance-checked way to obtain those two values:
 * it loads the entry and returns ONLY `{ source, filters, type }` so the route
 * or client can run the matching pipeline and return its output verbatim
 * (Req 12.2).
 *
 * Behavior:
 * - The identifier is validated first; a missing/empty/malformed id is a 404 and
 *   no lookup proceeds (Req 12.4). A `marketplaceId` is a UUID, which fits the
 *   catalog-id shape, so `isValidCatalogId` is the cheap format gate.
 * - A syntactically valid id that matches no entry, or an entry that is not BOTH
 *   public AND active, is a 404 — and crucially the preview pipeline is never
 *   invoked for such an entry (Req 12.4).
 * - This is a pure read: it performs NO engagement-counter mutation (no views,
 *   installs, or likes increment) and does not write the entry, so the entry and
 *   its Engagement_Counter values are left unchanged (Req 12.5). It also does not
 *   touch caches.
 *
 * Preview-pipeline failure (Req 12.5) is handled by the caller: because this
 * helper never mutates engagement, a downstream pipeline failure naturally
 * leaves the entry and its counters unchanged; the caller surfaces the error.
 *
 * Authentication, where required, is enforced at the route layer.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5.
 */
export async function getEntryForPreview(entryId: string): Promise<PreviewTarget> {
  // Req 12.4: reject missing/empty/malformed identifiers before any lookup, and
  // never invoke the preview pipeline for them.
  if (!isValidCatalogId(entryId)) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Marketplace entry not found');
  }

  const storage = getStorage();
  const entry = await storage.getMarketplaceEntry(entryId);

  // Req 12.4: a missing entry, or one that is not both public AND active,
  // resolves to a 404 and the preview pipeline is never invoked. `isInstallable`
  // is exactly the public+active predicate reused here.
  if (!entry || !isInstallable(entry)) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Marketplace entry not found');
  }

  // Req 12.5: pure read — return only source/filters/type, mutate nothing.
  return {
    source: entry.source,
    filters: entry.filters,
    type: entry.type,
  };
}
