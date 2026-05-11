import { lazy } from 'react';
import { resolveOptionLabel, resolveSortLabel } from '../utils/filterLabels';

const NON_MAL_KEYS = [
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
  'simklListType',
  'simklTrendingPeriod',
  'simklGenre',
  'simklType',
  'simklSort',
  'simklBestFilter',
  'simklYear',
  'simklNetwork',
];

/** @implements {import('./types').SourceDescriptor} */
export const MAL_SOURCE = {
  id: 'mal',
  label: 'MAL',
  supportedTypes: ['movie', 'series', 'anime'],
  defaultSortBy: 'all',

  defaultFilters: {
    genres: [],
    excludeGenres: [],
    malRankingType: 'all',
    malGenres: [],
    malExcludeGenres: [],
    malMediaType: [],
    malStatus: [],
  },

  movieOnlyFilterKeys: [],
  seriesOnlyFilterKeys: ['malSeason', 'malSeasonYear', 'malSort'],

  cleanFiltersOnSwitch(currentFilters) {
    const result = { ...currentFilters };
    for (const key of NON_MAL_KEYS) {
      delete result[key];
    }
    return result;
  },

  computeActiveChips(filters, refData) {
    const {
      malRankingTypes = [],
      malSortOptions = [],
      malOrderByOptions = [],
      malMediaTypes = [],
      malStatuses = [],
      malRatings = [],
      malGenres: malGenreList = [],
    } = refData;
    const active = [];

    if (filters.malRankingType && filters.malRankingType !== 'all') {
      active.push({
        key: 'malRankingType',
        label: `Ranking: ${resolveOptionLabel(malRankingTypes, filters.malRankingType)}`,
        section: 'filters',
      });
    }

    if (filters.malSeason && filters.malSeasonYear) {
      active.push({
        key: 'malSeason',
        label: `Season: ${filters.malSeason} ${filters.malSeasonYear}`,
        section: 'season',
      });
    }

    if (filters.malGenres?.length > 0) {
      const names = filters.malGenres.slice(0, 2).map((id) => {
        const match = malGenreList.find((g) => g.id === id);
        return match?.name || String(id);
      });
      const extra = filters.malGenres.length > 2 ? ` +${filters.malGenres.length - 2}` : '';
      active.push({
        key: 'malGenres',
        label: `Genres: ${names.join(', ')}${extra}`,
        section: 'genres',
      });
    }

    if (filters.malExcludeGenres?.length > 0) {
      active.push({
        key: 'malExcludeGenres',
        label: `Excluded: ${filters.malExcludeGenres.length} genre(s)`,
        section: 'genres',
      });
    }

    if (filters.malMediaType?.length > 0) {
      const names = filters.malMediaType.map((v) => resolveOptionLabel(malMediaTypes, v));
      active.push({
        key: 'malMediaType',
        label: `Type: ${names.join(', ')}`,
        section: 'format',
      });
    }

    if (filters.malStatus?.length > 0) {
      const names = filters.malStatus.map((v) => resolveOptionLabel(malStatuses, v));
      active.push({
        key: 'malStatus',
        label: `Status: ${names.join(', ')}`,
        section: 'format',
      });
    }

    if (filters.malRating) {
      active.push({
        key: 'malRating',
        label: `Rating: ${resolveOptionLabel(malRatings, filters.malRating)}`,
        section: 'format',
      });
    }

    if (filters.malScoreMin || filters.malScoreMax) {
      active.push({
        key: 'malScore',
        label: `Score: ${filters.malScoreMin || 0}-${filters.malScoreMax || 10}`,
        section: 'score',
      });
    }

    if (filters.malOrderBy) {
      active.push({
        key: 'malOrderBy',
        label: `Order: ${resolveOptionLabel(malOrderByOptions, filters.malOrderBy)}`,
        section: 'score',
      });
    }

    if (filters.malSort) {
      active.push({
        key: 'malSort',
        label: `Sort: ${resolveSortLabel(malSortOptions, filters.malSort)}`,
        section: 'filters',
      });
    }

    if (filters.randomize) {
      active.push({ key: 'randomize', label: 'Randomized', section: 'options' });
    }

    return active;
  },

  FilterPanelComponent: lazy(() =>
    import('../components/config/catalog/sources/mal/MalFilterPanel').then((m) => ({
      default: m.MalFilterPanel,
    }))
  ),
};
