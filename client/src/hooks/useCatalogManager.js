import { useState } from 'react';
import { PRESET_DATE_MAP } from '../constants/datePresets';

const TMDB_PRESET_DISCOVER_DEFAULTS = {
  movie: {
    now_playing: {
      sortBy: 'popularity.desc',
      releaseTypes: ['2', '3'],
      datePreset: 'last_30_days',
    },
    upcoming: { sortBy: 'popularity.desc', releaseTypes: ['2', '3'], datePreset: 'next_30_days' },
    top_rated: { sortBy: 'vote_average.desc', excludeGenres: [99], voteCountMin: 200 },
    popular: { sortBy: 'popularity.desc' },
  },
  series: {
    airing_today: { sortBy: 'popularity.desc', datePreset: 'today' },
    on_the_air: { sortBy: 'popularity.desc', datePreset: 'next_7_days' },
    top_rated: { sortBy: 'vote_average.desc', voteCountMin: 200 },
    popular: { sortBy: 'popularity.desc' },
  },
};

function resolvePresetDateFields(filters, type) {
  if (!filters.datePreset) return filters;
  const dates = PRESET_DATE_MAP[filters.datePreset];
  if (!dates) return filters;
  const isMovie = type === 'movie';
  const fromKey = isMovie ? 'releaseDateFrom' : 'airDateFrom';
  const toKey = isMovie ? 'releaseDateTo' : 'airDateTo';
  return { ...filters, [fromKey]: dates.from, [toKey]: dates.to };
}

function buildPresetFilters(type, presetValue) {
  const defaults = TMDB_PRESET_DISCOVER_DEFAULTS[type]?.[presetValue];
  if (!defaults) return { listType: presetValue };

  const discoverDefaults = resolvePresetDateFields({ ...defaults }, type);
  return { listType: presetValue, presetOrigin: presetValue, presetDefaults: discoverDefaults };
}

export function promotePresetToDiscover(filters) {
  if (!filters?.presetOrigin || filters.listType === 'discover') return filters;
  const defaults = filters.presetDefaults || {};
  const { presetDefaults: _presetDefaults, ...rest } = filters;
  return { ...defaults, ...rest, listType: 'discover' };
}

export function useCatalogManager(config, addToast) {
  const [activeCatalog, setActiveCatalogState] = useState(null);
  const [globalSource, setGlobalSource] = useState('tmdb');

  const setActiveCatalog = (catalog) => {
    setActiveCatalogState(catalog);
    setGlobalSource(catalog?.source || 'tmdb');
  };

  const handleAddCatalog = (catalogData) => {
    const newCatalog = { ...catalogData, _id: crypto.randomUUID() };
    config.setCatalogs((prev) => [...prev, newCatalog]);
    setActiveCatalog(newCatalog);
  };

  const handleAddPresetCatalog = (type, preset, source) => {
    const effectiveSource = source || globalSource;
    const isTmdb = effectiveSource !== 'imdb';
    const newCatalog = {
      _id: crypto.randomUUID(),
      name: preset.label.replace(/^[^\s]+\s/, ''),
      type,
      filters: isTmdb ? buildPresetFilters(type, preset.value) : { listType: preset.value },
      enabled: true,
    };
    if (effectiveSource === 'imdb') {
      newCatalog.source = 'imdb';
    }
    config.setCatalogs((prev) => [...prev, newCatalog]);
    setActiveCatalog(newCatalog);
  };

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
      ...structuredClone(catalog),
      _id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      name: `${catalog.name} (Copy)`,
    };

    config.setCatalogs((prev) => {
      const sourceIndex = prev.findIndex((c) => c._id === catalogId || c.id === catalogId);
      if (sourceIndex < 0) return [...prev, newCatalog];

      const next = [...prev];
      next.splice(sourceIndex + 1, 0, newCatalog);
      return next;
    });
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
