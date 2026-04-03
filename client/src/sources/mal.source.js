import { lazy } from 'react';

const NON_MAL_KEYS = [
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
  defaultSortBy: 'all',

  defaultFilters: {
    genres: [],
    excludeGenres: [],
    malRankingType: 'all',
  },

  movieOnlyFilterKeys: [],
  seriesOnlyFilterKeys: [],

  cleanFiltersOnSwitch(currentFilters) {
    const result = { ...currentFilters };
    for (const key of NON_MAL_KEYS) {
      delete result[key];
    }
    return result;
  },

  computeActiveChips(filters, refData) {
    const { malRankingTypes = [], malSortOptions = [] } = refData;
    const active = [];

    if (filters.malRankingType && filters.malRankingType !== 'all') {
      const match = malRankingTypes.find((r) => r.value === filters.malRankingType);
      active.push({
        key: 'malRankingType',
        label: `Ranking: ${match?.label || filters.malRankingType}`,
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

    if (filters.genres?.length > 0) {
      const names = filters.genres.slice(0, 2).map((g) => {
        if (typeof g === 'object' && g.name) return g.name;
        return String(g);
      });
      const extra = filters.genres.length > 2 ? ` +${filters.genres.length - 2}` : '';
      active.push({
        key: 'genres',
        label: `Genres: ${names.join(', ')}${extra}`,
        section: 'genres',
      });
    }

    if (filters.malSort) {
      const match = malSortOptions.find((s) => s.value === filters.malSort);
      active.push({
        key: 'malSort',
        label: `Sort: ${match?.label || filters.malSort}`,
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
