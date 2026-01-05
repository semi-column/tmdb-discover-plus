import { useState, useCallback } from 'react';
import { api } from '../services/api';

const STORAGE_KEY = 'tmdb-stremio-apikey';

export function useConfig(initialUserId = null) {
  const [userId, setUserId] = useState(initialUserId);
  // Initialize apiKey from localStorage if available
  const [apiKey, setApiKeyState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [catalogs, setCatalogs] = useState([]);
  const [preferences, setPreferences] = useState({
    showAdultContent: false,
    defaultLanguage: 'en',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Wrapper to persist apiKey to localStorage
  const setApiKey = useCallback((key) => {
    setApiKeyState(key);
    try {
      if (key) {
        localStorage.setItem(STORAGE_KEY, key);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // localStorage not available
    }
  }, []);

  const loadConfig = useCallback(async (id) => {
    setLoading(true);
    setError(null);
    try {
      const config = await api.getConfig(id);
      setUserId(config.userId);
      setCatalogs(config.catalogs || []);
      setPreferences(config.preferences || {});
      return config;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const saveConfig = useCallback(async (newApiKey) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.saveConfig({
        userId,
        tmdbApiKey: newApiKey || apiKey,
        catalogs,
        preferences,
      });
      setUserId(result.userId);
      if (newApiKey) setApiKey(newApiKey);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [userId, apiKey, catalogs, preferences, setApiKey]);

  const updateConfig = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.updateConfig(userId, {
        tmdbApiKey: apiKey,
        catalogs,
        preferences,
      });
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [userId, apiKey, catalogs, preferences]);

  const addCatalog = useCallback((catalog) => {
    setCatalogs(prev => [...prev, { ...catalog, _id: crypto.randomUUID() }]);
  }, []);

  const updateCatalog = useCallback((catalogId, updates) => {
    setCatalogs(prev => prev.map(c => 
      (c._id === catalogId || c.id === catalogId) ? { ...c, ...updates } : c
    ));
  }, []);

  const removeCatalog = useCallback((catalogId) => {
    setCatalogs(prev => prev.filter(c => 
      c._id !== catalogId && c.id !== catalogId
    ));
  }, []);

  return {
    userId,
    setUserId,
    apiKey,
    setApiKey,
    catalogs,
    setCatalogs,
    preferences,
    setPreferences,
    loading,
    error,
    loadConfig,
    saveConfig,
    updateConfig,
    addCatalog,
    updateCatalog,
    removeCatalog,
  };
}
