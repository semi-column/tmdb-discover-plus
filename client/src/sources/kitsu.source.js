import { lazy } from 'react';
import { resolveOptionLabel, resolveSortLabel } from '../utils/filterLabels';

const NON_KITSU_KEYS = [
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
  'malGenres',
  'malExcludeGenres',
  'malScoreMin',
  'malScoreMax',
  'malOrderBy',
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
export const KITSU_SOURCE = {
  id: 'kitsu',
  label: 'Kitsu',
  supportedTypes: ['movie', 'series', 'anime'],
  defaultSortBy: '-averageRating',

  defaultFilters: {
    genres: [],
    excludeGenres: [],
    kitsuListType: 'browse',
    kitsuSort: '-averageRating',
    kitsuSubtype: [],
    kitsuStatus: [],
    kitsuAgeRating: [],
    kitsuCategories: [],
    kitsuExcludeCategories: [],
  },

  movieOnlyFilterKeys: [],
  seriesOnlyFilterKeys: ['kitsuSeason', 'kitsuSeasonYear'],

  cleanFiltersOnSwitch(currentFilters) {
    const result = { ...currentFilters };
    for (const key of NON_KITSU_KEYS) {
      delete result[key];
    }
    return result;
  },

  computeActiveChips(filters, refData) {
    const {
      kitsuSortOptions = [],
      kitsuSubtypes = [],
      kitsuStatuses = [],
      kitsuAgeRatings = [],
      kitsuCategories = [],
    } = refData;
    const active = [];

    if (filters.kitsuListType === 'trending') {
      active.push({
        key: 'kitsuListType',
        label: 'Trending',
        section: 'filters',
      });
    }

    if (filters.kitsuSort && filters.kitsuSort !== '-averageRating') {
      active.push({
        key: 'kitsuSort',
        label: `Sort: ${resolveSortLabel(kitsuSortOptions, filters.kitsuSort)}`,
        section: 'filters',
      });
    }

    if (filters.kitsuCategories?.length > 0) {
      const names = filters.kitsuCategories.slice(0, 2).map((slug) => {
        const match = kitsuCategories.find((c) => c.slug === slug);
        return match?.title || slug;
      });
      const extra =
        filters.kitsuCategories.length > 2 ? ` +${filters.kitsuCategories.length - 2}` : '';
      active.push({
        key: 'kitsuCategories',
        label: `Categories: ${names.join(', ')}${extra}`,
        section: 'genres',
      });
    }

    if (filters.kitsuExcludeCategories?.length > 0) {
      const names = filters.kitsuExcludeCategories.slice(0, 2).map((slug) => {
        const match = kitsuCategories.find((c) => c.slug === slug);
        return match?.title || slug;
      });
      const extra =
        filters.kitsuExcludeCategories.length > 2
          ? ` +${filters.kitsuExcludeCategories.length - 2}`
          : '';
      active.push({
        key: 'kitsuExcludeCategories',
        label: `Exclude: ${names.join(', ')}${extra}`,
        section: 'genres',
      });
    }

    if (filters.kitsuSubtype?.length > 0) {
      const names = filters.kitsuSubtype.map((v) => resolveOptionLabel(kitsuSubtypes, v));
      active.push({
        key: 'kitsuSubtype',
        label: `Type: ${names.join(', ')}`,
        section: 'format',
      });
    }

    if (filters.kitsuStatus?.length > 0) {
      const names = filters.kitsuStatus.map((v) => resolveOptionLabel(kitsuStatuses, v));
      active.push({
        key: 'kitsuStatus',
        label: `Status: ${names.join(', ')}`,
        section: 'format',
      });
    }

    if (filters.kitsuAgeRating?.length > 0) {
      const names = filters.kitsuAgeRating.map((v) => resolveOptionLabel(kitsuAgeRatings, v));
      active.push({
        key: 'kitsuAgeRating',
        label: `Rating: ${names.join(', ')}`,
        section: 'format',
      });
    }

    if (filters.kitsuSeason && filters.kitsuSeasonYear) {
      active.push({
        key: 'kitsuSeason',
        label: `Season: ${filters.kitsuSeason} ${filters.kitsuSeasonYear}`,
        section: 'season',
      });
    }

    if (filters.randomize) {
      active.push({ key: 'randomize', label: 'Randomize', section: 'options' });
    }

    return active;
  },

  FilterPanelComponent: lazy(() =>
    import('../components/config/catalog/sources/kitsu/KitsuFilterPanel').then((m) => ({
      default: m.KitsuFilterPanel,
    }))
  ),
};
