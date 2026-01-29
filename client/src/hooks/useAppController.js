import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfig } from './useConfig';
import { useTMDB } from './useTMDB';
import { api } from '../services/api';
import { logger } from '../utils/logger';

export function useAppController() {
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

  const [isSetup, setIsSetup] = useState(false);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [wantsToChangeKey, setWantsToChangeKey] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [activeCatalog, setActiveCatalog] = useState(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showNewCatalogModal, setShowNewCatalogModal] = useState(false);
  const [installData, setInstallData] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [userConfigs, setUserConfigs] = useState([]);
  const [configsLoading, setConfigsLoading] = useState(false);
  const [showMismatchModal, setShowMismatchModal] = useState(false);
  const loginHandledRef = useRef(false);
  const configsLoadedRef = useRef(false);
  const loadingLockRef = useRef(false);
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
  }, []);

  useEffect(() => {
    if (!config.authChecked) return;

    const currentUrlUserId = getUrlUserId();

    if (config.isAuthenticated) {
      setIsSetup(false);
      setIsSessionExpired(false);
      
      if (!currentUrlUserId && config.userId) {
        window.history.replaceState({}, '', `/?userId=${config.userId}`);
        setUrlUserId(config.userId);
      }
      
      if (!configsLoadedRef.current) {
        configsLoadedRef.current = true;
        loadUserConfigs();
      }
      
      setPageLoading(false);
    } else {
      if (currentUrlUserId) {
        setIsSessionExpired(true);
      }
      setIsSetup(true);
      setPageLoading(false);
    }
  }, [config.authChecked, config.isAuthenticated, config.userId, loadUserConfigs]);
  useEffect(() => {
    if (isSetup) {
      loginHandledRef.current = false;
    }
  }, [isSetup]);
  useEffect(() => {
    if (!urlUserId || !config.authChecked) return;
    
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
        if (err.code === 'API_KEY_MISMATCH') {
          logger.warn('[App] API key mismatch for config:', urlUserId);
          setShowMismatchModal(true);
          setPageLoading(false);
          return;
        }

        logger.error('[App] Config load error, attempting fallback:', err);
        
        try {
          const configs = await loadUserConfigs();
          
          if (configs && configs.length > 0) {
            const latest = configs[0];
            logger.info('[App] Falling back to latest config:', latest.userId);
            setPageLoading(true);
            window.history.replaceState({}, '', `/?userId=${latest.userId}`);
            setUrlUserId(latest.userId);
          } else {
            window.history.replaceState({}, '', '/');
            setUrlUserId(null); 
            setPageLoading(false);
          }
        } catch (fallbackErr) {
          logger.error('[App] Fallback failed:', fallbackErr);
          addToast('Failed to recover configuration', 'error');
          setPageLoading(false);
        }
      });
  }, [urlUserId, config.authChecked, isSetup]);

  const handleLogin = async (userId, configs = []) => {
    if (loginHandledRef.current) return;
    loginHandledRef.current = true;

    setIsSetup(false);
    setIsSessionExpired(false);
    setPageLoading(true);

    try {
      if (configs && configs.length > 0) {
        configs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        setUserConfigs(configs);
        configsLoadedRef.current = true;
      }

      const data = await config.loadConfig(userId);
      if (data.catalogs?.length > 0) {
        setActiveCatalog(data.catalogs[0]);
      }
      
      window.history.replaceState({}, '', `/?userId=${userId}`);
      setUrlUserId(userId);
      
      addToast('Logged in successfully');
      if (!configs || configs.length === 0) {
        configsLoadedRef.current = true; // Set lock before loading
        const loadedConfigs = await loadUserConfigs();
        
        if (!loadedConfigs || loadedConfigs.length === 0) {
             const newConfig = await api.saveConfig({
                catalogs: [],
                preferences: {},
             });
             // Update URL to new config
             window.history.replaceState({}, '', `/?userId=${newConfig.userId}`);
             setUrlUserId(newConfig.userId);
             await config.loadConfig(newConfig.userId);
        }
      }
    } catch (err) {
      logger.error('Error loading config after login:', err);
      addToast('Failed to load configuration', 'error');
      loginHandledRef.current = false;
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

      loadingLockRef.current = false;
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
      id: crypto.randomUUID(),
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

  const handleImportConfig = (importedData) => {
    try {
      if (!importedData || typeof importedData !== 'object') {
        throw new Error('Invalid configuration file');
      }

      if (importedData.catalogs && !Array.isArray(importedData.catalogs)) {
        throw new Error('Invalid catalogs format');
      }

      if (importedData.catalogs) {
         const newCatalogs = importedData.catalogs.map(c => ({
            ...c,
            _id: c._id || crypto.randomUUID(),
            id: c.id || crypto.randomUUID() 
         }));
         config.setCatalogs(newCatalogs);
         if (newCatalogs.length > 0) {
            setActiveCatalog(newCatalogs[0]);
         }
      }

      if (importedData.preferences) {
        config.setPreferences(p => ({ ...p, ...importedData.preferences }));
      }
      
      if (importedData.configName) {
        config.setConfigName(importedData.configName);
      }

      addToast('Configuration imported successfully');
    } catch (err) {
      logger.error('Import config failed:', err);
      addToast(err.message || 'Failed to import configuration', 'error');
    }
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
      showMismatchModal,
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
      handleImportConfig,
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
      setShowMismatchModal,
      handleConfigMismatchGoToOwn: async () => {
        setShowMismatchModal(false);
        setPageLoading(true);
        try {
          const configs = await loadUserConfigs();
          if (configs && configs.length > 0) {
            window.location.href = `/?userId=${configs[0].userId}`;
          } else {
            // No configs - show setup or create one
            window.location.href = '/';
          }
        } catch {
          window.location.href = '/';
        }
      },
    },
    data: {
      config,
      tmdb,
    },
  };
}
