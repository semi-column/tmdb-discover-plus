import { useState } from 'react';

export function useCatalogManager(config, addToast) {
  const [activeCatalog, setActiveCatalog] = useState(null);

  const handleAddCatalog = (catalogData) => {
    const newCatalog = { ...catalogData, _id: crypto.randomUUID() };
    config.setCatalogs((prev) => [...prev, newCatalog]);
    setActiveCatalog(newCatalog);
  };

  const handleAddPresetCatalog = (type, preset) => {
    const newCatalog = {
      _id: crypto.randomUUID(),
      name: preset.label.replace(/^[^\s]+\s/, ''),
      type,
      filters: { listType: preset.value },
      enabled: true,
    };
    config.setCatalogs((prev) => [...prev, newCatalog]);
    setActiveCatalog(newCatalog);
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
    handleAddCatalog,
    handleAddPresetCatalog,
    handleDeleteCatalog,
    handleDuplicateCatalog,
    handleUpdateCatalog,
  };
}
