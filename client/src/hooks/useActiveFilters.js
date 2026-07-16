import { useCallback, useMemo } from 'react';
import { DATE_PRESETS } from '../constants/datePresets';
import { getSource } from '../sources/index';
import {
  humanizeFilterValue,
  humanizeSortValue,
  resolveOptionLabel,
  resolveSortLabel,
} from '../utils/filterLabels';
import {
  formatTraktCalendarWindowLabel,
  normalizeTraktListType,
  supportsTraktCalendarSettings,
  supportsTraktPeriod,
} from '../sources/traktCapabilities';

const KITSU_SORT_LABELS = {
  '-averageRating': 'Highest Rated',
  '-userCount': 'Most Popular',
  '-favoritesCount': 'Most Favorited',
  '-startDate': 'Newest',
  startDate: 'Oldest',
  '-episodeCount': 'Most Episodes',
};

const KITSU_SUBTYPE_LABELS = {
  TV: 'TV',
  movie: 'Movie',
  OVA: 'OVA',
  ONA: 'ONA',
  special: 'Special',
  music: 'Music',
};

const KITSU_STATUS_LABELS = {
  current: 'Currently Airing',
  finished: 'Finished',
  tba: 'TBA',
  unreleased: 'Unreleased',
  upcoming: 'Upcoming',
};

const KITSU_AGE_RATING_LABELS = {
  G: 'G - All Ages',
  PG: 'PG - Children',
  R: 'R - 17+',
};

const KITSU_CATEGORY_LABELS = {
  action: 'Action',
  adventure: 'Adventure',
  comedy: 'Comedy',
  drama: 'Drama',
  'sci-fi': 'Sci-Fi',
  space: 'Space',
  mystery: 'Mystery',
  magic: 'Magic',
  supernatural: 'Supernatural',
  fantasy: 'Fantasy',
  sports: 'Sports',
  romance: 'Romance',
  'slice-of-life': 'Slice of Life',
  horror: 'Horror',
  psychological: 'Psychological',
  thriller: 'Thriller',
  'martial-arts': 'Martial Arts',
  'super-power': 'Super Power',
  school: 'School',
  ecchi: 'Ecchi',
  historical: 'Historical',
  military: 'Military',
  mecha: 'Mecha',
  demons: 'Demons',
  harem: 'Harem',
  music: 'Music',
  shounen: 'Shounen',
  shoujo: 'Shoujo',
  seinen: 'Seinen',
  josei: 'Josei',
  isekai: 'Isekai',
  kids: 'Kids',
  parody: 'Parody',
};

