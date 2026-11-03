import { describe, expect, it } from 'vitest';
import { hasIncompleteCollectionSelection, validateCatalogSelections } from './catalogValidation';

describe('collection selection validation', () => {
  it.each([undefined, '', '0', '-1', 'abc', '42|43', ['42'], {}, 1.5, '9007199254740992'])(
    'rejects malformed collection/studio ID %j',
    (id) => {
      for (const listType of ['collection', 'studio']) {
        const catalogs = [{ type: 'collection', filters: { listType, [`${listType}Id`]: id } }];
        expect(hasIncompleteCollectionSelection(catalogs)).toBe(true);
        expect(() => validateCatalogSelections(catalogs)).toThrow();
      }
    }
  );

  it('rejects collection type without a collection or studio mode', () => {
    expect(hasIncompleteCollectionSelection([{ type: 'collection', filters: {} }])).toBe(true);
  });

  it('allows positive IDs, empty configs, disabled drafts and unrelated sources', () => {
    expect(() => validateCatalogSelections([])).not.toThrow();
    expect(() =>
      validateCatalogSelections([
        { type: 'movie', filters: { listType: 'collection', collectionId: 42 } },
        { type: 'collection', filters: { listType: 'studio', studioId: '42' } },
        { type: 'collection', enabled: false, filters: {} },
        { type: 'series', source: 'simkl', filters: { listType: 'collection' } },
      ])
    ).not.toThrow();
  });
});
