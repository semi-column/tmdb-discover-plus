import { Header } from './components/layout/Header';
import { ApiKeySetup } from './components/auth/ApiKeySetup';
import { CatalogSidebar } from './components/config/CatalogSidebar';
import { InstallModal } from './components/modals/InstallModal';
import { NewCatalogModal } from './components/modals/NewCatalogModal';
import { ConfigMismatchModal } from './components/modals/ConfigMismatchModal';
import { ToastContainer } from './components/layout/Toast';
import { ConfigDropdown } from './components/config/ConfigDropdown';
import { useState, useEffect, lazy, Suspense } from 'react';
import { useAppController } from './hooks/useAppController';
import { api } from './services/api';
import { Download, Settings, Loader } from 'lucide-react';
import { FilterPanelSkeleton, CatalogListSkeleton } from './components/layout/Skeleton';

import './styles/globals.css';
import './styles/components.css';

const CatalogEditor = lazy(() =>
  import('./components/config/CatalogEditor').then((m) => ({ default: m.CatalogEditor }))
);
const ImdbCatalogEditor = lazy(() =>
  import('./components/config/ImdbCatalogEditor').then((m) => ({ default: m.ImdbCatalogEditor }))
);

function App() {
  const {
    state,
    actions,
    data: { config, tmdb },
  } = useAppController();

  const {
    isSetup,
    pageLoading,
    activeCatalog,
    showInstallModal,
    showNewCatalogModal,
    installData,
    toasts,
    isSaving,
    userConfigs,
    configsLoading,
  } = state;

  const activeImdbCatalog = state.activeImdbCatalog;
  const imdbData = tmdb.imdb || null;

  const [stats, setStats] = useState(null);

  useEffect(() => {
    let stale = false;
    api
      .getStats()
      .then((data) => {
        if (!stale) setStats(data);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, []);

  if (pageLoading || !config.authChecked) {
    return (
      <div className="app">
        <Header stats={stats} />
        <main className="main">
          <div className="loading loading--page">
            <div className="spinner" />
          </div>
        </main>
      </div>
    );
  }

  if (isSetup) {
    return (
      <div className="app">
        <Header stats={stats} />
        <ApiKeySetup
          onLogin={(userId, configs) => {
            state.setWantsToChangeKey(false);
            actions.handleLogin(userId, configs);
          }}
          isSessionExpired={state.isSessionExpired}
          returnUserId={config.userId}
        />
      </div>
    );
  }

  if (tmdb.loading) {
    return (
      <div className="app">
        <Header />
        <main className="main">
          <div className="container">
            <div className="builder-toolbar">
              <div>
                <div
                  className="skeleton-box"
                  style={{ width: 200, height: 24, borderRadius: 6, marginBottom: 8 }}
                />
                <div className="skeleton-box" style={{ width: 320, height: 14, borderRadius: 4 }} />
              </div>
            </div>
            <div className="builder-layout">
              <aside className="sidebar">
                <CatalogListSkeleton count={4} />
              </aside>
              <div className="editor-panel" style={{ padding: 24 }}>
                <FilterPanelSkeleton />
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <a href="#main-content" className="skip-to-content">
        Skip to content
      </a>
      <Header userId={config.userId} stats={stats} />

      <main className="main" id="main-content">
        <div className="container">
          <div className="builder-toolbar">
            <div>
              <h2>Catalog Builder</h2>
              <p className="text-secondary">
                Create and customize your Stremio catalogs with TMDB filters
              </p>

              {tmdb.error && (
                <div className="tmdb-error-banner" role="alert">
                  Failed to load TMDB data: {tmdb.error}
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={tmdb.refresh}
                    style={{ marginLeft: 8 }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {stats && (
                <div className="mobile-stats-pill">
                  <span>
                    <strong>{stats.totalUsers.toLocaleString()}</strong> Users
                  </span>
                  <span className="divider">•</span>
                  <span>
                    <strong>{stats.totalCatalogs.toLocaleString()}</strong> Catalogs
                  </span>
                </div>
              )}
            </div>
            <div className="actions-toolbar">
              {userConfigs.length > 0 && (
                <ConfigDropdown
                  configs={userConfigs}
                  currentUserId={config.userId}
                  currentCatalogs={config.catalogs}
                  currentConfigName={config.configName}
                  loading={configsLoading}
                  onSelectConfig={actions.handleSwitchConfig}
                  onDeleteConfig={actions.handleDeleteConfigFromDropdown}
                  onCreateNew={actions.handleCreateNewConfig}
                />
              )}

              {(config.catalogs.length > 0 || (config.imdbCatalogs || []).length > 0) && (
                <div className="save-button-wrapper">
                  {config.isDirty && <span className="unsaved-indicator" title="Unsaved changes" />}
                  <button
                    className="btn btn-primary"
                    onClick={actions.handleSave}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <Loader size={18} className="animate-spin" />
                    ) : (
                      <Download size={18} />
                    )}
                    Save & Install
                  </button>
                </div>
              )}

              <button
                className="btn btn-secondary"
                onClick={() => actions.handleLogout({ changeKey: true })}
              >
                <Settings size={18} />
                Change API Key
              </button>
            </div>
          </div>

          <div className="builder-layout">
            <CatalogSidebar
              catalogs={config.catalogs}
              activeCatalog={activeCatalog}
              onSelectCatalog={(cat) => {
                state.setActiveCatalog(cat);
                if (cat) state.setActiveImdbCatalog(null);
              }}
              onAddCatalog={() => state.setShowNewCatalogModal(true)}
              onAddPresetCatalog={actions.handleAddPresetCatalog}
              onDeleteCatalog={actions.handleDeleteCatalog}
              onDuplicateCatalog={actions.handleDuplicateCatalog}
              onReorderCatalogs={(nextCatalogs) => {
                config.setCatalogs(nextCatalogs);
              }}
              presetCatalogs={tmdb.presetCatalogs}
              configName={config.configName}
              onConfigNameChange={config.setConfigName}
              preferences={config.preferences}
              onPreferencesChange={config.setPreferences}
              onImportConfig={actions.handleImportConfig}
              languages={tmdb.languages}
              addToast={actions.addToast}
              imdbCatalogs={config.imdbCatalogs}
              activeImdbCatalog={activeImdbCatalog}
              onSelectImdbCatalog={(cat) => {
                state.setActiveImdbCatalog(cat);
                if (cat) state.setActiveCatalog(null);
              }}
              onAddImdbPresetCatalog={actions.handleAddImdbPresetCatalog}
              imdbPresetCatalogs={imdbData?.presetCatalogs || { movie: [], series: [] }}
              imdbAvailable={!!imdbData?.available}
            />

            <Suspense
              fallback={
                <div className="editor-panel editor-loading">
                  <div className="spinner" />
                </div>
              }
            >
              {activeImdbCatalog ? (
                <ImdbCatalogEditor
                  catalog={activeImdbCatalog}
                  imdbData={imdbData}
                  onUpdate={actions.handleUpdateImdbCatalog}
                  onDelete={actions.handleDeleteImdbCatalog}
                />
              ) : (
                <CatalogEditor
                  catalog={activeCatalog}
                  genres={tmdb.genres}
                  genresLoading={tmdb.loading}
                  refreshGenres={tmdb.refresh}
                  languages={tmdb.languages}
                  originalLanguages={tmdb.originalLanguages}
                  countries={tmdb.countries}
                  sortOptions={tmdb.sortOptions}
                  releaseTypes={tmdb.releaseTypes}
                  tvStatuses={tmdb.tvStatuses}
                  tvTypes={tmdb.tvTypes}
                  monetizationTypes={tmdb.monetizationTypes}
                  certifications={tmdb.certifications}
                  watchRegions={tmdb.watchRegions}
                  tvNetworks={tmdb.tvNetworks}
                  preferences={config.preferences}
                  onUpdate={actions.handleUpdateCatalog}
                  onPreview={tmdb.preview}
                  searchPerson={tmdb.searchPerson}
                  searchCompany={tmdb.searchCompany}
                  searchKeyword={tmdb.searchKeyword}
                  searchTVNetworks={tmdb.searchTVNetworks}
                  getPersonById={tmdb.getPersonById}
                  getCompanyById={tmdb.getCompanyById}
                  getKeywordById={tmdb.getKeywordById}
                  getNetworkById={tmdb.getNetworkById}
                  getWatchProviders={tmdb.getWatchProviders}
                />
              )}
            </Suspense>
          </div>
        </div>
      </main>

      <NewCatalogModal
        isOpen={showNewCatalogModal}
        onClose={() => state.setShowNewCatalogModal(false)}
        onAdd={actions.handleAddCatalog}
      />

      <InstallModal
        isOpen={showInstallModal}
        onClose={() => state.setShowInstallModal(false)}
        installUrl={installData?.installUrl}
        stremioUrl={installData?.stremioUrl}
        configureUrl={installData?.configureUrl}
        userId={installData?.userId}
      />

      <ConfigMismatchModal
        isOpen={state.showMismatchModal}
        onGoToOwn={actions.handleConfigMismatchGoToOwn}
        onLoginNew={actions.handleConfigMismatchLoginNew}
      />

      <ToastContainer toasts={toasts} removeToast={actions.removeToast} />
    </div>
  );
}

export default App;