const DATE_TAG_LABELS = {
  today: 'Today',
  'today-30d': 'Today − 30d',
  'today-90d': 'Today − 90d',
  'today-6mo': 'Today − 6mo',
  'today-12mo': 'Today − 12mo',
  'today+30d': 'Today + 30d',
  'today+3mo': 'Today + 3mo',
};

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
  selectedImdbExcludeCompanies,
  setSelectedImdbExcludeCompanies,
  imdbSortOptions = [],
  anilistSortOptions = [],
  anilistFormatOptions = [],
  anilistStatusOptions = [],
  anilistSeasonOptions = [],
  anilistSourceOptions = [],
  anilistCountryOptions = [],
  malRankingTypes = [],
  malSortOptions = [],
  simklListTypes = [],
  simklTrendingPeriods = [],
  simklBestFilters = [],
  simklSortOptions = [],
  simklAnimeTypes = [],
  traktListTypes = [],
  traktCalendarTypes = [],
  traktCommunityMetrics = [],
  traktNetworks = [],
}) {
  const isImdbSource = localCatalog?.source === 'imdb';
  const isAnilistSource = localCatalog?.source === 'anilist';
  const isCollectionCatalog = localCatalog?.type === 'collection';
  const isStudioCollection = isCollectionCatalog && localCatalog?.filters?.listType === 'studio';

  const update = useCallback(
    (patch) => setLocalCatalog((prev) => ({ ...prev, filters: { ...prev.filters, ...patch } })),
    [setLocalCatalog]
  );

  // Single source of truth: one descriptor per filter key, covering both how a chip is built
  // (isActive/label/section) and how it's cleared (clear). `build()` filters+maps over this list;
  // `clearFilter()` looks a key up in it. Every filter key is declared exactly once.
  const filterDescriptors = useMemo(() => {
    const isMovieType = localCatalog?.type === 'movie';
    const source = localCatalog?.source;
    const isImdb = source === 'imdb';
    const isAnilist = source === 'anilist';
    const isTmdb = !source || source === 'tmdb';
    const imdbSortDefault = 'POPULARITY';
    const effectiveTmdbType = localCatalog?.type === 'collection' ? 'movie' : localCatalog?.type;
    const tmdbSortDefault =
      localCatalog?.type === 'collection'
        ? localCatalog?.filters?.listType === 'studio'
          ? undefined
          : 'collection_order'
        : 'popularity.desc';
    const anilistSortDefault = 'TRENDING_DESC';
    const sortOpts = sortOptions[effectiveTmdbType] || sortOptions.movie || [];

    const getOptionLabel = (options, value, valueKey = 'value', labelKey = 'label') =>
      resolveOptionLabel(options, value, {
        valueKey,
        labelKey,
        fallbackFormatter: humanizeFilterValue,
      });

    const getLabelSummary = (options, values, valueKey = 'value', labelKey = 'label') => {
      const labels = values.map((value) => getOptionLabel(options, value, valueKey, labelKey));
      const shown = labels.slice(0, 2).join(', ');
      const extra = labels.length > 2 ? ` +${labels.length - 2}` : '';
      return `${shown}${extra}`;
    };

    const toTitleCase = (value) => {
      if (typeof value !== 'string' || !value.length) return value;
      return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
    };

    const isImdbExcludeCompaniesActive = () => isImdb && selectedImdbExcludeCompanies?.length > 0;
    const isImdbKeywordsActive = (filters) => isImdb && filters.keywords?.length > 0;
    const isImdbExcludeKeywordsActive = (filters) => isImdb && filters.excludeKeywords?.length > 0;

    return [
      {
        key: 'sortBy',
        isActive: (filters) => {
          if (isImdb) return !!(filters.sortBy && filters.sortBy !== imdbSortDefault);
          if (isAnilist) return !!(filters.sortBy && filters.sortBy !== anilistSortDefault);
          if (isTmdb && filters.sortBy && String(filters.sortBy) !== tmdbSortDefault) {
            const hasKnownSort = sortOpts.some(
              (option) => option?.value === String(filters.sortBy)
            );
            return sortOpts.length === 0 || hasKnownSort;
          }
          return false;
        },
        label: (filters) => {
          if (isImdb) return `Sort: ${resolveSortLabel(imdbSortOptions, filters.sortBy)}`;
          if (isAnilist) return `Sort: ${resolveSortLabel(anilistSortOptions, filters.sortBy)}`;
          return `Sort: ${resolveSortLabel(sortOpts, filters.sortBy)}`;
        },
        section: 'filters',
        clear: () =>
          update(
            isImdbSource
              ? { sortBy: 'POPULARITY', sortOrder: 'DESC' }
              : isAnilistSource
                ? { sortBy: 'TRENDING_DESC' }
                : isCollectionCatalog
                  ? { sortBy: isStudioCollection ? undefined : 'collection_order' }
                  : { sortBy: 'popularity.desc' }
          ),
      },
      {
        key: 'genres',
        isActive: (filters) => filters.genres?.length > 0,
        label: (filters) => {
          const genreNames = filters.genres
            .map((id) => {
              const genre = (genres[localCatalog?.type] || []).find((g) => g.id === id);
              return genre?.name || id;
            })
            .slice(0, 2);
          const extra = filters.genres.length > 2 ? ` +${filters.genres.length - 2}` : '';
          return `Genres: ${genreNames.join(', ')}${extra}`;
        },
        section: 'genres',
        clear: () => update({ genres: [] }),
      },
      {
        key: 'excludeGenres',
        isActive: (filters) => filters.excludeGenres?.length > 0,
        label: (filters) => {
          const excNames = filters.excludeGenres
            .map((id) => {
              const genre = (genres[localCatalog?.type] || []).find((g) => g.id === id);
              return genre?.name || id;
            })
            .slice(0, 2);
          const extra =
            filters.excludeGenres.length > 2 ? ` +${filters.excludeGenres.length - 2}` : '';
          return `Exclude: ${excNames.join(', ')}${extra}`;
        },
        section: 'genres',
        clear: () => update({ excludeGenres: [] }),
      },
      // Cleared via UI elsewhere but never surfaced as its own chip (matches prior behavior).
      {
        key: 'genreMatchMode',
        isActive: () => false,
        label: () => '',
        section: 'genres',
        clear: () => update({ genreMatchMode: 'any' }),
      },
      {
        key: 'language',
        isActive: (filters) => !!filters.language,
        label: (filters) => {
          const lang = originalLanguages.find((l) => l.iso_639_1 === filters.language);
          return `Language: ${lang?.english_name || filters.language}`;
        },
        section: 'filters',
        clear: () => update({ language: undefined }),
      },
      {
        key: 'countries',
        isActive: (filters) => {
          if (!filters.countries) return false;
          const countriesArr = Array.isArray(filters.countries)
            ? filters.countries
            : String(filters.countries).split(',').filter(Boolean);
          return countriesArr.length > 0;
        },
        label: (filters) => {
          const countriesArr = Array.isArray(filters.countries)
            ? filters.countries
            : String(filters.countries).split(',').filter(Boolean);
          const countryNames = countriesArr
            .map((code) => countries.find((c) => c.iso_3166_1 === code)?.english_name || code)
            .slice(0, 2);
          const extra = countriesArr.length > 2 ? ` +${countriesArr.length - 2}` : '';
          return `Country: ${countryNames.join(', ')}${extra}`;
        },
        section: 'filters',
        clear: () => update({ countries: [] }),
      },
      {
        key: 'imdbCountries',
        isActive: (filters) => filters.imdbCountries?.length > 0,
        label: (filters) => {
          const countryNames = filters.imdbCountries
            .map((code) => {
              const country = countries.find((c) => c.iso_3166_1 === code);
              return country?.english_name || code;
            })
            .slice(0, 2);
          const extra =
            filters.imdbCountries.length > 2 ? ` +${filters.imdbCountries.length - 2}` : '';
          return `IMDb Countries: ${countryNames.join(', ')}${extra}`;
        },
        section: 'region',
        clear: () => update({ imdbCountries: [] }),
      },
      {
        key: 'year',
        isActive: (filters) => !!(filters.yearFrom || filters.yearTo),
        label: (filters) => {
          const from = filters.yearFrom || 'Any';
          const to = filters.yearTo || 'Now';
          return `Year: ${from}–${to}`;
        },
        section: 'filters',
        clear: () => update({ yearFrom: undefined, yearTo: undefined }),
      },
      {
        key: 'rating',
        isActive: (filters) =>
          filters.ratingMin > 0 || (filters.ratingMax != null && filters.ratingMax < 10),
        label: (filters) => `Rating: ${filters.ratingMin || 0}–${filters.ratingMax ?? 10}`,
        section: 'filters',
        clear: () => update({ ratingMin: 0, ratingMax: 10 }),
      },
      {
        key: 'runtime',
        isActive: (filters) => !!(filters.runtimeMin || filters.runtimeMax),
        label: (filters) => `Runtime: ${filters.runtimeMin || 0}–${filters.runtimeMax || '∞'}min`,
        section: 'filters',
        clear: () => update({ runtimeMin: undefined, runtimeMax: undefined }),
      },
      {
        key: 'voteCountMin',
        isActive: (filters) => filters.voteCountMin > 0,
        label: (filters) => `Min votes: ${filters.voteCountMin.toLocaleString()}`,
        section: 'filters',
        clear: () => update({ voteCountMin: 0 }),
      },
      {
        key: 'datePreset',
        isActive: (filters) => !!filters.datePreset,
        label: (filters) => {
          const presetMatch = DATE_PRESETS.find((p) => p.value === filters.datePreset);
          return `Date: ${presetMatch ? presetMatch.label : filters.datePreset}`;
        },
        section: 'release',
        clear: () =>
          update({
            datePreset: undefined,
            releaseDateFrom: undefined,
            releaseDateTo: undefined,
            airDateFrom: undefined,
            airDateTo: undefined,
          }),
      },
      {
        key: 'releaseDate',
        isActive: (filters) =>
          !filters.datePreset &&
          !filters.lastXYears &&
          !!(
            filters.releaseDateFrom ||
            filters.releaseDateTo ||
            filters.airDateFrom ||
            filters.airDateTo
          ),
        label: (filters) => {
          const rawFrom = filters.releaseDateFrom || filters.airDateFrom || '…';
          const rawTo = filters.releaseDateTo || filters.airDateTo || '…';
          const from = DATE_TAG_LABELS[rawFrom] || rawFrom;
          const to = DATE_TAG_LABELS[rawTo] || rawTo;
          return `${isMovieType ? 'Release' : 'Air'}: ${from} – ${to}`;
        },
        section: 'release',
        clear: () =>
          update({
            releaseDateFrom: undefined,
            releaseDateTo: undefined,
            airDateFrom: undefined,
            airDateTo: undefined,
          }),
      },
      {
        key: 'firstAirDate',
        isActive: (filters) =>
          !isMovieType && !!(filters.firstAirDateFrom || filters.firstAirDateTo),
        label: (filters) =>
          `Premiered: ${filters.firstAirDateFrom || '…'} – ${filters.firstAirDateTo || '…'}`,
        section: 'release',
        clear: () => update({ firstAirDateFrom: undefined, firstAirDateTo: undefined }),
      },
      {
        key: 'firstAirDateYear',
        isActive: (filters) => !!filters.firstAirDateYear,
        label: (filters) => `First air year: ${filters.firstAirDateYear}`,
        section: 'release',
        clear: () => update({ firstAirDateYear: undefined }),
      },
      {
        key: 'primaryReleaseYear',
        isActive: (filters) => !!filters.primaryReleaseYear,
        label: (filters) => `Release year: ${filters.primaryReleaseYear}`,
        section: 'release',
        clear: () => update({ primaryReleaseYear: undefined }),
      },
      {
        key: 'region',
        isActive: (filters) => !!filters.region,
        label: (filters) => {
          const regionLabel =
            countries.find((c) => c.iso_3166_1 === filters.region)?.english_name || filters.region;
          return `${isMovieType ? 'Release region' : 'Regional appearance'}: ${regionLabel}`;
        },
        section: 'release',
        clear: () => update({ region: undefined, releaseTypes: [] }),
      },
      {
        key: 'releaseTypes',
        isActive: (filters) => filters.releaseTypes?.length > 0,
        label: (filters) =>
          `${filters.releaseTypes.length} ${isMovieType ? 'release type(s)' : 'regional type(s)'}`,
        section: 'release',
        clear: () => update({ releaseTypes: [] }),
      },
      {
        key: 'certifications',
        isActive: (filters) => filters.certifications?.length > 0,
        label: (filters) => `Rating: ${filters.certifications.join(', ')}`,
        section: 'release',
        clear: () => update({ certifications: [] }),
      },
      {
        key: 'certificationRange',
        isActive: (filters) => !!(filters.certificationMin || filters.certificationMax),
        label: (filters) =>
          `Age range: ${filters.certificationMin || 'Any'}–${filters.certificationMax || 'Any'}`,
        section: 'release',
        clear: () => update({ certificationMin: undefined, certificationMax: undefined }),
      },
      {
        key: 'certificationCountry',
        isActive: (filters) =>
          !!filters.certificationCountry && filters.certificationCountry !== 'US',
        label: (filters) => {
          const certCountryLabel =
            countries.find((c) => c.iso_3166_1 === filters.certificationCountry)?.english_name ||
            filters.certificationCountry;
          return `Rating country: ${certCountryLabel}`;
        },
        section: 'release',
        clear: () => update({ certificationCountry: undefined }),
      },
      {
        key: 'timezone',
        isActive: (filters) => !!filters.timezone,
        label: (filters) => `Timezone: ${filters.timezone}`,
        section: 'release',
        clear: () => update({ timezone: undefined }),
      },
      {
        key: 'tvStatus',
        isActive: (filters) => !isMovieType && !!filters.tvStatus,
        label: (filters) => `Status: ${resolveOptionLabel(tvStatuses, filters.tvStatus)}`,
        section: 'release',
        clear: () => update({ tvStatus: undefined }),
      },
      {
        key: 'tvType',
        isActive: (filters) => !isMovieType && !!filters.tvType,
        label: (filters) => `Type: ${resolveOptionLabel(tvTypes, filters.tvType)}`,
        section: 'release',
        clear: () => update({ tvType: undefined }),
      },
      {
        key: 'watchRegion',
        isActive: (filters) => !!filters.watchRegion,
        label: (filters) => {
          const regionLabel =
            watchRegions.find((r) => r.iso_3166_1 === filters.watchRegion)?.english_name ||
            filters.watchRegion;
          return `Stream region: ${regionLabel}`;
        },
        section: 'streaming',
        clear: () => update({ watchRegion: undefined }),
      },
      {
        key: 'watchProviders',
        isActive: (filters) => filters.watchProviders?.length > 0,
        label: (filters) => `${filters.watchProviders.length} streaming service(s)`,
        section: 'streaming',
        clear: () => update({ watchProviders: [] }),
      },
      {
        key: 'watchMonetizationTypes',
        isActive: (filters) => filters.watchMonetizationTypes?.length > 0,
        label: (filters) => {
          const labels = filters.watchMonetizationTypes
            .map((v) => monetizationTypes.find((m) => m.value === v)?.label || v)
            .join(', ');
          return `Monetization: ${labels}`;
        },
        section: 'streaming',
        clear: () => update({ watchMonetizationTypes: undefined }),
      },
      {
        key: 'withNetworks',
        isActive: (filters) => !!filters.withNetworks,
        label: (filters) => {
          const count = filters.withNetworks.split('|').filter(Boolean).length;
          return `${count} network(s)`;
        },
        section: 'streaming',
        clear: () => update({ withNetworks: undefined }),
      },
      {
        key: 'people',
        isActive: () => selectedPeople.length > 0,
        label: () => {
          const names = selectedPeople.slice(0, 2).map((p) => p.name);
          const extra = selectedPeople.length > 2 ? ` +${selectedPeople.length - 2}` : '';
          return `Cast/Crew: ${names.join(', ')}${extra}`;
        },
        section: 'people',
        clear: () => setSelectedPeople([]),
      },
      {
        key: 'companies',
        isActive: () => selectedCompanies.length > 0,
        label: () => {
          const names = selectedCompanies.slice(0, 2).map((c) => c.name);
          const extra = selectedCompanies.length > 2 ? ` +${selectedCompanies.length - 2}` : '';
          return `Studio: ${names.join(', ')}${extra}`;
        },
        section: 'people',
        clear: () => setSelectedCompanies([]),
      },
      {
        key: 'imdbExcludeCompanies',
        isActive: () => isImdbExcludeCompaniesActive(),
        label: () => `Exclude IMDb studios: ${selectedImdbExcludeCompanies.length}`,
        section: 'people',
        clear: () => {
          update({ excludeCompanies: [] });
          if (setSelectedImdbExcludeCompanies) setSelectedImdbExcludeCompanies([]);
        },
      },
      {
        key: 'excludeCompanies',
        isActive: () => !isImdbExcludeCompaniesActive() && excludeCompanies.length > 0,
        label: () => `Exclude ${excludeCompanies.length} studio(s)`,
        section: 'people',
        clear: () => setExcludeCompanies([]),
      },
      {
        key: 'keywords',
        isActive: (filters) => isImdbKeywordsActive(filters) || selectedKeywords.length > 0,
        label: (filters) => {
          if (isImdbKeywordsActive(filters)) {
            const names = filters.keywords.slice(0, 2);
            const extra = filters.keywords.length > 2 ? ` +${filters.keywords.length - 2}` : '';
            return `Keywords: ${names.join(', ')}${extra}`;
          }
          const names = selectedKeywords.slice(0, 2).map((k) => k.name);
          const extra = selectedKeywords.length > 2 ? ` +${selectedKeywords.length - 2}` : '';
          return `Keywords: ${names.join(', ')}${extra}`;
        },
        section: (filters) => (isImdbKeywordsActive(filters) ? 'keywords' : 'people'),
        clear: () => {
          if (isImdbSource) update({ keywords: [] });
          setSelectedKeywords([]);
        },
      },
      {
        key: 'excludeKeywords',
        isActive: (filters) => isImdbExcludeKeywordsActive(filters) || excludeKeywords.length > 0,
        label: (filters) => {
          if (isImdbExcludeKeywordsActive(filters)) {
            const names = filters.excludeKeywords.slice(0, 2);
            const extra =
              filters.excludeKeywords.length > 2 ? ` +${filters.excludeKeywords.length - 2}` : '';
            return `Exclude: ${names.join(', ')}${extra}`;
          }
          return `Exclude ${excludeKeywords.length} keyword(s)`;
        },
        section: (filters) => (isImdbExcludeKeywordsActive(filters) ? 'keywords' : 'people'),
        clear: () => {
          if (isImdbSource) update({ excludeKeywords: [] });
          setExcludeKeywords([]);
        },
      },
      {
        key: 'includeAdult',
        isActive: (filters) => !!filters.includeAdult,
        label: () => 'Adult content',
        section: 'options',
        clear: () => update({ includeAdult: undefined }),
      },
      {
        key: 'includeVideo',
        isActive: (filters) => !!filters.includeVideo,
        label: () => 'Include video',
        section: 'options',
        clear: () => update({ includeVideo: undefined }),
      },
      {
        key: 'randomize',
        isActive: (filters) => !!filters.randomize,
        label: () => 'Randomized',
        section: 'options',
        clear: () => update({ randomize: undefined }),
      },
      {
        key: 'discoverOnly',
        isActive: (filters) => !!filters.discoverOnly,
        label: () => 'Discover only',
        section: 'options',
        clear: () => update({ discoverOnly: undefined }),
      },
      {
        key: 'includeNullFirstAirDates',
        isActive: (filters) => !!filters.includeNullFirstAirDates,
        label: () => 'Unknown air dates',
        section: 'options',
        clear: () => update({ includeNullFirstAirDates: undefined }),
      },
      {
        key: 'screenedTheatrically',
        isActive: (filters) => !!filters.screenedTheatrically,
        label: () => 'Screened theatrically',
        section: 'options',
        clear: () => update({ screenedTheatrically: undefined }),
      },
      {
        key: 'releasedOnly',
        isActive: (filters) => !!filters.releasedOnly,
        label: () => 'Released only',
        section: 'release',
        clear: () => update({ releasedOnly: undefined }),
      },
      {
        key: 'lastXYears',
        isActive: (filters) => !!filters.lastXYears,
        label: (filters) => `Last ${filters.lastXYears} years`,
        section: 'release',
        clear: () =>
          update({
            lastXYears: undefined,
            releaseDateFrom: undefined,
            releaseDateTo: undefined,
            airDateFrom: undefined,
            airDateTo: undefined,
          }),
      },
      {
        key: 'creditedNames',
        isActive: (filters) => filters.creditedNames?.length > 0,
        label: (filters) => `IMDb People: ${filters.creditedNames.length}`,
        section: 'people',
        clear: () => update({ creditedNames: [] }),
      },
      {
        key: 'imdbCompanies',
        isActive: (filters) => filters.companies?.length > 0 && isImdb,
        label: (filters) => `IMDb Studios: ${filters.companies.length}`,
        section: 'people',
        clear: () => update({ companies: [] }),
      },
      {
        key: 'inTheaters',
        isActive: (filters) => !!filters.inTheatersLat,
        label: () => 'In Theatres',
        section: 'theatres',
        clear: () =>
          update({
            inTheatersLat: undefined,
            inTheatersLong: undefined,
            inTheatersRadius: undefined,
          }),
      },
      {
        key: 'imdbCertificates',
        isActive: (filters) => filters.certificates?.length > 0,
        label: (filters) => `Certificates: ${filters.certificates.length}`,
        section: 'certificates',
        clear: () => update({ certificates: [], certificateCountry: undefined }),
      },
      {
        key: 'rankedLists',
        isActive: (filters) => filters.rankedLists?.length > 0,
        label: (filters) => `Ranked Lists: ${filters.rankedLists.length}`,
        section: 'rankedLists',
        clear: () => update({ rankedLists: [] }),
      },
      {
        key: 'excludeRankedLists',
        isActive: (filters) => filters.excludeRankedLists?.length > 0,
        label: (filters) => `Exclude Lists: ${filters.excludeRankedLists.length}`,
        section: 'rankedLists',
        clear: () => update({ excludeRankedLists: [] }),
      },
      {
        key: 'explicitContent',
        isActive: (filters) => !!filters.explicitContent,
        label: (filters) => `Explicit: ${filters.explicitContent}`,
        section: 'advanced',
        clear: () => update({ explicitContent: undefined }),
      },
      {
        key: 'plot',
        isActive: (filters) => !!filters.plot,
        label: (filters) => `Plot: "${filters.plot}"`,
        section: 'textSearch',
        clear: () => update({ plot: undefined }),
      },
      {
        key: 'filmingLocations',
        isActive: (filters) => !!filters.filmingLocations,
        label: (filters) => `Filmed in: "${filters.filmingLocations}"`,
        section: 'textSearch',
        clear: () => update({ filmingLocations: undefined }),
      },
      {
        key: 'withData',
        isActive: (filters) => filters.withData?.length > 0,
        label: (filters) => `Must have: ${filters.withData.length} data type(s)`,
        section: 'advanced',
        clear: () => update({ withData: [] }),
      },

      // --- AniList specific ---
      {
        key: 'format',
        isActive: (filters) => isAnilist && filters.format?.length > 0,
        label: (filters) => `Format: ${getLabelSummary(anilistFormatOptions, filters.format)}`,
        section: 'filters',
        clear: () => update({ format: [] }),
      },
      {
        key: 'status',
        isActive: (filters) => isAnilist && filters.status?.length > 0,
        label: (filters) => `Status: ${getLabelSummary(anilistStatusOptions, filters.status)}`,
        section: 'filters',
        clear: () => update({ status: [] }),
      },
      {
        key: 'season',
        isActive: (filters) => isAnilist && !!filters.season,
        label: (filters) => `Season: ${getOptionLabel(anilistSeasonOptions, filters.season)}`,
        section: 'filters',
        clear: () => update({ season: undefined }),
      },
      {
        key: 'seasonYear',
        isActive: (filters) => isAnilist && !!filters.seasonYear,
        label: (filters) => `Year: ${filters.seasonYear}`,
        section: 'filters',
        clear: () => update({ seasonYear: undefined }),
      },
      {
        key: 'popularityMin',
        isActive: (filters) => isAnilist && filters.popularityMin > 0,
        label: (filters) => `Min popularity: ${filters.popularityMin.toLocaleString()}`,
        section: 'filters',
        clear: () => update({ popularityMin: undefined }),
      },
      {
        key: 'averageScore',
        isActive: (filters) =>
          isAnilist && (filters.averageScoreMin > 0 || filters.averageScoreMax < 100),
        label: (filters) =>
          `Score: ${filters.averageScoreMin || 0}-${filters.averageScoreMax || 100}`,
        section: 'filters',
        clear: () => update({ averageScoreMin: undefined, averageScoreMax: undefined }),
      },
      {
        key: 'countryOfOrigin',
        isActive: (filters) => isAnilist && !!filters.countryOfOrigin,
        label: (filters) =>
          `Country: ${getOptionLabel(anilistCountryOptions, filters.countryOfOrigin)}`,
        section: 'filters',
        clear: () => update({ countryOfOrigin: undefined }),
      },
      {
        key: 'sourceMaterial',
        isActive: (filters) => isAnilist && filters.sourceMaterial?.length > 0,
        label: (filters) =>
          `Source: ${getLabelSummary(anilistSourceOptions, filters.sourceMaterial)}`,
        section: 'filters',
        clear: () => update({ sourceMaterial: [] }),
      },
      {
        key: 'tags',
        isActive: (filters) => isAnilist && filters.tags?.length > 0,
        label: (filters) =>
          `Tags: ${filters.tags.slice(0, 2).join(', ')}${filters.tags.length > 2 ? ` +${filters.tags.length - 2}` : ''}`,
        section: 'filters',
        clear: () => update({ tags: undefined }),
      },
      {
        key: 'excludeTags',
        isActive: (filters) => isAnilist && filters.excludeTags?.length > 0,
        label: (filters) =>
          `Exclude tags: ${filters.excludeTags.slice(0, 2).join(', ')}${filters.excludeTags.length > 2 ? ` +${filters.excludeTags.length - 2}` : ''}`,
        section: 'filters',
        clear: () => update({ excludeTags: undefined }),
      },
      {
        key: 'episodes',
        isActive: (filters) => isAnilist && !!(filters.episodesMin || filters.episodesMax),
        label: (filters) => `Episodes: ${filters.episodesMin || 0}-${filters.episodesMax || '∞'}`,
        section: 'score',
        clear: () => update({ episodesMin: undefined, episodesMax: undefined }),
      },
      {
        key: 'duration',
        isActive: (filters) => isAnilist && !!(filters.durationMin || filters.durationMax),
        label: (filters) =>
          `Duration: ${filters.durationMin || 0}-${filters.durationMax || '∞'} min`,
        section: 'score',
        clear: () => update({ durationMin: undefined, durationMax: undefined }),
      },
      {
        key: 'isAdult',
        isActive: (filters) => isAnilist && !!filters.isAdult,
        label: () => 'Adult content',
        section: 'options',
        clear: () => update({ isAdult: undefined }),
      },

      // --- MAL specific ---
      {
        key: 'malRankingType',
        isActive: (filters) =>
          source === 'mal' && !!filters.malRankingType && filters.malRankingType !== 'all',
        label: (filters) => `Ranking: ${getOptionLabel(malRankingTypes, filters.malRankingType)}`,
        section: 'filters',
        clear: () => update({ malRankingType: undefined }),
      },
      {
        key: 'malSeason',
        isActive: (filters) => source === 'mal' && !!filters.malSeason,
        label: (filters) => `Season: ${toTitleCase(filters.malSeason)}`,
        section: 'filters',
        clear: () => update({ malSeason: undefined }),
      },
      {
        key: 'malSeasonYear',
        isActive: (filters) => source === 'mal' && !!filters.malSeasonYear,
        label: (filters) => `Year: ${filters.malSeasonYear}`,
        section: 'filters',
        clear: () => update({ malSeasonYear: undefined }),
      },
      {
        key: 'malSort',
        isActive: (filters) =>
          source === 'mal' && !!filters.malSort && filters.malSort !== 'anime_num_list_users',
        label: (filters) => `Sort: ${getOptionLabel(malSortOptions, filters.malSort)}`,
        section: 'filters',
        clear: () => update({ malSort: undefined }),
      },
      {
        key: 'malGenres',
        isActive: (filters) => source === 'mal' && filters.malGenres?.length > 0,
        label: (filters) => `Genres: ${filters.malGenres.length}`,
        section: 'genres',
        clear: () => update({ malGenres: [] }),
      },
      {
        key: 'malExcludeGenres',
        isActive: (filters) => source === 'mal' && filters.malExcludeGenres?.length > 0,
        label: (filters) => `Excluded: ${filters.malExcludeGenres.length}`,
        section: 'genres',
        clear: () => update({ malExcludeGenres: [] }),
      },
      {
        key: 'malMediaType',
        isActive: (filters) => source === 'mal' && filters.malMediaType?.length > 0,
        label: (filters) => `Type: ${filters.malMediaType.join(', ')}`,
        section: 'format',
        clear: () => update({ malMediaType: [] }),
      },
      {
        key: 'malStatus',
        isActive: (filters) => source === 'mal' && filters.malStatus?.length > 0,
        label: (filters) => `Status: ${filters.malStatus.join(', ')}`,
        section: 'format',
        clear: () => update({ malStatus: [] }),
      },
      {
        key: 'malRating',
        isActive: (filters) => source === 'mal' && !!filters.malRating,
        label: (filters) => `Rating: ${filters.malRating}`,
        section: 'format',
        clear: () => update({ malRating: undefined }),
      },
      {
        key: 'malScore',
        isActive: (filters) => source === 'mal' && !!(filters.malScoreMin || filters.malScoreMax),
        label: (filters) => `Score: ${filters.malScoreMin || 0}-${filters.malScoreMax || 10}`,
        section: 'score',
        clear: () => update({ malScoreMin: undefined, malScoreMax: undefined }),
      },
      {
        key: 'malOrderBy',
        isActive: (filters) => source === 'mal' && !!filters.malOrderBy,
        label: (filters) => `Order: ${filters.malOrderBy}`,
        section: 'score',
        clear: () => update({ malOrderBy: undefined }),
      },

      // --- Kitsu specific ---
      {
        key: 'kitsuListType',
        isActive: (filters) => source === 'kitsu' && filters.kitsuListType === 'trending',
        label: () => 'Trending',
        section: 'filters',
        clear: () => update({ kitsuListType: 'browse' }),
      },
      {
        key: 'kitsuSort',
        isActive: (filters) =>
          source === 'kitsu' &&
          !!filters.kitsuSort &&
          filters.kitsuSort !== '-averageRating' &&
          filters.kitsuListType !== 'trending',
        label: (filters) =>
          `Sort: ${KITSU_SORT_LABELS[filters.kitsuSort] || humanizeSortValue(filters.kitsuSort)}`,
        section: 'filters',
        clear: () => update({ kitsuSort: '-averageRating' }),
      },
      {
        key: 'kitsuCategories',
        isActive: (filters) => source === 'kitsu' && filters.kitsuCategories?.length > 0,
        label: (filters) => {
          const names = filters.kitsuCategories
            .slice(0, 2)
            .map((slug) => KITSU_CATEGORY_LABELS[slug] || slug);
          const extra =
            filters.kitsuCategories.length > 2 ? ` +${filters.kitsuCategories.length - 2}` : '';
          return `Categories: ${names.join(', ')}${extra}`;
        },
        section: 'genres',
        clear: () => update({ kitsuCategories: [] }),
      },
      {
        key: 'kitsuExcludeCategories',
        isActive: (filters) => source === 'kitsu' && filters.kitsuExcludeCategories?.length > 0,
        label: (filters) => {
          const names = filters.kitsuExcludeCategories
            .slice(0, 2)
            .map((slug) => KITSU_CATEGORY_LABELS[slug] || slug);
          const extra =
            filters.kitsuExcludeCategories.length > 2
              ? ` +${filters.kitsuExcludeCategories.length - 2}`
              : '';
          return `Exclude: ${names.join(', ')}${extra}`;
        },
        section: 'genres',
        clear: () => update({ kitsuExcludeCategories: [] }),
      },
      {
        key: 'kitsuSubtype',
        isActive: (filters) => source === 'kitsu' && filters.kitsuSubtype?.length > 0,
        label: (filters) => {
          const names = filters.kitsuSubtype.map((value) => KITSU_SUBTYPE_LABELS[value] || value);
          return `Type: ${names.join(', ')}`;
        },
        section: 'format',
        clear: () => update({ kitsuSubtype: [] }),
      },
      {
        key: 'kitsuStatus',
        isActive: (filters) => source === 'kitsu' && filters.kitsuStatus?.length > 0,
        label: (filters) => {
          const names = filters.kitsuStatus.map((value) => KITSU_STATUS_LABELS[value] || value);
          return `Status: ${names.join(', ')}`;
        },
        section: 'format',
        clear: () => update({ kitsuStatus: [] }),
      },
      {
        key: 'kitsuAgeRating',
        isActive: (filters) => source === 'kitsu' && filters.kitsuAgeRating?.length > 0,
        label: (filters) => {
          const names = filters.kitsuAgeRating.map(
            (value) => KITSU_AGE_RATING_LABELS[value] || value
          );
          return `Rating: ${names.join(', ')}`;
        },
        section: 'format',
        clear: () => update({ kitsuAgeRating: [] }),
      },
      {
        key: 'kitsuSeason',
        isActive: (filters) => source === 'kitsu' && !!filters.kitsuSeason,
        label: (filters) =>
          filters.kitsuSeasonYear
            ? `Season: ${toTitleCase(filters.kitsuSeason)} ${filters.kitsuSeasonYear}`
            : `Season: ${toTitleCase(filters.kitsuSeason)}`,
        section: 'season',
        clear: () => update({ kitsuSeason: undefined, kitsuSeasonYear: undefined }),
      },
      {
        key: 'kitsuSeasonYear',
        isActive: (filters) =>
          source === 'kitsu' && !filters.kitsuSeason && !!filters.kitsuSeasonYear,
        label: (filters) => `Year: ${filters.kitsuSeasonYear}`,
        section: 'season',
        clear: () => update({ kitsuSeasonYear: undefined }),
      },

      // --- Simkl specific ---
      {
        key: 'simklListType',
        isActive: (filters) =>
          source === 'simkl' && !!filters.simklListType && filters.simklListType !== 'trending',
        label: (filters) => `List: ${getOptionLabel(simklListTypes, filters.simklListType)}`,
        section: 'filters',
        clear: () => update({ simklListType: undefined }),
      },
      {
        key: 'simklTrendingPeriod',
        isActive: (filters) =>
          source === 'simkl' &&
          !!filters.simklTrendingPeriod &&
          filters.simklTrendingPeriod !== 'week',
        label: (filters) =>
          `Period: ${getOptionLabel(simklTrendingPeriods, filters.simklTrendingPeriod)}`,
        section: 'filters',
        clear: () => update({ simklTrendingPeriod: undefined }),
      },
      {
        key: 'simklBestFilter',
        isActive: (filters) =>
          source === 'simkl' && !!filters.simklBestFilter && filters.simklBestFilter !== 'all',
        label: (filters) => `Best: ${getOptionLabel(simklBestFilters, filters.simklBestFilter)}`,
        section: 'filters',
        clear: () => update({ simklBestFilter: undefined }),
      },
      {
        key: 'simklGenre',
        isActive: (filters) => source === 'simkl' && !!filters.simklGenre,
        label: (filters) => `Genre: ${filters.simklGenre}`,
        section: 'filters',
        clear: () => update({ simklGenre: undefined }),
      },
      {
        key: 'simklSort',
        isActive: (filters) =>
          source === 'simkl' && !!filters.simklSort && filters.simklSort !== 'rank',
        label: (filters) => `Sort: ${getOptionLabel(simklSortOptions, filters.simklSort)}`,
        section: 'filters',
        clear: () => update({ simklSort: undefined }),
      },
      {
        key: 'simklType',
        // Net effect of the original nested guards: only shown for non-movie catalogs.
        isActive: (filters) =>
          source === 'simkl' &&
          !!filters.simklType &&
          filters.simklType !== 'all' &&
          localCatalog?.type !== 'movie',
        label: (filters) => `Type: ${getOptionLabel(simklAnimeTypes, filters.simklType)}`,
        section: 'filters',
        clear: () => update({ simklType: undefined }),
      },

      // --- Trakt specific ---
      {
        key: 'traktListType',
        isActive: (filters) => {
          if (source !== 'trakt') return false;
          return normalizeTraktListType(filters.traktListType) !== 'calendar';
        },
        label: (filters) => {
          const listType = normalizeTraktListType(filters.traktListType);
          const allOptions = [...traktListTypes, ...traktCommunityMetrics];
          return `List: ${getOptionLabel(allOptions, listType)}`;
        },
        section: 'filters',
        clear: () =>
          update({
            traktListType: undefined,
            traktCalendarType: undefined,
            traktCalendarDays: undefined,
            traktCalendarStartDate: undefined,
            traktCalendarEndDate: undefined,
            traktCalendarSort: undefined,
          }),
      },
      {
        key: 'traktPeriod',
        isActive: (filters) => {
          if (source !== 'trakt') return false;
          const listType = normalizeTraktListType(filters.traktListType);
          return (
            supportsTraktPeriod(listType) &&
            !!filters.traktPeriod &&
            filters.traktPeriod !== 'weekly'
          );
        },
        label: (filters) => `Period: ${humanizeFilterValue(filters.traktPeriod)}`,
        section: 'filters',
        clear: () => update({ traktPeriod: undefined }),
      },
      {
        key: 'traktCalendarType',
        isActive: (filters) => {
          if (source !== 'trakt') return false;
          const listType = normalizeTraktListType(filters.traktListType);
          return supportsTraktCalendarSettings(listType) && !!filters.traktCalendarType;
        },
        label: (filters) =>
          `Feed: ${getOptionLabel(traktCalendarTypes, filters.traktCalendarType)}`,
        section: 'filters',
        clear: () => update({ traktCalendarType: undefined }),
      },
      {
        key: 'traktCalendarSort',
        isActive: (filters) => {
          if (source !== 'trakt') return false;
          const listType = normalizeTraktListType(filters.traktListType);
          const defaultCalendarSort = 'desc';
          return (
            supportsTraktCalendarSettings(listType) &&
            !!filters.traktCalendarSort &&
            filters.traktCalendarSort !== defaultCalendarSort
          );
        },
        label: (filters) =>
          `Date Order: ${filters.traktCalendarSort === 'desc' ? 'Descending' : 'Ascending'}`,
        section: 'filters',
        clear: () => update({ traktCalendarSort: undefined }),
      },
      {
        key: 'traktCalendarRange',
        isActive: (filters) => {
          if (source !== 'trakt') return false;
          const listType = normalizeTraktListType(filters.traktListType);
          return (
            supportsTraktCalendarSettings(listType) &&
            !!(filters.traktCalendarStartDate || filters.traktCalendarEndDate)
          );
        },
        label: (filters) =>
          `Range: ${filters.traktCalendarStartDate || '...'} to ${filters.traktCalendarEndDate || '...'}`,
        section: 'filters',
        clear: () => update({ traktCalendarStartDate: undefined, traktCalendarEndDate: undefined }),
      },
      {
        key: 'traktCalendarDays',
        isActive: (filters) => {
          if (source !== 'trakt') return false;
          const listType = normalizeTraktListType(filters.traktListType);
          if (
            !filters.traktCalendarDays ||
            !supportsTraktCalendarSettings(listType) ||
            filters.traktCalendarStartDate ||
            filters.traktCalendarEndDate
          ) {
            return false;
          }
          return !!formatTraktCalendarWindowLabel(listType, filters.traktCalendarDays);
        },
        label: (filters) => {
          const listType = normalizeTraktListType(filters.traktListType);
          return formatTraktCalendarWindowLabel(listType, filters.traktCalendarDays);
        },
        section: 'filters',
        clear: () => update({ traktCalendarDays: undefined }),
      },
      // Cleared via UI elsewhere but never surfaced as their own chip (matches prior behavior).
      {
        key: 'traktCalendarStartDate',
        isActive: () => false,
        label: () => '',
        section: 'filters',
        clear: () => update({ traktCalendarStartDate: undefined }),
      },
      {
        key: 'traktCalendarEndDate',
        isActive: () => false,
        label: () => '',
        section: 'filters',
        clear: () => update({ traktCalendarEndDate: undefined }),
      },
      {
        key: 'traktLanguages',
        isActive: (filters) => source === 'trakt' && filters.traktLanguages?.length,
        label: (filters) =>
          `Languages: ${filters.traktLanguages.map((c) => c.toUpperCase()).join(', ')}`,
        section: 'filters',
        clear: () => update({ traktLanguages: undefined }),
      },
      {
        key: 'traktCountries',
        isActive: (filters) => source === 'trakt' && filters.traktCountries?.length,
        label: (filters) =>
          `Countries: ${filters.traktCountries.map((c) => c.toUpperCase()).join(', ')}`,
        section: 'filters',
        clear: () => update({ traktCountries: undefined }),
      },
      {
        key: 'traktNetworkIds',
        isActive: (filters) => source === 'trakt' && filters.traktNetworkIds?.length,
        label: (filters) => {
          const safeNets = Array.isArray(traktNetworks) ? traktNetworks : [];
          const names = filters.traktNetworkIds.map((id) => {
            const net = safeNets.find((n) => n.ids?.trakt === id);
            return net?.name || String(id);
          });
          const shown = names.slice(0, 2).join(', ');
          const extra = names.length > 2 ? ` +${names.length - 2}` : '';
          return `Networks: ${shown}${extra}`;
        },
        section: 'network',
        clear: () => update({ traktNetworkIds: undefined }),
      },
      {
        key: 'traktGenres',
        isActive: (filters) => source === 'trakt' && filters.traktGenres?.length,
        label: (filters) => `Genres: ${filters.traktGenres.length}`,
        section: 'genres',
        clear: () => update({ traktGenres: undefined }),
      },
      {
        key: 'traktExcludeGenres',
        isActive: (filters) => source === 'trakt' && filters.traktExcludeGenres?.length,
        label: (filters) => `Excluded: ${filters.traktExcludeGenres.length}`,
        section: 'genres',
        clear: () => update({ traktExcludeGenres: undefined }),
      },
      {
        key: 'traktYear',
        isActive: (filters) =>
          source === 'trakt' && (filters.traktYearMin != null || filters.traktYearMax != null),
        label: (filters) =>
          `Year: ${filters.traktYearMin ?? '...'}–${filters.traktYearMax ?? '...'}`,
        section: 'filters',
        clear: () => update({ traktYearMin: undefined, traktYearMax: undefined }),
      },
      {
        key: 'traktRating',
        isActive: (filters) =>
          source === 'trakt' && !!(filters.traktRatingMin || filters.traktRatingMax),
        label: (filters) =>
          `Rating: ${filters.traktRatingMin ?? 0}–${filters.traktRatingMax ?? 100}`,
        section: 'filters',
        clear: () => update({ traktRatingMin: undefined, traktRatingMax: undefined }),
      },
      {
        key: 'traktVotesMin',
        isActive: (filters) => source === 'trakt' && !!filters.traktVotesMin,
        label: (filters) => `Min Votes: ${filters.traktVotesMin}`,
        section: 'ratings',
        clear: () => update({ traktVotesMin: undefined }),
      },
      {
        key: 'traktAiredEpisodes',
        isActive: (filters) =>
          source === 'trakt' &&
          (filters.traktAiredEpisodesMin != null || filters.traktAiredEpisodesMax != null),
        label: (filters) =>
          `Aired Episodes: ${filters.traktAiredEpisodesMin ?? '...'}–${filters.traktAiredEpisodesMax ?? '...'}`,
        section: 'filters',
        clear: () => update({ traktAiredEpisodesMin: undefined, traktAiredEpisodesMax: undefined }),
      },
      {
        key: 'traktExcludeSingleSeason',
        isActive: (filters) => source === 'trakt' && !!filters.traktExcludeSingleSeason,
        label: () => 'Hide New / Single-Season Shows',
        section: 'filters',
        clear: () => update({ traktExcludeSingleSeason: undefined }),
      },
    ];
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
    setSelectedPeople,
    selectedCompanies,
    setSelectedCompanies,
    selectedKeywords,
    setSelectedKeywords,
    excludeKeywords,
    setExcludeKeywords,
    excludeCompanies,
    setExcludeCompanies,
    selectedImdbExcludeCompanies,
    setSelectedImdbExcludeCompanies,
    imdbSortOptions,
    anilistSortOptions,
    anilistFormatOptions,
    anilistStatusOptions,
    anilistSeasonOptions,
    anilistSourceOptions,
    anilistCountryOptions,
    malRankingTypes,
    malSortOptions,
    simklListTypes,
    simklTrendingPeriods,
    simklBestFilters,
    simklSortOptions,
    simklAnimeTypes,
    traktListTypes,
    traktCalendarTypes,
    traktCommunityMetrics,
    traktNetworks,
    isImdbSource,
    isAnilistSource,
    isCollectionCatalog,
    isStudioCollection,
    update,
  ]);

  const activeFilters = useMemo(() => {
    const filters = localCatalog?.filters || {};
    return filterDescriptors
      .filter((descriptor) => descriptor.isActive(filters))
      .map((descriptor) => ({
        key: descriptor.key,
        label: descriptor.label(filters),
        section:
          typeof descriptor.section === 'function'
            ? descriptor.section(filters)
            : descriptor.section,
      }));
  }, [filterDescriptors, localCatalog]);

  const clearFilter = useCallback(
    (filterKey) => {
      const descriptor = filterDescriptors.find((d) => d.key === filterKey);
      descriptor?.clear();
    },
    [filterDescriptors]
  );

  const clearAllFilters = useCallback(() => {
    setLocalCatalog((prev) => ({
      ...prev,
      filters:
        prev?.source === 'tmdb' && prev?.type === 'collection'
          ? {
              ...getSource(prev?.source ?? 'tmdb').defaultFilters,
              listType: prev?.filters?.listType === 'studio' ? 'studio' : 'collection',
              sortBy: prev?.filters?.listType === 'studio' ? undefined : 'collection_order',
              collectionId: undefined,
              collectionName: undefined,
              studioId: undefined,
              studioName: undefined,
            }
          : { ...getSource(prev?.source ?? 'tmdb').defaultFilters },
    }));
    setSelectedPeople([]);
    setSelectedCompanies([]);
    setSelectedKeywords([]);
    setExcludeKeywords([]);
    setExcludeCompanies([]);
    if (setSelectedImdbExcludeCompanies) setSelectedImdbExcludeCompanies([]);
  }, [
    setExcludeCompanies,
    setExcludeKeywords,
    setSelectedImdbExcludeCompanies,
    setSelectedCompanies,
    setSelectedKeywords,
    setSelectedPeople,
    setLocalCatalog,
  ]);

  return { activeFilters, clearFilter, clearAllFilters };
}
