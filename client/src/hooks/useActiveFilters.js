import { useCallback, useMemo } from 'react';

const DEFAULT_FILTERS = {
  genres: [],
  excludeGenres: [],
  sortBy: 'popularity.desc',
  imdbOnly: false,
  voteCountMin: 0,
};

const DATE_PRESETS = [
  { label: 'Last 30 days', value: 'last_30_days' },
  { label: 'Last 90 days', value: 'last_90_days' },
  { label: 'Last 6 months', value: 'last_180_days' },
  { label: 'Last 12 months', value: 'last_365_days' },
  { label: 'Next 30 days', value: 'next_30_days' },
  { label: 'Next 3 months', value: 'next_90_days' },
  { label: 'Era: 2020s', value: 'era_2020s' },
  { label: 'Era: 2010s', value: 'era_2010s' },
  { label: 'Era: 2000s', value: 'era_2000s' },
  { label: 'Era: 1990s', value: 'era_1990s' },
  { label: 'Era: 1980s', value: 'era_1980s' },
];

export function useActiveFilters({
  localCatalog,
  setLocalCatalog,
  genres,
  sortOptions,
  originalLanguages,
  countries,
  tvStatuses,
  tvTypes,
  watchRegions,
  monetizationTypes,
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
}) {
  const activeFilters = useMemo(() => {
    const filters = localCatalog?.filters || {};
    const active = [];
    const isMovieType = localCatalog?.type === 'movie';

    if (filters.sortBy && filters.sortBy !== 'popularity.desc') {
      const sortOpts = sortOptions[localCatalog?.type] || sortOptions.movie || [];
      const match = sortOpts.find((s) => s.value === filters.sortBy);
      active.push({
        key: 'sortBy',
        label: `Sort: ${match?.label || filters.sortBy}`,
        section: 'filters',
      });
    }

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

    if (filters.genreMatchMode === 'all' && filters.genres?.length > 1) {
      active.push({ key: 'genreMatchMode', label: 'Genre match: ALL', section: 'genres' });
    }

    if (filters.language) {
      const lang = originalLanguages.find((l) => l.iso_639_1 === filters.language);
      active.push({
        key: 'language',
        label: `Language: ${lang?.english_name || filters.language}`,
        section: 'filters',
      });
    }

    if (filters.originCountry) {
      const country = countries.find((c) => c.iso_3166_1 === filters.originCountry);
      active.push({
        key: 'originCountry',
        label: `Country: ${country?.english_name || filters.originCountry}`,
        section: 'filters',
      });
    }

    if (filters.yearFrom || filters.yearTo) {
      const from = filters.yearFrom || 'Any';
      const to = filters.yearTo || 'Now';
      active.push({ key: 'year', label: `Year: ${from}–${to}`, section: 'filters' });
    }

    if (filters.ratingMin > 0 || (filters.ratingMax != null && filters.ratingMax < 10)) {
      active.push({
        key: 'rating',
        label: `Rating: ${filters.ratingMin || 0}–${filters.ratingMax ?? 10}`,
        section: 'filters',
      });
    }

    if (filters.runtimeMin || filters.runtimeMax) {
      active.push({
        key: 'runtime',
        label: `Runtime: ${filters.runtimeMin || 0}–${filters.runtimeMax || '∞'}min`,
        section: 'filters',
      });
    }

    if (filters.voteCountMin > 0) {
      active.push({
        key: 'voteCountMin',
        label: `Min votes: ${filters.voteCountMin.toLocaleString()}`,
        section: 'filters',
      });
    }

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
      const DATE_TAG_LABELS = {
        'today': 'Today', 'today-30d': 'Today − 30d', 'today-90d': 'Today − 90d',
        'today-6mo': 'Today − 6mo', 'today-12mo': 'Today − 12mo',
        'today+30d': 'Today + 30d', 'today+3mo': 'Today + 3mo',
      };
      const rawFrom = filters.releaseDateFrom || filters.airDateFrom || '…';
      const rawTo = filters.releaseDateTo || filters.airDateTo || '…';
      const from = DATE_TAG_LABELS[rawFrom] || rawFrom;
      const to = DATE_TAG_LABELS[rawTo] || rawTo;
      active.push({
        key: 'releaseDate',
        label: `${isMovieType ? 'Release' : 'Air'}: ${from} – ${to}`,
        section: 'release',
      });
    }

    if (!isMovieType && (filters.firstAirDateFrom || filters.firstAirDateTo)) {
      const from = filters.firstAirDateFrom || '…';
      const to = filters.firstAirDateTo || '…';
      active.push({ key: 'firstAirDate', label: `Premiered: ${from} – ${to}`, section: 'release' });
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

    if (isMovieType && filters.region) {
      const regionLabel =
        countries.find((c) => c.iso_3166_1 === filters.region)?.english_name || filters.region;
      active.push({ key: 'region', label: `Release region: ${regionLabel}`, section: 'release' });
    }

    if (isMovieType && filters.releaseTypes?.length > 0) {
      active.push({
        key: 'releaseTypes',
        label: `${filters.releaseTypes.length} release type(s)`,
        section: 'release',
      });
    }

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
      active.push({ key: 'timezone', label: `Timezone: ${filters.timezone}`, section: 'release' });
    }

    if (!isMovieType && filters.tvStatus) {
      const statusMatch = tvStatuses.find((s) => s.value === filters.tvStatus);
      active.push({
        key: 'tvStatus',
        label: `Status: ${statusMatch?.label || filters.tvStatus}`,
        section: 'release',
      });
    }

    if (!isMovieType && filters.tvType) {
      const typeMatch = tvTypes.find((t) => t.value === filters.tvType);
      active.push({
        key: 'tvType',
        label: `Type: ${typeMatch?.label || filters.tvType}`,
        section: 'release',
      });
    }

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

    if (filters.watchMonetizationTypes?.length > 0) {
      const labels = filters.watchMonetizationTypes
        .map((v) => monetizationTypes.find((m) => m.value === v)?.label || v)
        .join(', ');
      active.push({
        key: 'watchMonetizationTypes',
        label: `Monetization: ${labels}`,
        section: 'streaming',
      });
    }

    if (filters.withNetworks) {
      const count = filters.withNetworks.split('|').filter(Boolean).length;
      active.push({ key: 'withNetworks', label: `${count} network(s)`, section: 'streaming' });
    }

    if (selectedPeople.length > 0) {
      const names = selectedPeople.slice(0, 2).map((p) => p.name);
      const extra = selectedPeople.length > 2 ? ` +${selectedPeople.length - 2}` : '';
      active.push({
        key: 'people',
        label: `Cast/Crew: ${names.join(', ')}${extra}`,
        section: 'people',
      });
    }

    if (selectedCompanies.length > 0) {
      const names = selectedCompanies.slice(0, 2).map((c) => c.name);
      const extra = selectedCompanies.length > 2 ? ` +${selectedCompanies.length - 2}` : '';
      active.push({
        key: 'companies',
        label: `Studio: ${names.join(', ')}${extra}`,
        section: 'people',
      });
    }

    if (excludeCompanies.length > 0) {
      active.push({
        key: 'excludeCompanies',
        label: `Exclude ${excludeCompanies.length} studio(s)`,
        section: 'people',
      });
    }

    if (selectedKeywords.length > 0) {
      const names = selectedKeywords.slice(0, 2).map((k) => k.name);
      const extra = selectedKeywords.length > 2 ? ` +${selectedKeywords.length - 2}` : '';
      active.push({
        key: 'keywords',
        label: `Keywords: ${names.join(', ')}${extra}`,
        section: 'people',
      });
    }

    if (excludeKeywords.length > 0) {
      active.push({
        key: 'excludeKeywords',
        label: `Exclude ${excludeKeywords.length} keyword(s)`,
        section: 'people',
      });
    }

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

    if (filters.releasedOnly) {
      active.push({ key: 'releasedOnly', label: 'Released only', section: 'options' });
    }

    return active;
  }, [
    localCatalog,
    genres,
    sortOptions,
    originalLanguages,
    countries,
    tvStatuses,
    tvTypes,
    watchRegions,
    monetizationTypes,
    selectedPeople,
    selectedCompanies,
    selectedKeywords,
    excludeKeywords,
    excludeCompanies,
  ]);

  const clearFilter = useCallback(
    (filterKey) => {
      const update = (patch) =>
        setLocalCatalog((prev) => ({ ...prev, filters: { ...prev.filters, ...patch } }));

      switch (filterKey) {
        case 'sortBy':
          update({ sortBy: 'popularity.desc' });
          break;
        case 'genres':
          update({ genres: [] });
          break;
        case 'excludeGenres':
          update({ excludeGenres: [] });
          break;
        case 'genreMatchMode':
          update({ genreMatchMode: 'any' });
          break;
        case 'language':
          update({ language: undefined });
          break;
        case 'originCountry':
          update({ originCountry: undefined });
          break;
        case 'year':
          update({ yearFrom: undefined, yearTo: undefined });
          break;
        case 'rating':
          update({ ratingMin: 0, ratingMax: 10 });
          break;
        case 'runtime':
          update({ runtimeMin: undefined, runtimeMax: undefined });
          break;
        case 'voteCountMin':
          update({ voteCountMin: 0 });
          break;
        case 'datePreset':
          update({
            datePreset: undefined,
            releaseDateFrom: undefined,
            releaseDateTo: undefined,
            airDateFrom: undefined,
            airDateTo: undefined,
          });
          break;
        case 'releaseDate':
          update({
            releaseDateFrom: undefined,
            releaseDateTo: undefined,
            airDateFrom: undefined,
            airDateTo: undefined,
          });
          break;
        case 'firstAirDate':
          update({ firstAirDateFrom: undefined, firstAirDateTo: undefined });
          break;
        case 'firstAirDateYear':
          update({ firstAirDateYear: undefined });
          break;
        case 'primaryReleaseYear':
          update({ primaryReleaseYear: undefined });
          break;
        case 'region':
          update({ region: undefined, releaseTypes: [] });
          break;
        case 'releaseTypes':
          update({ releaseTypes: [] });
          break;
        case 'certifications':
          update({ certifications: [] });
          break;
        case 'certificationRange':
          update({ certificationMin: undefined, certificationMax: undefined });
          break;
        case 'certificationCountry':
          update({ certificationCountry: undefined });
          break;
        case 'timezone':
          update({ timezone: undefined });
          break;
        case 'tvStatus':
          update({ tvStatus: undefined });
          break;
        case 'tvType':
          update({ tvType: undefined });
          break;
        case 'watchRegion':
          update({ watchRegion: undefined });
          break;
        case 'watchProviders':
          update({ watchProviders: [] });
          break;
        case 'watchMonetizationTypes':
          update({ watchMonetizationTypes: undefined });
          break;
        case 'withNetworks':
          update({ withNetworks: undefined });
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
          update({ includeAdult: undefined });
          break;
        case 'includeVideo':
          update({ includeVideo: undefined });
          break;
        case 'randomize':
          update({ randomize: undefined });
          break;
        case 'discoverOnly':
          update({ discoverOnly: undefined });
          break;
        case 'includeNullFirstAirDates':
          update({ includeNullFirstAirDates: undefined });
          break;
        case 'screenedTheatrically':
          update({ screenedTheatrically: undefined });
          break;
        case 'releasedOnly':
          update({ releasedOnly: undefined });
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
      setLocalCatalog,
    ]
  );

  const clearAllFilters = useCallback(() => {
    setLocalCatalog((prev) => ({ ...prev, filters: { ...DEFAULT_FILTERS } }));
    setSelectedPeople([]);
    setSelectedCompanies([]);
    setSelectedKeywords([]);
    setExcludeKeywords([]);
    setExcludeCompanies([]);
  }, [
    setExcludeCompanies,
    setExcludeKeywords,
    setSelectedCompanies,
    setSelectedKeywords,
    setSelectedPeople,
    setLocalCatalog,
  ]);

  return { activeFilters, clearFilter, clearAllFilters };
}
