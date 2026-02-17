import { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveFilters } from './useActiveFilters';
import { useCatalogSync } from './useCatalogSync';
import { useResolvedFilters } from './useResolvedFilters';
import { useWatchProviders } from './useWatchProviders';
import { useCatalog, useTMDBData, useAppActions } from '../context/AppContext';

const DEFAULT_CATALOG = {
  name: '',
  type: 'movie',
  filters: {
    genres: [],
    excludeGenres: [],
    sortBy: 'popularity.desc',
    imdbOnly: false,
    voteCountMin: 0,
  },
  enabled: true,
};

export { DEFAULT_CATALOG };

export function useCatalogEditor() {
  const { activeCatalog: catalog, preferences = {}, handleUpdateCatalog: onUpdate } = useCatalog();
  const {
    genres = { movie: [], series: [] },
    loading: genresLoading = false,
    refresh: refreshGenres = () => {},
    originalLanguages = [],
    countries = [],
    sortOptions = { movie: [], series: [] },
    releaseTypes = [],
    tvStatuses = [],
    tvTypes = [],
    monetizationTypes = [],
    certifications = { movie: {}, series: {} },
    watchRegions = [],
    tvNetworks = [],
    preview: onPreview,
    previewImdb: onPreviewImdb,
    imdbGenres = [],
    imdbKeywords = [],
    imdbAwards = [],
    imdbSortOptions = [],
    imdbTitleTypes = [],
    imdbEnabled = false,
    searchPerson,
    searchCompany,
    searchKeyword,
    searchTVNetworks,
    getPersonById,
    getCompanyById,
    getKeywordById,
    getNetworkById,
    getWatchProviders,
  } = useTMDBData();
  const { addToast } = useAppActions();

  const safeGenres =
    genres && typeof genres === 'object' && !Array.isArray(genres)
      ? genres
      : { movie: [], series: [] };
  const safeOriginalLanguages = Array.isArray(originalLanguages) ? originalLanguages : [];
  const safeCountries = Array.isArray(countries) ? countries : [];
  const safeSortOptions =
    sortOptions && typeof sortOptions === 'object' && !Array.isArray(sortOptions)
      ? sortOptions
      : { movie: [], series: [] };
  const safeTvStatuses = Array.isArray(tvStatuses) ? tvStatuses : [];
  const safeTvTypes = Array.isArray(tvTypes) ? tvTypes : [];
  const safeMonetizationTypes = Array.isArray(monetizationTypes) ? monetizationTypes : [];
  const safeCertifications =
    certifications && typeof certifications === 'object' && !Array.isArray(certifications)
      ? certifications
      : { movie: {}, series: {} };
  const safeWatchRegions = Array.isArray(watchRegions) ? watchRegions : [];

  const [localCatalog, setLocalCatalog] = useState(catalog || DEFAULT_CATALOG);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [searchedNetworks, setSearchedNetworks] = useState([]);
  const [expandedSections, setExpandedSections] = useState({
    basic: false,
    genres: false,
    filters: false,
    release: false,
    streaming: false,
    people: false,
    options: false,
  });

  const prevCatalogIdRef = useRef(null);
  const {
    selectedPeople,
    setSelectedPeople,
    selectedCompanies,
    setSelectedCompanies,
    selectedKeywords,
    setSelectedKeywords,
    excludeKeywords,
    setExcludeKeywords,
    excludeCompanies,
    setExcludeCompanies,
    selectedNetworks,
  } = useResolvedFilters({
    catalog,
    getPersonById,
    searchPerson,
    getCompanyById,
    searchCompany,
    getKeywordById,
    searchKeyword,
    getNetworkById,
  });

  const { watchProviders } = useWatchProviders({
    type: localCatalog?.type,
    region: localCatalog?.filters?.watchRegion,
    getWatchProviders,
  });

  const mergedLocalCatalog = useMemo(
    () => ({
      ...localCatalog,
      filters: {
        ...localCatalog.filters,
        withPeople: selectedPeople.map((p) => p.id).join(',') || undefined,
        withCompanies: selectedCompanies.map((c) => c.id).join(',') || undefined,
        withKeywords: selectedKeywords.map((k) => k.id).join(',') || undefined,
        excludeKeywords: excludeKeywords.map((k) => k.id).join(',') || undefined,
        excludeCompanies: excludeCompanies.map((c) => c.id).join(',') || undefined,
      },
    }),
    [
      localCatalog,
      selectedPeople,
      selectedCompanies,
      selectedKeywords,
      excludeKeywords,
      excludeCompanies,
    ]
  );

  useCatalogSync({ localCatalog: mergedLocalCatalog, catalog, onUpdate });

  const { activeFilters, clearFilter, clearAllFilters } = useActiveFilters({
    localCatalog,
    setLocalCatalog,
    genres: safeGenres,
    sortOptions: safeSortOptions,
    originalLanguages: safeOriginalLanguages,
    countries: safeCountries,
    tvStatuses: safeTvStatuses,
    tvTypes: safeTvTypes,
    watchRegions: safeWatchRegions,
    monetizationTypes: safeMonetizationTypes,
    selectedPeople,
    setSelectedPeople,
    selectedCompanies,
    setSelectedCompanies,
    selectedKeywords,
    setSelectedKeywords,
    excludeKeywords,
    setExcludeKeywords,
    excludeCompanies,
    setExcludeCompanies,
  });

  const tvNetworkOptions = useMemo(() => {
    const byId = new Map();
    (tvNetworks || []).forEach((n) => {
      if (n && n.id != null) byId.set(String(n.id), n);
    });
    searchedNetworks.forEach((n) => {
      if (n && n.id != null) {
        const key = String(n.id);
        const existing = byId.get(key);
        const existingHasProperName = existing && existing.name && existing.name !== key;
        const newHasProperName = n.name && n.name !== key;
        if (!existing || !existingHasProperName || newHasProperName) {
          byId.set(key, n);
        }
      }
    });
    return Array.from(byId.values());
  }, [tvNetworks, searchedNetworks]);

  const catalogIdForSync = catalog?._id;
  const catalogRef = useRef(catalog);
  useEffect(() => {
    catalogRef.current = catalog;
  });

  useEffect(() => {
    const currentCatalog = catalogRef.current;
    if (currentCatalog) {
      setLocalCatalog(currentCatalog);
      const prevId = prevCatalogIdRef.current;
      const newId = currentCatalog._id || null;
      if (prevId !== newId) setPreviewData(null);
      prevCatalogIdRef.current = newId;
    } else {
      setLocalCatalog(DEFAULT_CATALOG);
      setPreviewData(null);
      prevCatalogIdRef.current = null;
    }
  }, [catalogIdForSync]);

  return {
    catalog,
    preferences,
    onUpdate,
    addToast,

    localCatalog,
    setLocalCatalog,
    previewData,
    setPreviewData,
    previewLoading,
    setPreviewLoading,
    previewError,
    setPreviewError,
    tvNetworkOptions,
    setSearchedNetworks,
    expandedSections,
    setExpandedSections,

    safeGenres,
    safeOriginalLanguages,
    safeCountries,
    safeSortOptions,
    safeTvStatuses,
    safeTvTypes,
    safeMonetizationTypes,
    safeCertifications,
    safeWatchRegions,

    sortOptions,
    originalLanguages,
    countries,
    releaseTypes,
    tvStatuses,
    tvTypes,
    monetizationTypes,
    watchRegions,
    watchProviders,

    genresLoading,
    refreshGenres,
    onPreview,
    onPreviewImdb,
    imdbGenres,
    imdbKeywords,
    imdbAwards,
    imdbSortOptions,
    imdbTitleTypes,
    imdbEnabled,
    searchPerson,
    searchCompany,
    searchKeyword,
    searchTVNetworks,

    selectedPeople,
    setSelectedPeople,
    selectedCompanies,
    setSelectedCompanies,
    selectedKeywords,
    setSelectedKeywords,
    excludeKeywords,
    setExcludeKeywords,
    excludeCompanies,
    setExcludeCompanies,
    selectedNetworks,

    activeFilters,
    clearFilter,
    clearAllFilters,
  };
}
