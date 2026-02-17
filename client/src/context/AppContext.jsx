import { createContext, useContext, useMemo } from 'react';

// ─── Catalog Context ──────────────────────────────────────
const CatalogContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useCatalog() {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used within AppProviders');
  return ctx;
}

// ─── TMDB Data Context ────────────────────────────────────
const TMDBDataContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useTMDBData() {
  const ctx = useContext(TMDBDataContext);
  if (!ctx) throw new Error('useTMDBData must be used within AppProviders');
  return ctx;
}

// ─── App Actions Context ──────────────────────────────────
const AppActionsContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useAppActions() {
  const ctx = useContext(AppActionsContext);
  if (!ctx) throw new Error('useAppActions must be used within AppProviders');
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────
export function AppProviders({ state, actions, config, tmdb, children }) {
  const catalogValue = useMemo(
    () => ({
      catalogs: config.catalogs,
      setCatalogs: config.setCatalogs,
      activeCatalog: state.activeCatalog,
      setActiveCatalog: state.setActiveCatalog,
      globalSource: state.globalSource,
      setGlobalSource: state.setGlobalSource,
      configName: config.configName,
      setConfigName: config.setConfigName,
      preferences: config.preferences,
      setPreferences: config.setPreferences,
      isDirty: config.isDirty,
      userId: config.userId,
      handleAddCatalog: actions.handleAddCatalog,
      handleAddPresetCatalog: actions.handleAddPresetCatalog,
      handleDeleteCatalog: actions.handleDeleteCatalog,
      handleDuplicateCatalog: actions.handleDuplicateCatalog,
      handleUpdateCatalog: actions.handleUpdateCatalog,
      handleImportConfig: actions.handleImportConfig,
    }),
    [
      config,
      state.activeCatalog,
      state.setActiveCatalog,
      state.globalSource,
      state.setGlobalSource,
      actions,
    ]
  );

  const tmdbValue = useMemo(
    () => ({
      genres: tmdb.genres,
      loading: tmdb.loading,
      error: tmdb.error,
      refresh: tmdb.refresh,
      languages: tmdb.languages,
      originalLanguages: tmdb.originalLanguages,
      countries: tmdb.countries,
      sortOptions: tmdb.sortOptions,
      releaseTypes: tmdb.releaseTypes,
      tvStatuses: tmdb.tvStatuses,
      tvTypes: tmdb.tvTypes,
      monetizationTypes: tmdb.monetizationTypes,
      certifications: tmdb.certifications,
      watchRegions: tmdb.watchRegions,
      tvNetworks: tmdb.tvNetworks,
      presetCatalogs: tmdb.presetCatalogs,
      imdbPresetCatalogs: tmdb.imdbPresetCatalogs,
      imdbEnabled: tmdb.imdbEnabled,
      imdbGenres: tmdb.imdbGenres,
      imdbKeywords: tmdb.imdbKeywords,
      imdbAwards: tmdb.imdbAwards,
      imdbSortOptions: tmdb.imdbSortOptions,
      imdbTitleTypes: tmdb.imdbTitleTypes,
      preview: tmdb.preview,
      previewImdb: tmdb.previewImdb,
      searchPerson: tmdb.searchPerson,
      searchCompany: tmdb.searchCompany,
      searchKeyword: tmdb.searchKeyword,
      searchTVNetworks: tmdb.searchTVNetworks,
      getPersonById: tmdb.getPersonById,
      getCompanyById: tmdb.getCompanyById,
      getKeywordById: tmdb.getKeywordById,
      getNetworkById: tmdb.getNetworkById,
      getWatchProviders: tmdb.getWatchProviders,
    }),
    [tmdb]
  );

  const actionsValue = useMemo(
    () => ({
      addToast: actions.addToast,
      removeToast: actions.removeToast,
      handleSave: actions.handleSave,
      handleLogin: actions.handleLogin,
      handleLogout: actions.handleLogout,
      handleSwitchConfig: actions.handleSwitchConfig,
      handleDeleteConfigFromDropdown: actions.handleDeleteConfigFromDropdown,
      handleCreateNewConfig: actions.handleCreateNewConfig,
      isSaving: state.isSaving,
      setShowNewCatalogModal: state.setShowNewCatalogModal,
    }),
    [actions, state.isSaving, state.setShowNewCatalogModal]
  );

  return (
    <CatalogContext.Provider value={catalogValue}>
      <TMDBDataContext.Provider value={tmdbValue}>
        <AppActionsContext.Provider value={actionsValue}>{children}</AppActionsContext.Provider>
      </TMDBDataContext.Provider>
    </CatalogContext.Provider>
  );
}
