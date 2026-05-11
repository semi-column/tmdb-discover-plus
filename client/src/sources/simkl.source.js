import { lazy } from 'react';
import { resolveOptionLabel } from '../utils/filterLabels';

const NON_SIMKL_KEYS = [
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
];

/** @implements {import('./types').SourceDescriptor} */
export const SIMKL_SOURCE = {
  id: 'simkl',
  label: 'Simkl',
  supportedTypes: ['movie', 'series', 'anime'],
  defaultSortBy: 'trending',

  defaultFilters: {
    genres: [],
    excludeGenres: [],
    simklListType: 'trending',
    simklTrendingPeriod: 'week',
  },

  movieOnlyFilterKeys: [],
  seriesOnlyFilterKeys: [],

  cleanFiltersOnSwitch(currentFilters) {
    const result = { ...currentFilters };
    for (const key of NON_SIMKL_KEYS) {
      delete result[key];
    }
    return result;
  },

  computeActiveChips(filters, refData, catalogType) {
    const {
      simklListTypes = [],
      simklTrendingPeriods = [],
      simklBestFilters = [],
      simklAnimeTypes = [],
    } = refData;
    const active = [];

    if (filters.simklListType && filters.simklListType !== 'trending') {
      active.push({
        key: 'simklListType',
        label: `List: ${resolveOptionLabel(simklListTypes, filters.simklListType)}`,
        section: 'filters',
      });
    }

    if (filters.simklTrendingPeriod && filters.simklTrendingPeriod !== 'week') {
      active.push({
        key: 'simklTrendingPeriod',
        label: `Period: ${resolveOptionLabel(simklTrendingPeriods, filters.simklTrendingPeriod)}`,
        section: 'filters',
      });
    }

    if (filters.simklGenre) {
      active.push({ key: 'simklGenre', label: `Genre: ${filters.simklGenre}`, section: 'genres' });
    }

    if (filters.simklType && filters.simklType !== 'all') {
      if (catalogType !== 'movie' || filters.simklType === 'movies') {
        active.push({
          key: 'simklType',
          label: `Type: ${resolveOptionLabel(simklAnimeTypes, filters.simklType)}`,
          section: 'filters',
        });
      }
    }

    if (filters.simklBestFilter) {
      active.push({
        key: 'simklBestFilter',
        label: `Best: ${resolveOptionLabel(simklBestFilters, filters.simklBestFilter)}`,
        section: 'filters',
      });
    }

    if (filters.randomize) {
      active.push({ key: 'randomize', label: 'Randomized', section: 'options' });
    }

    return active;
  },

  FilterPanelComponent: lazy(() =>
    import('../components/config/catalog/sources/simkl/SimklFilterPanel').then((m) => ({
      default: m.SimklFilterPanel,
    }))
  ),
};
