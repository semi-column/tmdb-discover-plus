import { useCallback, useRef } from 'react';
import { DEFAULT_CATALOG } from './catalogEditor.constants';
import { getSource } from '../sources/index';

function stripOppositeTypeFilters(filters, targetType, sourceId) {
  const source = getSource(sourceId ?? 'tmdb');
  const keysToRemove =
    targetType === 'movie' ? source.seriesOnlyFilterKeys : source.movieOnlyFilterKeys;
  const result = { ...filters };
  for (const key of keysToRemove) {
    delete result[key];
  }
  return result;
}

function pickTypeSpecificFilters(filters, type, sourceId) {
  const source = getSource(sourceId ?? 'tmdb');
  const keys = type === 'movie' ? source.movieOnlyFilterKeys : source.seriesOnlyFilterKeys;
  const stash = {};
  for (const key of keys) {
    if (filters[key] !== undefined) stash[key] = filters[key];
  }
  return stash;
}

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
  onPreviewAnilist,
  onPreviewMal,
  onPreviewSimkl,
  selectedPeople,
  selectedCompanies,
  selectedImdbPeople,
  selectedImdbCompanies,
  selectedImdbExcludeCompanies,
  selectedKeywords,
  excludeKeywords,
  excludeCompanies,
  searchTVNetworks,
}) {
  const typeFilterStashRef = useRef({});
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
        const currentType = prev.type || 'movie';
        if (currentType === type) return prev; // no-op

        const catalogId = prev._id;
        const isImdb = prev.source === 'imdb';

        if (catalogId) {
          const stash = typeFilterStashRef.current;
          if (!stash[catalogId]) stash[catalogId] = {};
          stash[catalogId][currentType] = pickTypeSpecificFilters(
            prev.filters || {},
            currentType,
            prev.source
          );
        }

        const strippedFilters = stripOppositeTypeFilters(prev.filters || {}, type, prev.source);

        const previousStash = typeFilterStashRef.current[catalogId]?.[type] || {};

        const awardsWon = (strippedFilters.awardsWon || []).filter((a) =>
          type === 'series'
            ? a !== 'best_picture_oscar' && a !== 'best_director_oscar'
            : a !== 'emmy'
        );
        const awardsNominated = (strippedFilters.awardsNominated || []).filter((a) =>
          type === 'series'
            ? a !== 'best_picture_oscar' && a !== 'best_director_oscar'
            : a !== 'emmy'
        );

        const filterRankedListsByType = (lists) => {
          if (!Array.isArray(lists) || lists.length === 0) return lists;
          if (type === 'series') return [];
          return lists;
        };

        const nextTypeFilters = {
          ...strippedFilters,
          ...previousStash,
        };

        const rankedList = type === 'series' ? undefined : nextTypeFilters.rankedList;

        const updated = {
          ...prev,
          type,
          filters: {
            ...nextTypeFilters,
            genres: prev.source === 'tmdb' || isImdb ? [] : nextTypeFilters.genres || [],
            excludeGenres:
              prev.source === 'tmdb' || isImdb ? [] : nextTypeFilters.excludeGenres || [],
            sortBy:
              nextTypeFilters.sortBy !== undefined
                ? nextTypeFilters.sortBy
                : getSource(prev.source || 'tmdb').defaultFilters?.sortBy,
            awardsWon,
            awardsNominated,
            rankedList,
            rankedLists: filterRankedListsByType(nextTypeFilters.rankedLists),
            excludeRankedLists: filterRankedListsByType(nextTypeFilters.excludeRankedLists),
            inTheatersLat: type === 'movie' ? nextTypeFilters.inTheatersLat : undefined,
            inTheatersLong: type === 'movie' ? nextTypeFilters.inTheatersLong : undefined,
            inTheatersRadius: type === 'movie' ? nextTypeFilters.inTheatersRadius : undefined,
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
        const nextSource = getSource(source);
        const cleanedFilters = nextSource.cleanFiltersOnSwitch(prev.filters || {});
        const updated = {
          ...prev,
          source: nextSource.id,
          filters: {
            ...cleanedFilters,
            sortBy: nextSource.defaultSortBy,
            sortOrder: nextSource.defaultFilters.sortOrder,
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
        const imdbFilters = {
          ...(localCatalog.filters || {}),
          creditedNames: selectedImdbPeople.map((p) => p.id),
          companies: selectedImdbCompanies.map((c) => c.id),
          excludeCompanies: selectedImdbExcludeCompanies.map((c) => c.id),
        };
        data = await onPreviewImdb(localCatalog.type || 'movie', imdbFilters);
      } else if (localCatalog.source === 'anilist' && onPreviewAnilist) {
        data = await onPreviewAnilist(localCatalog.type || 'movie', localCatalog.filters || {});
      } else if (localCatalog.source === 'mal' && onPreviewMal) {
        data = await onPreviewMal(localCatalog.type || 'movie', localCatalog.filters || {});
      } else if (localCatalog.source === 'simkl' && onPreviewSimkl) {
        data = await onPreviewSimkl(localCatalog.type || 'movie', localCatalog.filters || {});
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
    onPreviewAnilist,
    onPreviewMal,
    onPreviewSimkl,
    preferences?.defaultLanguage,
    selectedPeople,
    selectedCompanies,
    selectedImdbPeople,
    selectedImdbCompanies,
    selectedImdbExcludeCompanies,
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
        console.warn('Network search failed:', e);
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
