import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

export function useTMDB(apiKey) {
  const [genres, setGenres] = useState({ movie: [], series: [] });
  const [languages, setLanguages] = useState([]);
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load static data (genres, languages, sort options, etc.)
  const loadMetadata = useCallback(async () => {
    if (!apiKey) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Load all metadata in parallel
      const [
        movieGenres, 
        tvGenres, 
        langs, 
        ctries,
        sorts,
        lists,
        presets,
        relTypes,
        tvStats,
        tvTyps,
        monTypes,
        movieCerts,
        tvCerts,
        regions,
        networks,
      ] = await Promise.all([
        api.getGenres(apiKey, 'movie'),
        api.getGenres(apiKey, 'series'),
        api.getLanguages(apiKey),
        api.getCountries(apiKey),
        api.getSortOptions(),
        api.getListTypes(),
        api.getPresetCatalogs(),
        api.getReleaseTypes(),
        api.getTVStatuses(),
        api.getTVTypes(),
        api.getMonetizationTypes(),
        api.getCertifications(apiKey, 'movie'),
        api.getCertifications(apiKey, 'series'),
        api.getWatchRegions(apiKey),
        api.getTVNetworks(null, ''),
      ]);
      
      setGenres({ movie: movieGenres, series: tvGenres });
      setLanguages(langs);
      setCountries(ctries);
      // sortOptions now comes as { movie: [...], series: [...] }
      setSortOptions(sorts);
      setListTypes(lists);
      setPresetCatalogs(presets);
      setReleaseTypes(relTypes);
      setTVStatuses(tvStats);
      setTVTypes(tvTyps);
      setMonetizationTypes(monTypes);
      setCertifications({ movie: movieCerts, series: tvCerts });
      setWatchRegions(regions);
      setTVNetworks(networks);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    if (apiKey) {
      loadMetadata();
    }
  }, [apiKey, loadMetadata]);

  const preview = useCallback(async (type, filters, page = 1) => {
    if (!apiKey) throw new Error('API key required');
    return api.preview(apiKey, type, filters, page);
  }, [apiKey]);

  const searchPerson = useCallback(async (query) => {
    if (!apiKey) throw new Error('API key required');
    return api.searchPerson(apiKey, query);
  }, [apiKey]);

  const searchCompany = useCallback(async (query) => {
    if (!apiKey) throw new Error('API key required');
    return api.searchCompany(apiKey, query);
  }, [apiKey]);

  const searchKeyword = useCallback(async (query) => {
    if (!apiKey) throw new Error('API key required');
    return api.searchKeyword(apiKey, query);
  }, [apiKey]);

  const getWatchProviders = useCallback(async (type, region) => {
    if (!apiKey) throw new Error('API key required');
    return api.getWatchProviders(apiKey, type, region);
  }, [apiKey]);

  const searchTVNetworks = useCallback(async (query) => {
    if (!apiKey) throw new Error('API key required');
    if (!query) return [];
    return api.getTVNetworks(apiKey, query);
  }, [apiKey]);

  const getPersonById = useCallback(async (id) => {
    if (!apiKey) throw new Error('API key required');
    return api.getPersonById(apiKey, id);
  }, [apiKey]);

  const getCompanyById = useCallback(async (id) => {
    if (!apiKey) throw new Error('API key required');
    return api.getCompanyById(apiKey, id);
  }, [apiKey]);

  const getKeywordById = useCallback(async (id) => {
    if (!apiKey) throw new Error('API key required');
    return api.getKeywordById(apiKey, id);
  }, [apiKey]);

  return {
    genres,
    languages,
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
  };
}
