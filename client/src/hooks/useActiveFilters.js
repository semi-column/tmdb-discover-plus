import { useCallback, useMemo } from 'react';
import { DATE_PRESETS } from '../constants/datePresets';
import { getSource } from '../sources/index';

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
}) {
  const isImdbSource = localCatalog?.source === 'imdb';
  const isAnilistSource = localCatalog?.source === 'anilist';

  const activeFilters = useMemo(() => {
    const filters = localCatalog?.filters || {};
    const active = [];
    const isMovieType = localCatalog?.type === 'movie';

    const source = localCatalog?.source;
    const isImdb = source === 'imdb';
    const isAnilist = source === 'anilist';
    const isTmdb = !source || source === 'tmdb';
    const imdbSortDefault = 'POPULARITY';
    const tmdbSortDefault = 'popularity.desc';
    const anilistSortDefault = 'TRENDING_DESC';

    const humanize = (value) => {
      if (typeof value !== 'string') return value;
      return value
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
    };

    const getOptionLabel = (options, value, valueKey = 'value', labelKey = 'label') =>
      options.find((item) => item?.[valueKey] === value)?.[labelKey] || humanize(value);

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

    if (isImdb) {
      // For IMDB: only show sort chip when it differs from the IMDB default
      if (filters.sortBy && filters.sortBy !== imdbSortDefault) {
        const match = imdbSortOptions.find((s) => s.value === filters.sortBy);
        active.push({
          key: 'sortBy',
          label: `Sort: ${match?.label || filters.sortBy}`,
          section: 'filters',
        });
      }
    } else if (isAnilist) {
      if (filters.sortBy && filters.sortBy !== anilistSortDefault) {
        const match = anilistSortOptions.find((s) => s.value === filters.sortBy);
        active.push({
          key: 'sortBy',
          label: `Sort: ${match?.label || filters.sortBy}`,
          section: 'filters',
        });
      }
    } else if (isTmdb && filters.sortBy && String(filters.sortBy) !== tmdbSortDefault) {
      // TMDB / fallback sorting chip
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

    if (filters.language) {
      const lang = originalLanguages.find((l) => l.iso_639_1 === filters.language);
      active.push({
        key: 'language',
        label: `Language: ${lang?.english_name || filters.language}`,
        section: 'filters',
      });
    }

    if (filters.countries) {
      const countriesArr = Array.isArray(filters.countries)
        ? filters.countries
        : String(filters.countries).split(',').filter(Boolean);
      if (countriesArr.length > 0) {
        const countryNames = countriesArr
          .map((code) => countries.find((c) => c.iso_3166_1 === code)?.english_name || code)
          .slice(0, 2);
        const extra = countriesArr.length > 2 ? ` +${countriesArr.length - 2}` : '';
        active.push({
          key: 'countries',
          label: `Country: ${countryNames.join(', ')}${extra}`,
          section: 'filters',
        });
      }
    }

    if (filters.imdbCountries?.length > 0) {
      const countryNames = filters.imdbCountries
        .map((code) => {
          const country = countries.find((c) => c.iso_3166_1 === code);
          return country?.english_name || code;
        })
        .slice(0, 2);
      const extra = filters.imdbCountries.length > 2 ? ` +${filters.imdbCountries.length - 2}` : '';
      active.push({
        key: 'imdbCountries',
        label: `IMDb Countries: ${countryNames.join(', ')}${extra}`,
        section: 'region',
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
      !filters.lastXYears &&
      (filters.releaseDateFrom || filters.releaseDateTo || filters.airDateFrom || filters.airDateTo)
    ) {
      const DATE_TAG_LABELS = {
        today: 'Today',
        'today-30d': 'Today − 30d',
        'today-90d': 'Today − 90d',
        'today-6mo': 'Today − 6mo',
        'today-12mo': 'Today − 12mo',
        'today+30d': 'Today + 30d',
        'today+3mo': 'Today + 3mo',
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

    if (isImdb && selectedImdbExcludeCompanies?.length > 0) {
      active.push({
        key: 'imdbExcludeCompanies',
        label: `Exclude IMDb studios: ${selectedImdbExcludeCompanies.length}`,
        section: 'people',
      });
    } else if (excludeCompanies.length > 0) {
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
      active.push({ key: 'releasedOnly', label: 'Released only', section: 'release' });
    }

    if (filters.lastXYears) {
      active.push({
        key: 'lastXYears',
        label: `Last ${filters.lastXYears} years`,
        section: 'release',
      });
    }

    // --- IMDB-specific new filters ---
    if (filters.creditedNames?.length > 0) {
      active.push({
        key: 'creditedNames',
        label: `IMDb People: ${filters.creditedNames.length}`,
        section: 'people',
      });
    }

    if (filters.companies?.length > 0 && isImdb) {
      active.push({
        key: 'imdbCompanies',
        label: `IMDb Studios: ${filters.companies.length}`,
        section: 'people',
      });
    }

    if (filters.inTheatersLat) {
      active.push({
        key: 'inTheaters',
        label: 'In Theatres',
        section: 'theatres',
      });
    }

    if (filters.certificates?.length > 0) {
      active.push({
        key: 'imdbCertificates',
        label: `Certificates: ${filters.certificates.length}`,
        section: 'certificates',
      });
    }

    if (filters.rankedLists?.length > 0) {
      active.push({
        key: 'rankedLists',
        label: `Ranked Lists: ${filters.rankedLists.length}`,
        section: 'rankedLists',
      });
    }

    if (filters.excludeRankedLists?.length > 0) {
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
      active.push({
        key: 'plot',
        label: `Plot: "${filters.plot}"`,
        section: 'textSearch',
      });
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

    if (source === 'anilist') {
      if (filters.format?.length > 0) {
        active.push({
          key: 'format',
          label: `Format: ${getLabelSummary(anilistFormatOptions, filters.format)}`,
          section: 'filters',
        });
      }

      if (filters.status?.length > 0) {
        active.push({
          key: 'status',
          label: `Status: ${getLabelSummary(anilistStatusOptions, filters.status)}`,
          section: 'filters',
        });
      }

      if (filters.season) {
        const seasonLabel = getOptionLabel(anilistSeasonOptions, filters.season);
        active.push({
          key: 'season',
          label: `Season: ${seasonLabel}`,
          section: 'filters',
        });
      }

      if (filters.seasonYear) {
        active.push({
          key: 'seasonYear',
          label: `Year: ${filters.seasonYear}`,
          section: 'filters',
        });
      }

      if (filters.popularityMin > 0) {
        active.push({
          key: 'popularityMin',
          label: `Min popularity: ${filters.popularityMin.toLocaleString()}`,
          section: 'filters',
        });
      }

      if (filters.averageScoreMin > 0 || filters.averageScoreMax < 100) {
        active.push({
          key: 'averageScore',
          label: `Score: ${filters.averageScoreMin || 0}-${filters.averageScoreMax || 100}`,
          section: 'filters',
        });
      }

      if (filters.countryOfOrigin) {
        const countryLabel = getOptionLabel(anilistCountryOptions, filters.countryOfOrigin);
        active.push({
          key: 'countryOfOrigin',
          label: `Country: ${countryLabel}`,
          section: 'filters',
        });
      }

      if (filters.sourceMaterial?.length > 0) {
        active.push({
          key: 'sourceMaterial',
          label: `Source: ${getLabelSummary(anilistSourceOptions, filters.sourceMaterial)}`,
          section: 'filters',
        });
      }

      if (filters.tags?.length > 0) {
        active.push({
          key: 'tags',
          label: `Tags: ${filters.tags.slice(0, 2).join(', ')}${filters.tags.length > 2 ? ` +${filters.tags.length - 2}` : ''}`,
          section: 'filters',
        });
      }

      if (filters.excludeTags?.length > 0) {
        active.push({
          key: 'excludeTags',
          label: `Exclude tags: ${filters.excludeTags.slice(0, 2).join(', ')}${filters.excludeTags.length > 2 ? ` +${filters.excludeTags.length - 2}` : ''}`,
          section: 'filters',
        });
      }

      if (filters.episodesMin || filters.episodesMax) {
        active.push({
          key: 'episodes',
          label: `Episodes: ${filters.episodesMin || 0}-${filters.episodesMax || '∞'}`,
          section: 'score',
        });
      }

      if (filters.durationMin || filters.durationMax) {
        active.push({
          key: 'duration',
          label: `Duration: ${filters.durationMin || 0}-${filters.durationMax || '∞'} min`,
          section: 'score',
        });
      }

      if (filters.isAdult) {
        active.push({ key: 'isAdult', label: 'Adult content', section: 'options' });
      }
    }

    if (source === 'mal') {
      if (filters.malRankingType && filters.malRankingType !== 'all') {
        const rankingLabel = getOptionLabel(malRankingTypes, filters.malRankingType);
        active.push({
          key: 'malRankingType',
          label: `Ranking: ${rankingLabel}`,
          section: 'filters',
        });
      }

      if (filters.malSeason) {
        active.push({
          key: 'malSeason',
          label: `Season: ${toTitleCase(filters.malSeason)}`,
          section: 'filters',
        });
      }

      if (filters.malSeasonYear) {
        active.push({
          key: 'malSeasonYear',
          label: `Year: ${filters.malSeasonYear}`,
          section: 'filters',
        });
      }

      if (filters.malSort && filters.malSort !== 'anime_num_list_users') {
        const sortLabel = getOptionLabel(malSortOptions, filters.malSort);
        active.push({ key: 'malSort', label: `Sort: ${sortLabel}`, section: 'filters' });
      }

      if (filters.malGenres?.length > 0) {
        active.push({
          key: 'malGenres',
          label: `Genres: ${filters.malGenres.length}`,
          section: 'genres',
        });
      }

      if (filters.malExcludeGenres?.length > 0) {
        active.push({
          key: 'malExcludeGenres',
          label: `Excluded: ${filters.malExcludeGenres.length}`,
          section: 'genres',
        });
      }

      if (filters.malMediaType?.length > 0) {
        active.push({
          key: 'malMediaType',
          label: `Type: ${filters.malMediaType.join(', ')}`,
          section: 'format',
        });
      }

      if (filters.malStatus?.length > 0) {
        active.push({
          key: 'malStatus',
          label: `Status: ${filters.malStatus.join(', ')}`,
          section: 'format',
        });
      }

      if (filters.malRating) {
        active.push({
          key: 'malRating',
          label: `Rating: ${filters.malRating}`,
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
          label: `Order: ${filters.malOrderBy}`,
          section: 'score',
        });
      }
    }

    if (source === 'simkl') {
      if (filters.simklListType && filters.simklListType !== 'trending') {
        const typeLabel = getOptionLabel(simklListTypes, filters.simklListType);
        active.push({ key: 'simklListType', label: `List: ${typeLabel}`, section: 'filters' });
      }

      if (filters.simklTrendingPeriod && filters.simklTrendingPeriod !== 'week') {
        const periodLabel = getOptionLabel(simklTrendingPeriods, filters.simklTrendingPeriod);
        active.push({
          key: 'simklTrendingPeriod',
          label: `Period: ${periodLabel}`,
          section: 'filters',
        });
      }

      if (filters.simklBestFilter && filters.simklBestFilter !== 'all') {
        const bestLabel = getOptionLabel(simklBestFilters, filters.simklBestFilter);
        active.push({ key: 'simklBestFilter', label: `Best: ${bestLabel}`, section: 'filters' });
      }

      if (filters.simklGenre) {
        active.push({
          key: 'simklGenre',
          label: `Genre: ${filters.simklGenre}`,
          section: 'filters',
        });
      }

      if (filters.simklSort && filters.simklSort !== 'rank') {
        const sortLabel = getOptionLabel(simklSortOptions, filters.simklSort);
        active.push({ key: 'simklSort', label: `Sort: ${sortLabel}`, section: 'filters' });
      }

      if (filters.simklType && filters.simklType !== 'all') {
        if (localCatalog?.type !== 'movie' || filters.simklType === 'movies') {
          const animeTypeLabel = getOptionLabel(simklAnimeTypes, filters.simklType);
          // Don't show the chip if the catalog type is 'movie' since it's forced by the backend anyway
          if (localCatalog?.type !== 'movie') {
            active.push({ key: 'simklType', label: `Type: ${animeTypeLabel}`, section: 'filters' });
          }
        }
      }
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
    selectedImdbExcludeCompanies,
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
  ]);

  const clearFilter = useCallback(
    (filterKey) => {
      const update = (patch) =>
        setLocalCatalog((prev) => ({ ...prev, filters: { ...prev.filters, ...patch } }));

      switch (filterKey) {
        case 'sortBy':
          update(
            isImdbSource
              ? { sortBy: 'POPULARITY', sortOrder: 'DESC' }
              : isAnilistSource
                ? { sortBy: 'TRENDING_DESC' }
                : { sortBy: 'popularity.desc' }
          );
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
        case 'countries':
          update({ countries: [] });
          break;
        case 'imdbCountries':
          update({ imdbCountries: [] });
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
        case 'imdbExcludeCompanies':
          update({ excludeCompanies: [] });
          if (setSelectedImdbExcludeCompanies) setSelectedImdbExcludeCompanies([]);
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
        case 'lastXYears':
          update({
            lastXYears: undefined,
            releaseDateFrom: undefined,
            releaseDateTo: undefined,
            airDateFrom: undefined,
            airDateTo: undefined,
          });
          break;
        case 'creditedNames':
          update({ creditedNames: [] });
          break;
        case 'imdbCompanies':
          update({ companies: [] });
          break;
        case 'inTheaters':
          update({
            inTheatersLat: undefined,
            inTheatersLong: undefined,
            inTheatersRadius: undefined,
          });
          break;
        case 'imdbCertificates':
          update({ certificates: [], certificateCountry: undefined });
          break;
        case 'rankedLists':
          update({ rankedLists: [] });
          break;
        case 'excludeRankedLists':
          update({ excludeRankedLists: [] });
          break;
        case 'explicitContent':
          update({ explicitContent: undefined });
          break;
        case 'plot':
          update({ plot: undefined });
          break;
        case 'filmingLocations':
          update({ filmingLocations: undefined });
          break;
        case 'withData':
          update({ withData: [] });
          break;
        // --- AniList specific ---
        case 'format':
          update({ format: [] });
          break;
        case 'status':
          update({ status: [] });
          break;
        case 'season':
          update({ season: undefined });
          break;
        case 'seasonYear':
          update({ seasonYear: undefined });
          break;
        case 'popularityMin':
          update({ popularityMin: undefined });
          break;
        case 'averageScore':
          update({ averageScoreMin: undefined, averageScoreMax: undefined });
          break;
        case 'countryOfOrigin':
          update({ countryOfOrigin: undefined });
          break;
        case 'sourceMaterial':
          update({ sourceMaterial: [] });
          break;
        case 'tags':
          update({ tags: undefined });
          break;
        case 'excludeTags':
          update({ excludeTags: undefined });
          break;
        case 'episodes':
          update({ episodesMin: undefined, episodesMax: undefined });
          break;
        case 'duration':
          update({ durationMin: undefined, durationMax: undefined });
          break;
        case 'isAdult':
          update({ isAdult: undefined });
          break;
        // --- MAL specific ---
        case 'malRankingType':
          update({ malRankingType: undefined });
          break;
        case 'malSeason':
          update({ malSeason: undefined });
          break;
        case 'malSeasonYear':
          update({ malSeasonYear: undefined });
          break;
        case 'malSort':
          update({ malSort: undefined });
          break;
        case 'malGenres':
          update({ malGenres: [] });
          break;
        case 'malExcludeGenres':
          update({ malExcludeGenres: [] });
          break;
        case 'malMediaType':
          update({ malMediaType: [] });
          break;
        case 'malStatus':
          update({ malStatus: [] });
          break;
        case 'malRating':
          update({ malRating: undefined });
          break;
        case 'malScore':
          update({ malScoreMin: undefined, malScoreMax: undefined });
          break;
        case 'malOrderBy':
          update({ malOrderBy: undefined });
          break;
        // --- Simkl specific ---
        case 'simklListType':
          update({ simklListType: undefined });
          break;
        case 'simklTrendingPeriod':
          update({ simklTrendingPeriod: undefined });
          break;
        case 'simklBestFilter':
          update({ simklBestFilter: undefined });
          break;
        case 'simklGenre':
          update({ simklGenre: undefined });
          break;
        case 'simklSort':
          update({ simklSort: undefined });
          break;
        case 'simklType':
          update({ simklType: undefined });
          break;
        default:
          break;
      }
    },
    [
      isImdbSource,
      isAnilistSource,
      setSelectedPeople,
      setSelectedCompanies,
      setSelectedKeywords,
      setExcludeKeywords,
      setExcludeCompanies,
      setSelectedImdbExcludeCompanies,
      setLocalCatalog,
    ]
  );

  const clearAllFilters = useCallback(() => {
    setLocalCatalog((prev) => ({
      ...prev,
      filters: { ...getSource(prev?.source ?? 'tmdb').defaultFilters },
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
