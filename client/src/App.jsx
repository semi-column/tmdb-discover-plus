import { Header } from './components/Header';
import { ApiKeySetup } from './components/ApiKeySetup';
import { CatalogSidebar } from './components/CatalogSidebar';
import { CatalogEditor } from './components/CatalogEditor';
import { InstallModal } from './components/InstallModal';
import { NewCatalogModal } from './components/NewCatalogModal';
import { ToastContainer } from './components/Toast';
import { ConfigDropdown } from './components/ConfigDropdown';
import { useAppController } from './hooks/useAppController';
import { Download, Settings, Loader } from 'lucide-react';

import './styles/globals.css';
import './styles/components.css';

function App() {
  const {
    state,
    actions,
    data: { config, tmdb }
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
          onValidKey={(apiKey) => {
            state.setWantsToChangeKey(false);
            actions.handleValidApiKey(apiKey);
          }}
          onSelectExistingConfig={(apiKey, userId) => {
            state.setWantsToChangeKey(false);
            config.setApiKey(apiKey);
            actions.handleSwitchConfig(userId);
          }}
          skipAutoRedirect={state.wantsToChangeKey}
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
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              {/* Config Dropdown */}
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
              <button
                className="btn btn-secondary"
                onClick={() => {
                  state.setWantsToChangeKey(true);
                  state.setIsSetup(true);
                }}
              >
                <Settings size={18} />
                Change API Key
              </button>
              {config.catalogs.length > 0 && (
                <div className="save-button-wrapper">
                  {config.isDirty && (
                    <span className="unsaved-indicator" title="Unsaved changes" />
                  )}
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
            </div>
          </div>

          {/* Builder Layout */}
          <div className="builder-layout">
            <CatalogSidebar
              catalogs={config.catalogs}
              activeCatalog={activeCatalog}
              onSelectCatalog={state.setActiveCatalog}
              onAddCatalog={() => state.setShowNewCatalogModal(true)}
              onAddPresetCatalog={actions.handleAddPresetCatalog}
              onDeleteCatalog={actions.handleDeleteCatalog}
              onReorderCatalogs={(nextCatalogs) => {
                config.setCatalogs(nextCatalogs);
              }}
              presetCatalogs={tmdb.presetCatalogs}
              configName={config.configName}
              onConfigNameChange={config.setConfigName}
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
              getWatchProviders={tmdb.getWatchProviders}
            />
          </div>
        </div>
      </main>

      {/* Modals */}
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

      {/* Toasts */}
      <ToastContainer toasts={toasts} removeToast={actions.removeToast} />
    </div>
  );
}

export default App;
