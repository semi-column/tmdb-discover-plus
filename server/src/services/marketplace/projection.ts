import crypto from 'crypto';

import { MARKETPLACE_SECRET_DENYLIST, MARKETPLACE_SECRET_PATTERN } from '../../constants.ts';
import type { CatalogConfig, CatalogFilters, SourceType } from '../../types/config.ts';
import type { ContentType } from '../../types/common.ts';
import type { MarketplaceEntry } from '../../types/marketplace.ts';
import { AppError, ErrorCodes } from '../../utils/AppError.ts';
import { stableStringify } from '../../utils/stableStringify.ts';
import { isValidUserId, sanitizeFiltersForSource, sanitizeString } from '../../utils/validation.ts';

/**
 * Public projection of a catalog into a secret-free Marketplace_Entry.
 *
 * This module builds the projection, asserts that it carries no secrets, and
 * computes the deterministic content hash used for change detection and
 * deduplication.
 */

// --- Sanitization limits (see Requirements 3.1–3.3) ------------------------

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;
const TAG_MAX_LENGTH = 40;
const TAG_MAX_COUNT = 20;
const GENRE_MAX_LENGTH = 60;
const GENRE_MAX_COUNT = 50;
const CONFIG_NAME_MAX = 100;
const SCHEMA_VERSION = 1;

/**
 * Strip HTML/markup tags and decode the most common entities, then delegate to
 * `sanitizeString` for control-character removal, trimming, and length capping.
 */
function stripMarkup(input: unknown, maxLength: number): string {
  if (typeof input !== 'string' || input.length === 0) return '';

  let out = '';
  let inTag = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '<') {
      inTag = true;
      continue;
    }
    if (ch === '>') {
      inTag = false;
      continue;
    }
    if (!inTag) out += ch;
  }

  const decoded = out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

  return sanitizeString(decoded, maxLength);
}

/**
 * Sanitize the catalog name to 1–100 characters. The catalog is required to
 * carry a name; an empty name after sanitization is not persistable.
 */
function sanitizeName(name: unknown): string {
  const safe = stripMarkup(name, NAME_MAX);
  if (safe.length < 1) {
    throw new AppError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      'Catalog name must contain between 1 and 100 characters after sanitization'
    );
  }
  return safe;
}

/** Sanitize the optional description to 0–500 characters. */
function sanitizeDescription(description: unknown): string | undefined {
  const safe = stripMarkup(description, DESCRIPTION_MAX);
  return safe.length > 0 ? safe : undefined;
}

/**
 * Sanitize tags: strip markup, cap each at 40 chars, lowercase, drop empties,
 * deduplicate, and keep at most 20.
 */
function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    if (result.length >= TAG_MAX_COUNT) break;
    const token = stripMarkup(raw, TAG_MAX_LENGTH).toLowerCase();
    if (token.length < 1 || seen.has(token)) continue;
    seen.add(token);
    result.push(token);
  }
  return result;
}

/**
 * Resolve genre NAMES (source-agnostic) for faceting. Catalog genres are stored
 * as numeric ids in `filters.genres`; human-readable names live in
 * `filters.genreNames` when the UI captured them.
 */
function deriveGenres(filters: CatalogFilters): string[] {
  const names = (filters as { genreNames?: unknown }).genreNames;
  if (!Array.isArray(names)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    if (result.length >= GENRE_MAX_COUNT) break;
    const token = stripMarkup(raw, GENRE_MAX_LENGTH);
    if (token.length < 1 || seen.has(token)) continue;
    seen.add(token);
    result.push(token);
  }
  return result;
}

/**
 * Flatten a small, deterministic set of facet tokens used for search boosts,
 * e.g. `sort:popularity.desc`, `genre:action`. Derived from already-sanitized
 * filters and genre names so it never carries secrets.
 */
function deriveFilterFacets(filters: CatalogFilters, genres: string[]): string[] {
  const facets = new Set<string>();

  const sortBy = (filters as { sortBy?: unknown }).sortBy;
  if (typeof sortBy === 'string') {
    const token = sanitizeString(sortBy, 60);
    if (token) facets.add(`sort:${token}`);
  }

  for (const genre of genres) {
    facets.add(`genre:${genre.toLowerCase()}`);
  }

  return Array.from(facets);
}

