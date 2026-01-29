import { useEffect, useRef } from 'react';

export function useCatalogSync({ localCatalog, catalog, onUpdate, dependencies = [] }) {
  const initialSyncRef = useRef(true);
  const syncTimeoutRef = useRef(null);

  useEffect(() => {
    if (!catalog || !catalog._id) return;

    if (initialSyncRef.current) {
      initialSyncRef.current = false;
      return;
    }

    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);

    syncTimeoutRef.current = setTimeout(() => {
      if (typeof onUpdate === 'function') {
        onUpdate(catalog._id, localCatalog);
      }
    }, 250);

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localCatalog, catalog?._id, onUpdate, ...dependencies]);
}
