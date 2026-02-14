import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { logger } from '../utils/logger';

export const getUrlUserId = () => {
  const searchParams = new URLSearchParams(window.location.search);
  const qsUserId = searchParams.get('userId');
  if (qsUserId) return qsUserId;

  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const last = pathParts[pathParts.length - 1];
  return last && last !== 'configure' ? last : null;
};

export function useAuth(config, addToast, urlUserId, deps) {
  const { loadUserConfigs, setUserConfigs, setActiveCatalog, setUrlUserId, setShowMismatchModal } =
    deps;

  const [isSetup, setIsSetup] = useState(false);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [wantsToChangeKey, setWantsToChangeKey] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const loginHandledRef = useRef(false);
  const configsLoadedRef = useRef(false);

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
  }, [config.authChecked, config.isAuthenticated, config.userId, loadUserConfigs, setUrlUserId]);

  useEffect(() => {
    if (isSetup) {
      loginHandledRef.current = false;
    }
  }, [isSetup]);

  useEffect(() => {
    if (!urlUserId || !config.authChecked) return;

    if (isSetup) return;

    let stale = false;

    setPageLoading(true);
    config
      .loadConfig(urlUserId)
      .then((data) => {
        if (stale) return;
        if (data.catalogs?.length > 0) {
          setActiveCatalog(data.catalogs[0]);
        }
        setPageLoading(false);
      })
      .catch(async (err) => {
        if (stale) return;

        if (err.code === 'API_KEY_MISMATCH') {
          logger.warn('[App] API key mismatch for config:', urlUserId);
          setShowMismatchModal(true);
          setPageLoading(false);
          return;
        }

        logger.error('[App] Config load error, attempting fallback:', err);

        try {
          const configs = await loadUserConfigs();
          if (stale) return;

          if (configs && configs.length > 0) {
            const latest = configs[0];

            if (latest.userId === urlUserId) {
              logger.warn('[App] Latest config is same as failed config, aborting fallback loop');
              window.history.replaceState({}, '', '/');
              setUrlUserId(null);
              setPageLoading(false);
              return;
            }

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
          if (stale) return;
          logger.error('[App] Fallback failed:', fallbackErr);
          addToast('Failed to recover configuration', 'error');
          setPageLoading(false);
        }
      });

    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    urlUserId,
    config.authChecked,
    config.isAuthenticated,
    config.userId,
    config.loadConfig,
    isSetup,
    loadUserConfigs,
    addToast,
  ]);

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
        configsLoadedRef.current = true;
        const loadedConfigs = await loadUserConfigs();

        if (!loadedConfigs || loadedConfigs.length === 0) {
          const newConfig = await api.saveConfig({
            catalogs: [],
            preferences: {},
          });
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

  return {
    isSetup,
    setIsSetup,
    isSessionExpired,
    wantsToChangeKey,
    setWantsToChangeKey,
    pageLoading,
    setPageLoading,
    handleLogin,
    handleValidApiKey: handleLogin,
  };
}
