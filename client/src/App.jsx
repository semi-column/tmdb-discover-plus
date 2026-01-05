import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { ApiKeySetup } from './components/ApiKeySetup';
import { CatalogSidebar } from './components/CatalogSidebar';
import { CatalogEditor } from './components/CatalogEditor';
import { InstallModal } from './components/InstallModal';
import { NewCatalogModal } from './components/NewCatalogModal';
import { ToastContainer } from './components/Toast';
import { useConfig } from './hooks/useConfig';
import { useTMDB } from './hooks/useTMDB';
import { api } from './services/api';
import { Download, Settings, Loader } from 'lucide-react';

import './styles/globals.css';
import './styles/components.css';

function App() {
  // Get userId from query string or pathname if present.
  // Server redirects legacy `/configure/:userId` -> `/?userId=<id>`, so prefer
  // the query param and fall back to path segment parsing for direct links.
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

  // Initialize isSetup based on whether we have a stored API key
  const [isSetup, setIsSetup] = useState(() => {
    // If we have an API key stored, don't show setup
    try {
      const storedKey = localStorage.getItem('tmdb-stremio-apikey');
      return !storedKey && !urlUserId;
    } catch {
      return !urlUserId;
    }
  });
  const [pageLoading, setPageLoading] = useState(!!urlUserId);
  const [activeCatalog, setActiveCatalog] = useState(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showNewCatalogModal, setShowNewCatalogModal] = useState(false);
  const [installData, setInstallData] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  // Load existing config if userId in URL
  useEffect(() => {
    // Load config when there's a userId in the URL. If the user has entered a local API key
    // (on the Configure page) we pass it to the server so it can resolve placeholders.
    if (urlUserId) {
      setPageLoading(true);
      console.log('[App] Loading config for userId:', urlUserId);
      const localKey = config.apiKey;
      api.getConfig(urlUserId, localKey)
        .then(data => {
          console.log('[App] Config loaded from server:', JSON.stringify({
            userId: data.userId, 
            catalogCount: data.catalogs?.length,
            catalogs: data.catalogs?.map(c => ({ _id: c._id, name: c.name, type: c.type })),
            hasApiKey: data.hasApiKey
          }, null, 2));
          config.setUserId(data.userId);
          config.setCatalogs(data.catalogs || []);
          config.setPreferences(data.preferences || {});
          // Set first catalog as active if available
          if (data.catalogs?.length > 0) {
            setActiveCatalog(data.catalogs[0]);
          }
          // Only prompt for API key if we don't have one stored
          if (!config.apiKey) {
            setIsSetup(true);
          }
          setPageLoading(false);
        })
        .catch((err) => {
          console.error('[App] Config load error:', err);
          // Config not found, show setup
          if (!config.apiKey) {
            setIsSetup(true);
          }
          setPageLoading(false);
        });
    }
  }, [urlUserId]); // We intentionally only trigger on urlUserId; additional fetch on apiKey change handled below

  // If the user enters an API key on the Configure page after the initial load,
  // re-fetch the config with that key so the server can resolve placeholders.
  useEffect(() => {
    if (!urlUserId) return;
    // Only refetch when a valid apiKey exists and page is not currently loading
    if (config.apiKey) {
      console.log('[App] Re-fetching config with local API key to resolve placeholders');
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
  }, [config.apiKey, urlUserId]);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleValidApiKey = async (apiKey) => {
    setIsSetup(false);
    setPageLoading(true);
    try {
      // Create a user config immediately so user gets a userId and can be redirected
      // Server will validate the key again but ApiKeySetup already validated it.
      const payload = {
        // If the page was loaded with a userId in the URL, include it so the
        // server will attempt to update that user instead of creating a new one.
        userId: urlUserId || undefined,
        tmdbApiKey: apiKey,
        catalogs: [],
        preferences: {},
      };

      const result = await api.saveConfig(payload);

      // Persist in local state
      config.setApiKey(apiKey);
      config.setUserId(result.userId);
      config.setCatalogs(result.catalogs || []);
      config.setPreferences(result.preferences || {});

      // Update URL to the new configure userId without reload
      if (!urlUserId) {
        window.history.pushState({}, '', `/configure/${result.userId}`);
      }

      // Immediately re-fetch the persisted config from server using the saved API key
      // so the server can resolve placeholders (people/companies/keywords) and
      // we can update the client state with human-readable names right away.
      try {
        setPageLoading(true);
        const refreshed = await api.getConfig(result.userId, apiKey);
        // Sync with server-resolved data
        config.setUserId(refreshed.userId);
        config.setCatalogs(refreshed.catalogs || result.catalogs || []);
        config.setPreferences(refreshed.preferences || result.preferences || {});
        if (refreshed.catalogs?.length > 0) setActiveCatalog(refreshed.catalogs[0]);
      } catch (err) {
        console.warn('[handleValidApiKey] Unable to re-fetch config after save:', err);
      } finally {
        setPageLoading(false);
      }
      addToast('API key saved and account created');
    } catch (err) {
      console.error('[handleValidApiKey] Error saving config:', err);
      addToast('Failed to create configuration', 'error');
    } finally {
      setPageLoading(false);
      setIsSetup(false);
    }
  };

  const handleAddCatalog = (catalogData) => {
    const newCatalog = { ...catalogData, _id: crypto.randomUUID() };
    config.setCatalogs(prev => [...prev, newCatalog]);
    setActiveCatalog(newCatalog);
  };

  const handleAddPresetCatalog = (type, preset) => {
    const newCatalog = {
      _id: crypto.randomUUID(),
      name: preset.label.replace(/^[^\s]+\s/, ''), // Remove emoji prefix
      type,
      filters: {
        listType: preset.value,
        imdbOnly: false,
      },
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

  const handleSave = async () => {
    // Get current catalogs from state at the moment of save
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
      
      console.log('[handleSave] Saving config:', JSON.stringify({ 
        userId: config.userId, 
        catalogCount: catalogsToSave.length,
        catalogs: catalogsToSave.map(c => ({ _id: c._id, name: c.name, type: c.type }))
      }, null, 2));

      const result = config.userId 
        ? await api.updateConfig(config.userId, payload)
        : await api.saveConfig(payload);

      console.log('[handleSave] Server response:', JSON.stringify({ 
        userId: result.userId, 
        catalogCount: result.catalogs?.length,
        catalogs: result.catalogs?.map(c => ({ _id: c._id, name: c.name, type: c.type }))
      }, null, 2));

      // Sync state with server response
      config.setUserId(result.userId);
      if (result.catalogs) {
        console.log('[handleSave] Setting catalogs from server response:', result.catalogs.length);
        config.setCatalogs(result.catalogs);
      }
      if (result.preferences) {
        config.setPreferences(result.preferences);
      }
      
      // Update URL without reload
      if (!urlUserId) {
        window.history.pushState({}, '', `/configure/${result.userId}`);
      }

      setInstallData({
        installUrl: result.installUrl,
        configureUrl: result.configureUrl,
        userId: result.userId,
      });
      setShowInstallModal(true);
      addToast('Configuration saved successfully!');
    } catch (err) {
      console.error('[handleSave] Error:', err);
      addToast(err.message || 'Failed to save configuration', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Show loading while fetching existing config
  if (pageLoading) {
    return (
      <div className="app">
        <Header />
        <main className="main">
          <div className="loading" style={{ minHeight: '60vh' }}>
            <div className="spinner" />
          </div>
        </main>
      </div>
    );
  }

  // Show API key setup
  if (isSetup || !config.apiKey) {
    return (
      <div className="app">
        <Header />
        <ApiKeySetup 
          onValidKey={handleValidApiKey} 
          onSelectExistingConfig={(apiKey, userId) => {
            // User selected an existing config from the list
            config.setApiKey(apiKey);
            window.location.href = `/configure/${userId}`;
          }}
          onDeleteConfig={(userId) => {
            addToast('Configuration deleted');
          }}
          onInstallConfig={(userId) => {
            // Generate install URL and show modal
            const baseUrl = window.location.origin;
            const host = baseUrl.replace(/^https?:\/\//, '');
            setInstallData({
              installUrl: `stremio://${host}/${userId}/manifest.json`,
              configureUrl: `${baseUrl}/configure/${userId}`,
              userId: userId,
            });
            setShowInstallModal(true);
          }}
        />
        {/* Install Modal for quick install from selector */}
        <InstallModal
          isOpen={showInstallModal}
          onClose={() => setShowInstallModal(false)}
          installUrl={installData?.installUrl}
          configureUrl={installData?.configureUrl}
          userId={installData?.userId}
        />
      </div>
    );
  }

  // Show loading while TMDB data is being fetched
  if (tmdb.loading) {
    return (
      <div className="app">
        <Header />
        <main className="main">
          <div className="loading" style={{ minHeight: '60vh' }}>
            <div className="spinner" />
            <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Loading TMDB data...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <Header userId={config.userId} />
      
      <main className="main">
        <div className="container">
          {/* Top Actions Bar */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '24px'
          }}>
            <div>
              <h2 style={{ fontSize: '24px', marginBottom: '4px' }}>Catalog Builder</h2>
              <p className="text-secondary">
                Create and customize your Stremio catalogs with TMDB filters
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                className="btn btn-secondary"
                onClick={() => setIsSetup(true)}
              >
                <Settings size={18} />
                Change API Key
              </button>
              {config.catalogs.length > 0 && (
                <button 
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <Loader size={18} className="animate-spin" />
                  ) : (
                    <Download size={18} />
                  )}
                  Save & Install
                </button>
              )}
            </div>
          </div>

          {/* Builder Layout */}
          <div className="builder-layout">
            <CatalogSidebar
              catalogs={config.catalogs}
              activeCatalog={activeCatalog}
              onSelectCatalog={setActiveCatalog}
              onAddCatalog={() => setShowNewCatalogModal(true)}
              onAddPresetCatalog={handleAddPresetCatalog}
              onDeleteCatalog={handleDeleteCatalog}
              presetCatalogs={tmdb.presetCatalogs}
            />

            <CatalogEditor
              catalog={activeCatalog}
              genres={tmdb.genres}
              genresLoading={tmdb.loading}
              refreshGenres={tmdb.refresh}
              languages={tmdb.languages}
              countries={tmdb.countries}
              sortOptions={tmdb.sortOptions}
              listTypes={tmdb.listTypes}
              releaseTypes={tmdb.releaseTypes}
              tvStatuses={tmdb.tvStatuses}
              tvTypes={tmdb.tvTypes}
              monetizationTypes={tmdb.monetizationTypes}
              certifications={tmdb.certifications}
              watchRegions={tmdb.watchRegions}
              tvNetworks={tmdb.tvNetworks}
              onUpdate={(id, data) => {
                config.updateCatalog(id, data);
                setActiveCatalog(data);
              }}
              onPreview={tmdb.preview}
              onSave={handleSave}
              isSaving={isSaving}
              searchPerson={tmdb.searchPerson}
              searchCompany={tmdb.searchCompany}
              searchKeyword={tmdb.searchKeyword}
              getPersonById={tmdb.getPersonById}
              getCompanyById={tmdb.getCompanyById}
              getKeywordById={tmdb.getKeywordById}
              getWatchProviders={tmdb.getWatchProviders}
            />
          </div>
        </div>
      </main>

      {/* Modals */}
      <NewCatalogModal
        isOpen={showNewCatalogModal}
        onClose={() => setShowNewCatalogModal(false)}
        onAdd={handleAddCatalog}
      />

      <InstallModal
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
        installUrl={installData?.installUrl}
        configureUrl={installData?.configureUrl}
        userId={installData?.userId}
      />

      {/* Toasts */}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}

export default App;
