/**
 * Marketplace HTTP request validation & normalization helpers.
 *
 * These helpers perform *request-shape* validation and normalization for the
 * marketplace routes (see `routes/marketplace.ts`). They sanitize free-text
 * inputs, validate identifier formats, enforce the source/type/sort allow-lists,
 * parse and cap the comma-separated genre facet, and normalize pagination.
 *
 * Every invalid input throws an `AppError(400, VALIDATION_ERROR, …)` whose
 * message names the offending field, satisfying Requirements 20.8 / 21.5 (a 400
 * response identifying which input failed, with no index modification).
 *
 * The ranking / search-default *business* decisions live in the service
 * (`searchMarketplace`); these helpers only validate and normalize the request.
 * The service also normalizes its inputs (defense in depth) — the two are kept
 * consistent: both use the same allow-lists, the same 256-char query truncation,
 * the same [1,50]/default-24 limit clamp, and the same page>=0/default-0 rule.
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 21.5, 21.6.
 */

import { AppError, ErrorCodes } from '../../utils/AppError.ts';
import { isValidUserId, isValidCatalogId, sanitizeString } from '../../utils/validation.ts';
import {
  MARKETPLACE_SOURCES,
  MARKETPLACE_TYPES,
  MARKETPLACE_SORT_MODES,
  MARKETPLACE_LIMITS,
  MARKETPLACE_PAGINATION,
  type MarketplaceSortMode,
} from '../../constants.ts';
import type { SourceType } from '../../types/config.ts';
import type { ContentType } from '../../types/common.ts';
import type { MarketplaceSort } from '../../types/marketplace.ts';

// --- Field limits (request-shape) ------------------------------------------

const { MAX_QUERY_LENGTH } = MARKETPLACE_LIMITS;
const { DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_PAGE_SIZE } = MARKETPLACE_PAGINATION;

/** Maximum sanitized description length (Req 20.2). */
export const MAX_DESCRIPTION_LENGTH = 500;
/** Maximum sanitized length of a single tag (Req 20.2). */
export const MAX_TAG_LENGTH = 40;
/** Maximum number of tags accepted on a publish request (Req 3.3). */
export const MAX_TAGS = 20;
/** Maximum number of genre facet tokens retained after dedupe (Req 20.6). */
export const MAX_GENRE_FACETS = 10;
/** Maximum length of a single genre facet token before sanitization cap. */
const MAX_GENRE_TOKEN_LENGTH = 60;

const VALID_SOURCES = new Set<string>(MARKETPLACE_SOURCES);
const VALID_TYPES = new Set<string>(MARKETPLACE_TYPES);
const VALID_SORTS = new Set<string>(MARKETPLACE_SORT_MODES);

// --- Result shapes ----------------------------------------------------------

/** Normalized GET /marketplace/search query (post-validation). */
export interface NormalizedSearchQuery {
  q: string;
  source?: SourceType;
  type?: ContentType;
  genres: string[];
  sort: MarketplaceSort;
  page: number;
  limit: number;
}

/** Validated POST /marketplace/publish body. */
export interface ValidatedPublishRequest {
  userId: string;
  catalogId: string;
  description?: string;
  tags: string[];
}

/** Validated POST /marketplace/:id/install body. */
export interface ValidatedInstallRequest {
  targetUserId: string;
}

// --- Internals --------------------------------------------------------------

function fail(field: string, message: string): never {
  throw new AppError(400, ErrorCodes.VALIDATION_ERROR, message);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

/** True when a query value was actually supplied (not omitted / empty string). */
function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).length > 0;
}

// --- Public helpers ---------------------------------------------------------

/**
 * Validate & normalize the raw search query object from `req.query`.
 *
 * - `q` is sanitized (control chars stripped, trimmed) and truncated to 256
 *   characters (Req 20.1, 20.2 / consistent with service Req 6.6).
 * - `source` / `type` are validated against their case-sensitive allow-lists;
 *   an unrecognized value is a 400 naming the field (Req 20.5).
 * - `sort` is validated against the allow-list when supplied; an unrecognized
 *   value is a 400 naming the field (Req 20.5). When omitted it defaults to
 *   `trending` for an empty query and `relevance` otherwise (matches the
 *   service default).
 * - `genres` is split on commas, each entry trimmed/sanitized, empty entries
 *   dropped, remaining entries de-duplicated case-insensitively, and only the
 *   first 10 retained (Req 20.6).
 * - `page` is normalized to a non-negative integer (default 0) and `limit` is
 *   clamped to [1, 50] (default 24) (pagination normalization).
 */
