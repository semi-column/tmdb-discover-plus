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

    // UI State
    const [isSetup, setIsSetup] = useState(() => {
        try {
            const storedKey = localStorage.getItem('tmdb-stremio-apikey');
            return !storedKey && !urlUserId;
        } catch {
            return !urlUserId;
        }
    });

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

    // Toast helpers
    const addToast = useCallback((message, type = 'success') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
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

    // Effect: Auto-load configs or create new if simple start
    useEffect(() => {
        const storedKey = localStorage.getItem('tmdb-stremio-apikey');
        if (storedKey && !urlUserId && !wantsToChangeKey) {
            setPageLoading(true);
            api.getConfigsByApiKey(storedKey)
                .then(async (configs) => {
                    if (configs.length > 0) {
                        configs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
                        window.location.href = `/?userId=${configs[0].userId}`;
                    } else {
                        try {
                            const newConfig = await api.saveConfig({
                                tmdbApiKey: storedKey,
                                catalogs: [],
                                preferences: {},
                            });
                            window.location.href = `/?userId=${newConfig.userId}`;
                        } catch (err) {
                            console.error('Failed to create new config:', err);
                            setPageLoading(false);
                        }
                    }
                })
                .catch(err => {
                    console.error('Failed to load configs for stored key:', err);
                    setPageLoading(false);
                });
        }
    }, [urlUserId, wantsToChangeKey]);

    // Effect: Load config from server if userId in URL
    useEffect(() => {
        if (urlUserId) {
            setPageLoading(true);
            const localKey = config.apiKey;
            api.getConfig(urlUserId, localKey)
                .then(data => {
                    config.setUserId(data.userId);
                    config.setCatalogs(data.catalogs || []);
                    config.setPreferences(data.preferences || {});
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
            api.getConfig(urlUserId, config.apiKey)
                .then((data) => {
                    config.setUserId(data.userId);
                    config.setCatalogs(data.catalogs || []);
                    config.setPreferences(data.preferences || {});
                    if (data.catalogs?.length > 0) setActiveCatalog(data.catalogs[0]);
                })
                .catch((err) => console.error('[App] Re-fetch error:', err))
                .finally(() => setPageLoading(false));
        }
    }, [config.apiKey, urlUserId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Reload history when relevant state changes
    useEffect(() => {
        if (config.apiKey && config.userId && !isSetup) {
            loadUserConfigs(config.apiKey);
        }
    }, [config.apiKey, config.userId, isSetup, loadUserConfigs]);

    // Actions
    const handleValidApiKey = async (apiKey) => {
        setIsSetup(false);
        setPageLoading(true);
        try {
            const payload = {
                userId: urlUserId || undefined,
                tmdbApiKey: apiKey,
                catalogs: [],
                preferences: {},
            };

            const result = await api.saveConfig(payload);

            config.setApiKey(apiKey);
            config.setUserId(result.userId);
            config.setCatalogs(result.catalogs || []);
            config.setPreferences(result.preferences || {});

            if (!urlUserId) {
                window.history.pushState({}, '', `/?userId=${result.userId}`);
            }

            // Re-fetch immediate for hydration
            try {
                setPageLoading(true);
                const refreshed = await api.getConfig(result.userId, apiKey);
                config.setUserId(refreshed.userId);
                config.setCatalogs(refreshed.catalogs || result.catalogs || []);
                config.setPreferences(refreshed.preferences || result.preferences || {});
                if (refreshed.catalogs?.length > 0) setActiveCatalog(refreshed.catalogs[0]);
            } catch (err) {
                console.warn('Unable to re-fetch config after save:', err);
            } finally {
                setPageLoading(false);
            }
            addToast('API key saved and account created');
        } catch (err) {
            console.error('Error saving config:', err);
            addToast('Failed to create configuration', 'error');
        } finally {
            setPageLoading(false);
            setIsSetup(false);
        }
    };

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
                catalogs: catalogsToSave,
                preferences: config.preferences,
            };

            const result = config.userId
                ? await api.updateConfig(config.userId, payload)
                : await api.saveConfig(payload);

            config.setUserId(result.userId);
            if (result.catalogs) config.setCatalogs(result.catalogs);
            if (result.preferences) config.setPreferences(result.preferences);

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
        const apiKey = config.apiKey || localStorage.getItem('tmdb-stremio-apikey');
        if (!apiKey) {
            addToast('API key not found', 'error');
            return;
        }

        try {
            await api.deleteConfig(userId, apiKey);
        } catch (err) {
            if (!err.message?.includes('not found')) {
                addToast('Failed to delete configuration', 'error');
                throw err;
            }
        }

        const remaining = userConfigs.filter(c => c.userId !== userId);
        setUserConfigs(remaining);
        addToast('Configuration deleted');

        if (userId === config.userId) {
            if (remaining.length > 0) {
                window.location.href = `/?userId=${remaining[0].userId}`;
            } else {
                localStorage.removeItem('tmdb-stremio-apikey');
                window.location.href = '/';
            }
        }
    };

    // Creation logic for new catalog
    const handleAddCatalog = (catalogData) => {
        const newCatalog = { ...catalogData, _id: crypto.randomUUID() };
        config.setCatalogs(prev => [...prev, newCatalog]);
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
        config.setCatalogs(prev => [...prev, newCatalog]);
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
        },
        actions: {
            addToast,
            removeToast,
            handleValidApiKey,
            handleSave,
            handleDeleteConfigFromDropdown,
            handleAddCatalog,
            handleAddPresetCatalog,
            handleDeleteCatalog,
            handleUpdateCatalog,
            handleSwitchConfig: (uid) => window.location.href = `/?userId=${uid}`,
            handleCreateNewConfig: async () => {
                try {
                    const newConfig = await api.saveConfig({
                        tmdbApiKey: config.apiKey,
                        catalogs: [],
                        preferences: {},
                    });
                    window.location.href = `/?userId=${newConfig.userId}`;
                } catch (err) {
                    addToast('Failed to create new configuration', 'error');
                }
            }
        },
        data: {
            config,
            tmdb,
        },
    };
}
