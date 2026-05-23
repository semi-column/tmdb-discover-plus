import { useMemo, useState, useCallback, useEffect } from 'react';
import {
  Sparkles,
  Star,
  Shield,
  Settings,
  Key,
  Loader,
  AlertCircle,
  Tv,
  Layers,
} from 'lucide-react';
import { FilterSection } from '../../FilterSection';
import { SearchableSelect } from '../../../../forms/SearchableSelect';
import { MultiSelect } from '../../../../forms/MultiSelect';
import { RUNTIME_MAX_MINUTES } from '../../../../../constants/filterLimits';
import { LabelWithTooltip } from '../../../../forms/Tooltip';
import { StremioExtras } from '../../StremioExtras';
import { AnimeFormatSelector } from '../../shared/AnimeFormatSelector';
import { RangeSlider } from '../../../../forms/RangeSlider';
import { Checkbox } from '../../../../forms/Checkbox';
import { GenreSelector } from '../../GenreSelector';
import { api } from '../../../../../services/api';
import {
  getAvailableBrowseTypes,
  getBrowseTypeForListType,
  getDefaultListTypeForBrowseType,
  getTraktExternalRatingFilterSupport,
  getListTypeOptionsForBrowseType,
  normalizeTraktListType,
  supportsTraktAdvancedFilters,
  supportsTraktCalendarSettings,
  supportsTraktCoreRatingVoteFilters,
  supportsTraktDirectExternalRatingFilters,
  supportsTraktPeriod,
} from '../../../../../sources/traktCapabilities';

const CURRENT_YEAR = new Date().getFullYear();
const RECENTLY_AIRED_DAY_PRESETS = [
  { value: '30', label: '1 Month' },
  { value: '90', label: '3 Months' },
  { value: '180', label: '6 Months' },
  { value: '365', label: '12 Months' },
  { value: '1095', label: '3 Years' },
  { value: '1825', label: '5 Years' },
  { value: '3650', label: '10 Years' },
];
const CALENDAR_SORT_OPTIONS = [
  { value: 'desc', label: 'Descending (Newest → Oldest)' },
  { value: 'asc', label: 'Ascending (Oldest → Newest)' },
];

function getDaysUntilEndOfYearUtc() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const endOfYear = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
  return Math.max(
    Math.floor((endOfYear.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)) + 1,
    1
  );
}

function isCalendarTypeCompatible(calendarType, isMovie) {
  if (isMovie) {
    return ['movies', 'dvd', 'streaming'].includes(calendarType);
  }
  return ['shows', 'shows_new', 'shows_premieres', 'shows_finales'].includes(calendarType);
}

