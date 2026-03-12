import { useMemo, useRef, useState } from 'react';
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

const PRESET_DATE_MAP = {
  last_30_days: { from: 'today-30d', to: 'today' },
  last_90_days: { from: 'today-90d', to: 'today' },
  last_180_days: { from: 'today-6mo', to: 'today' },
  last_365_days: { from: 'today-12mo', to: 'today' },
  next_30_days: { from: 'today', to: 'today+30d' },
  next_90_days: { from: 'today', to: 'today+3mo' },
  era_2020s: { from: '2020-01-01', to: '2030-01-01' },
  era_2010s: { from: '2010-01-01', to: '2020-01-01' },
  era_2000s: { from: '2000-01-01', to: '2010-01-01' },
  era_1990s: { from: '1990-01-01', to: '2000-01-01' },
  era_1980s: { from: '1980-01-01', to: '1990-01-01' },
};

function withRestoredPreset(catalog) {
  if (!catalog) return DEFAULT_CATALOG;
  const filters = catalog.filters || {};
  if (!filters.datePreset) return catalog;
  const isMovie = catalog.type === 'movie';
  const fromKey = isMovie ? 'releaseDateFrom' : 'airDateFrom';
  const toKey = isMovie ? 'releaseDateTo' : 'airDateTo';
  if (filters[fromKey] && filters[toKey]) return catalog;
  const dates = PRESET_DATE_MAP[filters.datePreset];
  if (!dates) return catalog;
  return {
    ...catalog,
    filters: {
      ...filters,
      [fromKey]: filters[fromKey] || dates.from,
      [toKey]: filters[toKey] || dates.to,
    },
  };
}

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
    imdbCertificateRatings = {},
    imdbRankedLists = [],
    imdbWithDataOptions = [],
    searchPerson,
    searchCompany,
    searchKeyword,
    searchTVNetworks,
    searchImdbPeople,
    searchImdbCompanies,
    searchCities,
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

  const [localCatalog, setLocalCatalog] = useState(() =>
    withRestoredPreset(catalog || DEFAULT_CATALOG)
  );
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [searchedNetworks, setSearchedNetworks] = useState([]);
  const [selectedImdbPeople, setSelectedImdbPeople] = useState([]);
  const [selectedImdbCompanies, setSelectedImdbCompanies] = useState([]);
  const [selectedImdbExcludeCompanies, setSelectedImdbExcludeCompanies] = useState([]);
  const [selectedCity, setSelectedCity] = useState(null);
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

  // Sync all catalog-derived state when the selected catalog changes.
  // Uses "setState during render" — React-approved pattern to avoid setState-in-effect.
  // See: https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const incomingCatalogId = catalog?._id ?? null;
  if (prevCatalogIdRef.current !== incomingCatalogId) {
    prevCatalogIdRef.current = incomingCatalogId;
    setLocalCatalog(catalog ? withRestoredPreset(catalog) : DEFAULT_CATALOG);
    setPreviewData(null);
    setSelectedImdbPeople(catalog?.formState?.selectedImdbPeople || []);
    setSelectedImdbCompanies(catalog?.formState?.selectedImdbCompanies || []);
    setSelectedImdbExcludeCompanies(catalog?.formState?.selectedImdbExcludeCompanies || []);
    setSelectedCity(catalog?.formState?.selectedCity || null);
    if (catalog?.formState?.expandedSections) {
      setExpandedSections(catalog.formState.expandedSections);
    } else if (catalog) {
      setExpandedSections({
        basic: false,
        genres: false,
        filters: false,
        release: false,
        streaming: false,
        people: false,
        options: false,
      });
    }
  }

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
        excludeCompanies:
          localCatalog?.source === 'imdb'
            ? selectedImdbExcludeCompanies.map((c) => c.id)
            : excludeCompanies.map((c) => c.id).join(',') || undefined,
        ...(localCatalog?.source === 'imdb'
          ? {
              creditedNames: selectedImdbPeople.map((p) => p.id),
              companies: selectedImdbCompanies.map((c) => c.id),
            }
          : {}),
      },
      formState: {
        selectedPeople: selectedPeople.length > 0 ? selectedPeople : undefined,
        selectedCompanies: selectedCompanies.length > 0 ? selectedCompanies : undefined,
        selectedKeywords: selectedKeywords.length > 0 ? selectedKeywords : undefined,
        excludeKeywords: excludeKeywords.length > 0 ? excludeKeywords : undefined,
        excludeCompanies: excludeCompanies.length > 0 ? excludeCompanies : undefined,
        selectedNetworks: selectedNetworks.length > 0 ? selectedNetworks : undefined,
        selectedImdbPeople: selectedImdbPeople.length > 0 ? selectedImdbPeople : undefined,
        selectedImdbCompanies: selectedImdbCompanies.length > 0 ? selectedImdbCompanies : undefined,
        selectedImdbExcludeCompanies:
          selectedImdbExcludeCompanies.length > 0 ? selectedImdbExcludeCompanies : undefined,
        selectedCity: selectedCity || undefined,
        expandedSections,
      },
    }),
    [
      localCatalog,
      selectedPeople,
      selectedCompanies,
      selectedKeywords,
      excludeKeywords,
      excludeCompanies,
      selectedNetworks,
      selectedImdbPeople,
      selectedImdbCompanies,
      selectedImdbExcludeCompanies,
      selectedCity,
      expandedSections,
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
    selectedImdbExcludeCompanies,
    setSelectedImdbExcludeCompanies,
    imdbSortOptions,
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
    imdbCertificateRatings,
    imdbRankedLists,
    imdbWithDataOptions,
    searchPerson,
    searchCompany,
    searchKeyword,
    searchTVNetworks,
    searchImdbPeople,
    searchImdbCompanies,
    searchCities,

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
    selectedImdbPeople,
    setSelectedImdbPeople,
    selectedImdbCompanies,
    setSelectedImdbCompanies,
    selectedImdbExcludeCompanies,
    setSelectedImdbExcludeCompanies,
    selectedCity,
    setSelectedCity,

    activeFilters,
    clearFilter,
    clearAllFilters,
  };
}