/**
 * Recursively scan a value for any field whose name is a known secret or
 * matches the secret pattern. Returns the offending field NAME (never its
 * value) or null when the value is secret-free.
 */
function findSecretField(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSecretField(item);
      if (found) return found;
    }
    return null;
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (
      (MARKETPLACE_SECRET_DENYLIST as readonly string[]).includes(key) ||
      MARKETPLACE_SECRET_PATTERN.test(key)
    ) {
      return key;
    }
    const found = findSecretField((value as Record<string, unknown>)[key]);
    if (found) return found;
  }
  return null;
}

/**
 * Runtime assertion that an entry (or any object) carries no secret field at
 * any depth, evaluated against the secret denylist and the `*Encrypted`
 * pattern. Returns `true` when secret-free.
 */
export function containsNoSecrets(entry: unknown): boolean {
  return findSecretField(entry) === null;
}

/**
 * Compute a deterministic content hash over exactly the catalog name, type,
 * source, and filters (Requirement 1.6). Field order and object key order are
 * normalized via `stableStringify`, so two catalogs with identical values for
 * all four fields always produce the same hash, while any change to one or more
 * of those fields produces a different hash. Used for change detection and
 * deduplication during publish and reconciliation (Requirements 5.2, 5.3).
 */
export function computeContentHash(input: {
  name: unknown;
  type: unknown;
  source: unknown;
  filters: unknown;
}): string {
  const canonical = stableStringify({
    name: input.name,
    type: input.type,
    source: input.source,
    filters: input.filters,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Build a secret-free public projection of a catalog.
 *
 * The only catalog-derived data placed on the entry are name, description,
 * tags, type, source, genres, filterFacets, filters (post
 * `sanitizeFiltersForSource`), and formState. All other catalog fields are
 * excluded. Throws before returning if provenance is missing, filter
 * sanitization fails, or a secret is detected (without echoing secret values).
 */
export function toPublicProjection(userId: string, catalog: CatalogConfig): MarketplaceEntry {
  if (!isValidUserId(userId)) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Invalid origin user id');
  }

  const originCatalogId = catalog?._id || catalog?.id;
  if (!originCatalogId) {
    throw new AppError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      'Cannot publish: missing origin catalog identifier'
    );
  }

  // Legacy/most catalogs omit an explicit source and are implicitly TMDB, which
  // is how the rest of the app treats a missing source (getSource(source ||
  // 'tmdb')). Default it here so those catalogs can be projected and indexed.
  const source = (catalog.source || 'tmdb') as SourceType;

  // Source-specific filter sanitization. A thrown error here means the entry is
  // rejected before any persistence (Requirement 2.4).
  let filters: CatalogFilters;
  try {
    filters = sanitizeFiltersForSource(source, catalog.filters || {}) as CatalogFilters;
  } catch (err) {
    throw new AppError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      `Filter sanitization failed: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  }

  const genres = deriveGenres(filters);

  const projectedName = sanitizeName(catalog.name);
  const projectedType = catalog.type as ContentType;

  const now = new Date();
  const entry: MarketplaceEntry = {
    marketplaceId: crypto.randomUUID(),
    provenance: {
      originUserId: userId,
      originCatalogId,
      originConfigName: catalog.name
        ? stripMarkup(catalog.name, CONFIG_NAME_MAX) || undefined
        : undefined,
    },

    // Catalog-derived, secret-free fields only.
    name: projectedName,
    description: sanitizeDescription((catalog as { description?: unknown }).description),
    tags: sanitizeTags((catalog as { tags?: unknown }).tags),
    type: projectedType,
    source,
    genres,
    filterFacets: deriveFilterFacets(filters, genres),
    filters,
    formState: catalog.formState,

    // Lifecycle / governance defaults.
    visibility: 'public',
    moderation: 'active',
    engagement: {
      likes: 0,
      installs: 0,
      views: 0,
      trendingScore: 0,
    },

    // Sync bookkeeping. Deterministic hash over exactly {name, type, source, filters}.
    contentHash: computeContentHash({
      name: projectedName,
      type: projectedType,
      source,
      filters,
    }),
    publishedAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
  };

  // Hard invariant: no secret may ever enter the index (Requirements 2.2, 2.6).
  const secretField = findSecretField(entry);
  if (secretField !== null) {
    throw new AppError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      `Public projection rejected: contains a secret field "${secretField}"`
    );
  }

  return entry;
}
