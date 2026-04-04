import { useReducer, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';

const initialState = {
  genres: { movie: [], series: [] },
  languages: [],
  originalLanguages: [],
  countries: [],
  sortOptions: { movie: [], series: [] },
  listTypes: { movie: [], series: [] },
  presetCatalogs: { movie: [], series: [] },
  releaseTypes: [],
  tvStatuses: [],
  tvTypes: [],
  monetizationTypes: [],
  certifications: { movie: {}, series: {} },
  certificateRatingsByCountry: {},
  watchRegions: [],
  tvNetworks: [],
  imdbEnabled: false,
  imdbGenres: [],
  imdbKeywords: [],
  imdbAwards: [],
  imdbSortOptions: [],
  imdbTitleTypes: [],
  imdbPresetCatalogs: [],
  imdbCertificateRatings: {},
  imdbRankedLists: [],
  imdbWithDataOptions: [],
  anilistEnabled: true,
  anilistGenres: [],
  anilistTags: [],
  anilistSortOptions: [],
  anilistFormatOptions: [],
  anilistStatusOptions: [],
  anilistSeasonOptions: [],
  anilistSourceOptions: [],
  anilistCountryOptions: [],
  malEnabled: false,
  malGenres: [],
  malRankingTypes: [],
  malSortOptions: [],
  malOrderByOptions: [],
  malMediaTypes: [],
  malStatuses: [],
  malRatings: [],
  simklEnabled: false,
  simklGenres: [],
  simklSortOptions: [],
  simklListTypes: [],
  simklTrendingPeriods: [],
  simklBestFilters: [],
  simklAnimeTypes: [],
  loading: false,
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_SUCCESS': {
      const imdbData = action.payload.imdb || {};
      const anilistData = action.payload.anilist || {};
      const malData = action.payload.mal || {};
      const simklData = action.payload.simkl || {};
      return {
        ...state,
        genres: action.payload.genres || initialState.genres,
        languages: action.payload.languages || [],
        originalLanguages: action.payload.originalLanguages || [],
        countries: action.payload.countries || [],
        sortOptions: action.payload.sortOptions || initialState.sortOptions,
        listTypes: action.payload.listTypes || initialState.listTypes,
        presetCatalogs: action.payload.presetCatalogs || initialState.presetCatalogs,
        releaseTypes: action.payload.releaseTypes || [],
        tvStatuses: action.payload.tvStatuses || [],
        tvTypes: action.payload.tvTypes || [],
        monetizationTypes: action.payload.monetizationTypes || [],
        certifications: action.payload.certifications || initialState.certifications,
        certificateRatingsByCountry: action.payload.certificateRatingsByCountry || {},
        watchRegions: action.payload.watchRegions || [],
        tvNetworks: action.payload.tvNetworks || [],
        imdbEnabled: imdbData.enabled || false,
        imdbGenres: imdbData.genres || [],
        imdbKeywords: imdbData.keywords || [],
        imdbAwards: imdbData.awards || [],
        imdbSortOptions: imdbData.sortOptions || [],
        imdbTitleTypes: imdbData.titleTypes || [],
        imdbPresetCatalogs: imdbData.presetCatalogs || [],
        imdbCertificateRatings:
          action.payload.certificateRatingsByCountry || imdbData.certificateRatings || {},
        imdbRankedLists: imdbData.rankedLists || [],
        imdbWithDataOptions: imdbData.withDataOptions || [],
        // AniList data
        anilistEnabled: true,
        anilistGenres: anilistData.genres || [],
        anilistTags: anilistData.tags || [],
        anilistSortOptions: anilistData.sortOptions || [],
        anilistFormatOptions: anilistData.formatOptions || [],
        anilistStatusOptions: anilistData.statusOptions || [],
        anilistSeasonOptions: anilistData.seasonOptions || [],
        anilistSourceOptions: anilistData.sourceOptions || [],
        anilistCountryOptions: anilistData.countryOptions || [],
        // MAL data
        malEnabled: malData.enabled || false,
        malGenres: malData.genres || [],
        malRankingTypes: malData.rankingTypes || [],
        malSortOptions: malData.sortOptions || [],
        malOrderByOptions: malData.orderByOptions || [],
        malMediaTypes: malData.mediaTypes || [],
        malStatuses: malData.statuses || [],
        malRatings: malData.ratings || [],
        // Simkl data
        simklEnabled: simklData.enabled || false,
        simklGenres: simklData.genres || [],
        simklSortOptions: simklData.sortOptions || [],
        simklListTypes: simklData.listTypes || [],
        simklTrendingPeriods: simklData.trendingPeriods || [],
        simklBestFilters: simklData.bestFilters || [],
        simklAnimeTypes: simklData.animeTypes || [],
        loading: false,
        error: null,
      };
    }
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.error };
    default:
      return state;
  }
}