export function parseSearchQuery(reqQuery: unknown): NormalizedSearchQuery {
  const query = asRecord(reqQuery);

  // q — sanitize + truncate to MAX_QUERY_LENGTH (Req 20.1, 20.2).
  const q = sanitizeString(query.q, MAX_QUERY_LENGTH);

  // source — allow-list (Req 20.5).
  let source: SourceType | undefined;
  if (isPresent(query.source)) {
    const value = String(query.source);
    if (!VALID_SOURCES.has(value)) {
      fail('source', `Invalid source: "${value}"`);
    }
    source = value as SourceType;
  }

  // type — allow-list (Req 20.5).
  let type: ContentType | undefined;
  if (isPresent(query.type)) {
    const value = String(query.type);
    if (!VALID_TYPES.has(value)) {
      fail('type', `Invalid type: "${value}"`);
    }
    type = value as ContentType;
  }

  // sort — allow-list when supplied, else default by query presence (Req 20.5).
  let sort: MarketplaceSort;
  if (isPresent(query.sort)) {
    const value = String(query.sort);
    if (!VALID_SORTS.has(value)) {
      fail('sort', `Invalid sort: "${value}"`);
    }
    sort = value as MarketplaceSortMode;
  } else {
    sort = q.length > 0 ? 'relevance' : 'trending';
  }

  // genres — split / trim / drop-empty / dedupe / cap at 10 (Req 20.6).
  const genres = parseGenres(query.genres);

  return {
    q,
    source,
    type,
    genres,
    sort,
    page: normalizePage(query.page),
    limit: normalizeLimit(query.limit),
  };
}

/**
 * Split a comma-separated genre value into trimmed, de-duplicated tokens,
 * dropping empties and retaining only the first 10 after deduplication
 * (Req 20.6). Accepts either a raw string or an array of strings.
 */
export function parseGenres(raw: unknown): string[] {
  let parts: string[];
  if (Array.isArray(raw)) {
    parts = raw.map((entry) => String(entry));
  } else if (typeof raw === 'string') {
    parts = raw.split(',');
  } else {
    return [];
  }

  const seen = new Set<string>();
  const genres: string[] = [];
  for (const part of parts) {
    if (genres.length >= MAX_GENRE_FACETS) break;
    const token = sanitizeString(part, MAX_GENRE_TOKEN_LENGTH);
    if (token.length < 1) continue;
    const dedupeKey = token.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    genres.push(token);
  }
  return genres;
}

/**
 * Normalize the zero-based page index: a non-negative integer, defaulting to 0
 * when omitted, non-numeric, or negative.
 */
export function normalizePage(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/**
 * Normalize the page size: clamped to the inclusive range [1, 50], defaulting to
 * 24 when omitted or non-numeric.
 */
export function normalizeLimit(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(value)));
}

/**
 * Validate a POST /marketplace/publish body.
 *
 * - `userId` must match the user-id format (Req 20.3) — else 400 naming `userId`.
 * - `catalogId` must match the catalog-id format (Req 20.4) — else 400 naming
 *   `catalogId`.
 * - `description`, when present, must be a string; it is sanitized and must not
 *   exceed 500 characters (Req 20.1, 20.2) — else 400 naming `description`.
 * - `tags`, when present, must be an array of at most 20 strings; each is
 *   sanitized, must not exceed 40 characters (Req 20.2), empties are dropped and
 *   the remainder lowercased + de-duplicated — else 400 naming `tags`.
 */
export function validatePublishRequest(body: unknown): ValidatedPublishRequest {
  const data = asRecord(body);

  if (!isValidUserId(data.userId)) {
    fail('userId', 'Invalid or missing userId');
  }
  if (!isValidCatalogId(data.catalogId)) {
    fail('catalogId', 'Invalid or missing catalogId');
  }

  return {
    userId: data.userId as string,
    catalogId: data.catalogId as string,
    description: validateDescription(data.description),
    tags: validateTags(data.tags),
  };
}

/**
 * Validate a POST /marketplace/:id/install body. `targetUserId` must match the
 * user-id format (Req 20.3) — else 400 naming `targetUserId`.
 */
export function validateInstallRequest(body: unknown): ValidatedInstallRequest {
  const data = asRecord(body);

  if (!isValidUserId(data.targetUserId)) {
    fail('targetUserId', 'Invalid or missing targetUserId');
  }

  return { targetUserId: data.targetUserId as string };
}

/**
 * Validate a marketplace entry identifier taken from an `:id` route param. The
 * id must be a non-empty string matching the catalog-id format used for
 * marketplace ids (consistent with the service's `getEntry` check). Returns the
 * validated id — else 400 naming `id` (Req 20.8).
 */
export function validateEntryId(raw: unknown): string {
  if (!isValidCatalogId(raw)) {
    fail('id', 'Invalid or missing marketplace entry id');
  }
  return raw as string;
}

// --- Field-level helpers ----------------------------------------------------

function validateDescription(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    fail('description', 'description must be a string');
  }
  const sanitized = sanitizeString(raw, MAX_DESCRIPTION_LENGTH + 1);
  if (sanitized.length > MAX_DESCRIPTION_LENGTH) {
    fail('description', `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`);
  }
  return sanitized.length > 0 ? sanitized : undefined;
}

function validateTags(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    fail('tags', 'tags must be an array of strings');
  }
  if (raw.length > MAX_TAGS) {
    fail('tags', `tags must contain ${MAX_TAGS} entries or fewer`);
  }

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      fail('tags', 'each tag must be a string');
    }
    const sanitized = sanitizeString(entry, MAX_TAG_LENGTH + 1);
    if (sanitized.length > MAX_TAG_LENGTH) {
      fail('tags', `each tag must be ${MAX_TAG_LENGTH} characters or fewer`);
    }
    if (sanitized.length < 1) continue;
    const token = sanitized.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    tags.push(token);
  }
  return tags;
}
