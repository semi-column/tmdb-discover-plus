import { useCallback, useRef } from 'react';
import { DEFAULT_CATALOG } from './catalogEditor.constants';
import { getSource } from '../sources/index';
import { promotePresetToDiscover } from './useCatalogManager';

function normalizeArtworkContentType(type) {
  return type === 'series' || type === 'anime' ? type : 'movie';
}

function extractCustomUrlPattern(posterConfig) {
  if (typeof posterConfig?.customUrlPattern !== 'string') return null;
  const trimmed = posterConfig.customUrlPattern.trim();
  return trimmed || null;
}

function getPreviewCustomPosterPattern(preferences, contentType) {
  const normalizedType = normalizeArtworkContentType(contentType);

  const artwork = preferences?.artwork;
  if (artwork && typeof artwork === 'object') {
    const posterFromContentType = artwork?.[normalizedType]?.poster;
    const directPattern = extractCustomUrlPattern(posterFromContentType);
    if (directPattern) return directPattern;

    for (const ct of ['movie', 'series', 'anime']) {
      const candidatePattern = extractCustomUrlPattern(artwork?.[ct]?.poster);
      if (candidatePattern) return candidatePattern;
    }

    const legacyPoster = artwork?.poster;
    const legacyPattern = extractCustomUrlPattern(legacyPoster);
    if (legacyPattern) return legacyPattern;
  }

  if (typeof preferences?.posterCustomUrlPattern === 'string') {
    const fallbackPattern = preferences.posterCustomUrlPattern.trim();
    if (fallbackPattern) return fallbackPattern;
  }

  return null;
}

function getPreviewArtworkLanguagePreferences(preferences) {
  const artwork = preferences?.artwork;
  if (!artwork || typeof artwork !== 'object') {
    return {
      englishArtOnly: false,
      originalLangFallback: true,
    };
  }

  return {
    englishArtOnly: Boolean(artwork?.englishArtOnly),
    originalLangFallback:
      artwork?.originalLangFallback === undefined ? true : Boolean(artwork?.originalLangFallback),
  };
}

const SUPPORTED_PREVIEW_POSTER_PROVIDERS = new Set([
  'tmdb',
  'imdb',
  'tvdb',
  'fanart',
  'rpdb',
  'topPosters',
  'customUrl',
]);

function resolveGlobalPreviewPosterProvider(preferences, contentType) {
  const normalizedType = normalizeArtworkContentType(contentType);

  const providerFromArtwork =
    preferences?.artwork?.[normalizedType]?.poster?.provider ||
    preferences?.artwork?.poster?.provider ||
    null;

  const provider = providerFromArtwork || preferences?.posterService || null;

  if (!provider || provider === 'none' || provider === 'default' || provider === 'metahub') {
    return 'tmdb';
  }

  if (provider === 'customUrl') {
    return getPreviewCustomPosterPattern(preferences, contentType) ? 'customUrl' : 'tmdb';
  }

  return SUPPORTED_PREVIEW_POSTER_PROVIDERS.has(provider) ? provider : 'tmdb';
}

function stripOppositeTypeFilters(filters, targetType, sourceId) {
  const source = getSource(sourceId ?? 'tmdb');
  const normalizedTargetType =
    targetType === 'anime' ? 'series' : targetType === 'collection' ? 'movie' : targetType;
  const keysToRemove =
    normalizedTargetType === 'movie' ? source.seriesOnlyFilterKeys : source.movieOnlyFilterKeys;
  const result = { ...filters };
  for (const key of keysToRemove) {
    delete result[key];
  }
  return result;
}

function pickTypeSpecificFilters(filters, type, sourceId) {
  const source = getSource(sourceId ?? 'tmdb');
  const effectiveType = type === 'anime' ? 'series' : type === 'collection' ? 'movie' : type;
  const keys = effectiveType === 'movie' ? source.movieOnlyFilterKeys : source.seriesOnlyFilterKeys;
  const stash = {};
  for (const key of keys) {
    if (filters[key] !== undefined) stash[key] = filters[key];
  }
  return stash;
}

