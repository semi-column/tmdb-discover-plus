import { lazy } from 'react';

const NON_ANILIST_KEYS = [
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
  'simklSort',
  'simklBestFilter',
  'simklYear',
  'simklNetwork',
];

/** @implements {import('./types').SourceDescriptor} */
export const ANILIST_SOURCE = {
  id: 'anilist',
  label: 'AniList',
  defaultSortBy: 'TRENDING_DESC',

  defaultFilters: {
    genres: [],
    excludeGenres: [],
    sortBy: 'TRENDING_DESC',
  },

  movieOnlyFilterKeys: [],
  seriesOnlyFilterKeys: ['season', 'seasonYear'],

  cleanFiltersOnSwitch(currentFilters) {
    const result = { ...currentFilters };
    for (const key of NON_ANILIST_KEYS) {
      delete result[key];
    }
    return result;
  },

  computeActiveChips(filters, refData) {
    const { anilistSortOptions = [], anilistFormatOptions = [] } = refData;

    const active = [];

    if (filters.sortBy && filters.sortBy !== 'TRENDING_DESC') {
      const match = anilistSortOptions.find((s) => s.value === filters.sortBy);
      active.push({
        key: 'sortBy',
        label: `Sort: ${match?.label || filters.sortBy}`,
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

    if (filters.format?.length > 0) {
      const labels = filters.format
        .map((f) => anilistFormatOptions.find((o) => o.value === f)?.label || f)
        .join(', ');
      active.push({ key: 'format', label: `Format: ${labels}`, section: 'filters' });
    }

    if (filters.status?.length > 0) {
      active.push({
        key: 'status',
        label: `Status: ${filters.status.length} selected`,
        section: 'filters',
      });
    }

    if (filters.season) {
      const label = `${filters.season}${filters.seasonYear ? ' ' + filters.seasonYear : ''}`;
      active.push({ key: 'season', label: `Season: ${label}`, section: 'season' });
    }

    if (filters.tags?.length > 0) {
      const names = filters.tags.slice(0, 2);
      const extra = filters.tags.length > 2 ? ` +${filters.tags.length - 2}` : '';
      active.push({ key: 'tags', label: `Tags: ${names.join(', ')}${extra}`, section: 'tags' });
    }

    if (
      filters.averageScoreMin > 0 ||
      (filters.averageScoreMax != null && filters.averageScoreMax < 100)
    ) {
      active.push({
        key: 'averageScore',
        label: `Score: ${filters.averageScoreMin || 0}–${filters.averageScoreMax ?? 100}`,
        section: 'filters',
      });
    }

    if (filters.countryOfOrigin) {
      active.push({
        key: 'countryOfOrigin',
        label: `Country: ${filters.countryOfOrigin}`,
        section: 'filters',
      });
    }

    if (filters.sourceMaterial?.length > 0) {
      active.push({
        key: 'sourceMaterial',
        label: `Source: ${filters.sourceMaterial.length} selected`,
        section: 'filters',
      });
    }

    if (filters.isAdult) {
      active.push({ key: 'isAdult', label: 'Adult content', section: 'options' });
    }

    if (filters.randomize) {
      active.push({ key: 'randomize', label: 'Randomized', section: 'options' });
    }

    return active;
  },

  FilterPanelComponent: lazy(() =>
    import('../components/config/catalog/sources/anilist/AnilistFilterPanel').then((m) => ({
      default: m.AnilistFilterPanel,
    }))
  ),
};
