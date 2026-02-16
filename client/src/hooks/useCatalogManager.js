import { useState } from 'react';

export function useCatalogManager(config, addToast) {
  const [activeCatalog, setActiveCatalogState] = useState(null);
  const [globalSource, setGlobalSource] = useState('tmdb');

  const setActiveCatalog = (catalog) => {
    setActiveCatalogState(catalog);
    if (catalog?.source) {
      setGlobalSource(catalog.source);
    }
  };

  const handleAddCatalog = (catalogData) => {
    const newCatalog = { ...catalogData, _id: crypto.randomUUID() };
    config.setCatalogs((prev) => [...prev, newCatalog]);
    setActiveCatalog(newCatalog);
  };

  const handleAddPresetCatalog = (type, preset, source) => {
    const effectiveSource = source || globalSource;
    const newCatalog = {
      _id: crypto.randomUUID(),
      name: preset.label.replace(/^[^\s]+\s/, ''),
      type,
      filters: { listType: preset.value },
      enabled: true,
    };
    if (effectiveSource === 'imdb') {
      newCatalog.source = 'imdb';
    }
    config.setCatalogs((prev) => [...prev, newCatalog]);
    setActiveCatalog(newCatalog);
  };
  
  // Update global source when explicitly set, and clear active catalog if source mismatches
  const handleSetGlobalSource = (source) => {
    setGlobalSource(source);
    if (activeCatalog && (activeCatalog.source || 'tmdb') !== source) {
      setActiveCatalogState(null);
    }
  };

  const handleDeleteCatalog = (catalogId) => {
    config.removeCatalog(catalogId);
    if (activeCatalog?._id === catalogId) {
      setActiveCatalog(null);
    }
    addToast('Catalog deleted');
  };

  const handleDuplicateCatalog = (catalogId) => {
    const catalog = config.catalogs.find((c) => c._id === catalogId || c.id === catalogId);
    if (!catalog) return;

    const newCatalog = {
      ...JSON.parse(JSON.stringify(catalog)),
      _id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      name: `${catalog.name} (Copy)`,
    };

    config.setCatalogs((prev) => [...prev, newCatalog]);
    setActiveCatalog(newCatalog);
    addToast('Catalog duplicated');
  };

  const handleUpdateCatalog = (id, data) => {
    config.updateCatalog(id, data);
    setActiveCatalog(data);
  };

  return {
    activeCatalog,
    setActiveCatalog,
    globalSource,
    setGlobalSource: handleSetGlobalSource,
    handleAddCatalog,
    handleAddPresetCatalog,
    handleDeleteCatalog,
    handleDuplicateCatalog,
    handleUpdateCatalog,
  };
}
