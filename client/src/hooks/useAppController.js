import { useState, useEffect, useCallback } from 'react';
import { useConfig } from './useConfig';
import { useTMDB } from './useTMDB';
import { api } from '../services/api';

export function useAppController() {
  // Parsing userId from URL
  const searchParams = new URLSearchParams(window.location.search);
  const qsUserId = searchParams.get('userId');
  let urlUserId = null;
  if (qsUserId) {
    urlUserId = qsUserId;
  } else {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const last = pathParts[pathParts.length - 1];
    urlUserId = last && last !== 'configure' ? last : null;
  }

  const config = useConfig(urlUserId);
  const tmdb = useTMDB(config.apiKey);

  // UI State - determine setup based on auth state
  const [isSetup, setIsSetup] = useState(false);
  const [isSessionExpired, setIsSessionExpired] = useState(false);

  const [wantsToChangeKey, setWantsToChangeKey] = useState(false);
  const [pageLoading, setPageLoading] = useState(!!urlUserId);
  const [activeCatalog, setActiveCatalog] = useState(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showNewCatalogModal, setShowNewCatalogModal] = useState(false);
  const [installData, setInstallData] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [userConfigs, setUserConfigs] = useState([]);
  const [configsLoading, setConfigsLoading] = useState(false);

  // Toast helpers - with deduplication
  const addToast = useCallback((message, type = 'success') => {
    setToasts((prev) => {
      // Prevent duplicate toasts with same message within last 2 seconds
      const recentDupe = prev.find((t) => t.message === message && Date.now() - t.id < 2000);
      if (recentDupe) return prev;

      const id = Date.now();
      return [...prev, { id, message, type }];
    });
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Load user configs (history)
  const loadUserConfigs = useCallback(async (apiKey) => {
    if (!apiKey) return [];
    setConfigsLoading(true);
    try {
      const configs = await api.getConfigsByApiKey(apiKey);
      configs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      setUserConfigs(configs);
      return configs;
    } catch (err) {
      console.error('Failed to load user configs:', err);
      return [];
    } finally {
      setConfigsLoading(false);
    }
  }, []);

  // Effect: Initial auth check (replaces old localStorage check)
  useEffect(() => {
    if (!config.authChecked) return;

    if (!config.isAuthenticated && !urlUserId) {
      // Not authenticated and no userId in URL - show setup
      setIsSetup(true);
      setPageLoading(false);
    } else if (!config.isAuthenticated && urlUserId) {
      // Not authenticated but have userId - session might be expired
      setIsSessionExpired(true);
      setIsSetup(true);
      setPageLoading(false);
    } else if (config.isAuthenticated && !urlUserId) {
      // Authenticated but no userId - redirect to user's config
      if (config.userId) {
        window.history.replaceState({}, '', `/?userId=${config.userId}`);
      }
    }
  }, [config.authChecked, config.isAuthenticated, config.userId, urlUserId]);

  // Effect: Load config from server if userId in URL
  useEffect(() => {
    if (urlUserId) {
      setPageLoading(true);
      config
        .loadConfig(urlUserId)
        .then((data) => {
          if (data.catalogs?.length > 0) {
            setActiveCatalog(data.catalogs[0]);
          }
          if (!config.apiKey) {
            setIsSetup(true);
          }
          setPageLoading(false);
        })
        .catch((err) => {
          console.error('[App] Config load error:', err);
          if (!config.apiKey) setIsSetup(true);
          setPageLoading(false);
        });
    }
  }, [urlUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effect: Re-fetch if API key changes (to resolve placeholders)
  useEffect(() => {
    if (!urlUserId) return;
    if (config.apiKey) {
      setPageLoading(true);
      config
        .loadConfig(urlUserId)
        .then((data) => {
          if (data.catalogs?.length > 0) setActiveCatalog(data.catalogs[0]);
        })
        .catch((err) => console.error('[App] Re-fetch error:', err))
        .finally(() => setPageLoading(false));
    }
  }, [config.apiKey, urlUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload history when authenticated
  useEffect(() => {
    if (config.isAuthenticated && config.userId && !isSetup) {
      loadUserConfigs();
    }
  }, [config.isAuthenticated, config.userId, isSetup, loadUserConfigs]);

  // Handle successful login
  const handleLogin = async (userId) => {
    setIsSetup(false);
    setIsSessionExpired(false);
    setPageLoading(true);

    try {
      const data = await config.loadConfig(userId);
      if (data.catalogs?.length > 0) {
        setActiveCatalog(data.catalogs[0]);
      }
      window.history.replaceState({}, '', `/?userId=${userId}`);
      addToast('Logged in successfully');
    } catch (err) {
      console.error('Error loading config after login:', err);
      addToast('Failed to load configuration', 'error');
    } finally {
      setPageLoading(false);
    }
  };

  // Legacy handler kept for compatibility
  const handleValidApiKey = handleLogin;

  const handleSave = async () => {
    const catalogsToSave = [...config.catalogs];
    if (catalogsToSave.length === 0) {
      addToast('Add at least one catalog before saving', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        tmdbApiKey: config.apiKey,
        configName: config.configName,
        catalogs: catalogsToSave,
        preferences: config.preferences,
      };

      const result = config.userId
        ? await api.updateConfig(config.userId, payload)
        : await api.saveConfig(payload);

      config.setUserId(result.userId);
      if (result.configName !== undefined) config.setConfigName(result.configName);
      if (result.catalogs) config.setCatalogs(result.catalogs);
      if (result.preferences) config.setPreferences(result.preferences);

      // Mark as saved to clear dirty state
      config.markAsSaved();

      if (!urlUserId) {
        window.history.pushState({}, '', `/?userId=${result.userId}`);
      }

      await loadUserConfigs(config.apiKey);

      setInstallData({
        installUrl: result.installUrl,
        stremioUrl: result.stremioUrl,
        configureUrl: result.configureUrl,
        userId: result.userId,
      });
      setShowInstallModal(true);
      addToast('Configuration saved successfully!');
    } catch (err) {
      console.error('Error:', err);
      addToast(err.message || 'Failed to save configuration', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteConfigFromDropdown = async (userId) => {
    try {
      await api.deleteConfig(userId);
    } catch (err) {
      if (!err.message?.includes('not found')) {
        addToast('Failed to delete configuration', 'error');
        throw err;
      }
    }

    const remaining = userConfigs.filter((c) => c.userId !== userId);
    setUserConfigs(remaining);
    addToast('Configuration deleted');

    if (userId === config.userId) {
      if (remaining.length > 0) {
        window.location.href = `/?userId=${remaining[0].userId}`;
      } else {
        await config.logout();
        window.location.href = '/';
      }
    }
  };

  // Creation logic for new catalog
  const handleAddCatalog = (catalogData) => {
    const newCatalog = { ...catalogData, _id: crypto.randomUUID() };
    config.setCatalogs((prev) => [...prev, newCatalog]);
    setActiveCatalog(newCatalog);
  };

  const handleAddPresetCatalog = (type, preset) => {
    const newCatalog = {
      _id: crypto.randomUUID(),
      name: preset.label.replace(/^[^\s]+\s/, ''),
      type,
      filters: { listType: preset.value, imdbOnly: false },
      enabled: true,
    };
    config.setCatalogs((prev) => [...prev, newCatalog]);
    setActiveCatalog(newCatalog);
  };

  const handleDeleteCatalog = (catalogId) => {
    config.removeCatalog(catalogId);
    if (activeCatalog?._id === catalogId) {
      setActiveCatalog(null);
    }
    addToast('Catalog deleted');
  };

  const handleUpdateCatalog = (id, data) => {
    config.updateCatalog(id, data);
    setActiveCatalog(data);
  };

  return {
    state: {
      isSetup,
      setIsSetup, // exposed for manual trigger
      wantsToChangeKey,
      setWantsToChangeKey,
      pageLoading,
      activeCatalog,
      setActiveCatalog,
      showInstallModal,
      setShowInstallModal,
      showNewCatalogModal,
      setShowNewCatalogModal,
      installData,
      toasts,
      isSaving,
      userConfigs,
      configsLoading,
      isSessionExpired,
    },
    actions: {
      addToast,
      removeToast,
      handleLogin,
      handleValidApiKey,
      handleSave,
      handleDeleteConfigFromDropdown,
      handleAddCatalog,
      handleAddPresetCatalog,
      handleDeleteCatalog,
      handleUpdateCatalog,
      handleSwitchConfig: (uid) => (window.location.href = `/?userId=${uid}`),
      handleCreateNewConfig: async () => {
        try {
          const newConfig = await api.saveConfig({
            tmdbApiKey: config.apiKey,
            catalogs: [],
            preferences: {},
          });
          window.location.href = `/?userId=${newConfig.userId}`;
        } catch {
          addToast('Failed to create new configuration', 'error');
        }
      },
    },
    data: {
      config,
      tmdb,
    },
  };
}
