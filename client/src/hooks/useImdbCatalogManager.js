import { useState } from 'react';

export function useImdbCatalogManager(config, addToast) {
  const [activeImdbCatalog, setActiveImdbCatalog] = useState(null);

  const handleAddImdbCatalog = (catalogData) => {
    const newCatalog = { ...catalogData, _id: crypto.randomUUID() };
    config.setImdbCatalogs((prev) => [...prev, newCatalog]);
    setActiveImdbCatalog(newCatalog);
  };

  const handleAddImdbPresetCatalog = (type, preset) => {
    const presetConfig = preset.config || {};
    const newCatalog = {
      _id: crypto.randomUUID(),
      name: presetConfig.name || preset.label.replace(/^[^\s]+\s/, ''),
      type: presetConfig.type || type,
      filters: {
        sortBy: presetConfig.sortBy || 'rating',
        sortOrder: 'desc',
      },
      enabled: true,
    };
    config.setImdbCatalogs((prev) => [...prev, newCatalog]);
    setActiveImdbCatalog(newCatalog);
  };

  const handleDeleteImdbCatalog = (catalogId) => {
    config.setImdbCatalogs((prev) => prev.filter((c) => c._id !== catalogId && c.id !== catalogId));
    if (activeImdbCatalog?._id === catalogId) {
      setActiveImdbCatalog(null);
    }
    addToast('IMDB catalog deleted');
  };

  const handleDuplicateImdbCatalog = (catalogId) => {
    const catalogs = Array.isArray(config.imdbCatalogs) ? config.imdbCatalogs : [];
    const catalog = catalogs.find((c) => c._id === catalogId || c.id === catalogId);
    if (!catalog) return;

    const newCatalog = {
      ...JSON.parse(JSON.stringify(catalog)),
      _id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      name: `${catalog.name} (Copy)`,
    };

    config.setImdbCatalogs((prev) => [...prev, newCatalog]);
    setActiveImdbCatalog(newCatalog);
    addToast('IMDB catalog duplicated');
  };

  const handleUpdateImdbCatalog = (id, data) => {
    config.setImdbCatalogs((prev) =>
      prev.map((c) => (c._id === id || c.id === id ? { ...c, ...data } : c))
    );
    setActiveImdbCatalog(data);
  };

  return {
    activeImdbCatalog,
    setActiveImdbCatalog,
    handleAddImdbCatalog,
    handleAddImdbPresetCatalog,
    handleDeleteImdbCatalog,
    handleDuplicateImdbCatalog,
    handleUpdateImdbCatalog,
  };
}
