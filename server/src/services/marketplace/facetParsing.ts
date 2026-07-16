/**
 * Shared source/genre facet parsing used by both the HTTP request validator
 * (`routes/handlers/marketplaceValidation.ts`) and the service's own defense-in-depth
 * check (`marketplaceService.validateAndParseFacets`), so the two layers can't drift.
 */
import { AppError, ErrorCodes } from '../../utils/AppError.ts';
import { sanitizeString } from '../../utils/validation.ts';
import { MARKETPLACE_SOURCES } from '../../constants.ts';
import type { SourceType } from '../../types/config.ts';

const VALID_SOURCES = new Set<string>(MARKETPLACE_SOURCES);
const MAX_GENRE_FACETS = 10;
const MAX_GENRE_TOKEN_LENGTH = 60;

/**
 * Parse a comma-separated (or array) source facet value against the source
 * allow-list. Throws a 400 naming the field on an unrecognized source.
 */
export function parseSources(raw: unknown): SourceType[] | undefined {
  let parts: string[];
  if (Array.isArray(raw)) {
    parts = raw.flatMap((entry) => String(entry).split(','));
  } else if (typeof raw === 'string') {
    parts = raw.split(',');
  } else {
    return undefined;
  }

  const seen = new Set<string>();
  const sources: SourceType[] = [];
  for (const part of parts) {
    const token = sanitizeString(part, 24);
    if (!token) continue;
    if (!VALID_SOURCES.has(token)) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `Invalid source: "${token}"`);
    }
    if (seen.has(token)) continue;
    seen.add(token);
    sources.push(token as SourceType);
  }

  return sources.length ? sources : undefined;
}

/**
 * Split a comma-separated genre value into trimmed, de-duplicated tokens,
 * dropping empties and retaining only the first `MAX_GENRE_FACETS` after
 * deduplication. Accepts either a raw string or an array of strings.
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