export function useTMDB(apiKey) {
  const hasAuth = !!(apiKey || api.getSessionToken());
  const [state, dispatch] = useReducer(reducer, { ...initialState, loading: hasAuth });
  const abortRef = useRef(null);

  const loadMetadata = useCallback(async () => {
    if (!hasAuth) return;
    dispatch({ type: 'FETCH_START' });
    try {
      const data = await api.getReferenceData();
      dispatch({ type: 'FETCH_SUCCESS', payload: data });
    } catch (err) {
      if (err.name !== 'AbortError') {
        dispatch({ type: 'FETCH_ERROR', error: err.message });
      }
    }
  }, [hasAuth]);

  useEffect(() => {
    if (!hasAuth) return;

    const controller = new AbortController();
    abortRef.current = controller;

    api
      .getReferenceData()
      .then((data) => {
        if (!controller.signal.aborted) {
          dispatch({ type: 'FETCH_SUCCESS', payload: data });
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted && err.name !== 'AbortError') {
          dispatch({ type: 'FETCH_ERROR', error: err.message });
        }
      });

    return () => {
      controller.abort();
    };
  }, [hasAuth]);

  const preview = useCallback(
    async (type, filters, page = 1) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.preview(apiKey, type, filters, page);
    },
    [apiKey, hasAuth]
  );

  const searchPerson = useCallback(
    async (query) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.searchPerson(apiKey, query);
    },
    [apiKey, hasAuth]
  );

  const searchCompany = useCallback(
    async (query) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.searchCompany(apiKey, query);
    },
    [apiKey, hasAuth]
  );

  const searchKeyword = useCallback(
    async (query) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.searchKeyword(apiKey, query);
    },
    [apiKey, hasAuth]
  );

  const getWatchProviders = useCallback(
    async (type, region) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.getWatchProviders(apiKey, type, region);
    },
    [apiKey, hasAuth]
  );

  const searchTVNetworks = useCallback(
    async (query) => {
      if (!hasAuth) throw new Error('Authentication required');
      if (!query) return [];
      return api.getTVNetworks(apiKey, query);
    },
    [apiKey, hasAuth]
  );

  const getPersonById = useCallback(
    async (id) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.getPersonById(apiKey, id);
    },
    [apiKey, hasAuth]
  );

  const getCompanyById = useCallback(
    async (id) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.getCompanyById(apiKey, id);
    },
    [apiKey, hasAuth]
  );

  const getKeywordById = useCallback(
    async (id) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.getKeywordById(apiKey, id);
    },
    [apiKey, hasAuth]
  );

  const getNetworkById = useCallback(
    async (id) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.getNetworkById(apiKey, id);
    },
    [apiKey, hasAuth]
  );

  const previewImdb = useCallback(
    async (type, filters) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.previewImdbCatalog(type, filters);
    },
    [hasAuth]
  );

  const previewAnilist = useCallback(
    async (type, filters) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.previewAnilistCatalog(type, filters);
    },
    [hasAuth]
  );

  const previewMal = useCallback(
    async (type, filters) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.previewMalCatalog(type, filters);
    },
    [hasAuth]
  );

  const previewSimkl = useCallback(
    async (type, filters) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.previewSimklCatalog(type, filters);
    },
    [hasAuth]
  );

  const searchImdb = useCallback(
    async (query, type, limit) => {
      if (!hasAuth) throw new Error('Authentication required');
      return api.searchImdb(query, type, limit);
    },
    [hasAuth]
  );

  const searchImdbPeople = useCallback(
    async (query) => {
      if (!hasAuth) throw new Error('Authentication required');
      const data = await api.searchImdbPeople(query);
      return data?.results || [];
    },
    [hasAuth]
  );

  const searchImdbCompanies = useCallback(
    async (query) => {
      if (!hasAuth) throw new Error('Authentication required');
      const data = await api.searchImdbCompanies(query);
      return data?.results || [];
    },
    [hasAuth]
  );

  const searchCities = useCallback(
    async (query) => {
      if (!hasAuth) throw new Error('Authentication required');
      const data = await api.searchCities(query);
      return (data?.results || []).map((c) => ({
        id: c.id,
        name: c.name,
        displayName: c.displayName,
        lat: c.lat,
        lon: c.lon,
        state: c.state,
        country: c.country,
        countryCode: c.countryCode,
        locationLabel: c.locationLabel,
        knownFor: c.locationLabel || [c.state, c.country].filter(Boolean).join(', '),
      }));
    },
    [hasAuth]
  );

  return {
    ...state,
    preview,
    previewImdb,
    previewAnilist,
    previewMal,
    previewSimkl,
    searchImdb,
    searchImdbPeople,
    searchImdbCompanies,
    searchCities,
    searchPerson,
    searchCompany,
    searchKeyword,
    getWatchProviders,
    searchTVNetworks,
    refresh: loadMetadata,
    getPersonById,
    getCompanyById,
    getKeywordById,
    getNetworkById,
  };
}
