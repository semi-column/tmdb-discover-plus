import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  toPublicProjection,
  containsNoSecrets,
} from '../../src/services/marketplace/projection.ts';
import { MARKETPLACE_SECRET_DENYLIST, MARKETPLACE_SECRET_PATTERN } from '../../src/constants.ts';
import { AppError } from '../../src/utils/AppError.ts';
import type { CatalogConfig, SourceType } from '../../src/types/config.ts';
import type { ContentType } from '../../src/types/common.ts';

/**
 * Property 3: No secret leakage
 * Validates: Requirements 2.2, 2.6
 *
 * `toPublicProjection` must NEVER produce a Marketplace_Entry that contains a
 * Secret. A Secret is any field whose name is in the denylist or matches the
 * `*Encrypted` pattern. The guarantee holds at two levels:
 *
 *   (2.2) When projection SUCCEEDS, the entry contains no secret field name at
 *         any depth, passes `containsNoSecrets`, and carries no secret VALUE
 *         anywhere in its serialized form.
 *   (2.6) When a secret would otherwise reach the index, projection REJECTS by
 *         throwing, persisting nothing and never echoing the secret value in
 *         the error message.
 *
 * Both outcomes uphold the invariant, so the property accepts either branch and
 * asserts the relevant guarantee for each.
 */

// --- Generators ------------------------------------------------------------

const SAFE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_'.split('');
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('');
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

const safeChar = fc.constantFrom(...SAFE_CHARS);
const idChar = fc.constantFrom(...ID_CHARS);
const letter = fc.constantFrom(...LETTERS);

/** Catalog name that survives markup/control stripping with >= 1 char. */
const safeName = fc
  .array(safeChar, { minLength: 1, maxLength: 40 })
  .map((chars) => chars.join(''))
  .filter((s) => s.trim().length >= 1);

/** Origin user id that satisfies `isValidUserId` (/^[A-Za-z0-9_-]{6,30}$/). */
const validUserId = fc
  .array(idChar, { minLength: 6, maxLength: 30 })
  .map((chars) => chars.join(''));

/** Non-empty origin catalog id. */
const catalogId = fc.array(idChar, { minLength: 1, maxLength: 24 }).map((chars) => chars.join(''));

const source: fc.Arbitrary<SourceType> = fc.constantFrom(
  'tmdb',
  'imdb',
  'anilist',
  'mal',
  'simkl',
  'trakt',
  'kitsu'
);

const contentType: fc.Arbitrary<ContentType> = fc.constantFrom(
  'movie',
  'series',
  'anime',
  'collection'
);

/** A secret field name: an explicit denylist name or an arbitrary `*Encrypted`. */
const secretFieldName = fc.oneof(
  fc.constantFrom(...(MARKETPLACE_SECRET_DENYLIST as readonly string[])),
  fc.array(letter, { minLength: 1, maxLength: 8 }).map((c) => `${c.join('')}Encrypted`)
);

/** A distinctive, unique secret value so we can search for leaks unambiguously. */
const secretValue = fc.uuid().map((u) => `SECRET_VALUE_${u}`);

/** Zero or more [name, value] secret pairs to inject at a single location. */
const secretEntries = fc.array(fc.tuple(secretFieldName, secretValue), {
  minLength: 0,
  maxLength: 4,
});

type SecretEntries = ReadonlyArray<readonly [string, string]>;

function entriesToObject(entries: SecretEntries): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [key, value] of entries) obj[key] = value;
  return obj;
}

/** A small, valid, secret-free base filter set. */
const baseFilters = fc.record({
  sortBy: fc.constantFrom('popularity.desc', 'vote_average.desc', 'primary_release_date.desc'),
  genres: fc.array(fc.integer({ min: 1, max: 9999 }), { maxLength: 5 }),
  genreNames: fc.array(fc.constantFrom('Action', 'Drama', 'Comedy', 'Horror', 'Sci-Fi'), {
    maxLength: 5,
  }),
});

const catalogPlan = fc
  .record({
    userId: validUserId,
    id: catalogId,
    name: safeName,
    source,
    type: contentType,
    base: baseFilters,
    topSecrets: secretEntries,
    filterSecrets: secretEntries,
    formSecrets: secretEntries,
  })
  // Ensure at least one secret is injected somewhere.
  .filter((p) => p.topSecrets.length + p.filterSecrets.length + p.formSecrets.length >= 1);

// --- Helpers ---------------------------------------------------------------

function isSecretName(key: string): boolean {
  return (
    (MARKETPLACE_SECRET_DENYLIST as readonly string[]).includes(key) ||
    MARKETPLACE_SECRET_PATTERN.test(key)
  );
}

/** Independently collect every field name at any depth (does not trust impl). */
function collectFieldNames(value: unknown, acc: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return acc;
  if (Array.isArray(value)) {
    for (const item of value) collectFieldNames(item, acc);
    return acc;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    acc.push(key);
    collectFieldNames((value as Record<string, unknown>)[key], acc);
  }
  return acc;
}

// --- Property --------------------------------------------------------------

describe('projection secret leakage (Property 3)', () => {
  it('never produces an entry containing a secret field or value (Requirements 2.2, 2.6)', () => {
    fc.assert(
      fc.property(catalogPlan, (plan) => {
        const secretValues = [...plan.topSecrets, ...plan.filterSecrets, ...plan.formSecrets].map(
          ([, value]) => value
        );

        const catalog = {
          _id: plan.id,
          name: plan.name,
          type: plan.type,
          source: plan.source,
          filters: { ...plan.base, ...entriesToObject(plan.filterSecrets) },
          formState: { expandedSections: {}, ...entriesToObject(plan.formSecrets) },
          ...entriesToObject(plan.topSecrets),
        } as unknown as CatalogConfig;

        let entry;
        try {
          entry = toPublicProjection(plan.userId, catalog);
        } catch (err) {
          // Requirement 2.6: rejecting a projection that would carry a secret is
          // correct. The error must be an AppError and must not echo any secret
          // VALUE (the field name may appear, the value never may).
          expect(err).toBeInstanceOf(AppError);
          const message = String((err as Error).message);
          for (const value of secretValues) {
            expect(message).not.toContain(value);
          }
          return;
        }

        // Requirement 2.2: a successful projection is secret-free at every depth.
        expect(containsNoSecrets(entry)).toBe(true);

        const fieldNames = collectFieldNames(entry);
        expect(fieldNames.filter(isSecretName)).toEqual([]);

        // No secret VALUE may appear anywhere in the serialized entry.
        const serialized = JSON.stringify(entry);
        for (const value of secretValues) {
          expect(serialized).not.toContain(value);
        }
      }),
      { numRuns: 300 }
    );
  });
});
