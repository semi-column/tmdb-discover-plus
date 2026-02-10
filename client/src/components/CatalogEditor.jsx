import {
  Download as ArrowDownTrayIcon,
  Upload as ArrowUpTrayIcon,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Film,
  Loader,
  Play,
  Settings,
  Sparkles,
  Tv,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MultiSelect } from './MultiSelect';
import { RangeSlider, SingleSlider } from './RangeSlider';
import { SearchableSelect } from './SearchableSelect';
import { LabelWithTooltip } from './Tooltip';
import { CatalogPreview } from './catalog/CatalogPreview';
import { FilterSection } from './catalog/FilterSection';
import { GenreSelector } from './catalog/GenreSelector';
import { PeopleFilters } from './catalog/PeopleFilters';
import { StreamFilters } from './catalog/StreamFilters';

import { useCatalogSync } from '../hooks/useCatalogSync';
import { useResolvedFilters } from '../hooks/useResolvedFilters';
import { useWatchProviders } from '../hooks/useWatchProviders';

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

const CURRENT_YEAR = new Date().getFullYear();

const DATE_PRESETS = [
  { label: 'Last 30 days', value: 'last_30_days', days: 30 },
  { label: 'Last 90 days', value: 'last_90_days', days: 90 },
  { label: 'Last 6 months', value: 'last_180_days', days: 180 },
  { label: 'Last 12 months', value: 'last_365_days', days: 365 },
  { label: 'Next 30 days', value: 'next_30_days', future: true },
  { label: 'Next 3 months', value: 'next_90_days', future: true },
];



