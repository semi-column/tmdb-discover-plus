import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
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
  const [configName, setConfigName] = useState('');
  const [preferences, setPreferences] = useState({
    showAdultContent: false,
    defaultLanguage: 'en',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Track last saved state for dirty detection
  const savedStateRef = useRef({
    catalogs: [],
    configName: '',
    preferences: { showAdultContent: false, defaultLanguage: 'en' },
  });

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

  // Compute if current state differs from saved state
  const isDirty = useMemo(() => {
    const saved = savedStateRef.current;

    // Check config name
    if (configName !== saved.configName) return true;

    // Check catalogs (deep comparison)
    if (JSON.stringify(catalogs) !== JSON.stringify(saved.catalogs)) return true;

    // Check preferences
    if (JSON.stringify(preferences) !== JSON.stringify(saved.preferences)) return true;

    return false;
  }, [catalogs, configName, preferences]);

  // Mark current state as saved
  const markAsSaved = useCallback(() => {
    savedStateRef.current = {
      catalogs: JSON.parse(JSON.stringify(catalogs)),
      configName,
      preferences: JSON.parse(JSON.stringify(preferences)),
    };
  }, [catalogs, configName, preferences]);

  // Beforeunload warning when dirty
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const loadConfig = useCallback(async (id) => {
    setLoading(true);
    setError(null);
    try {
      const config = await api.getConfig(id);
      setUserId(config.userId);
      setCatalogs(config.catalogs || []);
      setConfigName(config.configName || '');
      setPreferences(config.preferences || {});
      // Update saved state
      savedStateRef.current = {
        catalogs: config.catalogs || [],
        configName: config.configName || '',
        preferences: config.preferences || {},
      };
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
        configName,
        catalogs,
        preferences,
      });
      setUserId(result.userId);
      if (newApiKey) setApiKey(newApiKey);
      markAsSaved();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [userId, apiKey, configName, catalogs, preferences, setApiKey, markAsSaved]);

  const updateConfig = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.updateConfig(userId, {
        tmdbApiKey: apiKey,
        configName,
        catalogs,
        preferences,
      });
      markAsSaved();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [userId, apiKey, configName, catalogs, preferences, markAsSaved]);

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
    configName,
    setConfigName,
    preferences,
    setPreferences,
    loading,
    error,
    isDirty,
    markAsSaved,
    loadConfig,
    saveConfig,
    updateConfig,
    addCatalog,
    updateCatalog,
    removeCatalog,
  };
}
