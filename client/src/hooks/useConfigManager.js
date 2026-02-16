import { useState, useCallback, useRef } from 'react';
import { api } from '../services/api';
import { logger } from '../utils/logger';

export function useConfigManager(config, addToast, deps) {
  const { setInstallData, setShowInstallModal, setActiveCatalog, urlUserId, setUrlUserId } = deps;

  const [isSaving, setIsSaving] = useState(false);
  const [userConfigs, setUserConfigs] = useState([]);
  const [configsLoading, setConfigsLoading] = useState(false);
  const [showMismatchModal, setShowMismatchModal] = useState(false);
  const loadingLockRef = useRef(false);

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

      config.applyConfig(result);

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

  const handleImportConfig = (importedData) => {
    try {
      if (!importedData || typeof importedData !== 'object') {
        throw new Error('Invalid configuration file');
      }

      if (importedData.catalogs && !Array.isArray(importedData.catalogs)) {
        throw new Error('Invalid catalogs format');
      }

      if (importedData.catalogs) {
        const newCatalogs = importedData.catalogs.map((c) => ({
          ...c,
          _id: crypto.randomUUID(),
          id: crypto.randomUUID(),
        }));
        config.setCatalogs((prev) => [...prev, ...newCatalogs]);
        if (newCatalogs.length > 0) {
          setActiveCatalog(newCatalogs[0]);
        }
      }

      if (importedData.preferences) {
        config.setPreferences((p) => ({ ...p, ...importedData.preferences }));
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

  const handleSwitchConfig = (uid) => {
    window.location.href = `/?userId=${uid}`;
  };

  const handleCreateNewConfig = async () => {
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
  };

  return {
    isSaving,
    userConfigs,
    setUserConfigs,
    configsLoading,
    showMismatchModal,
    setShowMismatchModal,
    loadUserConfigs,
    handleSave,
    handleDeleteConfigFromDropdown,
    handleImportConfig,
    handleSwitchConfig,
    handleCreateNewConfig,
  };
}
