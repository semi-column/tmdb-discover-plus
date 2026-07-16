import { MARKETPLACE_SOURCES, MARKETPLACE_TYPES } from '../../constants.ts';
import type { MarketplaceEntry } from '../../types/marketplace.ts';
import { AppError, ErrorCodes } from '../../utils/AppError.ts';

/**
 * Strict validation of a Marketplace_Entry before persistence (Requirement 3).
 *
 * Every rule from acceptance criteria 3.1–3.6 is enforced here. When any rule
 * fails the entry is rejected with a single `AppError` (400 VALIDATION_ERROR)
 * whose message identifies exactly which rule failed (Requirement 3.7). The
 * caller is responsible for ensuring no part of the entry is persisted when
 * this function throws.
 *
 * Sanitization (markup stripping, trimming, lowercasing, deduplication) is
 * performed upstream by `toPublicProjection`; this function asserts the
 * post-sanitization invariants hold rather than mutating the entry.
 */

// --- Rule bounds ------------------------------------------------------------

const NAME_MIN = 1;
const NAME_MAX = 100;
const DESCRIPTION_MIN = 0;
const DESCRIPTION_MAX = 500;
const TAG_MIN_COUNT = 0;
const TAG_MAX_COUNT = 20;
const TAG_MIN_LENGTH = 1;
const TAG_MAX_LENGTH = 40;

/** Engagement counter names that must be integers >= 0 (Requirement 3.6). */
const COUNTER_FIELDS = ['likes', 'installs', 'views'] as const;

function reject(message: string): never {
  throw new AppError(400, ErrorCodes.VALIDATION_ERROR, message);
}

/**
 * Validate a fully-built Marketplace_Entry against all storage invariants.
 *
 * Throws an `AppError` identifying the failed rule when the entry is invalid;
 * returns normally when every rule passes.
 */
export function validateMarketplaceEntry(entry: MarketplaceEntry): void {
  if (entry === null || typeof entry !== 'object') {
    reject('Rule 3: entry must be an object');
  }

  // --- 3.1 name: 1–100 characters ------------------------------------------
  const { name } = entry;
  if (typeof name !== 'string' || name.length < NAME_MIN || name.length > NAME_MAX) {
    reject(
      `Rule 3.1 (name length): name must contain between ${NAME_MIN} and ${NAME_MAX} characters after sanitization`
    );
  }

  // --- 3.2 description: 0–500 characters ------------------------------------
  const { description } = entry;
  if (description !== undefined) {
    if (
      typeof description !== 'string' ||
      description.length < DESCRIPTION_MIN ||
      description.length > DESCRIPTION_MAX
    ) {
      reject(
        `Rule 3.2 (description length): description must contain between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX} characters after sanitization`
      );
    }
  }

  // --- 3.3 tags: 0–20 tags, each 1–40 chars, lowercase, deduped -------------
  const { tags } = entry;
  if (!Array.isArray(tags)) {
    reject('Rule 3.3 (tags): tags must be an array');
  }
  if (tags.length < TAG_MIN_COUNT || tags.length > TAG_MAX_COUNT) {
    reject(
      `Rule 3.3 (tag count): tags must contain between ${TAG_MIN_COUNT} and ${TAG_MAX_COUNT} entries`
    );
  }
  const seenTags = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== 'string' || tag.length < TAG_MIN_LENGTH || tag.length > TAG_MAX_LENGTH) {
      reject(
        `Rule 3.3 (tag length): each tag must contain between ${TAG_MIN_LENGTH} and ${TAG_MAX_LENGTH} characters`
      );
    }
    if (tag !== tag.toLowerCase()) {
      reject('Rule 3.3 (tag case): each tag must be lowercased');
    }
    if (seenTags.has(tag)) {
      reject('Rule 3.3 (tag dedupe): tags must be deduplicated after lowercasing');
    }
    seenTags.add(tag);
  }

  // --- 3.4 type allow-list (case-sensitive) ---------------------------------
  if (!(MARKETPLACE_TYPES as readonly string[]).includes(entry.type)) {
    reject(`Rule 3.4 (type allow-list): type must be one of ${MARKETPLACE_TYPES.join(', ')}`);
  }

  // --- 3.5 source allow-list (case-sensitive) -------------------------------
  if (!(MARKETPLACE_SOURCES as readonly string[]).includes(entry.source)) {
    reject(`Rule 3.5 (source allow-list): source must be one of ${MARKETPLACE_SOURCES.join(', ')}`);
  }

  // --- 3.6 engagement counters & trending score -----------------------------
  const { engagement } = entry;
  if (engagement === null || typeof engagement !== 'object') {
    reject('Rule 3.6 (engagement): engagement must be an object');
  }

  for (const field of COUNTER_FIELDS) {
    const value = engagement[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      reject(
        `Rule 3.6 (counter): engagement.${field} must be an integer greater than or equal to 0`
      );
    }
  }

  const { trendingScore } = engagement;
  if (typeof trendingScore !== 'number' || !Number.isFinite(trendingScore) || trendingScore < 0) {
    reject(
      'Rule 3.6 (trendingScore): trendingScore must be a finite number greater than or equal to 0 (NaN, Infinity, and -Infinity are rejected)'
    );
  }
}
