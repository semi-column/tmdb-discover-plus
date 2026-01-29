import { Header } from './components/Header';
import { ApiKeySetup } from './components/ApiKeySetup';
import { CatalogSidebar } from './components/CatalogSidebar';
import { CatalogEditor } from './components/CatalogEditor';
import { InstallModal } from './components/InstallModal';
import { NewCatalogModal } from './components/NewCatalogModal';
import { ConfigMismatchModal } from './components/ConfigMismatchModal';
import { ToastContainer } from './components/Toast';
import { ConfigDropdown } from './components/ConfigDropdown';
import { useState, useEffect } from 'react';
import { useAppController } from './hooks/useAppController';
import { api } from './services/api';
import { Download, Settings, Loader } from 'lucide-react';

import './styles/globals.css';
import './styles/components.css';

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

  const [stats, setStats] = useState(null);

  useEffect(() => {
    api
      .getStats()
      .then(setStats)
      .catch(() => { });
  }, []);

  if (pageLoading || !config.authChecked) {
    return (
      <div className="app">
        <Header stats={stats} />
        <main className="main">
          <div className="loading" style={{ minHeight: '60vh' }}>
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
      <Header userId={config.userId} stats={stats} />

      <main className="main">
        <div className="container">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px',
            }}
          >
            <div>
              <h2 style={{ fontSize: '24px', marginBottom: '4px' }}>Catalog Builder</h2>
              <p className="text-secondary">
                Create and customize your Stremio catalogs with TMDB filters
              </p>

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

              {config.catalogs.length > 0 && (
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
                onClick={() => {
                  config.logout();
                  state.setWantsToChangeKey(true);
                  state.setIsSetup(true);
                }}
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
              onSelectCatalog={state.setActiveCatalog}
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
            />

            <CatalogEditor
              catalog={activeCatalog}
              genres={tmdb.genres}
              genresLoading={tmdb.loading}
              refreshGenres={tmdb.refresh}
              languages={tmdb.languages}
              countries={tmdb.countries}
              sortOptions={tmdb.sortOptions}
              releaseTypes={tmdb.releaseTypes}
              tvStatuses={tmdb.tvStatuses}
              tvTypes={tmdb.tvTypes}
              monetizationTypes={tmdb.monetizationTypes}
              certifications={tmdb.certifications}
              watchRegions={tmdb.watchRegions}
              tvNetworks={tmdb.tvNetworks}
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
        onLoginNew={() => {
          actions.setShowMismatchModal(false);
          config.logout();
          state.setIsSetup(true);
          state.setWantsToChangeKey(true);
        }}
      />

      <ToastContainer toasts={toasts} removeToast={actions.removeToast} />
    </div>
  );
}

export default App;
