export function hasIncompleteCollectionSelection(catalogs) {
  return (
    Array.isArray(catalogs) &&
    catalogs.some((catalog) => {
      if (
        catalog?.enabled === false ||
        (catalog?.source && !['tmdb', 'trakt'].includes(catalog.source))
      ) {
        return false;
      }

      const filters = catalog?.filters || {};
      const listType = filters.listType;
      if (catalog?.type === 'collection' && !['collection', 'studio'].includes(listType)) {
        return true;
      }
      if (!['collection', 'studio'].includes(listType)) return false;
      if (catalog?.type) {
        const validType =
          listType === 'studio'
            ? catalog.type === 'collection'
            : ['movie', 'collection'].includes(catalog.type);
        if (!validType) return true;
      }
      const id = listType === 'studio' ? filters.studioId : filters.collectionId;
      return (
        !['string', 'number'].includes(typeof id) ||
        !/^[1-9]\d*$/.test(String(id)) ||
        !Number.isSafeInteger(Number(id))
      );
    })
  );
}

export function validateCatalogSelections(catalogs) {
  if (hasIncompleteCollectionSelection(catalogs)) {
    throw new Error('Select a valid collection or studio before saving or importing');
  }
}
