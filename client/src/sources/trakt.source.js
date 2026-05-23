import { lazy } from 'react';
import { humanizeFilterValue, resolveOptionLabel } from '../utils/filterLabels';
import { RUNTIME_MAX_MINUTES } from '../constants/filterLimits';
import {
  formatTraktCalendarWindowLabel,
  normalizeTraktListType,
  supportsTraktCalendarSettings,
  supportsTraktPeriod,
} from './traktCapabilities';

const NON_TRAKT_KEYS = [
  'sortBy',
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
  'imdbListId',
  'imdbRatingMin',
  'imdbRatingMax',
  'totalVotesMin',
  'totalVotesMax',
  'releaseDateStart',
  'releaseDateEnd',
  'imdbCountries',
  'languages',
  'keywords',
  'awardsWon',
  'awardsNominated',
  'types',
  'sortOrder',
  'rankedList',
  'rankedLists',
  'excludeRankedLists',
  'rankedListMaxRank',
  'creditedNames',
  'companies',
  'certificateRating',
  'certificateCountry',
  'certificates',
  'explicitContent',
  'plot',
  'filmingLocations',
  'withData',
  'inTheatersLat',
  'inTheatersLong',
  'inTheatersRadius',
  'anilistSort',
  'format',
  'status',
  'season',
  'seasonYear',
  'tags',
  'tagCategories',
  'countryOfOrigin',
  'sourceMaterial',
  'averageScoreMin',
  'averageScoreMax',
  'popularityMin',
  'episodesMin',
  'episodesMax',
  'durationMin',
  'durationMax',
  'malRankingType',
  'malSeason',
  'malSeasonYear',
  'malMediaType',
  'malStatus',
  'malSort',
  'malRating',
  'simklListType',
  'simklTrendingPeriod',
  'simklGenre',
  'simklType',
  'simklBestFilter',
  'simklSort',
];