export function CatalogEditor({
  catalog,
  genres = { movie: [], series: [] },
  genresLoading = false,
  refreshGenres = () => {},
  languages = [],
  countries = [],
  sortOptions = { movie: [], series: [] },
  releaseTypes = [],
  tvStatuses = [],
  tvTypes = [],
  monetizationTypes = [],
  certifications = { movie: {}, series: {} },
  watchRegions = [],
  tvNetworks = [],
  onUpdate,
  onPreview,
  preferences = {},
  searchPerson,
  searchCompany,
  searchKeyword,
  searchTVNetworks,
  getPersonById,
  getCompanyById,
  getKeywordById,
  getNetworkById,
  getWatchProviders,
}) {
  const [localCatalog, setLocalCatalog] = useState(catalog || DEFAULT_CATALOG);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [selectedDatePreset, setSelectedDatePreset] = useState(null);
  const [tvNetworkOptions, setTVNetworkOptions] = useState(tvNetworks || []);

  useEffect(() => {
    if (tvNetworks && tvNetworks.length > 0) {
      setTVNetworkOptions(tvNetworks);
    }
  }, [tvNetworks]);
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
    catalog: catalog,
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
  const peopleIds = selectedPeople.map((p) => p.id).join(',') || undefined;
  const companiesIds = selectedCompanies.map((c) => c.id).join(',') || undefined;
  const keywordsIds = selectedKeywords.map((k) => k.id).join(',') || undefined;
  const excludeKeywordsIds = excludeKeywords.map((k) => k.id).join(',') || undefined;
  const excludeCompaniesIds = excludeCompanies.map((c) => c.id).join(',') || undefined;

  const mergedLocalCatalog = useMemo(
    () => ({
      ...localCatalog,
      filters: {
        ...localCatalog.filters,
        withPeople: peopleIds,
        withCompanies: companiesIds,
        withKeywords: keywordsIds,
        excludeKeywords: excludeKeywordsIds,
        excludeCompanies: excludeCompaniesIds,
      },
    }),
    [localCatalog, peopleIds, companiesIds, keywordsIds, excludeKeywordsIds, excludeCompaniesIds]
  );

  useCatalogSync({
    localCatalog: mergedLocalCatalog,
    catalog,
    onUpdate,
  });

  useEffect(() => {
    setTVNetworkOptions((prev) => {
      const byId = new Map();
      (prev || []).forEach((n) => {
        if (n && n.id != null) byId.set(String(n.id), n);
      });
      (tvNetworks || []).forEach((n) => {
        if (n && n.id != null) {
          const key = String(n.id);
          const existing = byId.get(key);
          const existingHasProperName = existing && existing.name && existing.name !== key;
          const newHasProperName = n.name && n.name !== key;
          if (!existing || (!existingHasProperName && newHasProperName)) {
            byId.set(key, n);
          }
        }
      });
      return Array.from(byId.values());
    });
  }, [tvNetworks]);

  const handleTVNetworkSearch = useCallback(
    async (query) => {
      if (!searchTVNetworks) return;
      const q = String(query || '').trim();
      if (q.length < 2) return;
      try {
        const results = await searchTVNetworks(q);
        if (!Array.isArray(results) || results.length === 0) return;
        setTVNetworkOptions((prev) => {
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
    [searchTVNetworks]
  );

  const handleTriStateGenreClick = useCallback((genreId) => {
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
        filters: {
          ...current.filters,
          genres: newIncluded,
          excludeGenres: newExcluded,
        },
      };
    });
  }, []);

  const catalogIdForSync = catalog?._id;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  useEffect(() => {
    const currentCatalog = catalogRef.current;
    if (currentCatalog) {
      setLocalCatalog(currentCatalog);

      if (currentCatalog.filters?.datePreset) {
        const presetMatch = DATE_PRESETS.find((p) => p.value === currentCatalog.filters.datePreset);
        setSelectedDatePreset(presetMatch ? presetMatch.label : null);
      } else {
        setSelectedDatePreset(null);
      }
      const prevId = prevCatalogIdRef.current;
      const newId = currentCatalog._id || null;
      if (prevId !== newId) {
        setPreviewData(null);
      }
      prevCatalogIdRef.current = newId;
    } else {
      setLocalCatalog(DEFAULT_CATALOG);
      setSelectedDatePreset(null);
      setPreviewData(null);
      prevCatalogIdRef.current = null;
    }
  }, [catalogIdForSync]);

  const toggleSection = (section) => {
    setExpandedSections((prev) => {
      const isCurrentlyExpanded = prev[section];
      if (isCurrentlyExpanded) {
        return { ...prev, [section]: false };
      } else {
        const allClosed = Object.keys(prev).reduce((acc, key) => {
          acc[key] = false;
          return acc;
        }, {});
        return { ...allClosed, [section]: true };
      }
    });
  };

  const handleFiltersChange = useCallback((key, value) => {
    setLocalCatalog((prev) => {
      const current = prev || DEFAULT_CATALOG;
      return {
        ...current,
        filters: {
          ...current.filters,
          [key]: value,
        },
      };
    });
  }, []);

  const handleNameChange = useCallback((name) => {
    setLocalCatalog((prev) => ({ ...prev, name }));
  }, []);

  const handleTypeChange = useCallback(
    (type) => {
      setLocalCatalog((prev) => {
        const isNextMovie = type === 'movie';
        const updated = {
          ...prev,
          type,
          filters: {
            ...prev.filters,
            genres: [],
            excludeGenres: [],
            sortBy: 'popularity.desc',
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
        if (catalog?._id) {
          onUpdate(catalog._id, updated);
        }
        return updated;
      });
    },
    [catalog?._id, onUpdate]
  );

  const handleYearRangeChange = useCallback((range) => {
    setLocalCatalog((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        yearFrom: range[0],
        yearTo: range[1],
      },
    }));
  }, []);

  const handleRatingRangeChange = useCallback((range) => {
    setLocalCatalog((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        ratingMin: range[0],
        ratingMax: range[1],
      },
    }));
  }, []);

  const handleRuntimeRangeChange = useCallback((range) => {
    setLocalCatalog((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        runtimeMin: range[0] === 0 ? undefined : range[0],
        runtimeMax: range[1] === 400 ? undefined : range[1],
      },
    }));
  }, []);

  const handleDatePreset = useCallback(
    (preset) => {
      setSelectedDatePreset(preset.label);
      handleFiltersChange('datePreset', preset.value);
      const isMovieType = localCatalog?.type === 'movie';
      handleFiltersChange(isMovieType ? 'releaseDateFrom' : 'airDateFrom', undefined);
      handleFiltersChange(isMovieType ? 'releaseDateTo' : 'airDateTo', undefined);
    },
    [localCatalog?.type, handleFiltersChange]
  );

  const loadPreview = async () => {
    if (!localCatalog) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const filters = {
        ...localCatalog.filters,
        displayLanguage: preferences?.defaultLanguage,
        withPeople: selectedPeople.map((p) => p.id).join(',') || undefined,
        withCompanies: selectedCompanies.map((c) => c.id).join(',') || undefined,
        withKeywords: selectedKeywords.map((k) => k.id).join(',') || undefined,
        excludeKeywords: excludeKeywords.map((k) => k.id).join(',') || undefined,
        excludeCompanies: excludeCompanies.map((c) => c.id).join(',') || undefined,
      };
      const data = await onPreview(localCatalog.type || 'movie', filters);
      setPreviewData(data);
    } catch (err) {
      setPreviewError(err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Compute active filters for the summary bar
  const getActiveFilters = useCallback(() => {
    const filters = localCatalog?.filters || {};
    const active = [];
    const isMovieType = localCatalog?.type === 'movie';

    // Sort By (non-default)
    if (filters.sortBy && filters.sortBy !== 'popularity.desc') {
      const sortOpts = sortOptions[localCatalog?.type] || sortOptions.movie || [];
      const match = sortOpts.find((s) => s.value === filters.sortBy);
      active.push({
        key: 'sortBy',
        label: `Sort: ${match?.label || filters.sortBy}`,
        section: 'filters',
      });
    }

    // Genres
    if (filters.genres?.length > 0) {
      const genreNames = filters.genres
        .map((id) => {
          const genre = (genres[localCatalog?.type] || []).find((g) => g.id === id);
          return genre?.name || id;
        })
        .slice(0, 2);
      const extra = filters.genres.length > 2 ? ` +${filters.genres.length - 2}` : '';
      active.push({
        key: 'genres',
        label: `Genres: ${genreNames.join(', ')}${extra}`,
        section: 'genres',
      });
    }

    // Excluded Genres
    if (filters.excludeGenres?.length > 0) {
      const excNames = filters.excludeGenres
        .map((id) => {
          const genre = (genres[localCatalog?.type] || []).find((g) => g.id === id);
          return genre?.name || id;
        })
        .slice(0, 2);
      const extra = filters.excludeGenres.length > 2 ? ` +${filters.excludeGenres.length - 2}` : '';
      active.push({
        key: 'excludeGenres',
        label: `Exclude: ${excNames.join(', ')}${extra}`,
        section: 'genres',
      });
    }

    // Genre Match Mode
    if (filters.genreMatchMode === 'all' && filters.genres?.length > 1) {
      active.push({
        key: 'genreMatchMode',
        label: 'Genre match: ALL',
        section: 'genres',
      });
    }

    // Original language
    if (filters.language) {
      const lang = languages.find((l) => l.iso_639_1 === filters.language);
      active.push({
        key: 'language',
        label: `Language: ${lang?.english_name || filters.language}`,
        section: 'filters',
      });
    }

    // Country
    if (filters.originCountry) {
      const country = countries.find((c) => c.iso_3166_1 === filters.originCountry);
      active.push({
        key: 'originCountry',
        label: `Country: ${country?.english_name || filters.originCountry}`,
        section: 'filters',
      });
    }

    // Year Range
    if (filters.yearFrom || filters.yearTo) {
      const from = filters.yearFrom || 'Any';
      const to = filters.yearTo || 'Now';
      active.push({ key: 'year', label: `Year: ${from}–${to}`, section: 'filters' });
    }

    // Rating
    if (filters.ratingMin > 0 || (filters.ratingMax != null && filters.ratingMax < 10)) {
      active.push({
        key: 'rating',
        label: `Rating: ${filters.ratingMin || 0}–${filters.ratingMax ?? 10}`,
        section: 'filters',
      });
    }

    // Runtime
    if (filters.runtimeMin || filters.runtimeMax) {
      active.push({
        key: 'runtime',
        label: `Runtime: ${filters.runtimeMin || 0}–${filters.runtimeMax || '∞'}min`,
        section: 'filters',
      });
    }

    // Minimum Votes
    if (filters.voteCountMin > 0) {
      active.push({
        key: 'voteCountMin',
        label: `Min votes: ${filters.voteCountMin.toLocaleString()}`,
        section: 'filters',
      });
    }

    // Date Preset (dynamic date filters)
    if (filters.datePreset) {
      const presetMatch = DATE_PRESETS.find((p) => p.value === filters.datePreset);
      const label = presetMatch ? presetMatch.label : filters.datePreset;
      active.push({ key: 'datePreset', label: `Date: ${label}`, section: 'release' });
    } else if (
      filters.releaseDateFrom ||
      filters.releaseDateTo ||
      filters.airDateFrom ||
      filters.airDateTo
    ) {
      const from = filters.releaseDateFrom || filters.airDateFrom || '…';
      const to = filters.releaseDateTo || filters.airDateTo || '…';
      active.push({
        key: 'releaseDate',
        label: `${isMovieType ? 'Release' : 'Air'}: ${from} – ${to}`,
        section: 'release',
      });
    }

    // First Air Date range (TV)
    if (!isMovieType && (filters.firstAirDateFrom || filters.firstAirDateTo)) {
      const from = filters.firstAirDateFrom || '…';
      const to = filters.firstAirDateTo || '…';
      active.push({
        key: 'firstAirDate',
        label: `Premiered: ${from} – ${to}`,
        section: 'release',
      });
    }

    if (filters.firstAirDateYear) {
      active.push({
        key: 'firstAirDateYear',
        label: `First air year: ${filters.firstAirDateYear}`,
        section: 'release',
      });
    }

    if (filters.primaryReleaseYear) {
      active.push({
        key: 'primaryReleaseYear',
        label: `Release year: ${filters.primaryReleaseYear}`,
        section: 'release',
      });
    }

    // Region
    if (isMovieType && filters.region) {
      const regionLabel =
        countries.find((c) => c.iso_3166_1 === filters.region)?.english_name || filters.region;
      active.push({
        key: 'region',
        label: `Release region: ${regionLabel}`,
        section: 'release',
      });
    }

    // Release Types
    if (isMovieType && filters.releaseTypes?.length > 0) {
      active.push({
        key: 'releaseTypes',
        label: `${filters.releaseTypes.length} release type(s)`,
        section: 'release',
      });
    }

    // Certifications (specific values)
    if (filters.certifications?.length > 0) {
      active.push({
        key: 'certifications',
        label: `Rating: ${filters.certifications.join(', ')}`,
        section: 'release',
      });
    }

    if (filters.certificationMin || filters.certificationMax) {
      const min = filters.certificationMin || 'Any';
      const max = filters.certificationMax || 'Any';
      active.push({
        key: 'certificationRange',
        label: `Age range: ${min}–${max}`,
        section: 'release',
      });
    }

    if (filters.certificationCountry && filters.certificationCountry !== 'US') {
      const certCountryLabel =
        countries.find((c) => c.iso_3166_1 === filters.certificationCountry)?.english_name ||
        filters.certificationCountry;
      active.push({
        key: 'certificationCountry',
        label: `Rating country: ${certCountryLabel}`,
        section: 'release',
      });
    }

    if (filters.timezone) {
      active.push({
        key: 'timezone',
        label: `Timezone: ${filters.timezone}`,
        section: 'release',
      });
    }

    // TV Status
    if (!isMovieType && filters.tvStatus) {
      const statusMatch = tvStatuses.find((s) => s.value === filters.tvStatus);
      active.push({
        key: 'tvStatus',
        label: `Status: ${statusMatch?.label || filters.tvStatus}`,
        section: 'release',
      });
    }

    // TV Type
    if (!isMovieType && filters.tvType) {
      const typeMatch = tvTypes.find((t) => t.value === filters.tvType);
      active.push({
        key: 'tvType',
        label: `Type: ${typeMatch?.label || filters.tvType}`,
        section: 'release',
      });
    }

    // Streaming
    if (filters.watchRegion) {
      const regionLabel =
        watchRegions.find((r) => r.iso_3166_1 === filters.watchRegion)?.english_name ||
        filters.watchRegion;
      active.push({
        key: 'watchRegion',
        label: `Stream region: ${regionLabel}`,
        section: 'streaming',
      });
    }

    if (filters.watchProviders?.length > 0) {
      active.push({
        key: 'watchProviders',
        label: `${filters.watchProviders.length} streaming service(s)`,
        section: 'streaming',
      });
    }

    if (filters.watchMonetizationTypes) {
      active.push({
        key: 'watchMonetizationTypes',
        label: `Monetization: ${filters.watchMonetizationTypes}`,
        section: 'streaming',
      });
    }

    // TV Networks
    if (filters.withNetworks) {
      const count = filters.withNetworks.split('|').filter(Boolean).length;
      active.push({
        key: 'withNetworks',
        label: `${count} network(s)`,
        section: 'streaming',
      });
    }

    // People
    if (selectedPeople.length > 0) {
      const names = selectedPeople.slice(0, 2).map((p) => p.name);
      const extra = selectedPeople.length > 2 ? ` +${selectedPeople.length - 2}` : '';
      active.push({
        key: 'people',
        label: `Cast/Crew: ${names.join(', ')}${extra}`,
        section: 'people',
      });
    }

    // Companies
    if (selectedCompanies.length > 0) {
      const names = selectedCompanies.slice(0, 2).map((c) => c.name);
      const extra = selectedCompanies.length > 2 ? ` +${selectedCompanies.length - 2}` : '';
      active.push({
        key: 'companies',
        label: `Studio: ${names.join(', ')}${extra}`,
        section: 'people',
      });
    }

    // Excluded Companies
    if (excludeCompanies.length > 0) {
      active.push({
        key: 'excludeCompanies',
        label: `Exclude ${excludeCompanies.length} studio(s)`,
        section: 'people',
      });
    }

    // Keywords
    if (selectedKeywords.length > 0) {
      const names = selectedKeywords.slice(0, 2).map((k) => k.name);
      const extra = selectedKeywords.length > 2 ? ` +${selectedKeywords.length - 2}` : '';
      active.push({
        key: 'keywords',
        label: `Keywords: ${names.join(', ')}${extra}`,
        section: 'people',
      });
    }

    // Excluded Keywords
    if (excludeKeywords.length > 0) {
      active.push({
        key: 'excludeKeywords',
        label: `Exclude ${excludeKeywords.length} keyword(s)`,
        section: 'people',
      });
    }

    // Options
    if (filters.includeAdult) {
      active.push({ key: 'includeAdult', label: 'Adult content', section: 'options' });
    }

    if (filters.includeVideo) {
      active.push({ key: 'includeVideo', label: 'Include video', section: 'options' });
    }

    if (filters.randomize) {
      active.push({ key: 'randomize', label: 'Randomized', section: 'options' });
    }

    if (filters.discoverOnly) {
      active.push({ key: 'discoverOnly', label: 'Discover only', section: 'options' });
    }

    if (filters.includeNullFirstAirDates) {
      active.push({
        key: 'includeNullFirstAirDates',
        label: 'Unknown air dates',
        section: 'options',
      });
    }

    if (filters.screenedTheatrically) {
      active.push({
        key: 'screenedTheatrically',
        label: 'Screened theatrically',
        section: 'options',
      });
    }

    return active;
  }, [
    localCatalog,
    genres,
    sortOptions,
    languages,
    countries,
    tvStatuses,
    tvTypes,
    watchRegions,
    selectedPeople,
    selectedCompanies,
    selectedKeywords,
    excludeKeywords,
    excludeCompanies,
  ]);

  // Clear a specific filter
  const clearFilter = useCallback(
    (filterKey) => {
      switch (filterKey) {
        case 'sortBy':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, sortBy: 'popularity.desc' },
          }));
          break;
        case 'genres':
          setLocalCatalog((prev) => ({ ...prev, filters: { ...prev.filters, genres: [] } }));
          break;
        case 'excludeGenres':
          setLocalCatalog((prev) => ({ ...prev, filters: { ...prev.filters, excludeGenres: [] } }));
          break;
        case 'genreMatchMode':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, genreMatchMode: 'any' },
          }));
          break;
        case 'language':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, language: undefined },
          }));
          break;
        case 'originCountry':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, originCountry: undefined },
          }));
          break;
        case 'year':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, yearFrom: undefined, yearTo: undefined },
          }));
          break;
        case 'rating':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, ratingMin: 0, ratingMax: 10 },
          }));
          break;
        case 'runtime':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, runtimeMin: undefined, runtimeMax: undefined },
          }));
          break;
        case 'voteCountMin':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, voteCountMin: 0 },
          }));
          break;
        case 'datePreset':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, datePreset: undefined },
          }));
          setSelectedDatePreset(null);
          break;
        case 'releaseDate':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: {
              ...prev.filters,
              releaseDateFrom: undefined,
              releaseDateTo: undefined,
              airDateFrom: undefined,
              airDateTo: undefined,
            },
          }));
          break;
        case 'firstAirDate':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: {
              ...prev.filters,
              firstAirDateFrom: undefined,
              firstAirDateTo: undefined,
            },
          }));
          break;
        case 'firstAirDateYear':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, firstAirDateYear: undefined },
          }));
          break;
        case 'primaryReleaseYear':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, primaryReleaseYear: undefined },
          }));
          break;
        case 'region':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, region: undefined, releaseTypes: [] },
          }));
          break;
        case 'releaseTypes':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, releaseTypes: [] },
          }));
          break;
        case 'certifications':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, certifications: [] },
          }));
          break;
        case 'certificationRange':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: {
              ...prev.filters,
              certificationMin: undefined,
              certificationMax: undefined,
            },
          }));
          break;
        case 'certificationCountry':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, certificationCountry: undefined },
          }));
          break;
        case 'timezone':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, timezone: undefined },
          }));
          break;
        case 'tvStatus':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, tvStatus: undefined },
          }));
          break;
        case 'tvType':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, tvType: undefined },
          }));
          break;
        case 'watchRegion':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, watchRegion: undefined },
          }));
          break;
        case 'watchProviders':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, watchProviders: [] },
          }));
          break;
        case 'watchMonetizationTypes':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, watchMonetizationTypes: undefined },
          }));
          break;
        case 'withNetworks':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, withNetworks: undefined },
          }));
          break;
        case 'people':
          setSelectedPeople([]);
          break;
        case 'companies':
          setSelectedCompanies([]);
          break;
        case 'excludeCompanies':
          setExcludeCompanies([]);
          break;
        case 'keywords':
          setSelectedKeywords([]);
          break;
        case 'excludeKeywords':
          setExcludeKeywords([]);
          break;
        case 'includeAdult':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, includeAdult: undefined },
          }));
          break;
        case 'includeVideo':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, includeVideo: undefined },
          }));
          break;
        case 'randomize':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, randomize: undefined },
          }));
          break;
        case 'discoverOnly':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, discoverOnly: undefined },
          }));
          break;
        case 'includeNullFirstAirDates':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, includeNullFirstAirDates: undefined },
          }));
          break;
        case 'screenedTheatrically':
          setLocalCatalog((prev) => ({
            ...prev,
            filters: { ...prev.filters, screenedTheatrically: undefined },
          }));
          break;
        default:
          break;
      }
    },
    [
      setSelectedPeople,
      setSelectedCompanies,
      setSelectedKeywords,
      setExcludeKeywords,
      setExcludeCompanies,
    ]
  );

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setLocalCatalog((prev) => ({
      ...prev,
      filters: {
        ...DEFAULT_CATALOG.filters,
      },
    }));
    setSelectedPeople([]);
    setSelectedCompanies([]);
    setSelectedKeywords([]);
    setExcludeKeywords([]);
    setExcludeCompanies([]);
    setSelectedDatePreset(null);
  }, [
    setExcludeCompanies,
    setExcludeKeywords,
    setSelectedCompanies,
    setSelectedKeywords,
    setSelectedPeople,
  ]);



  // Early return if no catalog selected
  if (!catalog) {
    return (
      <div className="editor-panel">
        <div className="empty-state">
          <div className="empty-state-icon">
            <Sparkles size={48} />
          </div>
          <h3>Create Your First Catalog</h3>
          <p>Click "Add" in the sidebar to start building a custom catalog with TMDB filters</p>
        </div>
      </div>
    );
  }

  const catalogType = localCatalog?.type || 'movie';
  const isMovie = catalogType === 'movie';
  const currentGenres = genres[catalogType] || [];
  const selectedGenres = localCatalog?.filters?.genres || [];
  const excludedGenres = localCatalog?.filters?.excludeGenres || [];
  const currentCertifications = certifications[catalogType] || {};
  const certCountry = localCatalog?.filters?.certificationCountry || 'US';
  const certOptions = currentCertifications[certCountry] || [];

  // Check if current list type supports full discover filters
  // Only 'discover' (no listType or explicitly 'discover') supports all filters
  // Random is now a sort option, not a list type
  const currentListType = localCatalog?.filters?.listType || 'discover';
  const isPresetCatalog = currentListType && currentListType !== 'discover';
  const supportsFullFilters = !isPresetCatalog;

  // Get active filters for summary bar
  const activeFilters = getActiveFilters();

  // Count active filters per section for badges
  const getFilterCountForSection = (sectionKey) => {
    const sectionFilters = activeFilters.filter((f) => f.section === sectionKey);
    return sectionFilters.length;
  };

  return (
    <div className="editor-container">
      <div className="editor-panel">
        {/* Header */}
        <div className="editor-header">
          <div className="editor-title">
            {isMovie ? <Film size={22} /> : <Tv size={22} />}
            <input
              type="text"
              className="editor-name-input"
              placeholder="Catalog Name..."
              value={localCatalog?.name || ''}
              onChange={(e) => handleNameChange(e.target.value)}
            />
          </div>
          <div className="editor-actions">
            <button className="btn btn-secondary" onClick={loadPreview} disabled={previewLoading}>
              {previewLoading ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
              Preview
            </button>
            <button
              className="btn btn-secondary"
              title="Export Catalog Config"
              onClick={() => {
                const dataStr = JSON.stringify(localCatalog, null, 2);
                const blob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${(localCatalog.name || 'catalog').replace(/\s+/g, '_')}_config.json`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              }}
            >
              <ArrowDownTrayIcon size={16} />
            </button>
            <label
              className="btn btn-secondary"
              title="Import Catalog Config"
              style={{ cursor: 'pointer' }}
            >
              <ArrowUpTrayIcon size={16} />
              <input
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    try {
                      const imported = JSON.parse(event.target.result);
                      if (imported && typeof imported === 'object') {
                        // Preserve ID/Name if desired, or overwrite?
                        // User likely wants to import settings but maybe keep name if editing current?
                        // "Import the whole exact config" -> overwrite everything including name/filters
                        // But keeping _id is safer if editing existing.
                        // Let's safe-guard _id.
                        const { _id, ...rest } = imported;
                        setLocalCatalog((prev) => ({ ...prev, ...rest }));
                      } else {
                        alert('Invalid JSON file');
                      }
                    } catch (err) {
                      console.error('Import failed', err);
                      alert('Failed to parse JSON');
                    }
                    e.target.value = ''; // reset
                  };
                  reader.readAsText(file);
                }}
              />
            </label>
          </div>
        </div>

        <div className="editor-content">
          {/* Content Type Toggle */}
          <div className="content-type-toggle">
            <button
              className={`type-btn ${isMovie ? 'active' : ''}`}
              onClick={() => handleTypeChange('movie')}
              disabled={!supportsFullFilters}
              style={!supportsFullFilters ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              <Film size={18} />
              Movies
            </button>
            <button
              className={`type-btn ${!isMovie ? 'active' : ''}`}
              onClick={() => handleTypeChange('series')}
              disabled={!supportsFullFilters}
              style={!supportsFullFilters ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              <Tv size={18} />
              TV Shows
            </button>
          </div>

          {/* Active Filters Summary */}
          {activeFilters.length > 0 && (
            <div className="active-filters-bar">
              <div className="active-filters-chips">
                {activeFilters.map((filter) => (
                  <div
                    key={filter.key}
                    className="active-filter-chip"
                    onClick={() => toggleSection(filter.section)}
                  >
                    <span>{filter.label}</span>
                    <button
                      className="chip-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearFilter(filter.key);
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <button className="clear-all-btn" onClick={clearAllFilters}>
                Clear All
              </button>
            </div>
          )}

          {/* Core Filters Section - Only show for Custom Discover */}
          {!isPresetCatalog && (
            <div className="filter-section">
              <button className="filter-section-header" onClick={() => toggleSection('filters')}>
                <Settings size={18} />
                <div className="filter-section-title-group">
                  <h4 className="filter-section-title">Sort & Filter</h4>
                  <span className="filter-section-desc">Sorting, language, year, rating</span>
                </div>
                {getFilterCountForSection('filters') > 0 && (
                  <span className="filter-count-badge">{getFilterCountForSection('filters')}</span>
                )}
                {expandedSections.filters ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {expandedSections.filters && (
                <div className="filter-section-content">
                  {/* Sort, Language, Country */}
                  {supportsFullFilters && (
                    <>
                      <div className="filter-grid">
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Sort By"
                            tooltip="How to order your results. Popular shows what's trending now, while rating shows critically acclaimed content."
                          />
                          <SearchableSelect
                            options={sortOptions[localCatalog?.type] || sortOptions.movie || []}
                            value={localCatalog?.filters?.sortBy || 'popularity.desc'}
                            onChange={(value) => handleFiltersChange('sortBy', value)}
                            placeholder="Most Popular"
                            searchPlaceholder="Search..."
                            labelKey="label"
                            valueKey="value"
                            allowClear={false}
                          />
                        </div>

                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Original Language"
                            tooltip="Filter by the original language of the content (e.g., select 'Japanese' for anime, 'Korean' for K-dramas)."
                          />
                          <SearchableSelect
                            options={languages}
                            value={localCatalog?.filters?.language || ''}
                            onChange={(value) => handleFiltersChange('language', value)}
                            placeholder="Any"
                            searchPlaceholder="Search languages..."
                            labelKey="english_name"
                            valueKey="iso_639_1"
                          />
                        </div>

                        {/* Display Language REMOVED - Use Global Settings */}
                        {/* 
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Display Language"
                            tooltip="Localize titles and overviews (when available) to this language. Tip: set Display Language to English while keeping Original Language set to Japanese/Korean/etc."
                          />
                          <SearchableSelect
                            options={languages}
                            value={localCatalog?.filters?.displayLanguage || ''}
                            onChange={(value) => handleFiltersChange('displayLanguage', value)}
                            placeholder="Default"
                            searchPlaceholder="Search languages..."
                            labelKey="name"
                            valueKey="code"
                          />
                        </div>
                        */}

                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Country"
                            tooltip="Filter by country of origin. Useful for finding British shows, Bollywood movies, etc."
                          />
                          <SearchableSelect
                            options={countries}
                            value={localCatalog?.filters?.originCountry || ''}
                            onChange={(value) => handleFiltersChange('originCountry', value)}
                            placeholder="Any"
                            searchPlaceholder="Search countries..."
                            labelKey="english_name"
                            valueKey="iso_3166_1"
                          />
                        </div>
                      </div>

                      {/* Year Range Slider */}
                      <div style={{ marginTop: '24px' }}>
                        <RangeSlider
                          label="Year Range"
                          tooltip="Filter by release year or first air date. Great for finding classics or recent releases."
                          min={1900}
                          max={CURRENT_YEAR + 2}
                          step={1}
                          value={[
                            localCatalog?.filters?.yearFrom || 1900,
                            localCatalog?.filters?.yearTo || CURRENT_YEAR + 2,
                          ]}
                          onChange={handleYearRangeChange}
                          formatValue={(v) => v}
                          showInputs
                        />
                      </div>

                      {/* Rating Range Slider */}
                      <div style={{ marginTop: '20px' }}>
                        <RangeSlider
                          label="Rating"
                          tooltip="TMDB average user rating (0-10 scale). Higher ratings indicate better reviews."
                          min={0}
                          max={10}
                          step={0.1}
                          value={[
                            localCatalog?.filters?.ratingMin || 0,
                            localCatalog?.filters?.ratingMax || 10,
                          ]}
                          onChange={handleRatingRangeChange}
                          formatValue={(v) => v.toFixed(1)}
                          showInputs
                        />
                      </div>

                      {/* Runtime Range Slider */}
                      <div style={{ marginTop: '20px' }}>
                        <RangeSlider
                          label="Runtime (minutes)"
                          tooltip="Filter by total runtime. Perfect for finding quick watches or epic adventures."
                          min={0}
                          max={400}
                          step={1}
                          value={[
                            localCatalog?.filters?.runtimeMin || 0,
                            localCatalog?.filters?.runtimeMax || 400,
                          ]}
                          onChange={handleRuntimeRangeChange}
                          formatValue={(v) => (v === 0 ? 'Any' : v === 400 ? '400+' : `${v}m`)}
                          showInputs
                        />
                        <div
                          className="runtime-presets"
                          style={{
                            marginTop: '8px',
                            display: 'flex',
                            gap: '8px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <button
                            type="button"
                            className={`date-preset ${localCatalog?.filters?.runtimeMax === 60 && !localCatalog?.filters?.runtimeMin ? 'active' : ''}`}
                            onClick={() => handleRuntimeRangeChange([0, 60])}
                          >
                            Short (&lt;60m)
                          </button>
                          <button
                            type="button"
                            className={`date-preset ${localCatalog?.filters?.runtimeMin === 90 && localCatalog?.filters?.runtimeMax === 120 ? 'active' : ''}`}
                            onClick={() => handleRuntimeRangeChange([90, 120])}
                          >
                            Standard (90-120m)
                          </button>
                          <button
                            type="button"
                            className={`date-preset ${localCatalog?.filters?.runtimeMin === 150 && localCatalog?.filters?.runtimeMax === 400 ? 'active' : ''}`}
                            onClick={() => handleRuntimeRangeChange([150, 400])}
                          >
                            Long (&gt;150m)
                          </button>
                          <button
                            type="button"
                            className={`date-preset ${localCatalog?.filters?.runtimeMin === 180 ? 'active' : ''}`}
                            onClick={() => handleRuntimeRangeChange([180, 400])}
                          >
                            Epic (&gt;3h)
                          </button>
                          <button
                            type="button"
                            className="date-preset"
                            onClick={() => handleRuntimeRangeChange([0, 400])}
                          >
                            Any
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* For non-discover modes - no filters apply, show info message */}
                  {!supportsFullFilters && (
                    <div className="list-type-info">
                      <p className="filter-hint">
                        ℹ️ Pre-made lists like Trending, Popular, etc. don't support filters. They
                        show globally popular content as ranked by TMDB.
                      </p>
                      <p className="filter-hint" style={{ marginTop: '8px' }}>
                        💡 <strong>Want to filter by country, language, or genre?</strong> Use "🔍
                        Custom Discover" which gives you full control over all filters.
                      </p>
                    </div>
                  )}
                  {supportsFullFilters && (
                    <div style={{ marginTop: '20px' }}>
                      <SingleSlider
                        label="Minimum Votes"
                        tooltip="Requires this many user ratings. Higher values filter out obscure titles and ensure quality."
                        min={0}
                        max={10000}
                        step={1}
                        value={localCatalog?.filters?.voteCountMin ?? 0}
                        onChange={(v) => handleFiltersChange('voteCountMin', v)}
                        formatValue={(v) => v.toLocaleString()}
                        showInput
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {supportsFullFilters && (
            <div className="filter-section">
              <button className="filter-section-header" onClick={() => toggleSection('release')}>
                <Calendar size={18} />
                <div className="filter-section-title-group">
                  <h4 className="filter-section-title">
                    {isMovie ? 'Release' : 'Air Date'} & Classification
                  </h4>
                  <span className="filter-section-desc">
                    Date ranges, age ratings, release type
                  </span>
                </div>
                {getFilterCountForSection('release') > 0 && (
                  <span className="filter-count-badge">{getFilterCountForSection('release')}</span>
                )}
                {expandedSections.release ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {expandedSections.release && (
                <div className="filter-section-content">
                  {/* Date Presets */}
                  <div className="date-presets">
                    {DATE_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        className={`date-preset ${selectedDatePreset === preset.label ? 'active' : ''}`}
                        onClick={() => handleDatePreset(preset)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div className="filter-two-col">
                    <div className="filter-group">
                      <LabelWithTooltip
                        label={isMovie ? 'Release Date From' : 'Episode Air Date From'}
                        tooltip={
                          isMovie
                            ? 'Filter movies released on or after this date'
                            : 'Filter shows that had episodes airing on or after this date'
                        }
                      />
                      <input
                        type="date"
                        className="input"
                        value={
                          localCatalog?.filters?.[isMovie ? 'releaseDateFrom' : 'airDateFrom'] || ''
                        }
                        onChange={(e) => {
                          setSelectedDatePreset(null);
                          handleFiltersChange('datePreset', undefined); // Clear dynamic preset when manually editing
                          handleFiltersChange(
                            isMovie ? 'releaseDateFrom' : 'airDateFrom',
                            e.target.value
                          );
                        }}
                      />
                    </div>
                    <div className="filter-group">
                      <LabelWithTooltip
                        label={isMovie ? 'Release Date To' : 'Episode Air Date To'}
                        tooltip={
                          isMovie
                            ? 'Filter movies released on or before this date'
                            : 'Filter shows that had episodes airing on or before this date'
                        }
                      />
                      <input
                        type="date"
                        className="input"
                        value={
                          localCatalog?.filters?.[isMovie ? 'releaseDateTo' : 'airDateTo'] || ''
                        }
                        onChange={(e) => {
                          setSelectedDatePreset(null);
                          handleFiltersChange('datePreset', undefined); // Clear dynamic preset when manually editing
                          handleFiltersChange(
                            isMovie ? 'releaseDateTo' : 'airDateTo',
                            e.target.value
                          );
                        }}
                      />
                    </div>
                  </div>

                  {/* First Air Date for TV - when show premiered */}
                  {!isMovie && (
                    <div className="filter-two-col" style={{ marginTop: '16px' }}>
                      <div className="filter-group">
                        <LabelWithTooltip
                          label="Show Premiered From"
                          tooltip="Filter by when the TV show first aired. This is the date of the very first episode, not individual episode air dates."
                        />
                        <span className="filter-label-hint">
                          When show first aired (premiere date)
                        </span>
                        <input
                          type="date"
                          className="input"
                          value={localCatalog?.filters?.firstAirDateFrom || ''}
                          onChange={(e) => handleFiltersChange('firstAirDateFrom', e.target.value)}
                        />
                      </div>
                      <div className="filter-group">
                        <LabelWithTooltip
                          label="Show Premiered To"
                          tooltip="Latest premiere date to include. Shows that first aired before or on this date."
                        />
                        <input
                          type="date"
                          className="input"
                          value={localCatalog?.filters?.firstAirDateTo || ''}
                          onChange={(e) => handleFiltersChange('firstAirDateTo', e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {!isMovie && (
                    <div className="filter-two-col" style={{ marginTop: '16px' }}>
                      <div className="filter-group">
                        <LabelWithTooltip
                          label="First Air Year"
                          tooltip="Filter by the year the show first aired (TMDB first_air_date_year)."
                        />
                        <input
                          type="number"
                          className="input"
                          min="1900"
                          max={CURRENT_YEAR + 1}
                          placeholder="e.g. 2019"
                          value={localCatalog?.filters?.firstAirDateYear || ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            handleFiltersChange(
                              'firstAirDateYear',
                              value ? Number(value) : undefined
                            );
                          }}
                        />
                      </div>
                      <div className="filter-group">
                        <LabelWithTooltip
                          label="Timezone"
                          tooltip="Timezone for date calculations (e.g., America/New_York)."
                        />
                        <input
                          type="text"
                          className="input"
                          placeholder="e.g. America/New_York"
                          value={localCatalog?.filters?.timezone || ''}
                          onChange={(e) =>
                            handleFiltersChange(
                              'timezone',
                              e.target.value ? e.target.value.trim() : undefined
                            )
                          }
                        />
                      </div>
                    </div>
                  )}

                  {isMovie ? (
                    <>
                      <div className="filter-group" style={{ marginTop: '16px' }}>
                        <LabelWithTooltip
                          label="Release Region"
                          tooltip="Filter by when content was released in a specific country. Useful since movies often premiere at different times worldwide."
                        />
                        <span className="filter-label-hint">
                          Use regional release dates instead of worldwide premiere
                        </span>
                        <SearchableSelect
                          options={[
                            { iso_3166_1: '', english_name: 'Worldwide (default)' },
                            ...countries,
                          ]}
                          value={localCatalog?.filters?.region || ''}
                          onChange={(value) => {
                            handleFiltersChange('region', value);
                            if (!value) {
                              handleFiltersChange('releaseTypes', []);
                            }
                          }}
                          placeholder="Worldwide"
                          searchPlaceholder="Search countries..."
                          labelKey="english_name"
                          valueKey="iso_3166_1"
                        />
                      </div>
                      <div className="filter-two-col" style={{ marginTop: '16px' }}>
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Primary Release Year"
                            tooltip="Filter by the year of a movie's primary (worldwide) release."
                          />
                          <input
                            type="number"
                            className="input"
                            min="1900"
                            max={CURRENT_YEAR + 1}
                            placeholder="e.g. 2015"
                            value={localCatalog?.filters?.primaryReleaseYear || ''}
                            onChange={(e) => {
                              const value = e.target.value;
                              handleFiltersChange(
                                'primaryReleaseYear',
                                value ? Number(value) : undefined
                              );
                            }}
                          />
                        </div>
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Release Type"
                            tooltip="How the movie was released: Theatrical (cinemas), Digital (streaming/download), Physical (DVD/Blu-ray), TV broadcast, etc. Requires a region to be selected."
                          />
                          <MultiSelect
                            options={releaseTypes}
                            value={localCatalog?.filters?.releaseTypes || []}
                            onChange={(value) => handleFiltersChange('releaseTypes', value)}
                            placeholder={
                              !localCatalog?.filters?.region ? 'Select region first' : 'All types'
                            }
                            labelKey="label"
                            valueKey="value"
                            disabled={!localCatalog?.filters?.region}
                          />
                          {!localCatalog?.filters?.region && (
                            <span className="filter-label-hint warning">
                              Select a region above to filter by release type
                            </span>
                          )}
                        </div>
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Age Rating"
                            tooltip="Content certification/age rating (e.g., PG-13, R, TV-MA). Varies by country - US ratings shown by default."
                          />
                          <MultiSelect
                            options={certOptions.map((c) => ({
                              value: c.certification,
                              label: c.certification,
                            }))}
                            value={localCatalog?.filters?.certifications || []}
                            onChange={(value) => handleFiltersChange('certifications', value)}
                            placeholder="Any"
                            labelKey="label"
                            valueKey="value"
                          />
                          <span className="filter-label-hint">
                            Use this for exact certifications; use min/max below for ranges.
                          </span>
                        </div>
                      </div>
                      <div className="filter-group" style={{ marginTop: '16px' }}>
                        <LabelWithTooltip
                          label="Age Rating Country"
                          tooltip="Pick the country rating system to use for certifications."
                        />
                        <SearchableSelect
                          options={countries}
                          value={localCatalog?.filters?.certificationCountry || 'US'}
                          onChange={(value) => handleFiltersChange('certificationCountry', value)}
                          placeholder="Select country"
                          searchPlaceholder="Search countries..."
                          labelKey="english_name"
                          valueKey="iso_3166_1"
                        />
                        <span className="filter-label-hint">
                          TMDB uses country-specific rating systems
                        </span>
                      </div>
                      <div className="filter-two-col" style={{ marginTop: '16px' }}>
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Age Rating Min"
                            tooltip="Lower bound for certification. Uses the selected country rating system."
                          />
                          <SearchableSelect
                            options={[
                              { value: '', label: 'Any' },
                              ...certOptions.map((c) => ({
                                value: c.certification,
                                label: c.certification,
                              })),
                            ]}
                            value={localCatalog?.filters?.certificationMin || ''}
                            onChange={(value) =>
                              handleFiltersChange('certificationMin', value || undefined)
                            }
                            placeholder="Any"
                            searchPlaceholder="Search..."
                            labelKey="label"
                            valueKey="value"
                          />
                        </div>
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Age Rating Max"
                            tooltip="Upper bound for certification. Uses the selected country rating system."
                          />
                          <SearchableSelect
                            options={[
                              { value: '', label: 'Any' },
                              ...certOptions.map((c) => ({
                                value: c.certification,
                                label: c.certification,
                              })),
                            ]}
                            value={localCatalog?.filters?.certificationMax || ''}
                            onChange={(value) =>
                              handleFiltersChange('certificationMax', value || undefined)
                            }
                            placeholder="Any"
                            searchPlaceholder="Search..."
                            labelKey="label"
                            valueKey="value"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="filter-two-col" style={{ marginTop: '16px' }}>
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Show Status"
                            tooltip="Whether the TV show is currently Returning Series, Ended, Canceled, In Production, or Pilot status."
                          />
                          <SearchableSelect
                            options={[{ value: '', label: 'Any' }, ...tvStatuses]}
                            value={localCatalog?.filters?.tvStatus || ''}
                            onChange={(value) => handleFiltersChange('tvStatus', value)}
                            placeholder="Any"
                            searchPlaceholder="Search..."
                            labelKey="label"
                            valueKey="value"
                          />
                        </div>
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Show Type"
                            tooltip="Format of TV show: Scripted (regular series), Reality, Documentary, Talk Show, News, Miniseries, etc."
                          />
                          <SearchableSelect
                            options={[{ value: '', label: 'Any' }, ...tvTypes]}
                            value={localCatalog?.filters?.tvType || ''}
                            onChange={(value) => handleFiltersChange('tvType', value)}
                            placeholder="Any"
                            searchPlaceholder="Search..."
                            labelKey="label"
                            valueKey="value"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {supportsFullFilters && (
            <FilterSection
              id="streaming"
              title="Where to Watch"
              description="Filter by streaming services and original networks"
              icon={Play}
              isOpen={expandedSections.streaming}
              onToggle={toggleSection}
              badgeCount={getFilterCountForSection('streaming')}
            >
              <StreamFilters
                type={localCatalog?.type}
                tvNetworks={tvNetworkOptions}
                selectedNetworks={selectedNetworks}
                watchRegions={watchRegions}
                watchProviders={watchProviders}
                monetizationTypes={monetizationTypes}
                onNetworkSearch={handleTVNetworkSearch}
                filters={localCatalog?.filters || {}}
                onFiltersChange={handleFiltersChange}
              />
            </FilterSection>
          )}

          {supportsFullFilters && (
            <FilterSection
              id="genres"
              title="Genres"
              description={
                activeFilters.find((f) => f.section === 'genres')?.label ||
                'Select genres to include/exclude'
              }
              icon={Sparkles}
              isOpen={expandedSections.genres}
              onToggle={toggleSection}
              badgeCount={getFilterCountForSection('genres')}
            >
              <GenreSelector
                genres={currentGenres}
                selectedGenres={selectedGenres}
                excludedGenres={excludedGenres}
                genreMatchMode={localCatalog?.filters?.genreMatchMode || 'any'}
                onInclude={(id) => handleTriStateGenreClick(id)}
                onExclude={(id) => handleTriStateGenreClick(id)}
                onClear={(id) => handleTriStateGenreClick(id)}
                onSetMatchMode={(mode) => handleFiltersChange('genreMatchMode', mode)}
                loading={genresLoading}
                onRefresh={refreshGenres}
              />
            </FilterSection>
          )}
          {supportsFullFilters && (
            <FilterSection
              id="people"
              title={isMovie ? 'People & Studios' : 'Studios & Keywords'}
              description={
                isMovie
                  ? 'Filter by cast, crew, or production company'
                  : 'Filter by production companies and keywords'
              }
              icon={Users}
              isOpen={expandedSections.people}
              onToggle={toggleSection}
              badgeCount={getFilterCountForSection('people')}
            >
              <PeopleFilters
                selectedPeople={selectedPeople}
                onSelectPeople={setSelectedPeople}
                selectedCompanies={selectedCompanies}
                onSelectCompanies={setSelectedCompanies}
                selectedKeywords={selectedKeywords}
                onSelectKeywords={setSelectedKeywords}
                excludeKeywords={excludeKeywords}
                onExcludeKeywords={setExcludeKeywords}
                excludeCompanies={excludeCompanies}
                onExcludeCompanies={setExcludeCompanies}
                searchPerson={searchPerson}
                searchCompany={searchCompany}
                searchKeyword={searchKeyword}
                showPeople={isMovie}
              />
            </FilterSection>
          )}

          {supportsFullFilters ? (
            /* Options Section */
            <div className="filter-section">
              <button className="filter-section-header" onClick={() => toggleSection('options')}>
                <Settings size={18} />
                <div className="filter-section-title-group">
                  <h4 className="filter-section-title">Options</h4>
                  <span className="filter-section-desc">
                    Include adult, video, randomize, or discover-only results
                  </span>
                </div>
                {expandedSections.options ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {expandedSections.options && (
                <div className="filter-section-content">
                  <div className="checkbox-grid">
                    <label
                      className="checkbox-label-row"
                      onClick={() =>
                        handleFiltersChange('includeAdult', !localCatalog?.filters?.includeAdult)
                      }
                      style={{ cursor: 'pointer' }}
                    >
                      <div
                        className={`checkbox ${localCatalog?.filters?.includeAdult ? 'checked' : ''}`}
                      >
                        {localCatalog?.filters?.includeAdult && <Check size={14} />}
                      </div>
                      <LabelWithTooltip
                        label="Include adult content"
                        tooltip="Include adult/18+ rated content in results. Disabled by default."
                      />
                    </label>

                    {isMovie && (
                      <label
                        className="checkbox-label-row"
                        onClick={() =>
                          handleFiltersChange('includeVideo', !localCatalog?.filters?.includeVideo)
                        }
                        style={{ cursor: 'pointer' }}
                      >
                        <div
                          className={`checkbox ${
                            localCatalog?.filters?.includeVideo ? 'checked' : ''
                          }`}
                        >
                          {localCatalog?.filters?.includeVideo && <Check size={14} />}
                        </div>
                        <LabelWithTooltip
                          label="Include video content"
                          tooltip="Include titles marked as video content in TMDB."
                        />
                      </label>
                    )}

                    <label
                      className="checkbox-label-row"
                      onClick={() =>
                        handleFiltersChange('randomize', !localCatalog?.filters?.randomize)
                      }
                      style={{ cursor: 'pointer' }}
                    >
                      <div
                        className={`checkbox ${localCatalog?.filters?.randomize ? 'checked' : ''}`}
                      >
                        {localCatalog?.filters?.randomize && <Check size={14} />}
                      </div>
                      <LabelWithTooltip
                        label="Randomize Results"
                        tooltip="Fetch a random page from the matching results and shuffle them. Great for discovering something new every time."
                      />
                    </label>

                    <label
                      className="checkbox-label-row"
                      onClick={() =>
                        handleFiltersChange('discoverOnly', !localCatalog?.filters?.discoverOnly)
                      }
                      style={{ cursor: 'pointer' }}
                    >
                      <div
                        className={`checkbox ${localCatalog?.filters?.discoverOnly ? 'checked' : ''}`}
                      >
                        {localCatalog?.filters?.discoverOnly && <Check size={14} />}
                      </div>
                      <LabelWithTooltip
                        label="Discover Only"
                        tooltip="Hide this catalog from the Board (Home). It will only appear in the Discover tab."
                      />
                    </label>

                    {!isMovie && (
                      <label
                        className="checkbox-label-row"
                        onClick={() =>
                          handleFiltersChange(
                            'includeNullFirstAirDates',
                            !localCatalog?.filters?.includeNullFirstAirDates
                          )
                        }
                        style={{ cursor: 'pointer' }}
                      >
                        <div
                          className={`checkbox ${
                            localCatalog?.filters?.includeNullFirstAirDates ? 'checked' : ''
                          }`}
                        >
                          {localCatalog?.filters?.includeNullFirstAirDates && <Check size={14} />}
                        </div>
                        <LabelWithTooltip
                          label="Include unknown air dates"
                          tooltip="Include shows with no recorded first air date."
                        />
                      </label>
                    )}

                    {!isMovie && (
                      <label
                        className="checkbox-label-row"
                        onClick={() =>
                          handleFiltersChange(
                            'screenedTheatrically',
                            !localCatalog?.filters?.screenedTheatrically
                          )
                        }
                        style={{ cursor: 'pointer' }}
                      >
                        <div
                          className={`checkbox ${
                            localCatalog?.filters?.screenedTheatrically ? 'checked' : ''
                          }`}
                        >
                          {localCatalog?.filters?.screenedTheatrically && <Check size={14} />}
                        </div>
                        <LabelWithTooltip
                          label="Screened theatrically"
                          tooltip="Include shows that were screened in theaters."
                        />
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              className="flex items-center gap-3 p-4 mt-6 rounded-lg border border-white/5 bg-white/5"
              style={{ justifyContent: 'center' }}
            >
              <Sparkles size={16} className="text-indigo-400" />
              <span className="text-gray-300 text-sm font-medium">
                This is a curated preset from TMDB and cannot be modified.
              </span>
            </div>
          )}

          {/* Mobile Preview Button - at end of filters for easy access */}
          <div className="mobile-preview-btn-container">
            <button
              className="btn btn-secondary mobile-preview-btn"
              onClick={loadPreview}
              disabled={previewLoading}
            >
              {previewLoading ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
              Preview
            </button>
          </div>
        </div>
      </div>

      {/* Preview Panel - Separate Box */}
      <CatalogPreview
        loading={previewLoading}
        error={previewError}
        data={previewData}
        onRetry={loadPreview}
        onLoadPreview={loadPreview}
      />
    </div>
  );
}
