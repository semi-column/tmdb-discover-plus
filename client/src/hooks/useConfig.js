import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { api } from '../services/api';

export function useConfig(initialUserId = null) {
  const [userId, setUserId] = useState(initialUserId);
  const [apiKey, setApiKeyState] = useState('');
  const [catalogs, setCatalogs] = useState([]);
  const [configName, setConfigName] = useState('');
  const [preferences, setPreferences] = useState({
    showAdultContent: false,
    defaultLanguage: 'en',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // Track last saved state for dirty detection
  const savedStateRef = useRef({
    catalogs: [],
    configName: '',
    preferences: { showAdultContent: false, defaultLanguage: 'en' },
  });

  // Set API key in memory only (not stored in localStorage anymore)
  const setApiKey = useCallback((key) => {
    setApiKeyState(key);
  }, []);

  // Compute if current state differs from saved state
  const isDirty = useMemo(() => {
    const saved = savedStateRef.current;
    if (configName !== saved.configName) return true;
    if (JSON.stringify(catalogs) !== JSON.stringify(saved.catalogs)) return true;
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

  // Check for existing session or migrate legacy key on mount
  useEffect(() => {
    const checkAuth = async () => {
      // First, try existing session token
      const sessionResult = await api.verifySession();
      if (sessionResult.valid) {
        setIsAuthenticated(true);
        setUserId(sessionResult.userId);
        setAuthChecked(true);
        return;
      }

      // Try to migrate legacy API key from localStorage
      const legacyKey = api.getLegacyApiKey();
      if (legacyKey) {
        try {
          const loginResult = await api.login(legacyKey, initialUserId);
          if (loginResult.token) {
            setIsAuthenticated(true);
            setUserId(loginResult.userId);
            api.clearLegacyApiKey();
          } else if (loginResult.multipleConfigs) {
            // Has multiple configs - let user choose
            setApiKeyState(legacyKey);
            api.clearLegacyApiKey();
          }
        } catch {
          // Legacy key invalid, clear it
          api.clearLegacyApiKey();
        }
      }

      setAuthChecked(true);
    };

    checkAuth();
  }, [initialUserId]);

  // Login with API key
  const login = useCallback(
    async (key, rememberMe = true) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.login(key, userId, rememberMe);

        if (result.multipleConfigs) {
          // Store key temporarily for config selection
          setApiKeyState(key);
          return result;
        }

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

  // Select a specific config when user has multiple
  const selectConfigById = useCallback(
    async (selectedUserId, rememberMe = true) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.selectConfig(apiKey, selectedUserId, rememberMe);
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
    [apiKey]
  );

  // Logout
  const logout = useCallback(async () => {
    await api.logout();
    setIsAuthenticated(false);
    setUserId(null);
    setCatalogs([]);
    setConfigName('');
    setPreferences({ showAdultContent: false, defaultLanguage: 'en' });
    savedStateRef.current = {
      catalogs: [],
      configName: '',
      preferences: { showAdultContent: false, defaultLanguage: 'en' },
    };
  }, []);

  const loadConfig = useCallback(async (id) => {
    setLoading(true);
    setError(null);
    try {
      const config = await api.getConfig(id);
      setUserId(config.userId);
      setCatalogs(config.catalogs || []);
      setConfigName(config.configName || '');
      setPreferences(config.preferences || {});
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
    [userId, apiKey, configName, catalogs, preferences, markAsSaved]
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
    setCatalogs((prev) => [...prev, { ...catalog, _id: crypto.randomUUID() }]);
  }, []);

  const updateCatalog = useCallback((catalogId, updates) => {
    setCatalogs((prev) =>
      prev.map((c) => (c._id === catalogId || c.id === catalogId ? { ...c, ...updates } : c))
    );
  }, []);

  const removeCatalog = useCallback((catalogId) => {
    setCatalogs((prev) => prev.filter((c) => c._id !== catalogId && c.id !== catalogId));
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
    isAuthenticated,
    authChecked,
    markAsSaved,
    login,
    logout,
    selectConfigById,
    loadConfig,
    saveConfig,
    updateConfig,
    addCatalog,
    updateCatalog,
    removeCatalog,
  };
}
