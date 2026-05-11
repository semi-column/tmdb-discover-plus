import { lazy } from 'react';
import { resolveSortLabel } from '../utils/filterLabels';

const TMDB_ONLY_KEYS = [
  'listType',
  'voteCountMin',
  'imdbOnly',
  'displayLanguage',
  'region',
  'releaseType',
  'releaseTypes',
  'releaseDateFrom',
  'releaseDateTo',
  'primaryReleaseYear',
  'includeVideo',
  'airDateFrom',
  'airDateTo',
  'firstAirDateFrom',
  'firstAirDateTo',
  'firstAirDateYear',
  'includeNullFirstAirDates',
  'screenedTheatrically',
  'timezone',
  'withNetworks',
  'tvStatus',
  'tvType',
  'withPeople',
  'withCast',
  'withCrew',
  'withCompanies',
  'withKeywords',
  'watchRegion',
  'watchProviders',
  'watchMonetizationType',
  'watchMonetizationTypes',
  'releasedOnly',
  'certificationMin',
  'certificationMax',
  'datePreset',
  'certification',
];

/** @implements {import('./types').SourceDescriptor} */
export const IMDB_SOURCE = {
  id: 'imdb',
  label: 'IMDb',
  supportedTypes: ['movie', 'series'],
  defaultSortBy: 'POPULARITY',

  defaultFilters: {
    genres: [],
    excludeGenres: [],
    sortBy: 'POPULARITY',
    sortOrder: 'DESC',
    listType: 'discover',
  },

  movieOnlyFilterKeys: ['rankedList', 'rankedLists', 'excludeRankedLists', 'rankedListMaxRank'],

  seriesOnlyFilterKeys: [],

  cleanFiltersOnSwitch(currentFilters) {
    const result = { ...currentFilters };
    for (const key of TMDB_ONLY_KEYS) {
      delete result[key];
    }
    return result;
  },

  computeActiveChips(filters, refData) {
    const {
      imdbSortOptions = [],
      countries = [],
      selectedImdbPeople = [],
      selectedImdbCompanies = [],
      selectedImdbExcludeCompanies = [],
      contentType = 'movie',
    } = refData;

    const active = [];
    const isMovieType = contentType === 'movie';

    if (filters.sortBy && filters.sortBy !== 'POPULARITY') {
      active.push({
        key: 'sortBy',
        label: `Sort: ${resolveSortLabel(imdbSortOptions, filters.sortBy)}`,
        section: 'filters',
      });
    }

    if (filters.genres?.length > 0) {
      const names = filters.genres.slice(0, 2);
      const extra = filters.genres.length > 2 ? ` +${filters.genres.length - 2}` : '';
      active.push({
        key: 'genres',
        label: `Genres: ${names.join(', ')}${extra}`,
        section: 'genres',
      });
    }

    if (filters.excludeGenres?.length > 0) {
      const names = filters.excludeGenres.slice(0, 2);
      const extra = filters.excludeGenres.length > 2 ? ` +${filters.excludeGenres.length - 2}` : '';
      active.push({
        key: 'excludeGenres',
        label: `Exclude: ${names.join(', ')}${extra}`,
        section: 'genres',
      });
    }

    if (filters.imdbCountries?.length > 0) {
      const names = filters.imdbCountries
        .map((code) => countries.find((c) => c.iso_3166_1 === code)?.english_name || code)
        .slice(0, 2);
      const extra = filters.imdbCountries.length > 2 ? ` +${filters.imdbCountries.length - 2}` : '';
      active.push({
        key: 'imdbCountries',
        label: `IMDb Countries: ${names.join(', ')}${extra}`,
        section: 'region',
      });
    }

    if (filters.yearFrom || filters.yearTo) {
      active.push({
        key: 'year',
        label: `Year: ${filters.yearFrom || 'Any'}–${filters.yearTo || 'Now'}`,
        section: 'filters',
      });
    }

    if (
      filters.imdbRatingMin > 0 ||
      (filters.imdbRatingMax != null && filters.imdbRatingMax < 10)
    ) {
      active.push({
        key: 'imdbRating',
        label: `IMDb Rating: ${filters.imdbRatingMin || 0}–${filters.imdbRatingMax ?? 10}`,
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

    if (filters.totalVotesMin > 0) {
      active.push({
        key: 'totalVotesMin',
        label: `Min votes: ${filters.totalVotesMin.toLocaleString()}`,
        section: 'filters',
      });
    }

    if (filters.releaseDateStart || filters.releaseDateEnd) {
      active.push({
        key: 'releaseDate',
        label: `Release: ${filters.releaseDateStart || '…'} – ${filters.releaseDateEnd || '…'}`,
        section: 'release',
      });
    }

    if (filters.awardsWon?.length > 0) {
      active.push({
        key: 'awardsWon',
        label: `Awards won: ${filters.awardsWon.length}`,
        section: 'awards',
      });
    }

    if (filters.awardsNominated?.length > 0) {
      active.push({
        key: 'awardsNominated',
        label: `Awards nominated: ${filters.awardsNominated.length}`,
        section: 'awards',
      });
    }

    if (selectedImdbPeople?.length > 0) {
      active.push({
        key: 'creditedNames',
        label: `IMDb People: ${selectedImdbPeople.length}`,
        section: 'people',
      });
    }

    if (selectedImdbCompanies?.length > 0) {
      active.push({
        key: 'imdbCompanies',
        label: `IMDb Studios: ${selectedImdbCompanies.length}`,
        section: 'people',
      });
    }

    if (selectedImdbExcludeCompanies?.length > 0) {
      active.push({
        key: 'imdbExcludeCompanies',
        label: `Exclude IMDb studios: ${selectedImdbExcludeCompanies.length}`,
        section: 'people',
      });
    }

    if (filters.inTheatersLat) {
      active.push({ key: 'inTheaters', label: 'In Theatres', section: 'theatres' });
    }

    if (filters.certificates?.length > 0) {
      active.push({
        key: 'imdbCertificates',
        label: `Certificates: ${filters.certificates.length}`,
        section: 'certificates',
      });
    }

    if (isMovieType && filters.rankedLists?.length > 0) {
      active.push({
        key: 'rankedLists',
        label: `Ranked Lists: ${filters.rankedLists.length}`,
        section: 'rankedLists',
      });
    }

    if (isMovieType && filters.excludeRankedLists?.length > 0) {
      active.push({
        key: 'excludeRankedLists',
        label: `Exclude Lists: ${filters.excludeRankedLists.length}`,
        section: 'rankedLists',
      });
    }

    if (filters.explicitContent) {
      active.push({
        key: 'explicitContent',
        label: `Explicit: ${filters.explicitContent}`,
        section: 'advanced',
      });
    }

    if (filters.plot) {
      active.push({ key: 'plot', label: `Plot: "${filters.plot}"`, section: 'textSearch' });
    }

    if (filters.filmingLocations) {
      active.push({
        key: 'filmingLocations',
        label: `Filmed in: "${filters.filmingLocations}"`,
        section: 'textSearch',
      });
    }

    if (filters.withData?.length > 0) {
      active.push({
        key: 'withData',
        label: `Must have: ${filters.withData.length} data type(s)`,
        section: 'advanced',
      });
    }

    if (filters.includeAdult) {
      active.push({ key: 'includeAdult', label: 'Adult content', section: 'options' });
    }

    if (filters.randomize) {
      active.push({ key: 'randomize', label: 'Randomized', section: 'options' });
    }

    if (filters.discoverOnly) {
      active.push({ key: 'discoverOnly', label: 'Discover only', section: 'options' });
    }

    return active;
  },

  FilterPanelComponent: lazy(() =>
    import('../components/config/catalog/ImdbFilterPanel').then((m) => ({
      default: m.ImdbFilterPanel,
    }))
  ),
};
