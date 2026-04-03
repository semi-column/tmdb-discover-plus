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
import { Download, Settings, Loader, Coffee } from 'lucide-react';
import { FilterPanelSkeleton, CatalogListSkeleton } from './components/layout/Skeleton';
import { PanelErrorBoundary } from './components/layout/PanelErrorBoundary';
import { CreditsBanner } from './components/layout/CreditsBanner';
import { DiscordIcon } from './components/social/DiscordButton.jsx';
import { AppProviders } from './context/AppContext';

import './styles/globals.css';
import './styles/layout.css';
import './styles/sidebar.css';
import './styles/editor.css';
import './styles/filters.css';
import './styles/forms.css';
import './styles/modals.css';
import './styles/preview.css';
import './styles/social.css';
import './styles/responsive.css';

const CatalogEditor = lazy(() =>
  import('./components/config/CatalogEditor').then((m) => ({ default: m.CatalogEditor }))
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
    let stale = false;
    api
      .getStats()
      .then((data) => {
        if (!stale) setStats(data);
      })
      .catch((err) => console.warn('Stats fetch failed', err));
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

      <AppProviders state={state} actions={actions} config={config} tmdb={tmdb}>
        <main
          className={`main ${state.activeCatalog?.source && state.activeCatalog.source !== 'tmdb' ? `theme-${state.activeCatalog.source}` : ''}`}
          id="main-content"
        >
          <div className="container">
            <div className="builder-toolbar">
              <div className="builder-title-area">
                <h2>Catalog Builder</h2>
                <p className="text-secondary">Create and customize your Stremio catalogs</p>

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

              <CreditsBanner />

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
                    {config.isDirty && (
                      <span className="unsaved-indicator" title="Unsaved changes" />
                    )}
                    <button
                      className="btn btn-primary"
                      onClick={actions.handleSave}
                      disabled={isSaving || config.loading || configsLoading}
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

              <div className="mobile-support-under-actions">
                <a
                  href="https://discord.gg/X2N3btmEG2"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sidebar-support-btn sidebar-support-discord"
                  title="Join our Discord community"
                >
                  <DiscordIcon className="sidebar-support-icon" />
                  <span>Discord</span>
                </a>
                <a
                  href="https://buymeacoffee.com/semi.column"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sidebar-support-btn sidebar-support-bmc"
                  title="Buy me a coffee"
                >
                  <Coffee size={14} />
                  <span>Buy me a coffee</span>
                </a>
              </div>
            </div>

            <div className="builder-layout">
              <PanelErrorBoundary fallbackMessage="The sidebar encountered an error.">
                <CatalogSidebar />
              </PanelErrorBoundary>

              <PanelErrorBoundary fallbackMessage="The editor encountered an error.">
                <Suspense
                  fallback={
                    <div className="editor-panel editor-loading">
                      <div className="spinner" />
                    </div>
                  }
                >
                  <CatalogEditor />
                </Suspense>
              </PanelErrorBoundary>
            </div>
          </div>
        </main>

        <NewCatalogModal
          isOpen={showNewCatalogModal}
          onClose={() => state.setShowNewCatalogModal(false)}
          onAdd={actions.handleAddCatalog}
          imdbEnabled={tmdb.imdbEnabled}
        />

        <InstallModal
          isOpen={showInstallModal}
          onClose={() => state.setShowInstallModal(false)}
          installUrl={installData?.installUrl}
          stremioUrl={installData?.stremioUrl}
        />

        <ConfigMismatchModal
          isOpen={state.showMismatchModal}
          onGoToOwn={actions.handleConfigMismatchGoToOwn}
          onLoginNew={actions.handleConfigMismatchLoginNew}
        />

        <ToastContainer toasts={toasts} removeToast={actions.removeToast} />
      </AppProviders>
    </div>
  );
}

export default App;
