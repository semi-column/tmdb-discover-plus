import { useState, useMemo, useCallback } from 'react';
import { useConfig } from './useConfig';
import { useTMDB } from './useTMDB';
import { useToast } from './useToast';
import { useInstall } from './useInstall';
import { useCatalogManager } from './useCatalogManager';
import { useConfigManager } from './useConfigManager';
import { useAuth, getUrlUserId } from './useAuth';

export function useAppController() {
  const [urlUserId, setUrlUserId] = useState(getUrlUserId);
  const config = useConfig(urlUserId);
  const tmdb = useTMDB(config.apiKey);
  const [showNewCatalogModal, setShowNewCatalogModal] = useState(false);

  const toast = useToast();
  const install = useInstall();
  const catalogs = useCatalogManager(config, toast.addToast);
  const configMgr = useConfigManager(config, toast.addToast, {
    setInstallData: install.setInstallData,
    setShowInstallModal: install.setShowInstallModal,
    setActiveCatalog: catalogs.setActiveCatalog,
    urlUserId,
    setUrlUserId,
  });
  const auth = useAuth(config, toast.addToast, urlUserId, {
    loadUserConfigs: configMgr.loadUserConfigs,
    setUserConfigs: configMgr.setUserConfigs,
    setActiveCatalog: catalogs.setActiveCatalog,
    setUrlUserId,
    setShowMismatchModal: configMgr.setShowMismatchModal,
  });

  const handleConfigMismatchGoToOwn = useCallback(async () => {
    configMgr.setShowMismatchModal(false);
    auth.setPageLoading(true);
    try {
      const configs = await configMgr.loadUserConfigs();
      if (configs && configs.length > 0) {
        window.location.href = `/?userId=${configs[0].userId}`;
      } else {
        window.location.href = '/';
      }
    } catch {
      window.location.href = '/';
    }
  }, [configMgr, auth]);

  const handleConfigMismatchLoginNew = useCallback(() => {
    configMgr.setShowMismatchModal(false);
    auth.handleLogout({ changeKey: true });
  }, [configMgr, auth]);

  const state = useMemo(
    () => ({
      isSetup: auth.isSetup,
      setIsSetup: auth.setIsSetup,
      wantsToChangeKey: auth.wantsToChangeKey,
      setWantsToChangeKey: auth.setWantsToChangeKey,
      pageLoading: auth.pageLoading,
      activeCatalog: catalogs.activeCatalog,
      setActiveCatalog: catalogs.setActiveCatalog,
      showInstallModal: install.showInstallModal,
      setShowInstallModal: install.setShowInstallModal,
      showNewCatalogModal,
      setShowNewCatalogModal,
      installData: install.installData,
      toasts: toast.toasts,
      isSaving: configMgr.isSaving,
      userConfigs: configMgr.userConfigs,
      configsLoading: configMgr.configsLoading,
      isSessionExpired: auth.isSessionExpired,
      showMismatchModal: configMgr.showMismatchModal,
    }),
    [
      auth.isSetup,
      auth.setIsSetup,
      auth.wantsToChangeKey,
      auth.setWantsToChangeKey,
      auth.pageLoading,
      auth.isSessionExpired,
      catalogs.activeCatalog,
      catalogs.setActiveCatalog,
      install.showInstallModal,
      install.setShowInstallModal,
      install.installData,
      showNewCatalogModal,
      toast.toasts,
      configMgr.isSaving,
      configMgr.userConfigs,
      configMgr.configsLoading,
      configMgr.showMismatchModal,
    ]
  );

  const actions = useMemo(
    () => ({
      addToast: toast.addToast,
      removeToast: toast.removeToast,
      handleLogin: auth.handleLogin,
      handleLogout: auth.handleLogout,
      handleValidApiKey: auth.handleValidApiKey,
      handleSave: configMgr.handleSave,
      handleDeleteConfigFromDropdown: configMgr.handleDeleteConfigFromDropdown,
      handleAddCatalog: catalogs.handleAddCatalog,
      handleAddPresetCatalog: catalogs.handleAddPresetCatalog,
      handleDeleteCatalog: catalogs.handleDeleteCatalog,
      handleDuplicateCatalog: catalogs.handleDuplicateCatalog,
      handleUpdateCatalog: catalogs.handleUpdateCatalog,
      handleImportConfig: configMgr.handleImportConfig,
      handleSwitchConfig: configMgr.handleSwitchConfig,
      handleCreateNewConfig: configMgr.handleCreateNewConfig,
      setShowMismatchModal: configMgr.setShowMismatchModal,
      handleConfigMismatchGoToOwn,
      handleConfigMismatchLoginNew,
    }),
    [
      toast.addToast,
      toast.removeToast,
      auth.handleLogin,
      auth.handleLogout,
      auth.handleValidApiKey,
      configMgr.handleSave,
      configMgr.handleDeleteConfigFromDropdown,
      configMgr.handleImportConfig,
      configMgr.handleSwitchConfig,
      configMgr.handleCreateNewConfig,
      configMgr.setShowMismatchModal,
      catalogs.handleAddCatalog,
      catalogs.handleAddPresetCatalog,
      catalogs.handleDeleteCatalog,
      catalogs.handleDuplicateCatalog,
      catalogs.handleUpdateCatalog,
      handleConfigMismatchGoToOwn,
      handleConfigMismatchLoginNew,
    ]
  );

  const data = useMemo(
    () => ({
      config,
      tmdb,
    }),
    [config, tmdb]
  );

  return { state, actions, data };
}