/** @implements {import('./types').SourceDescriptor} */
export const TRAKT_SOURCE = {
  id: 'trakt',
  label: 'Trakt',
  supportedTypes: ['movie', 'series'],
  defaultSortBy: 'calendar',

  defaultFilters: {
    genres: [],
    excludeGenres: [],
    traktExcludeGenres: [],
  },

  movieOnlyFilterKeys: [],
  seriesOnlyFilterKeys: ['traktStatus'],

  cleanFiltersOnSwitch(currentFilters) {
    const result = { ...currentFilters };
    for (const key of NON_TRAKT_KEYS) {
      delete result[key];
    }
    return result;
  },

  computeActiveChips(filters, refData) {
    const {
      traktListTypes = [],
      traktPeriods = [],
      traktCalendarTypes = [],
      traktCommunityMetrics = [],
    } = refData;
    const active = [];
    const normalizedListType = normalizeTraktListType(filters.traktListType);
    const defaultCalendarSort = 'desc';

    if (normalizedListType !== 'calendar') {
      const allListTypes = [...traktListTypes, ...traktCommunityMetrics];
      active.push({
        key: 'traktListType',
        label: `List: ${resolveOptionLabel(allListTypes, normalizedListType, { fallbackFormatter: humanizeFilterValue })}`,
        section: 'filters',
      });
    }

    if (
      supportsTraktPeriod(normalizedListType) &&
      filters.traktPeriod &&
      filters.traktPeriod !== 'weekly'
    ) {
      active.push({
        key: 'traktPeriod',
        label: `Period: ${resolveOptionLabel(traktPeriods, filters.traktPeriod, { fallbackFormatter: humanizeFilterValue })}`,
        section: 'filters',
      });
    }

    if (filters.traktCalendarType) {
      active.push({
        key: 'traktCalendarType',
        label: `Feed: ${resolveOptionLabel(traktCalendarTypes, filters.traktCalendarType, { fallbackFormatter: humanizeFilterValue })}`,
        section: 'filters',
      });
    }

    if (
      supportsTraktCalendarSettings(normalizedListType) &&
      filters.traktCalendarSort &&
      filters.traktCalendarSort !== defaultCalendarSort
    ) {
      active.push({
        key: 'traktCalendarSort',
        label: `Date Order: ${filters.traktCalendarSort === 'desc' ? 'Descending' : 'Ascending'}`,
        section: 'filters',
      });
    }

    if (
      supportsTraktCalendarSettings(normalizedListType) &&
      (filters.traktCalendarStartDate || filters.traktCalendarEndDate)
    ) {
      active.push({
        key: 'traktCalendarRange',
        label: `Range: ${filters.traktCalendarStartDate || '...'} to ${filters.traktCalendarEndDate || '...'}`,
        section: 'filters',
      });
    }

    if (
      filters.traktCalendarDays &&
      supportsTraktCalendarSettings(normalizedListType) &&
      !filters.traktCalendarStartDate &&
      !filters.traktCalendarEndDate
    ) {
      const windowLabel = formatTraktCalendarWindowLabel(
        normalizedListType,
        filters.traktCalendarDays
      );
      active.push({
        key: 'traktCalendarDays',
        label: windowLabel || `Last ${filters.traktCalendarDays} days`,
        section: 'filters',
      });
    }

    if (filters.traktGenres && filters.traktGenres.length > 0) {
      active.push({
        key: 'traktGenres',
        label: `Genres: ${filters.traktGenres.length}`,
        section: 'genres',
      });
    }

    if (filters.traktExcludeGenres && filters.traktExcludeGenres.length > 0) {
      active.push({
        key: 'traktExcludeGenres',
        label: `Excluded: ${filters.traktExcludeGenres.length}`,
        section: 'genres',
      });
    }

    if (filters.traktYearMin != null || filters.traktYearMax != null) {
      const min = filters.traktYearMin ?? 1900;
      const max = filters.traktYearMax ?? new Date().getFullYear() + 1;
      active.push({ key: 'traktYear', label: `Year: ${min}-${max}`, section: 'filters' });
    }

    if (filters.traktRuntimeMin != null || filters.traktRuntimeMax != null) {
      const min = filters.traktRuntimeMin ?? 0;
      const max = filters.traktRuntimeMax ?? RUNTIME_MAX_MINUTES;
      active.push({ key: 'traktRuntime', label: `Runtime: ${min}-${max}m`, section: 'filters' });
    }

    if (filters.traktCertifications && filters.traktCertifications.length > 0) {
      active.push({
        key: 'traktCertifications',
        label: `Cert: ${filters.traktCertifications.join(',')}`,
        section: 'release',
      });
    }

    if (filters.traktCountries && filters.traktCountries.length > 0) {
      active.push({
        key: 'traktCountries',
        label: `Countries: ${filters.traktCountries.length}`,
        section: 'filters',
      });
    }

    if (filters.traktLanguages && filters.traktLanguages.length > 0) {
      active.push({
        key: 'traktLanguages',
        label: `Languages: ${filters.traktLanguages.length}`,
        section: 'filters',
      });
    }

    if (filters.traktStatus && filters.traktStatus.length > 0) {
      active.push({
        key: 'traktStatus',
        label: `Status: ${filters.traktStatus.length}`,
        section: 'release',
      });
    }

    if (filters.traktRatingMin || filters.traktRatingMax) {
      active.push({
        key: 'traktRating',
        label: `Rating: ${filters.traktRatingMin || 0}-${filters.traktRatingMax || 100}`,
        section: 'filters',
      });
    }

    if (filters.traktVotesMin) {
      active.push({
        key: 'traktVotesMin',
        label: `Trakt Votes: \u2265${filters.traktVotesMin}`,
        section: 'ratings',
      });
    }

    if (filters.traktAiredEpisodesMin != null || filters.traktAiredEpisodesMax != null) {
      const min = filters.traktAiredEpisodesMin ?? '...';
      const max = filters.traktAiredEpisodesMax ?? '...';
      active.push({
        key: 'traktAiredEpisodes',
        label: `Aired Episodes: ${min}-${max}`,
        section: 'filters',
      });
    }

    if (filters.traktExcludeSingleSeason) {
      active.push({
        key: 'traktExcludeSingleSeason',
        label: 'Hide New / Single-Season Shows',
        section: 'filters',
      });
    }

    if (filters.traktImdbVotesMin) {
      active.push({
        key: 'traktImdbVotesMin',
        label: `IMDb Votes: \u2265${filters.traktImdbVotesMin}`,
        section: 'ratings',
      });
    }

    if (filters.traktTmdbVotesMin) {
      active.push({
        key: 'traktTmdbVotesMin',
        label: `TMDB Votes: \u2265${filters.traktTmdbVotesMin}`,
        section: 'ratings',
      });
    }

    if (filters.traktNetworkIds && filters.traktNetworkIds.length > 0) {
      active.push({
        key: 'traktNetworkIds',
        label: `Networks: ${filters.traktNetworkIds.length}`,
        section: 'filters',
      });
    }

    if (filters.traktRtUserMeterMin || filters.traktRtUserMeterMax) {
      active.push({
        key: 'traktRtUserMeter',
        label: `RT Audience: ${filters.traktRtUserMeterMin || 0}-${filters.traktRtUserMeterMax || 100}`,
        section: 'ratings',
      });
    }

    if (filters.randomize) {
      active.push({ key: 'randomize', label: 'Randomized', section: 'options' });
    }

    return active;
  },

  FilterPanelComponent: lazy(() =>
    import('../components/config/catalog/sources/trakt/TraktFilterPanel').then((m) => ({
      default: m.TraktFilterPanel,
    }))
  ),
};
