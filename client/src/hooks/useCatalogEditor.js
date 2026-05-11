import { useMemo, useRef, useState } from 'react';
import { useActiveFilters } from './useActiveFilters';
import { useCatalogSync } from './useCatalogSync';
import { useResolvedFilters } from './useResolvedFilters';
import { useWatchProviders } from './useWatchProviders';
import { DEFAULT_CATALOG } from './catalogEditor.constants';
import { useCatalog, useTMDBData, useAppActions } from '../context/AppContext';
import { PRESET_DATE_MAP } from '../constants/datePresets';

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
    searchCollection,
    searchTVNetworks,
    searchImdbPeople,
    searchImdbCompanies,
    searchCities,
    getPersonById,
    getCompanyById,
    getKeywordById,
    getNetworkById,
    getCollectionById,
    getWatchProviders,
    // Anime sources
    previewAnilist: onPreviewAnilist,
    previewMal: onPreviewMal,
    previewKitsu: onPreviewKitsu,
    previewSimkl: onPreviewSimkl,
    anilistGenres = [],
    anilistTags = [],
    anilistSortOptions = [],
    anilistFormatOptions = [],
    anilistStatusOptions = [],
    anilistSeasonOptions = [],
    anilistSourceOptions = [],
    anilistCountryOptions = [],
    malGenres = [],
    malRankingTypes = [],
    malSortOptions = [],
    malOrderByOptions = [],
    malMediaTypes = [],
    malStatuses = [],
    malRatings = [],
    simklGenres = [],
    simklSortOptions = [],
    simklListTypes = [],
    simklTrendingPeriods = [],
    simklBestFilters = [],
    simklAnimeTypes = [],
    // Trakt sources
    previewTrakt: onPreviewTrakt,
    traktGenres = [],
    traktListTypes = [],
    traktPeriods = [],
    traktCalendarTypes = [],

    traktShowStatuses = [],
    traktCertificationsMovie = [],
    traktCertificationsSeries = [],
    traktCommunityMetrics = [],
    traktNetworks = [],
    traktHasKey = false,
  } = useTMDBData();
  const { addToast } = useAppActions();

  const safeGenres =
    genres && typeof genres === 'object' && !Array.isArray(genres)
      ? genres
      : { movie: [], series: [] };
  const safeOriginalLanguages = Array.isArray(originalLanguages) ? originalLanguages : [];
  const safeCountries = Array.isArray(countries) ? countries : [];
  const safeSortOptions = useMemo(
    () =>
      sortOptions && typeof sortOptions === 'object' && !Array.isArray(sortOptions)
        ? sortOptions
        : { movie: [], series: [] },
    [sortOptions]
  );
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
  const [previewPosterProvider, setPreviewPosterProvider] = useState('default');
  const [searchedNetworks, setSearchedNetworks] = useState([]);
  const [selectedImdbPeople, setSelectedImdbPeople] = useState([]);
  const [selectedImdbCompanies, setSelectedImdbCompanies] = useState([]);
  const [selectedImdbExcludeCompanies, setSelectedImdbExcludeCompanies] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [selectedStudio, setSelectedStudio] = useState(null);
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

  const prevCatalogIdRef = useRef(catalog?._id ?? null);
  const incomingCatalogId = catalog?._id ?? null;
  if (prevCatalogIdRef.current !== incomingCatalogId) {
    prevCatalogIdRef.current = incomingCatalogId;
    setLocalCatalog(catalog ? withRestoredPreset(catalog) : DEFAULT_CATALOG);
    setPreviewData(null);
    setSelectedImdbPeople(catalog?.formState?.selectedImdbPeople || []);
    setSelectedImdbCompanies(catalog?.formState?.selectedImdbCompanies || []);
    setSelectedImdbExcludeCompanies(catalog?.formState?.selectedImdbExcludeCompanies || []);
    setSelectedCollection(catalog?.formState?.selectedCollection || null);
    setSelectedStudio(catalog?.formState?.selectedStudio || null);
    setSelectedCity(catalog?.formState?.selectedCity || null);

    // Always start with all sections collapsed, regardless of what was saved
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

  const mergedLocalCatalog = useMemo(() => {
    const presetDefaults = localCatalog.filters?.presetDefaults || {};
    return {
      ...localCatalog,
      filters: {
        ...presetDefaults,
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
        ...(localCatalog?.source === 'tmdb'
          ? {
              collectionId: selectedCollection?.id
                ? String(selectedCollection.id)
                : localCatalog?.filters?.collectionId,
              collectionName: selectedCollection?.name || localCatalog?.filters?.collectionName,
              studioId: selectedStudio?.id
                ? String(selectedStudio.id)
                : localCatalog?.filters?.studioId,
              studioName: selectedStudio?.name || localCatalog?.filters?.studioName,
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
        selectedCollection: selectedCollection || undefined,
        selectedStudio: selectedStudio || undefined,
        selectedCity: selectedCity || undefined,
        expandedSections,
      },
    };
  }, [
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
    selectedCollection,
    selectedStudio,
    selectedCity,
    expandedSections,
  ]);

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
    anilistSortOptions,
    anilistFormatOptions,
    anilistStatusOptions,
    anilistSeasonOptions,
    anilistSourceOptions,
    anilistCountryOptions,
    malRankingTypes,
    malSortOptions,
    malOrderByOptions,
    malMediaTypes,
    malStatuses,
    malRatings,
    simklListTypes,
    simklTrendingPeriods,
    simklBestFilters,
    simklSortOptions,
    simklAnimeTypes,
    traktListTypes,
    traktCalendarTypes,
    traktCommunityMetrics,
    traktNetworks,
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
    previewPosterProvider,
    setPreviewPosterProvider,
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
    searchCollection,
    searchTVNetworks,
    searchImdbPeople,
    searchImdbCompanies,
    searchCities,
    getCompanyById,
    getCollectionById,

    // Anime sources
    onPreviewAnilist,
    onPreviewMal,
    onPreviewKitsu,
    onPreviewSimkl,
    anilistGenres,
    anilistTags,
    anilistSortOptions,
    anilistFormatOptions,
    anilistStatusOptions,
    anilistSeasonOptions,
    anilistSourceOptions,
    anilistCountryOptions,
    malGenres,
    malRankingTypes,
    malSortOptions,
    malOrderByOptions,
    malMediaTypes,
    malStatuses,
    malRatings,
    simklGenres,
    simklSortOptions,
    simklListTypes,
    simklTrendingPeriods,
    simklBestFilters,
    simklAnimeTypes,

    // Trakt sources
    onPreviewTrakt,
    traktGenres,
    traktListTypes,
    traktPeriods,
    traktCalendarTypes,

    traktShowStatuses,
    traktCertificationsMovie,
    traktCertificationsSeries,
    traktCommunityMetrics,
    traktNetworks,
    traktHasKey,

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
    selectedCollection,
    setSelectedCollection,
    selectedStudio,
    setSelectedStudio,
    selectedCity,
    setSelectedCity,

    activeFilters,
    clearFilter,
    clearAllFilters,
  };
}
