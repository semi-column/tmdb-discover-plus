import { useCallback } from 'react';
import { DEFAULT_CATALOG } from './useCatalogEditor';

export function useCatalogEditorHandlers({
  catalog,
  onUpdate,
  preferences,
  localCatalog,
  setLocalCatalog,
  setPreviewData,
  setPreviewLoading,
  setPreviewError,
  setExpandedSections,
  setSearchedNetworks,
  onPreview,
  onPreviewImdb,
  selectedPeople,
  selectedCompanies,
  selectedKeywords,
  excludeKeywords,
  excludeCompanies,
  searchTVNetworks,
}) {
  const toggleSection = useCallback(
    (section) => {
      setExpandedSections((prev) => {
        if (prev[section]) return { ...prev, [section]: false };
        const allClosed = Object.keys(prev).reduce((acc, key) => {
          acc[key] = false;
          return acc;
        }, {});
        return { ...allClosed, [section]: true };
      });
    },
    [setExpandedSections]
  );

  const handleFiltersChange = useCallback(
    (key, value) => {
      setLocalCatalog((prev) => {
        const current = prev || DEFAULT_CATALOG;
        return { ...current, filters: { ...current.filters, [key]: value } };
      });
    },
    [setLocalCatalog]
  );

  const handleNameChange = useCallback(
    (name) => {
      if (name.length > 50) return;
      setLocalCatalog((prev) => ({ ...prev, name }));
    },
    [setLocalCatalog]
  );

  const handleTypeChange = useCallback(
    (type) => {
      let result;
      setLocalCatalog((prev) => {
        const isNextMovie = type === 'movie';
        const isImdb = prev.source === 'imdb';
        const updated = {
          ...prev,
          type,
          filters: {
            ...prev.filters,
            genres: [],
            excludeGenres: [],
            sortBy: isImdb ? 'POPULARITY' : 'popularity.desc',
            ...(isNextMovie
              ? {
                  airDateFrom: undefined,
                  airDateTo: undefined,
                  firstAirDateFrom: undefined,
                  firstAirDateTo: undefined,
                  firstAirDateYear: undefined,
                  includeNullFirstAirDates: undefined,
                  screenedTheatrically: undefined,
                  timezone: undefined,
                }
              : {
                  includeVideo: undefined,
                  primaryReleaseYear: undefined,
                  certifications: undefined,
                  certificationMin: undefined,
                  certificationMax: undefined,
                  certificationCountry: undefined,
                }),
          },
        };
        result = updated;
        return updated;
      });
      if (catalog?._id && result) onUpdate(catalog._id, result);
    },
    [catalog?._id, onUpdate, setLocalCatalog]
  );

  const handleSourceChange = useCallback(
    (source) => {
      let result;
      setLocalCatalog((prev) => {
        const isNextImdb = source === 'imdb';
        const cleanedFilters = { ...prev.filters };

        if (isNextImdb) {
          delete cleanedFilters.voteCountMin;
          delete cleanedFilters.certifications;
          delete cleanedFilters.watchProviders;
          delete cleanedFilters.watchRegion;
          delete cleanedFilters.withPeople;
          delete cleanedFilters.withCompanies;
          delete cleanedFilters.withKeywords;
          delete cleanedFilters.withNetworks;
          delete cleanedFilters.monetizationType;
          delete cleanedFilters.releaseType;
          delete cleanedFilters.tvStatus;
          delete cleanedFilters.tvType;
          delete cleanedFilters.originalLanguage;
          delete cleanedFilters.yearRange;
          delete cleanedFilters.datePreset;
          delete cleanedFilters.imdbOnly;
        } else {
          delete cleanedFilters.keywords;
          delete cleanedFilters.awardsWon;
          delete cleanedFilters.awardsNominated;
          delete cleanedFilters.imdbListId;
          delete cleanedFilters.types;
          delete cleanedFilters.imdbRatingMin;
          delete cleanedFilters.totalVotesMin;
          delete cleanedFilters.releaseDateStart;
          delete cleanedFilters.releaseDateEnd;
          delete cleanedFilters.runtimeMin;
          delete cleanedFilters.runtimeMax;
          delete cleanedFilters.languages;
          delete cleanedFilters.countries;
          delete cleanedFilters.sortOrder;
        }

        const updated = {
          ...prev,
          source: isNextImdb ? 'imdb' : 'tmdb',
          filters: {
            ...cleanedFilters,
            sortBy: isNextImdb ? 'POPULARITY' : 'popularity.desc',
            listType: 'discover',
            genres: [],
            excludeGenres: [],
          },
        };
        result = updated;
        return updated;
      });
      if (catalog?._id && result) onUpdate(catalog._id, result);
    },
    [catalog?._id, onUpdate, setLocalCatalog]
  );

  const handleTriStateGenreClick = useCallback(
    (genreId) => {
      setLocalCatalog((prev) => {
        const current = prev || DEFAULT_CATALOG;
        const included = current.filters?.genres || [];
        const excluded = current.filters?.excludeGenres || [];
        const isIncluded = included.includes(genreId);
        const isExcluded = excluded.includes(genreId);
        let newIncluded, newExcluded;
        if (isIncluded) {
          newIncluded = included.filter((id) => id !== genreId);
          newExcluded = [...excluded, genreId];
        } else if (isExcluded) {
          newIncluded = included;
          newExcluded = excluded.filter((id) => id !== genreId);
        } else {
          newIncluded = [...included, genreId];
          newExcluded = excluded;
        }
        return {
          ...current,
          filters: { ...current.filters, genres: newIncluded, excludeGenres: newExcluded },
        };
      });
    },
    [setLocalCatalog]
  );

  const loadPreview = useCallback(async () => {
    if (!localCatalog) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      let data;
      if (localCatalog.source === 'imdb' && onPreviewImdb) {
        data = await onPreviewImdb(localCatalog.type || 'movie', localCatalog.filters || {});
      } else {
        const filters = {
          ...localCatalog.filters,
          displayLanguage: preferences?.defaultLanguage,
          withPeople: selectedPeople.map((p) => p.id).join(',') || undefined,
          withCompanies: selectedCompanies.map((c) => c.id).join(',') || undefined,
          withKeywords: selectedKeywords.map((k) => k.id).join(',') || undefined,
          excludeKeywords: excludeKeywords.map((k) => k.id).join(',') || undefined,
          excludeCompanies: excludeCompanies.map((c) => c.id).join(',') || undefined,
        };
        data = await onPreview(localCatalog.type || 'movie', filters);
      }
      setPreviewData(data);
    } catch (err) {
      setPreviewError(err.message);
    } finally {
      setPreviewLoading(false);
    }
  }, [
    localCatalog,
    onPreview,
    onPreviewImdb,
    preferences?.defaultLanguage,
    selectedPeople,
    selectedCompanies,
    selectedKeywords,
    excludeKeywords,
    excludeCompanies,
    setPreviewData,
    setPreviewLoading,
    setPreviewError,
  ]);

  const handleImport = useCallback(
    (data) => {
      setLocalCatalog((prev) => ({ ...prev, ...data }));
    },
    [setLocalCatalog]
  );

  const handleTVNetworkSearch = useCallback(
    async (query) => {
      if (!searchTVNetworks) return;
      const q = String(query || '').trim();
      if (q.length < 2) return;
      try {
        const results = await searchTVNetworks(q);
        if (!Array.isArray(results) || results.length === 0) return;
        setSearchedNetworks((prev) => {
          const byId = new Map();
          (prev || []).forEach((n) => {
            if (n && n.id != null) byId.set(String(n.id), n);
          });
          results.forEach((n) => {
            if (n && n.id != null) {
              const key = String(n.id);
              const existing = byId.get(key);
              const existingHasProperName = existing && existing.name && existing.name !== key;
              const newHasProperName = n.name && n.name !== key;
              if (!existing || (!existingHasProperName && newHasProperName) || newHasProperName) {
                byId.set(key, n);
              }
            }
          });
          return Array.from(byId.values());
        });
      } catch (e) {
        void e;
      }
    },
    [searchTVNetworks, setSearchedNetworks]
  );

  return {
    toggleSection,
    handleFiltersChange,
    handleNameChange,
    handleTypeChange,
    handleSourceChange,
    handleTriStateGenreClick,
    loadPreview,
    handleImport,
    handleTVNetworkSearch,
  };
}
