import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { computeContentHash } from '../../../src/services/marketplace/projection.ts';
import { stableStringify } from '../../../src/utils/stableStringify.ts';
import { MARKETPLACE_SOURCES, MARKETPLACE_TYPES } from '../../../src/constants.ts';

/**
 * Property tests for `computeContentHash` (Requirement 1.6).
 *
 * The content hash is computed over exactly {name, type, source, filters} and
 * must be:
 *   1. Deterministic — identical values (including filters with reordered
 *      object keys) always produce the same hash.
 *   2. Sensitive — changing any one of name / type / source / filters always
 *      produces a different hash.
 *
 * **Validates: Requirements 1.6**
 */

// --- Generators ------------------------------------------------------------

const typeArb = fc.constantFrom(...MARKETPLACE_TYPES);
const sourceArb = fc.constantFrom(...MARKETPLACE_SOURCES);
const nameArb = fc.string({ minLength: 1, maxLength: 100 });

// A JSON-safe filter value: strings, integers, booleans, or arrays of strings.
const filterValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.array(fc.string(), { maxLength: 5 })
);

// A realistic, flat-ish filters object with arbitrary keys/values.
const filtersArb = fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), filterValueArb, {
  maxKeys: 8,
});

const contentArb = fc.record({
  name: nameArb,
  type: typeArb,
  source: sourceArb,
  filters: filtersArb,
});

// --- Helpers ---------------------------------------------------------------

/** Rebuild an object (recursively) with its keys inserted in reverse order. */
function reorderKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(reorderKeys);

  const keys = Object.keys(value as Record<string, unknown>).reverse();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] = reorderKeys((value as Record<string, unknown>)[key]);
  }
  return out;
}

describe('computeContentHash — determinism (Requirement 1.6)', () => {
  it('produces identical hashes for identical {name,type,source,filters}', () => {
    fc.assert(
      fc.property(contentArb, (content) => {
        const a = computeContentHash(content);
        const b = computeContentHash({
          name: content.name,
          type: content.type,
          source: content.source,
          filters: content.filters,
        });
        expect(a).toBe(b);
      })
    );
  });

  it('is insensitive to filter object key ordering', () => {
    fc.assert(
      fc.property(contentArb, (content) => {
        const base = computeContentHash(content);
        const reordered = computeContentHash({
          // Top-level fields supplied in a different order, plus filters with
          // deeply reordered keys.
          source: content.source,
          filters: reorderKeys(content.filters),
          name: content.name,
          type: content.type,
        });
        expect(reordered).toBe(base);
      })
    );
  });
});

describe('computeContentHash — sensitivity (Requirement 1.6)', () => {
  it('changes when the name changes', () => {
    fc.assert(
      fc.property(contentArb, nameArb, (content, newName) => {
        fc.pre(stableStringify(newName) !== stableStringify(content.name));
        expect(computeContentHash({ ...content, name: newName })).not.toBe(
          computeContentHash(content)
        );
      })
    );
  });

  it('changes when the type changes', () => {
    fc.assert(
      fc.property(contentArb, typeArb, (content, newType) => {
        fc.pre(newType !== content.type);
        expect(computeContentHash({ ...content, type: newType })).not.toBe(
          computeContentHash(content)
        );
      })
    );
  });

  it('changes when the source changes', () => {
    fc.assert(
      fc.property(contentArb, sourceArb, (content, newSource) => {
        fc.pre(newSource !== content.source);
        expect(computeContentHash({ ...content, source: newSource })).not.toBe(
          computeContentHash(content)
        );
      })
    );
  });

  it('changes when the filters change', () => {
    fc.assert(
      fc.property(contentArb, filtersArb, (content, newFilters) => {
        fc.pre(stableStringify(newFilters) !== stableStringify(content.filters));
        expect(computeContentHash({ ...content, filters: newFilters })).not.toBe(
          computeContentHash(content)
        );
      })
    );
  });
});