function normalizeTmdbSortValueForType(sortBy, targetType, sortOptions) {
  const effectiveType =
    targetType === 'anime' ? 'series' : targetType === 'collection' ? 'movie' : targetType;
  const typeSortOptions = sortOptions?.[effectiveType];

  if (!Array.isArray(typeSortOptions) || typeSortOptions.length === 0) {
    return sortBy;
  }

  if (sortBy == null) {
    return undefined;
  }

  const rawSortBy = String(sortBy);
  const validValues = new Set(typeSortOptions.map((option) => option?.value).filter(Boolean));
  if (validValues.has(rawSortBy)) {
    return rawSortBy;
  }

  const mappedSortBy =
    effectiveType === 'series' && /^release_date\.(asc|desc)$/i.test(rawSortBy)
      ? rawSortBy.replace(/^release_date\./i, 'first_air_date.')
      : effectiveType === 'movie' && /^first_air_date\.(asc|desc)$/i.test(rawSortBy)
        ? rawSortBy.replace(/^first_air_date\./i, 'release_date.')
        : null;

  if (mappedSortBy && validValues.has(mappedSortBy)) {
    return mappedSortBy;
  }

  return undefined;
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
  onPreviewKitsu,
  onPreviewSimkl,
  onPreviewTrakt,
  selectedPeople,
  selectedCompanies,
  selectedImdbPeople,
  selectedImdbCompanies,
  selectedImdbExcludeCompanies,
  previewPosterProvider,
  safeSortOptions,
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
        const filters = current.filters || {};
        let updatedFilters = { ...filters, [key]: value };
        if (filters.presetOrigin && filters.listType !== 'discover') {
          updatedFilters = { ...promotePresetToDiscover(filters), [key]: value };
        }
        return { ...current, filters: updatedFilters };
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

        const isSeriesLike = type === 'series' || type === 'anime';
        const isCollectionType = type === 'collection';

        const awardsWon = (strippedFilters.awardsWon || []).filter((a) =>
          isSeriesLike ? a !== 'best_picture_oscar' && a !== 'best_director_oscar' : a !== 'emmy'
        );
        const awardsNominated = (strippedFilters.awardsNominated || []).filter((a) =>
          isSeriesLike ? a !== 'best_picture_oscar' && a !== 'best_director_oscar' : a !== 'emmy'
        );

        const filterRankedListsByType = (lists) => {
          if (!Array.isArray(lists) || lists.length === 0) return lists;
          if (isSeriesLike) return [];
          return lists;
        };

        const nextTypeFilters = {
          ...strippedFilters,
          ...previousStash,
        };
        const sourceId = prev.source || 'tmdb';
        const sourceDescriptor = getSource(sourceId);
        const defaultSortBy = sourceDescriptor.defaultFilters?.sortBy;
        const requestedSortBy =
          nextTypeFilters.sortBy !== undefined ? nextTypeFilters.sortBy : defaultSortBy;
        const normalizedSortBy =
          sourceId === 'tmdb'
            ? (normalizeTmdbSortValueForType(requestedSortBy, type, safeSortOptions) ??
              defaultSortBy)
            : requestedSortBy;
        const collectionModeListType =
          nextTypeFilters.listType === 'studio' ? 'studio' : 'collection';
        const collectionModeSortBy =
          collectionModeListType === 'studio'
            ? nextTypeFilters.sortBy
            : (nextTypeFilters.sortBy ?? 'collection_order');

        const rankedList =
          isSeriesLike || isCollectionType ? undefined : nextTypeFilters.rankedList;

        const updated = {
          ...prev,
          type,
          filters: {
            ...nextTypeFilters,
            genres: prev.source === 'tmdb' || isImdb ? [] : nextTypeFilters.genres || [],
            excludeGenres:
              prev.source === 'tmdb' || isImdb ? [] : nextTypeFilters.excludeGenres || [],
            listType: isCollectionType
              ? collectionModeListType
              : nextTypeFilters.listType === 'collection' || nextTypeFilters.listType === 'studio'
                ? 'discover'
                : (nextTypeFilters.listType ?? 'discover'),
            presetOrigin: isCollectionType ? undefined : nextTypeFilters.presetOrigin,
            presetDefaults: isCollectionType ? undefined : nextTypeFilters.presetDefaults,
            collectionId: isCollectionType ? nextTypeFilters.collectionId : undefined,
            collectionName: isCollectionType ? nextTypeFilters.collectionName : undefined,
            studioId: isCollectionType ? nextTypeFilters.studioId : undefined,
            studioName: isCollectionType ? nextTypeFilters.studioName : undefined,
            sortBy: isCollectionType ? collectionModeSortBy : normalizedSortBy,
            awardsWon,
            awardsNominated,
            rankedList,
            rankedLists: filterRankedListsByType(nextTypeFilters.rankedLists),
            excludeRankedLists: filterRankedListsByType(nextTypeFilters.excludeRankedLists),
            inTheatersLat:
              type === 'movie' && !isCollectionType ? nextTypeFilters.inTheatersLat : undefined,
            inTheatersLong:
              type === 'movie' && !isCollectionType ? nextTypeFilters.inTheatersLong : undefined,
            inTheatersRadius:
              type === 'movie' && !isCollectionType ? nextTypeFilters.inTheatersRadius : undefined,
          },
        };
        result = updated;
        return updated;
      });
      if (catalog?._id && result) onUpdate(catalog._id, result);
    },
    [catalog?._id, onUpdate, safeSortOptions, setLocalCatalog]
  );

  const handleSourceChange = useCallback(
    (source) => {
      let result;
      setLocalCatalog((prev) => {
        const nextSource = getSource(source);
        const cleanedFilters = nextSource.cleanFiltersOnSwitch(prev.filters || {});
        const nextType =
          nextSource.supportedTypes && !nextSource.supportedTypes.includes(prev.type)
            ? nextSource.supportedTypes[0]
            : prev.type;
        const updated = {
          ...prev,
          source: nextSource.id,
          type: nextType,
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
      const globalPreviewPosterProvider = resolveGlobalPreviewPosterProvider(
        preferences,
        localCatalog.type
      );
      const selectedPreviewPosterProvider =
        previewPosterProvider && previewPosterProvider !== 'default'
          ? previewPosterProvider
          : globalPreviewPosterProvider;
      const selectedPreviewPosterApiKey = selectedPreviewPosterProvider
        ? preferences?.apiKeys?.[selectedPreviewPosterProvider] || null
        : null;
      const selectedPreviewPosterCustomUrlPattern =
        selectedPreviewPosterProvider === 'customUrl'
          ? getPreviewCustomPosterPattern(preferences, localCatalog.type)
          : null;
      const previewArtworkLanguagePreferences = getPreviewArtworkLanguagePreferences(preferences);

      let data;
      if (localCatalog.source === 'imdb' && onPreviewImdb) {
        const imdbFilters = {
          ...(localCatalog.filters || {}),
          creditedNames: selectedImdbPeople.map((p) => p.id),
          companies: selectedImdbCompanies.map((c) => c.id),
          excludeCompanies: selectedImdbExcludeCompanies.map((c) => c.id),
        };
        data = await onPreviewImdb(
          localCatalog.type || 'movie',
          imdbFilters,
          selectedPreviewPosterProvider,
          selectedPreviewPosterApiKey,
          selectedPreviewPosterCustomUrlPattern
        );
      } else if (localCatalog.source === 'anilist' && onPreviewAnilist) {
        data = await onPreviewAnilist(
          localCatalog.type || 'movie',
          localCatalog.filters || {},
          selectedPreviewPosterProvider,
          selectedPreviewPosterApiKey,
          selectedPreviewPosterCustomUrlPattern
        );
      } else if (localCatalog.source === 'mal' && onPreviewMal) {
        data = await onPreviewMal(
          localCatalog.type || 'movie',
          localCatalog.filters || {},
          selectedPreviewPosterProvider,
          selectedPreviewPosterApiKey,
          selectedPreviewPosterCustomUrlPattern
        );
      } else if (localCatalog.source === 'kitsu' && onPreviewKitsu) {
        data = await onPreviewKitsu(
          localCatalog.type || 'movie',
          localCatalog.filters || {},
          selectedPreviewPosterProvider,
          selectedPreviewPosterApiKey,
          selectedPreviewPosterCustomUrlPattern
        );
      } else if (localCatalog.source === 'simkl' && onPreviewSimkl) {
        data = await onPreviewSimkl(
          localCatalog.type || 'movie',
          localCatalog.filters || {},
          selectedPreviewPosterProvider,
          selectedPreviewPosterApiKey,
          selectedPreviewPosterCustomUrlPattern
        );
      } else if (localCatalog.source === 'trakt' && onPreviewTrakt) {
        data = await onPreviewTrakt(
          localCatalog.type || 'movie',
          localCatalog.filters || {},
          selectedPreviewPosterProvider,
          selectedPreviewPosterApiKey,
          selectedPreviewPosterCustomUrlPattern
        );
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
        data = await onPreview(
          localCatalog.type || 'movie',
          filters,
          1,
          selectedPreviewPosterProvider,
          selectedPreviewPosterApiKey,
          selectedPreviewPosterCustomUrlPattern,
          previewArtworkLanguagePreferences.englishArtOnly,
          previewArtworkLanguagePreferences.originalLangFallback
        );
      }
      setPreviewData(data);
      return true;
    } catch (err) {
      setPreviewError(err.message);
      return false;
    } finally {
      setPreviewLoading(false);
    }
  }, [
    localCatalog,
    onPreview,
    onPreviewImdb,
    onPreviewAnilist,
    onPreviewMal,
    onPreviewKitsu,
    onPreviewSimkl,
    onPreviewTrakt,
    previewPosterProvider,
    preferences,
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
