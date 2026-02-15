import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';

export function useConfig(initialUserId = null) {
  const [userId, setUserId] = useState(initialUserId);
  const [apiKey, setApiKeyState] = useState('');
  const [catalogs, setCatalogs] = useState([]);
  const [imdbCatalogs, setImdbCatalogs] = useState([]);
  const [configName, setConfigName] = useState('');
  const [preferences, setPreferences] = useState({
    showAdultContent: false,
    defaultLanguage: 'en',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const setApiKey = useCallback((key) => {
    setApiKeyState(key);
  }, []);

  const markAsSaved = useCallback(() => {
    setIsDirty(false);
  }, []);

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

  useEffect(() => {
    const checkAuth = async () => {
      const sessionResult = await api.verifySession();
      if (sessionResult.valid) {
        setIsAuthenticated(true);
        setUserId(sessionResult.userId);
        setAuthChecked(true);
        return;
      }

      const legacyKey = api.getLegacyApiKey();
      if (legacyKey) {
        try {
          const loginResult = await api.login(legacyKey, initialUserId);
          if (loginResult.token) {
            setIsAuthenticated(true);
            setUserId(loginResult.userId);
          }
          api.clearLegacyApiKey();
        } catch (e) {
          void e;
          api.clearLegacyApiKey();
        }
      }

      setAuthChecked(true);
    };

    checkAuth();
  }, [initialUserId]);

  const login = useCallback(
    async (key, rememberMe = true) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.login(key, userId, rememberMe);
        setIsAuthenticated(true);
        setUserId(result.userId);
        setApiKeyState('');
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  const logout = useCallback(async () => {
    await api.logout();
    setIsAuthenticated(false);
    setUserId(null);
    setCatalogs([]);
    setImdbCatalogs([]);
    setConfigName('');
    setPreferences({ showAdultContent: false, defaultLanguage: 'en' });
    setIsDirty(false);
  }, []);

  const applyConfig = useCallback((configData) => {
    setUserId(configData.userId);
    setCatalogs(configData.catalogs || []);
    setImdbCatalogs(configData.imdbCatalogs || []);
    setConfigName(configData.configName || '');
    setPreferences(configData.preferences || {});
    setIsDirty(false);
  }, []);

  const loadConfig = useCallback(
    async (id) => {
      setLoading(true);
      setError(null);
      try {
        const config = await api.getConfig(id);
        applyConfig(config);
        return config;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [applyConfig]
  );

  const saveConfig = useCallback(
    async (newApiKey) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.saveConfig({
          userId,
          tmdbApiKey: newApiKey || apiKey,
          configName,
          catalogs,
          imdbCatalogs,
          preferences,
        });
        setUserId(result.userId);
        markAsSaved();
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [userId, apiKey, configName, catalogs, imdbCatalogs, preferences, markAsSaved]
  );

  const updateConfig = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.updateConfig(userId, {
        tmdbApiKey: apiKey,
        configName,
        catalogs,
        imdbCatalogs,
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
  }, [userId, apiKey, configName, catalogs, imdbCatalogs, preferences, markAsSaved]);

  const addCatalog = useCallback((catalog) => {
    setCatalogs((prev) => [...prev, { ...catalog, _id: crypto.randomUUID() }]);
    setIsDirty(true);
  }, []);

  const updateCatalog = useCallback((catalogId, updates) => {
    setCatalogs((prev) =>
      prev.map((c) => (c._id === catalogId || c.id === catalogId ? { ...c, ...updates } : c))
    );
    setIsDirty(true);
  }, []);

  const removeCatalog = useCallback((catalogId) => {
    setCatalogs((prev) => prev.filter((c) => c._id !== catalogId && c.id !== catalogId));
    setIsDirty(true);
  }, []);

  const setCatalogsAndDirty = useCallback((value) => {
    setCatalogs(value);
    setIsDirty(true);
  }, []);

  const setImdbCatalogsAndDirty = useCallback((value) => {
    setImdbCatalogs(value);
    setIsDirty(true);
  }, []);

  const setConfigNameAndDirty = useCallback((value) => {
    setConfigName(value);
    setIsDirty(true);
  }, []);

  const setPreferencesAndDirty = useCallback((value) => {
    setPreferences(value);
    setIsDirty(true);
  }, []);

  return {
    userId,
    setUserId,
    apiKey,
    setApiKey,
    catalogs,
    setCatalogs: setCatalogsAndDirty,
    imdbCatalogs,
    setImdbCatalogs: setImdbCatalogsAndDirty,
    configName,
    setConfigName: setConfigNameAndDirty,
    preferences,
    setPreferences: setPreferencesAndDirty,
    loading,
    error,
    isDirty,
    isAuthenticated,
    authChecked,
    markAsSaved,
    login,
    logout,
    applyConfig,
    loadConfig,
    saveConfig,
    updateConfig,
    addCatalog,
    updateCatalog,
    removeCatalog,
  };
}