export function TraktFilterPanel({
  localCatalog,
  onFiltersChange,
  expandedSections,
  onToggleSection,
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
  originalLanguages = [],
  countries = [],
}) {
  const filters = localCatalog?.filters || {};
  const hasExplicitListType = filters.traktListType != null && filters.traktListType !== '';
  const listType = normalizeTraktListType(filters.traktListType);
  const catalogType = localCatalog?.type || 'movie';
  const isMovie = catalogType === 'movie';

  // ─── Key State Machine ───────────────────────────────────
  const [keyState, setKeyState] = useState(traktHasKey ? 'ready' : 'checking');
  const [traktKey, setTraktKey] = useState('');
  const [keyValidating, setKeyValidating] = useState(false);
  const [keyError, setKeyError] = useState(null);
  const [showUpdateKey, setShowUpdateKey] = useState(false);

  useEffect(() => {
    if (traktHasKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- short-circuit when parent already confirmed key is present
      setKeyState('ready');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await api.getSourceKeys();
        if (cancelled) return;
        setKeyState(result?.trakt ? 'ready' : 'needs_key');
      } catch {
        if (!cancelled) setKeyState('needs_key');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [traktHasKey]);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- React Compiler cannot preserve memoization across the surrounding state-machine; manual useCallback is intentional
  const handleSaveKey = useCallback(async () => {
    if (!traktKey.trim()) return;
    setKeyValidating(true);
    setKeyError(null);
    try {
      const validation = await api.validateTraktKey(traktKey.trim());
      if (!validation.valid) {
        setKeyError(validation.error || 'Invalid Trakt Client ID');
        return;
      }
      await api.saveSourceKey('trakt', traktKey.trim());
      setKeyState('ready');
      setShowUpdateKey(false);
      setTraktKey('');
    } catch (err) {
      setKeyError(err.message || 'Failed to save Trakt Client ID');
    } finally {
      setKeyValidating(false);
    }
  }, [traktKey]);

  const includeMovieOnlyOptions = isMovie || listType === 'boxoffice';
  const browseType = getBrowseTypeForListType(listType);
  const browseTypeOptions = useMemo(
    () =>
      getAvailableBrowseTypes({
        listTypes: traktListTypes,
        communityMetrics: traktCommunityMetrics,
        isMovie: includeMovieOnlyOptions,
      }),
    [traktListTypes, traktCommunityMetrics, includeMovieOnlyOptions]
  );

  const activeBrowseType = browseTypeOptions.some((option) => option.value === browseType)
    ? browseType
    : browseTypeOptions[0]?.value || 'discover';

  const listTypeOptions = useMemo(
    () =>
      getListTypeOptionsForBrowseType({
        browseType: activeBrowseType,
        listTypes: traktListTypes,
        communityMetrics: traktCommunityMetrics,
        isMovie: includeMovieOnlyOptions,
      }),
    [activeBrowseType, traktListTypes, traktCommunityMetrics, includeMovieOnlyOptions]
  );

  const activeListType = listTypeOptions.some((option) => option.value === listType)
    ? listType
    : listTypeOptions[0]?.value || 'calendar';

  const showPeriod = supportsTraktPeriod(activeListType);
  const showCalendarControls = supportsTraktCalendarSettings(activeListType);
  const showAdvancedFilters = supportsTraktAdvancedFilters(activeListType);
  const showYearRange = showAdvancedFilters && activeBrowseType === 'discover';
  const showCoreRatingVoteFilters = supportsTraktCoreRatingVoteFilters(activeListType);
  const externalRatingSupport = useMemo(
    () => getTraktExternalRatingFilterSupport(activeListType, catalogType),
    [activeListType, catalogType]
  );
  const showDirectExternalRatingFilters = supportsTraktDirectExternalRatingFilters(
    activeListType,
    catalogType
  );
  const defaultCalendarSort = 'desc';
  const activeCalendarSort = filters.traktCalendarSort || defaultCalendarSort;
  const upcomingDayPresets = useMemo(() => {
    const daysToYearEnd = getDaysUntilEndOfYearUtc();
    return [
      { value: '7', label: 'Next Week Releases' },
      { value: '30', label: 'Next Month' },
      { value: String(daysToYearEnd), label: 'This Year' },
    ];
  }, []);
  const calendarDayPresetOptions =
    activeListType === 'calendar' ? upcomingDayPresets : RECENTLY_AIRED_DAY_PRESETS;
  const defaultCalendarDays = Number(calendarDayPresetOptions[0]?.value || 30);
  const compatibleCalendarTypes = useMemo(
    () => traktCalendarTypes.filter((item) => isCalendarTypeCompatible(item.value, isMovie)),
    [traktCalendarTypes, isMovie]
  );
  const fallbackCalendarType = compatibleCalendarTypes[0]?.value || (isMovie ? 'movies' : 'shows');
  const activeCalendarType = compatibleCalendarTypes.some(
    (item) => item.value === filters.traktCalendarType
  )
    ? filters.traktCalendarType
    : fallbackCalendarType;
  const calendarOptionItems = useMemo(() => {
    const modeOptions = listTypeOptions.filter((item) => supportsTraktCalendarSettings(item.value));
    return modeOptions.flatMap((mode) =>
      compatibleCalendarTypes.map((calType) => ({
        value: `${mode.value}::${calType.value}`,
        label: `${mode.label} • ${calType.label}`,
      }))
    );
  }, [listTypeOptions, compatibleCalendarTypes]);
  const activeCalendarOptionValue = `${activeListType}::${activeCalendarType}`;
  const optionDropdownOptions =
    activeBrowseType === 'calendar' ? calendarOptionItems : listTypeOptions;
  const activeOptionValue = optionDropdownOptions.some(
    (option) => option.value === activeCalendarOptionValue || option.value === activeListType
  )
    ? activeBrowseType === 'calendar'
      ? activeCalendarOptionValue
      : activeListType
    : optionDropdownOptions[0]?.value || activeListType;
  const selectedBrowseTypeValue = hasExplicitListType ? activeBrowseType : '';
  const selectedOptionValue = hasExplicitListType ? activeOptionValue : '';

  const clearListTypeSelection = useCallback(() => {
    onFiltersChange('traktListType', undefined);
    onFiltersChange('traktCalendarType', undefined);
    onFiltersChange('traktCalendarDays', undefined);
    onFiltersChange('traktCalendarStartDate', undefined);
    onFiltersChange('traktCalendarEndDate', undefined);
    onFiltersChange('traktCalendarSort', undefined);
    onFiltersChange('traktPeriod', undefined);
  }, [onFiltersChange]);

  const applyListTypeSelection = useCallback(
    (nextListType) => {
      onFiltersChange('traktListType', nextListType || undefined);

      if (!nextListType || !supportsTraktCalendarSettings(nextListType)) {
        onFiltersChange('traktCalendarType', undefined);
        onFiltersChange('traktCalendarDays', undefined);
        onFiltersChange('traktCalendarStartDate', undefined);
        onFiltersChange('traktCalendarEndDate', undefined);
        onFiltersChange('traktCalendarSort', undefined);
      }

      if (!nextListType || !supportsTraktPeriod(nextListType)) {
        onFiltersChange('traktPeriod', undefined);
      }
    },
    [onFiltersChange]
  );

  const handleBrowseTypeChange = useCallback(
    (nextBrowseType) => {
      if (!nextBrowseType) {
        clearListTypeSelection();
        return;
      }

      const defaultListType = getDefaultListTypeForBrowseType({
        browseType: nextBrowseType,
        listTypes: traktListTypes,
        communityMetrics: traktCommunityMetrics,
        isMovie: includeMovieOnlyOptions,
      });

      if (nextBrowseType === 'calendar') {
        onFiltersChange('traktCalendarType', fallbackCalendarType);
        onFiltersChange('traktCalendarDays', filters.traktCalendarDays || 30);
      }

      applyListTypeSelection(defaultListType);
    },
    [
      applyListTypeSelection,
      clearListTypeSelection,
      traktListTypes,
      traktCommunityMetrics,
      includeMovieOnlyOptions,
      onFiltersChange,
      fallbackCalendarType,
      filters.traktCalendarDays,
    ]
  );

  const handleOptionChange = useCallback(
    (nextValue) => {
      if (!nextValue) {
        clearListTypeSelection();
        return;
      }

      if (activeBrowseType === 'calendar') {
        const [nextListType, nextCalendarType] = String(nextValue).split('::');
        if (!nextListType) {
          clearListTypeSelection();
          return;
        }

        applyListTypeSelection(nextListType);
        onFiltersChange('traktCalendarType', nextCalendarType || fallbackCalendarType);
        onFiltersChange('traktCalendarDays', filters.traktCalendarDays || 30);
        return;
      }

      applyListTypeSelection(nextValue);
    },
    [
      activeBrowseType,
      applyListTypeSelection,
      clearListTypeSelection,
      onFiltersChange,
      fallbackCalendarType,
      filters.traktCalendarDays,
    ]
  );

  const typedTraktGenres = useMemo(() => {
    if (Array.isArray(traktGenres)) return traktGenres;
    if (traktGenres && typeof traktGenres === 'object') {
      const key = isMovie ? 'movie' : 'series';
      const scoped = traktGenres[key];
      return Array.isArray(scoped) ? scoped : [];
    }
    return [];
  }, [traktGenres, isMovie]);

  const traktGenreObjects = useMemo(
    () => typedTraktGenres.map((g) => ({ id: g.slug, name: g.name })),
    [typedTraktGenres]
  );

  const certifications = isMovie ? traktCertificationsMovie : traktCertificationsSeries;
  const selectedGenres = useMemo(() => filters.traktGenres || [], [filters.traktGenres]);
  const excludedGenres = useMemo(
    () => filters.traktExcludeGenres || [],
    [filters.traktExcludeGenres]
  );

  const typedGenreSlugSet = useMemo(
    () => new Set(typedTraktGenres.map((genre) => genre.slug)),
    [typedTraktGenres]
  );

  useEffect(() => {
    if (typedGenreSlugSet.size === 0) return;

    const cleanedSelected = selectedGenres.filter((slug) => typedGenreSlugSet.has(slug));
    const cleanedExcluded = excludedGenres.filter((slug) => typedGenreSlugSet.has(slug));

    if (cleanedSelected.length !== selectedGenres.length) {
      onFiltersChange('traktGenres', cleanedSelected.length > 0 ? cleanedSelected : undefined);
    }

    if (cleanedExcluded.length !== excludedGenres.length) {
      onFiltersChange(
        'traktExcludeGenres',
        cleanedExcluded.length > 0 ? cleanedExcluded : undefined
      );
    }
  }, [typedGenreSlugSet, selectedGenres, excludedGenres, onFiltersChange]);

  useEffect(() => {
    if (!externalRatingSupport.imdbRatings) {
      if (filters.traktImdbRatingMin != null || filters.traktImdbRatingMax != null) {
        onFiltersChange('traktImdbRatingMin', undefined);
        onFiltersChange('traktImdbRatingMax', undefined);
      }
    }

    if (!externalRatingSupport.tmdbRatings) {
      if (filters.traktTmdbRatingMin != null || filters.traktTmdbRatingMax != null) {
        onFiltersChange('traktTmdbRatingMin', undefined);
        onFiltersChange('traktTmdbRatingMax', undefined);
      }
    }

    if (!externalRatingSupport.rtMeters) {
      if (filters.traktRtMeterMin != null || filters.traktRtMeterMax != null) {
        onFiltersChange('traktRtMeterMin', undefined);
        onFiltersChange('traktRtMeterMax', undefined);
      }
    }

    if (!externalRatingSupport.rtUserMeters) {
      if (filters.traktRtUserMeterMin != null || filters.traktRtUserMeterMax != null) {
        onFiltersChange('traktRtUserMeterMin', undefined);
        onFiltersChange('traktRtUserMeterMax', undefined);
      }
    }

    if (!externalRatingSupport.metascores) {
      if (filters.traktMetascoreMin != null || filters.traktMetascoreMax != null) {
        onFiltersChange('traktMetascoreMin', undefined);
        onFiltersChange('traktMetascoreMax', undefined);
      }
    }

    if (!externalRatingSupport.imdbVotes) {
      if (filters.traktImdbVotesMin != null || filters.traktImdbVotesMax != null) {
        onFiltersChange('traktImdbVotesMin', undefined);
        onFiltersChange('traktImdbVotesMax', undefined);
      }
    }

    if (!externalRatingSupport.tmdbVotes) {
      if (filters.traktTmdbVotesMin != null || filters.traktTmdbVotesMax != null) {
        onFiltersChange('traktTmdbVotesMin', undefined);
        onFiltersChange('traktTmdbVotesMax', undefined);
      }
    }
  }, [
    externalRatingSupport.imdbRatings,
    externalRatingSupport.tmdbRatings,
    externalRatingSupport.rtMeters,
    externalRatingSupport.rtUserMeters,
    externalRatingSupport.metascores,
    externalRatingSupport.imdbVotes,
    externalRatingSupport.tmdbVotes,
    filters.traktImdbRatingMin,
    filters.traktImdbRatingMax,
    filters.traktTmdbRatingMin,
    filters.traktTmdbRatingMax,
    filters.traktRtMeterMin,
    filters.traktRtMeterMax,
    filters.traktRtUserMeterMin,
    filters.traktRtUserMeterMax,
    filters.traktMetascoreMin,
    filters.traktMetascoreMax,
    filters.traktImdbVotesMin,
    filters.traktImdbVotesMax,
    filters.traktTmdbVotesMin,
    filters.traktTmdbVotesMax,
    onFiltersChange,
  ]);

  useEffect(() => {
    if (filters.traktCalendarStartDate || filters.traktCalendarEndDate) {
      onFiltersChange('traktCalendarStartDate', undefined);
      onFiltersChange('traktCalendarEndDate', undefined);
    }
  }, [filters.traktCalendarStartDate, filters.traktCalendarEndDate, onFiltersChange]);

  useEffect(() => {
    if (activeBrowseType === 'discover') return;

    if (filters.traktYearMin != null || filters.traktYearMax != null) {
      onFiltersChange('traktYearMin', undefined);
      onFiltersChange('traktYearMax', undefined);
    }
  }, [activeBrowseType, filters.traktYearMin, filters.traktYearMax, onFiltersChange]);

  useEffect(() => {
    if (!isMovie) return;

    if (filters.traktAiredEpisodesMin != null || filters.traktAiredEpisodesMax != null) {
      onFiltersChange('traktAiredEpisodesMin', undefined);
      onFiltersChange('traktAiredEpisodesMax', undefined);
    }

    if (filters.traktExcludeSingleSeason) {
      onFiltersChange('traktExcludeSingleSeason', undefined);
    }
  }, [
    isMovie,
    filters.traktAiredEpisodesMin,
    filters.traktAiredEpisodesMax,
    filters.traktExcludeSingleSeason,
    onFiltersChange,
  ]);

  useEffect(() => {
    if (!showCalendarControls) return;

    const selectedDays = Number(filters.traktCalendarDays || defaultCalendarDays);
    const allowed = new Set(calendarDayPresetOptions.map((preset) => Number(preset.value)));
    if (!allowed.has(selectedDays)) {
      onFiltersChange('traktCalendarDays', defaultCalendarDays);
    }
  }, [
    showCalendarControls,
    filters.traktCalendarDays,
    defaultCalendarDays,
    calendarDayPresetOptions,
    onFiltersChange,
  ]);

  // ─── Country / Language Adder ────────────────────────────
  const safeLanguages = useMemo(
    () => (Array.isArray(originalLanguages) ? originalLanguages : []),
    [originalLanguages]
  );
  const safeCountries = useMemo(() => (Array.isArray(countries) ? countries : []), [countries]);

  const availableLanguages = useMemo(
    () => safeLanguages.filter((l) => !(filters.traktLanguages || []).includes(l.iso_639_1)),
    [safeLanguages, filters.traktLanguages]
  );

  const availableCountries = useMemo(
    () => safeCountries.filter((c) => !(filters.traktCountries || []).includes(c.iso_3166_1)),
    [safeCountries, filters.traktCountries]
  );

  const handleAddLanguage = useCallback(
    (value) => {
      if (!value) return;
      const current = filters.traktLanguages || [];
      if (!current.includes(value)) {
        onFiltersChange('traktLanguages', [...current, value]);
      }
    },
    [filters.traktLanguages, onFiltersChange]
  );

  const handleRemoveLanguage = useCallback(
    (value) => {
      const updated = (filters.traktLanguages || []).filter((v) => v !== value);
      onFiltersChange('traktLanguages', updated.length > 0 ? updated : undefined);
    },
    [filters.traktLanguages, onFiltersChange]
  );

  const handleAddCountry = useCallback(
    (value) => {
      if (!value) return;
      const current = filters.traktCountries || [];
      if (!current.includes(value)) {
        onFiltersChange('traktCountries', [...current, value]);
      }
    },
    [filters.traktCountries, onFiltersChange]
  );

  const handleRemoveCountry = useCallback(
    (value) => {
      const updated = (filters.traktCountries || []).filter((v) => v !== value);
      onFiltersChange('traktCountries', updated.length > 0 ? updated : undefined);
    },
    [filters.traktCountries, onFiltersChange]
  );

  // ─── Network Filter (shows only) ────────────────────────
  const [localNetworks, setLocalNetworks] = useState(
    Array.isArray(traktNetworks) ? traktNetworks : []
  );
  const [networksLoading, setNetworksLoading] = useState(false);
  const [networksError, setNetworksError] = useState(null);

  const fetchNetworks = useCallback(async () => {
    setNetworksLoading(true);
    setNetworksError(null);
    try {
      const result = await api.getTraktNetworks();
      if (Array.isArray(result?.networks)) {
        setLocalNetworks(result.networks);
      }
    } catch (err) {
      setNetworksError(err.message || 'Failed to load networks');
    } finally {
      setNetworksLoading(false);
    }
  }, []);

  // Sync from prop if it arrives with data (e.g. after parent refresh)
  useEffect(() => {
    if (Array.isArray(traktNetworks) && traktNetworks.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop→state mirror for late-arriving networks
      setLocalNetworks(traktNetworks);
    }
  }, [traktNetworks]);

  // Auto-fetch on mount if prop is empty
  useEffect(() => {
    if (!Array.isArray(traktNetworks) || traktNetworks.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only fetch; fetchNetworks owns its own setState
      fetchNetworks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only fetch
  }, []);

  const safeNetworks = localNetworks;

  const [networkCountryFilter, setNetworkCountryFilter] = useState('');

  const networkCountryOptions = useMemo(() => {
    const seen = new Set();
    const opts = [];
    safeNetworks.forEach((n) => {
      if (n.country && !seen.has(n.country)) {
        seen.add(n.country);
        const countryObj = safeCountries.find(
          (c) => c.iso_3166_1.toLowerCase() === n.country.toLowerCase()
        );
        opts.push({
          value: n.country,
          label: countryObj ? countryObj.english_name : n.country.toUpperCase(),
        });
      }
    });
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [safeNetworks, safeCountries]);

  const filteredNetworkOptions = useMemo(() => {
    const selectedIds = new Set(filters.traktNetworkIds || []);
    return safeNetworks
      .filter((n) => {
        if (selectedIds.has(n.ids.trakt)) return true;
        if (networkCountryFilter && n.country !== networkCountryFilter) return false;
        return true;
      })
      .map((n) => {
        const countryLabel =
          !networkCountryFilter && n.country ? ` (${n.country.toUpperCase()})` : '';
        return { code: n.ids.trakt, name: `${n.name}${countryLabel}` };
      });
  }, [safeNetworks, networkCountryFilter, filters.traktNetworkIds]);

  const handleNetworkChange = useCallback(
    (newIds) => {
      onFiltersChange('traktNetworkIds', newIds.length > 0 ? newIds : undefined);
    },
    [onFiltersChange]
  );

  // ─── Genre Handlers ──────────────────────────────────────
  const handleGenreInclude = useCallback(
    (genreId) => {
      const newExcluded = excludedGenres.filter((g) => g !== genreId);
      const newGenres = selectedGenres.includes(genreId)
        ? selectedGenres
        : [...selectedGenres, genreId];
      onFiltersChange('traktGenres', newGenres.length > 0 ? newGenres : undefined);
      onFiltersChange('traktExcludeGenres', newExcluded.length > 0 ? newExcluded : undefined);
    },
    [selectedGenres, excludedGenres, onFiltersChange]
  );

  const handleGenreExclude = useCallback(
    (genreId) => {
      const newGenres = selectedGenres.filter((g) => g !== genreId);
      const newExcluded = excludedGenres.includes(genreId)
        ? excludedGenres
        : [...excludedGenres, genreId];
      onFiltersChange('traktGenres', newGenres.length > 0 ? newGenres : undefined);
      onFiltersChange('traktExcludeGenres', newExcluded.length > 0 ? newExcluded : undefined);
    },
    [selectedGenres, excludedGenres, onFiltersChange]
  );

  const handleGenreClear = useCallback(
    (genreId) => {
      const newGenres = selectedGenres.filter((g) => g !== genreId);
      const newExcluded = excludedGenres.filter((g) => g !== genreId);
      onFiltersChange('traktGenres', newGenres.length > 0 ? newGenres : undefined);
      onFiltersChange('traktExcludeGenres', newExcluded.length > 0 ? newExcluded : undefined);
    },
    [selectedGenres, excludedGenres, onFiltersChange]
  );

  // ─── Badge Counts ────────────────────────────────────────
  const getSortFilterBadge = () => {
    let count = 0;
    if (activeBrowseType !== 'discover') count++;
    if (activeListType !== 'calendar') count++;
    if (showPeriod && filters.traktPeriod && filters.traktPeriod !== 'weekly') count++;
    if (
      showCalendarControls &&
      filters.traktCalendarType &&
      filters.traktCalendarType !== fallbackCalendarType
    )
      count++;
    if (
      showCalendarControls &&
      filters.traktCalendarSort &&
      filters.traktCalendarSort !== defaultCalendarSort
    )
      count++;
    if (showCalendarControls && filters.traktCalendarDays && filters.traktCalendarDays !== 30)
      count++;
    if (showAdvancedFilters && filters.traktLanguages?.length) count++;
    if (showAdvancedFilters && filters.traktCountries?.length) count++;
    if (showYearRange && (filters.traktYearMin != null || filters.traktYearMax != null)) count++;
    if (showCoreRatingVoteFilters && (filters.traktRatingMin || filters.traktRatingMax)) count++;
    if (showAdvancedFilters && (filters.traktRuntimeMin != null || filters.traktRuntimeMax != null))
      count++;
    if (
      showAdvancedFilters &&
      !isMovie &&
      (filters.traktAiredEpisodesMin != null || filters.traktAiredEpisodesMax != null)
    )
      count++;
    if (showAdvancedFilters && !isMovie && filters.traktExcludeSingleSeason) count++;
    return count;
  };

  const getGenreBadge = () => selectedGenres.length + excludedGenres.length || 0;

  const getNetworkBadge = () => filters.traktNetworkIds?.length || 0;

  const getReleaseBadge = () => {
    let count = 0;
    if (filters.traktCertifications?.length) count++;
    if (filters.traktStatus?.length) count++;
    return count;
  };

  const getRatingsBadge = () => {
    let count = 0;
    if (
      externalRatingSupport.imdbRatings &&
      (filters.traktImdbRatingMin || filters.traktImdbRatingMax)
    )
      count++;
    if (
      externalRatingSupport.tmdbRatings &&
      (filters.traktTmdbRatingMin || filters.traktTmdbRatingMax)
    )
      count++;
    if (externalRatingSupport.rtMeters && (filters.traktRtMeterMin || filters.traktRtMeterMax))
      count++;
    if (
      externalRatingSupport.rtUserMeters &&
      (filters.traktRtUserMeterMin || filters.traktRtUserMeterMax)
    )
      count++;
    if (
      externalRatingSupport.metascores &&
      (filters.traktMetascoreMin || filters.traktMetascoreMax)
    )
      count++;
    if (filters.traktVotesMin) count++;
    if (externalRatingSupport.imdbVotes && filters.traktImdbVotesMin) count++;
    if (externalRatingSupport.tmdbVotes && filters.traktTmdbVotesMin) count++;
    return count;
  };

  const getOptionsBadge = () => (filters.randomize ? 1 : 0);

  // ─── Key Input UI ────────────────────────────────────────
  const renderKeyInput = () => (
    <div style={{ padding: keyState === 'needs_key' ? '16px' : undefined }}>
      <FilterSection
        id="traktKey"
        title={keyState === 'needs_key' ? 'Trakt Client ID Required' : 'Update Trakt Client ID'}
        description={
          keyState === 'needs_key'
            ? 'Enter your Trakt Client ID to use Trakt catalogs'
            : 'Replace your current Trakt Client ID'
        }
        icon={Key}
        isOpen={true}
        onToggle={() => {}}
        badgeCount={0}
      >
        <div className="filter-group">
          <LabelWithTooltip
            label="Client ID"
            tooltip="Create a Trakt API application at trakt.tv/oauth/applications to get your Client ID."
          />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <input
              type="text"
              className="input"
              style={{ flex: 1, height: '40px' }}
              placeholder="Enter your Trakt Client ID..."
              value={traktKey}
              onChange={(e) => setTraktKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveKey();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              style={{ height: '40px', whiteSpace: 'nowrap' }}
              onClick={handleSaveKey}
              disabled={keyValidating || !traktKey.trim()}
            >
              {keyValidating ? (
                <>
                  <Loader size={14} className="animate-spin" /> Validating...
                </>
              ) : (
                'Save'
              )}
            </button>
            {showUpdateKey && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ height: '40px' }}
                onClick={() => {
                  setShowUpdateKey(false);
                  setTraktKey('');
                  setKeyError(null);
                }}
              >
                Cancel
              </button>
            )}
          </div>
          {keyError && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--error)',
                fontSize: '12px',
                marginTop: '6px',
              }}
            >
              <AlertCircle size={14} />
              {keyError}
            </div>
          )}
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
            Create an API application at{' '}
            <a
              href="https://trakt.tv/oauth/applications"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent-primary)' }}
            >
              trakt.tv/oauth/applications
            </a>{' '}
            and paste the Client ID above.
          </p>
        </div>
      </FilterSection>
    </div>
  );

  // ─── Early Returns ───────────────────────────────────────
  if (keyState === 'checking') {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <Loader size={24} className="animate-spin" style={{ marginBottom: '8px' }} />
        <p style={{ fontSize: '13px' }}>Checking Trakt API key...</p>
      </div>
    );
  }

  if (keyState === 'needs_key') {
    return renderKeyInput();
  }

  // ─── Main Filter UI ─────────────────────────────────────
  return (
    <>
      {showUpdateKey && renderKeyInput()}

      {/* ── Section 1: Sort & Filter (mirrors TMDB id="filters") ── */}
      <FilterSection
        id="filters"
        title="Sort & Filter"
        description="Browse type, option, locale, year, rating, runtime"
        icon={Settings}
        isOpen={expandedSections?.filters}
        onToggle={onToggleSection}
        badgeCount={getSortFilterBadge()}
      >
        <div
          className="filter-grid"
          style={{
            gridTemplateColumns: showAdvancedFilters
              ? 'repeat(2, minmax(0, 1fr))'
              : 'repeat(2, minmax(0, 1fr))',
          }}
        >
          {showAdvancedFilters && (
            <div className="filter-group">
              <LabelWithTooltip label="Original Language" tooltip="Filter by original language." />
              <SearchableSelect
                options={availableLanguages}
                value=""
                onChange={handleAddLanguage}
                placeholder="Add language..."
                searchPlaceholder="Search languages..."
                labelKey="english_name"
                valueKey="iso_639_1"
                allowClear={false}
              />
              {(filters.traktLanguages || []).length > 0 && (
                <div className="imdb-selected-chips" style={{ marginTop: '6px' }}>
                  {(filters.traktLanguages || []).map((code) => (
                    <button
                      key={code}
                      type="button"
                      className="genre-chip selected imdb-chip--clickable"
                      onClick={() => handleRemoveLanguage(code)}
                      aria-label={`Remove ${code} language filter`}
                    >
                      {code.toUpperCase()} &times;
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {showAdvancedFilters && (
            <div className="filter-group">
              <LabelWithTooltip label="Country" tooltip="Filter by country of origin." />
              <SearchableSelect
                options={availableCountries}
                value=""
                onChange={handleAddCountry}
                placeholder="Add country..."
                searchPlaceholder="Search countries..."
                labelKey="english_name"
                valueKey="iso_3166_1"
                allowClear={false}
              />
              {(filters.traktCountries || []).length > 0 && (
                <div className="imdb-selected-chips" style={{ marginTop: '6px' }}>
                  {(filters.traktCountries || []).map((code) => (
                    <button
                      key={code}
                      type="button"
                      className="genre-chip selected imdb-chip--clickable"
                      onClick={() => handleRemoveCountry(code)}
                      aria-label={`Remove ${code} country filter`}
                    >
                      {code.toUpperCase()} &times;
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="filter-group">
            <LabelWithTooltip
              label="Browse Type"
              tooltip="Pick a broader Trakt catalog family such as Discover, Community, Calendar, or Other."
            />
            <SearchableSelect
              options={browseTypeOptions}
              value={selectedBrowseTypeValue}
              onChange={handleBrowseTypeChange}
              placeholder="Optional (Trakt default)..."
              searchPlaceholder="Search browse types..."
              labelKey="label"
              valueKey="value"
              allowClear={true}
            />
          </div>

          <div className="filter-group">
            <LabelWithTooltip
              label="Option"
              tooltip={
                activeBrowseType === 'calendar'
                  ? 'Calendar options combine timeframe (upcoming/recently aired) and feed type.'
                  : activeListType === 'recommended'
                    ? 'Shows titles most often recommended by the Trakt community in the selected period. This is community-aggregated data — not your personal Trakt recommendations (those require account OAuth which is not supported).'
                    : 'Select the specific list option within the chosen browse type.'
              }
            />
            <SearchableSelect
              options={optionDropdownOptions}
              value={selectedOptionValue}
              onChange={handleOptionChange}
              placeholder="Optional (Trakt default)..."
              searchPlaceholder="Search options..."
              labelKey="label"
              valueKey="value"
              allowClear={true}
            />
            {activeBrowseType === 'calendar' && (
              <span className="filter-label-hint" style={{ marginTop: '4px' }}>
                Example: Upcoming • Movie Releases, or Recently Aired • Season Premieres.
              </span>
            )}
          </div>
        </div>

        {showPeriod && traktPeriods.length > 0 && (
          <div className="filter-group">
            <LabelWithTooltip label="Period" tooltip="Time range for this list." />
            <AnimeFormatSelector
              selected={[filters.traktPeriod || 'weekly']}
              options={traktPeriods}
              onChange={(vals) => {
                const newPeriod = vals[vals.length - 1] || 'weekly';
                onFiltersChange('traktPeriod', newPeriod);
              }}
            />
          </div>
        )}

        {showCalendarControls && (
          <div className="filter-group">
            <LabelWithTooltip
              label="Date Order"
              tooltip="Sort items in the selected time range by date in ascending or descending order."
            />
            <SearchableSelect
              options={CALENDAR_SORT_OPTIONS}
              value={activeCalendarSort}
              onChange={(value) => {
                const nextSort = value || defaultCalendarSort;
                onFiltersChange(
                  'traktCalendarSort',
                  nextSort === defaultCalendarSort ? undefined : nextSort
                );
              }}
              placeholder="Select date order..."
              searchPlaceholder="Search sort options..."
              labelKey="label"
              valueKey="value"
              allowClear={false}
            />

            <LabelWithTooltip
              label="Window"
              tooltip={
                activeListType === 'calendar'
                  ? 'Pick a future preset for upcoming releases (next week, next month, this year).'
                  : 'Pick a past preset ending today for recently aired titles.'
              }
            />
            <AnimeFormatSelector
              selected={[String(filters.traktCalendarDays || defaultCalendarDays)]}
              options={calendarDayPresetOptions}
              onChange={(vals) => {
                const nextWindow = parseInt(
                  vals[vals.length - 1] || String(defaultCalendarDays),
                  10
                );
                onFiltersChange('traktCalendarDays', nextWindow);
                onFiltersChange('traktCalendarStartDate', undefined);
                onFiltersChange('traktCalendarEndDate', undefined);
              }}
            />

            <span className="filter-label-hint" style={{ marginTop: '6px' }}>
              {activeListType === 'calendar'
                ? 'Future range: start date = today, end date = today plus selected preset.'
                : 'Recent range: end date = today, start date = today minus selected preset.'}
            </span>
          </div>
        )}

        {showYearRange && (
          <RangeSlider
            label="Year Range"
            min={1900}
            max={CURRENT_YEAR + 1}
            step={1}
            value={[filters.traktYearMin ?? 1900, filters.traktYearMax ?? CURRENT_YEAR + 1]}
            onChange={([min, max]) => {
              onFiltersChange('traktYearMin', min > 1900 ? min : undefined);
              onFiltersChange('traktYearMax', max < CURRENT_YEAR + 1 ? max : undefined);
            }}
          />
        )}

        {showCoreRatingVoteFilters && (
          <RangeSlider
            label="Trakt Rating"
            min={0}
            max={100}
            step={1}
            value={[filters.traktRatingMin || 0, filters.traktRatingMax || 100]}
            onChange={([min, max]) => {
              onFiltersChange('traktRatingMin', min > 0 ? min : undefined);
              onFiltersChange('traktRatingMax', max < 100 ? max : undefined);
            }}
          />
        )}

        {showAdvancedFilters && (
          <RangeSlider
            label="Runtime (minutes)"
            min={0}
            max={400}
            step={5}
            value={[filters.traktRuntimeMin ?? 0, filters.traktRuntimeMax ?? RUNTIME_MAX_MINUTES]}
            onChange={([min, max]) => {
              onFiltersChange('traktRuntimeMin', min > 0 ? min : undefined);
              onFiltersChange('traktRuntimeMax', max < RUNTIME_MAX_MINUTES ? max : undefined);
            }}
          />
        )}

        {showAdvancedFilters && !isMovie && (
          <>
            <RangeSlider
              label="Aired Episodes"
              min={0}
              max={1000}
              step={1}
              value={[filters.traktAiredEpisodesMin ?? 0, filters.traktAiredEpisodesMax ?? 1000]}
              onChange={([min, max]) => {
                onFiltersChange('traktAiredEpisodesMin', min > 0 ? min : undefined);
                onFiltersChange('traktAiredEpisodesMax', max < 1000 ? max : undefined);
              }}
            />

            <div style={{ marginTop: '16px' }}>
              <div
                className={`released-only-card ${filters.traktExcludeSingleSeason ? 'active' : ''}`}
                role="switch"
                aria-checked={!!filters.traktExcludeSingleSeason}
                tabIndex={0}
                onClick={() =>
                  onFiltersChange(
                    'traktExcludeSingleSeason',
                    !filters.traktExcludeSingleSeason || undefined
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    onFiltersChange(
                      'traktExcludeSingleSeason',
                      !filters.traktExcludeSingleSeason || undefined
                    );
                  }
                }}
              >
                <div className="released-only-content">
                  <span className="released-only-title">Hide New / Single-Season Shows</span>
                  <span className="released-only-desc">
                    Exclude brand new series, premieres, or miniseries that only have one season
                    available.
                  </span>
                </div>
                <div className="released-only-toggle">
                  <div className="released-only-thumb" />
                </div>
              </div>
            </div>
          </>
        )}

        {!showAdvancedFilters && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            This option does not support advanced filters.
          </p>
        )}
      </FilterSection>

      {/* ── Section: Network (series only) ── */}
      {!isMovie && showAdvancedFilters && (
        <FilterSection
          id="network"
          title="Network"
          description="Filter by TV network or streaming service"
          icon={Tv}
          isOpen={expandedSections?.network}
          onToggle={onToggleSection}
          badgeCount={getNetworkBadge()}
        >
          {networksLoading ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--text-muted)',
                fontSize: '13px',
                padding: '8px 0',
              }}
            >
              <Loader size={14} className="animate-spin" />
              Loading networks...
            </div>
          ) : safeNetworks.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                {networksError ? networksError : 'No networks loaded.'}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: '30px', fontSize: '12px', padding: '0 10px' }}
                onClick={fetchNetworks}
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {networkCountryOptions.length > 1 && (
                <div className="filter-group" style={{ marginBottom: '8px' }}>
                  <LabelWithTooltip
                    label="Filter by Country"
                    tooltip="Narrow the network list to a specific country. Global services like Netflix and Amazon Prime are registered under 'United States'."
                  />
                  <SearchableSelect
                    options={networkCountryOptions}
                    value={networkCountryFilter}
                    onChange={(v) => setNetworkCountryFilter(v || '')}
                    placeholder="All countries..."
                    searchPlaceholder="Search countries..."
                    labelKey="label"
                    valueKey="value"
                    allowClear={true}
                  />
                </div>
              )}
              <div className="filter-group">
                <LabelWithTooltip
                  label="Networks"
                  tooltip="Filter by the TV network or streaming service that originally produced the show (e.g. HBO, Netflix, BBC)."
                />
                <span className="filter-label-hint">
                  Where the show originally aired or streamed.
                </span>
                <MultiSelect
                  options={filteredNetworkOptions}
                  value={filters.traktNetworkIds || []}
                  onChange={handleNetworkChange}
                  placeholder="Any network..."
                  searchPlaceholder="Search networks..."
                  labelKey="name"
                  valueKey="code"
                />
              </div>
            </>
          )}
        </FilterSection>
      )}

      {/* ── Section 2: Ratings (cross-platform) ── */}
      {(showAdvancedFilters || showCoreRatingVoteFilters) && (
        <FilterSection
          id="ratings"
          title="Ratings & Votes"
          description="IMDb, TMDB, Rotten Tomatoes, Metacritic, vote counts"
          icon={Star}
          isOpen={expandedSections?.ratings}
          onToggle={onToggleSection}
          badgeCount={getRatingsBadge()}
        >
          {externalRatingSupport.imdbRatings && (
            <RangeSlider
              label="IMDb Rating"
              min={0}
              max={10}
              step={0.1}
              value={[filters.traktImdbRatingMin || 0, filters.traktImdbRatingMax || 10]}
              onChange={([min, max]) => {
                onFiltersChange('traktImdbRatingMin', min > 0 ? min : undefined);
                onFiltersChange('traktImdbRatingMax', max < 10 ? max : undefined);
              }}
            />
          )}

          {externalRatingSupport.tmdbRatings && (
            <RangeSlider
              label="TMDB Rating"
              min={0}
              max={10}
              step={0.1}
              value={[filters.traktTmdbRatingMin || 0, filters.traktTmdbRatingMax || 10]}
              onChange={([min, max]) => {
                onFiltersChange('traktTmdbRatingMin', min > 0 ? min : undefined);
                onFiltersChange('traktTmdbRatingMax', max < 10 ? max : undefined);
              }}
            />
          )}

          {externalRatingSupport.rtMeters && (
            <RangeSlider
              label="Rotten Tomatoes (Critics)"
              min={0}
              max={100}
              step={1}
              value={[filters.traktRtMeterMin || 0, filters.traktRtMeterMax || 100]}
              onChange={([min, max]) => {
                onFiltersChange('traktRtMeterMin', min > 0 ? min : undefined);
                onFiltersChange('traktRtMeterMax', max < 100 ? max : undefined);
              }}
            />
          )}

          {externalRatingSupport.rtUserMeters && (
            <RangeSlider
              label="Rotten Tomatoes (Audience)"
              min={0}
              max={100}
              step={1}
              value={[filters.traktRtUserMeterMin || 0, filters.traktRtUserMeterMax || 100]}
              onChange={([min, max]) => {
                onFiltersChange('traktRtUserMeterMin', min > 0 ? min : undefined);
                onFiltersChange('traktRtUserMeterMax', max < 100 ? max : undefined);
              }}
            />
          )}

          {externalRatingSupport.metascores && (
            <RangeSlider
              label="Metacritic"
              min={0}
              max={100}
              step={1}
              value={[filters.traktMetascoreMin || 0, filters.traktMetascoreMax || 100]}
              onChange={([min, max]) => {
                onFiltersChange('traktMetascoreMin', min > 0 ? min : undefined);
                onFiltersChange('traktMetascoreMax', max < 100 ? max : undefined);
              }}
            />
          )}

          <div className="filter-grid">
            <div className="filter-group">
              <LabelWithTooltip label="Trakt Min Votes" tooltip="Minimum number of Trakt votes." />
              <input
                type="number"
                className="input"
                style={{ height: '38px' }}
                placeholder="0"
                min={0}
                value={filters.traktVotesMin || ''}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  onFiltersChange('traktVotesMin', val > 0 ? val : undefined);
                }}
              />
            </div>

            {externalRatingSupport.imdbVotes && (
              <div className="filter-group">
                <LabelWithTooltip label="IMDb Min Votes" tooltip="Minimum number of IMDb votes." />
                <input
                  type="number"
                  className="input"
                  style={{ height: '38px' }}
                  placeholder="0"
                  min={0}
                  value={filters.traktImdbVotesMin || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    onFiltersChange('traktImdbVotesMin', val > 0 ? val : undefined);
                  }}
                />
              </div>
            )}

            {externalRatingSupport.tmdbVotes && (
              <div className="filter-group">
                <LabelWithTooltip label="TMDB Min Votes" tooltip="Minimum number of TMDB votes." />
                <input
                  type="number"
                  className="input"
                  style={{ height: '38px' }}
                  placeholder="0"
                  min={0}
                  value={filters.traktTmdbVotesMin || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    onFiltersChange('traktTmdbVotesMin', val > 0 ? val : undefined);
                  }}
                />
              </div>
            )}
          </div>

          {!showDirectExternalRatingFilters && (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
              This feed only supports Trakt Rating and Trakt Vote filters.
            </p>
          )}

          {showDirectExternalRatingFilters && !isMovie && (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
              Only filters supported by the selected feed and media type are shown.
            </p>
          )}
        </FilterSection>
      )}

      {/* ── Section 3: Genres ── */}
      {showAdvancedFilters && (
        <FilterSection
          id="genres"
          title="Genres"
          description="Select genres to include or exclude"
          icon={Sparkles}
          isOpen={expandedSections?.genres}
          onToggle={onToggleSection}
          badgeCount={getGenreBadge()}
        >
          <GenreSelector
            genres={traktGenreObjects}
            selectedGenres={selectedGenres}
            excludedGenres={excludedGenres}
            genreMatchMode="any"
            onInclude={handleGenreInclude}
            onExclude={handleGenreExclude}
            onClear={handleGenreClear}
            onSetMatchMode={() => {}}
            showMatchMode={false}
          />
        </FilterSection>
      )}

      {/* ── Section 4: Certifications & Status ── */}
      {showAdvancedFilters && (
        <FilterSection
          id="release"
          title="Certifications & Status"
          description="Age ratings, show status"
          icon={Shield}
          isOpen={expandedSections?.release}
          onToggle={onToggleSection}
          badgeCount={getReleaseBadge()}
        >
          {certifications.length > 0 && (
            <div className="filter-group">
              <LabelWithTooltip label="Certifications" tooltip="Filter by content rating." />
              <AnimeFormatSelector
                selected={filters.traktCertifications || []}
                options={certifications}
                onChange={(vals) =>
                  onFiltersChange('traktCertifications', vals.length > 0 ? vals : undefined)
                }
              />
            </div>
          )}

          {!isMovie && traktShowStatuses.length > 0 && (
            <div className="filter-group">
              <LabelWithTooltip label="Show Status" tooltip="Filter by show status." />
              <AnimeFormatSelector
                selected={filters.traktStatus || []}
                options={traktShowStatuses}
                onChange={(vals) =>
                  onFiltersChange('traktStatus', vals.length > 0 ? vals : undefined)
                }
              />
            </div>
          )}
        </FilterSection>
      )}

      {/* ── Section 5: Options ── */}
      <FilterSection
        id="options"
        title="Options"
        description="Randomization and API key"
        icon={Settings}
        isOpen={expandedSections?.options}
        onToggle={onToggleSection}
        badgeCount={getOptionsBadge()}
      >
        <Checkbox
          checked={!!filters.randomize}
          onChange={(checked) => onFiltersChange('randomize', checked || undefined)}
          label="Randomize Results"
          tooltip="Fetch a random page from matching results and shuffle them."
        />

        <div style={{ marginTop: '12px' }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: '12px' }}
            onClick={() => {
              setShowUpdateKey(true);
              setTraktKey('');
              setKeyError(null);
            }}
          >
            <Key size={14} />
            Update Trakt Client ID
          </button>
        </div>
      </FilterSection>

      <FilterSection
        id="extras"
        title="Stremio Extras"
        description="Expose filter dropdowns inside Stremio"
        icon={Layers}
        isOpen={expandedSections?.extras}
        onToggle={onToggleSection}
        badgeCount={(filters.stremioExtras || []).length}
      >
        <StremioExtras
          localCatalog={localCatalog}
          onFiltersChange={onFiltersChange}
          availableModes={['genre']}
        />
      </FilterSection>
    </>
  );
}
