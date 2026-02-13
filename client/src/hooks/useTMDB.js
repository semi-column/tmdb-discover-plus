import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

export function useTMDB(apiKey) {
  const [genres, setGenres] = useState({ movie: [], series: [] });
  const [languages, setLanguages] = useState([]);
  const [originalLanguages, setOriginalLanguages] = useState([]);
  const [countries, setCountries] = useState([]);
  const [sortOptions, setSortOptions] = useState({ movie: [], series: [] });
  const [listTypes, setListTypes] = useState({ movie: [], series: [] });
  const [presetCatalogs, setPresetCatalogs] = useState({ movie: [], series: [] });
  const [releaseTypes, setReleaseTypes] = useState([]);
  const [tvStatuses, setTVStatuses] = useState([]);
  const [tvTypes, setTVTypes] = useState([]);
  const [monetizationTypes, setMonetizationTypes] = useState([]);
  const [certifications, setCertifications] = useState({ movie: {}, series: {} });
  const [watchRegions, setWatchRegions] = useState([]);
  const [tvNetworks, setTVNetworks] = useState([]);
  const [loading, setLoading] = useState(() => !!(apiKey || api.getSessionToken()));
  const [error, setError] = useState(null);

  const hasAuth = !!(apiKey || api.getSessionToken());

  const loadMetadata = useCallback(async () => {
    if (!hasAuth) return;

    setLoading(true);
    setError(null);

    try {
      const data = await api.getReferenceData();

      setGenres(data.genres || { movie: [], series: [] });
      setLanguages(data.languages || []);
      setOriginalLanguages(data.originalLanguages || []);
      setCountries(data.countries || []);
      setSortOptions(data.sortOptions || { movie: [], series: [] });
      setPresetCatalogs(data.presetCatalogs || { movie: [], series: [] });
      setListTypes(data.listTypes || { movie: [], series: [] });
      setReleaseTypes(data.releaseTypes || []);
      setTVStatuses(data.tvStatuses || []);
      setTVTypes(data.tvTypes || []);
      setMonetizationTypes(data.monetizationTypes || []);
      setCertifications(data.certifications || { movie: {}, series: {} });
      setWatchRegions(data.watchRegions || []);
      setTVNetworks(data.tvNetworks || []);

      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [apiKey, hasAuth]);

  useEffect(() => {
    if (hasAuth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadMetadata();
    }
  }, [hasAuth, loadMetadata]);

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

  return {
    genres,
    languages,
    originalLanguages,
    countries,
    sortOptions,
    listTypes,
    presetCatalogs,
    releaseTypes,
    tvStatuses,
    tvTypes,
    monetizationTypes,
    certifications,
    watchRegions,
    tvNetworks,
    loading,
    error,
    preview,
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
