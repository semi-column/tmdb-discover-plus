import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfig } from './useConfig';
import { useTMDB } from './useTMDB';
import { api } from '../services/api';
import { logger } from '../utils/logger';

export function useAppController() {
  // Get userId from URL (read once per render)
  const getUrlUserId = () => {
    const searchParams = new URLSearchParams(window.location.search);
    const qsUserId = searchParams.get('userId');
    if (qsUserId) return qsUserId;
    
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const last = pathParts[pathParts.length - 1];
    return last && last !== 'configure' ? last : null;
  };

  const [urlUserId, setUrlUserId] = useState(getUrlUserId);

  const config = useConfig(urlUserId);
  const tmdb = useTMDB(config.apiKey);

  // UI State - start with loading true, let auth effect decide what to show
  const [isSetup, setIsSetup] = useState(false);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [wantsToChangeKey, setWantsToChangeKey] = useState(false);
  // Start with pageLoading true - we're always loading until auth is checked
  const [pageLoading, setPageLoading] = useState(true);
  const [activeCatalog, setActiveCatalog] = useState(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showNewCatalogModal, setShowNewCatalogModal] = useState(false);
  const [installData, setInstallData] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [userConfigs, setUserConfigs] = useState([]);
  const [configsLoading, setConfigsLoading] = useState(false);

  // Guards to prevent duplicate operations
  const loginHandledRef = useRef(false);
  const configsLoadedRef = useRef(false);
  const loadingLockRef = useRef(false);

  // Toast helpers
  const addToast = useCallback((message, type = 'success') => {
    setToasts((prev) => {
      const recentDupe = prev.find((t) => t.message === message && Date.now() - t.id < 2000);
      if (recentDupe) return prev;
      return [...prev, { id: Date.now(), message, type }];
    });
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Load user configs - stable function with ref-based lock
  const loadUserConfigs = useCallback(async () => {
    if (loadingLockRef.current) return [];
    
    loadingLockRef.current = true;
    setConfigsLoading(true);
    try {
      const configs = await api.getConfigsByApiKey();
      configs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      setUserConfigs(configs);
      return configs;
    } catch (err) {
      logger.error('Failed to load user configs:', err);
      return [];
    } finally {
      setConfigsLoading(false);
      loadingLockRef.current = false;
    }
  }, []); // Empty deps - uses ref for stability

  // SINGLE consolidated auth effect
  useEffect(() => {
    // Wait for auth check to complete
    if (!config.authChecked) return;

    const currentUrlUserId = getUrlUserId();

    if (config.isAuthenticated) {
      // User is authenticated
      setIsSetup(false);
      setIsSessionExpired(false);
      
      // If no userId in URL, redirect to user's config
      if (!currentUrlUserId && config.userId) {
        window.history.replaceState({}, '', `/?userId=${config.userId}`);
        setUrlUserId(config.userId);
      }
      
      // Load user configs once
      if (!configsLoadedRef.current) {
        configsLoadedRef.current = true;
        loadUserConfigs();
      }
      
      setPageLoading(false);
    } else {
      // Not authenticated
      if (currentUrlUserId) {
        // Has userId in URL but not authenticated - session expired
        setIsSessionExpired(true);
      }
      setIsSetup(true);
      setPageLoading(false);
    }
  }, [config.authChecked, config.isAuthenticated, config.userId, loadUserConfigs]);

  // Reset login lock when entering setup mode
  useEffect(() => {
    if (isSetup) {
      loginHandledRef.current = false;
    }
  }, [isSetup]);

  // Effect: Load config from server if userId in URL
  useEffect(() => {
    if (!urlUserId || !config.authChecked) return;
    
    // Don't load if we're showing setup
    if (isSetup) return;

    setPageLoading(true);
    config
      .loadConfig(urlUserId)
      .then((data) => {
        if (data.catalogs?.length > 0) {
          setActiveCatalog(data.catalogs[0]);
        }
        setPageLoading(false);
      })
      .catch(async (err) => {
        logger.error('[App] Config load error, attempting fallback:', err);
        
        // 404 or 403 means the config in URL is invalid/gone/unauthorized
        // We should fallback to the user's latest config or create a new one
        try {
          // Ensure we have the latest list
          const configs = await loadUserConfigs();
          
          if (configs && configs.length > 0) {
            // Switch to latest
            const latest = configs[0];
            logger.info('[App] Falling back to latest config:', latest.userId);
            setPageLoading(true); // Ensure loading stays true
            window.history.replaceState({}, '', `/?userId=${latest.userId}`);
            setUrlUserId(latest.userId);
            // The effect will re-trigger with new ID
          } else {
            // No configs exist, create one
            logger.info('[App] No configs found, creating new one');
            const newConfig = await api.saveConfig({
              tmdbApiKey: config.apiKey,
              catalogs: [],
              preferences: {},
            });
            setPageLoading(true); // Ensure loading stays true
            window.history.replaceState({}, '', `/?userId=${newConfig.userId}`);
            setUrlUserId(newConfig.userId);
            // Refresh list
            await loadUserConfigs();
          }
        } catch (fallbackErr) {
          logger.error('[App] Fallback failed:', fallbackErr);
          addToast('Failed to recover configuration', 'error');
          setPageLoading(false); // Only stop loading if fallback completely failed
        }
      });
  }, [urlUserId, config.authChecked, isSetup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle successful login from ApiKeySetup form
  const handleLogin = async (userId, configs = []) => {
    // Prevent multiple login handling
    if (loginHandledRef.current) return;
    loginHandledRef.current = true;

    setIsSetup(false);
    setIsSessionExpired(false);
    setPageLoading(true);

    try {
      // If configs were returned from login, use them immediately
      if (configs && configs.length > 0) {
        configs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        setUserConfigs(configs);
        configsLoadedRef.current = true; // Mark as loaded
      }

      const data = await config.loadConfig(userId);
      if (data.catalogs?.length > 0) {
        setActiveCatalog(data.catalogs[0]);
      }
      
      // Update URL
      window.history.replaceState({}, '', `/?userId=${userId}`);
      setUrlUserId(userId);
      
      addToast('Logged in successfully');

      // If no configs were passed, load them
      if (!configs || configs.length === 0) {
        configsLoadedRef.current = true;
        loadUserConfigs();
      }
    } catch (err) {
      logger.error('Error loading config after login:', err);
      addToast('Failed to load configuration', 'error');
      loginHandledRef.current = false; // Allow retry
    } finally {
      setPageLoading(false);
    }
  };

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
      config.markAsSaved();

      if (!urlUserId) {
        window.history.pushState({}, '', `/?userId=${result.userId}`);
        setUrlUserId(result.userId);
      }

      // Reload configs list
      loadingLockRef.current = false; // Reset lock
      await loadUserConfigs();

      setInstallData({
        installUrl: result.installUrl,
        stremioUrl: result.stremioUrl,
        configureUrl: result.configureUrl,
        userId: result.userId,
      });
      setShowInstallModal(true);
      addToast('Configuration saved successfully!');
    } catch (err) {
      logger.error('Error:', err);
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
      filters: { listType: preset.value },
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

  const handleDuplicateCatalog = (catalogId) => {
    const catalog = config.catalogs.find((c) => c._id === catalogId || c.id === catalogId);
    if (!catalog) return;

    const newCatalog = {
      ...JSON.parse(JSON.stringify(catalog)),
      _id: crypto.randomUUID(),
      id: crypto.randomUUID(), // Ensure both ID fields are new
      name: `${catalog.name} (Copy)`,
    };
    
    config.setCatalogs((prev) => [...prev, newCatalog]);
    setActiveCatalog(newCatalog);
    addToast('Catalog duplicated');
  };

  const handleUpdateCatalog = (id, data) => {
    config.updateCatalog(id, data);
    setActiveCatalog(data);
  };

  return {
    state: {
      isSetup,
      setIsSetup,
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
      handleDuplicateCatalog,
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
