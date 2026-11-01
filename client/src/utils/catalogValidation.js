export function hasIncompleteCollectionSelection(catalogs) {
  return (
    Array.isArray(catalogs) &&
    catalogs.some((catalog) => {
      if (catalog?.enabled === false || (catalog?.source && catalog.source !== 'tmdb')) {
        return false;
      }

      const filters = catalog?.filters || {};
      if (filters.listType === 'collection') {
        return filters.collectionId == null || String(filters.collectionId).trim() === '';
      }
      if (filters.listType === 'studio') {
        return filters.studioId == null || String(filters.studioId).trim() === '';
      }
      return false;
    })
  );
}
