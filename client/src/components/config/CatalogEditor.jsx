import { AlertTriangle, Eye, Film, Globe, Loader, Lock, Sparkles, Tv, X } from 'lucide-react';
import { memo, Suspense, useEffect, useMemo, useState } from 'react';
import { ActiveFiltersBar } from './catalog/ActiveFiltersBar';
import { CatalogPreview } from './catalog/CatalogPreview';

import { useCatalogEditor } from '../../hooks/useCatalogEditor';
import { useCatalogEditorHandlers } from '../../hooks/useCatalogEditorHandlers';
import { getSource } from '../../sources/index';
import { useIsMobile } from '../../hooks/useIsMobile';
import { SearchableSelect } from '../forms/SearchableSelect';

const SOURCE_ATTRIBUTION = {
  tmdb: { label: 'TMDB', url: 'https://www.themoviedb.org/' },
  imdb: { label: 'Sleeyax', url: 'https://sleeyax.dev/' },
  anilist: { label: 'AniList', url: 'https://anilist.co/' },
  mal: { label: 'MyAnimeList', url: 'https://myanimelist.net/' },
  kitsu: { label: 'Kitsu', url: 'https://kitsu.io/' },
  simkl: { label: 'Simkl', url: 'https://simkl.com/' },
  trakt: { label: 'Trakt', url: 'https://trakt.tv/' },
};

const PREVIEW_POSTER_PROVIDER_OVERRIDE_OPTIONS = [
  { id: 'tmdb', label: 'TMDB' },
  { id: 'imdb', label: 'IMDb' },
  { id: 'rpdb', label: 'RPDB' },
  { id: 'topPosters', label: 'Top Posters' },
];

const PREVIEW_POSTER_PROVIDER_OPTION_TVDB = {
  id: 'tvdb',
  label: 'TVDB',
};

const PREVIEW_POSTER_PROVIDER_OPTION_FANART = {
  id: 'fanart',
  label: 'Fanart.tv',
};

const PREVIEW_POSTER_PROVIDER_OPTION_CUSTOM_URL = {
  id: 'customUrl',
  label: 'Custom URL',
};

const PREVIEW_POSTER_PROVIDER_LABELS = {
  tmdb: 'TMDB',
  imdb: 'IMDb',
  tvdb: 'TVDB',
  fanart: 'Fanart.tv',
  rpdb: 'RPDB',
  topPosters: 'Top Posters',
  customUrl: 'Custom URL',
};

const SUPPORTED_PREVIEW_POSTER_PROVIDERS = new Set([
  'tmdb',
  'imdb',
  'tvdb',
  'fanart',
  'rpdb',
  'topPosters',
  'customUrl',
]);

function getPreviewPosterProviderHint(provider, globalProvider) {
  if (!provider || provider === 'default') {
    const globalLabel =
      PREVIEW_POSTER_PROVIDER_LABELS[globalProvider] || PREVIEW_POSTER_PROVIDER_LABELS.tmdb;
    return `Uses global poster source (${globalLabel}).`;
  }

  if (provider === 'customUrl') {
    return 'Uses your configured Custom URL pattern for preview posters.';
  }

  const forcedLabel = PREVIEW_POSTER_PROVIDER_LABELS[provider] || provider;
  return `Forces ${forcedLabel} posters in preview only.`;
}

function normalizeArtworkContentType(type) {
  return type === 'series' || type === 'anime' ? type : 'movie';
}

function extractPosterArtworkConfig(preferences, contentType) {
  const artwork = preferences?.artwork;
  if (!artwork || typeof artwork !== 'object') return null;

  const normalizedType = normalizeArtworkContentType(contentType);
  if (artwork[normalizedType] && typeof artwork[normalizedType] === 'object') {
    return artwork[normalizedType]?.poster || null;
  }

  if (artwork.poster && typeof artwork.poster === 'object') {
    return artwork.poster;
  }

  return null;
}

function extractCustomUrlPattern(posterConfig) {
  if (typeof posterConfig?.customUrlPattern !== 'string') return null;
  const trimmed = posterConfig.customUrlPattern.trim();
  return trimmed || null;
}

function hasProviderPreviewAccess(preferences, contentType, provider) {
  if (preferences?.apiKeys?.[provider] || preferences?.apiKeysEncrypted?.[provider]) return true;

  const directConfig = extractPosterArtworkConfig(preferences, contentType);
  if (
    directConfig?.provider === provider &&
    (directConfig?.apiKey || directConfig?.apiKeyEncrypted)
  ) {
    return true;
  }

  return ['movie', 'series', 'anime'].some((ct) => {
    const cfg = extractPosterArtworkConfig(preferences, ct);
    return cfg?.provider === provider && (cfg?.apiKey || cfg?.apiKeyEncrypted);
  });
}

function hasTvdbPreviewAccess(preferences, contentType) {
  return hasProviderPreviewAccess(preferences, contentType, 'tvdb');
}

function hasFanartPreviewAccess(preferences, contentType) {
  return hasProviderPreviewAccess(preferences, contentType, 'fanart');
}

function hasCustomUrlPreviewAccess(preferences, contentType) {
  const preferredType = normalizeArtworkContentType(contentType);
  const lookupOrder = [
    preferredType,
    ...['movie', 'series', 'anime'].filter((ct) => ct !== preferredType),
  ];

  const hasPatternInArtwork = lookupOrder.some((ct) => {
    const cfg = extractPosterArtworkConfig(preferences, ct);
    return Boolean(extractCustomUrlPattern(cfg));
  });

  if (hasPatternInArtwork) return true;

  return Boolean(
    typeof preferences?.posterCustomUrlPattern === 'string' &&
    preferences.posterCustomUrlPattern.trim()
  );
}

function resolveGlobalPreviewPosterProvider(preferences, contentType) {
  const directConfig = extractPosterArtworkConfig(preferences, contentType);
  const provider = directConfig?.provider;

  if (!provider || provider === 'none' || provider === 'default') {
    return 'tmdb';
  }

  if (provider === 'metahub') {
    return 'tmdb';
  }

  if (provider === 'customUrl') {
    return hasCustomUrlPreviewAccess(preferences, contentType) ? 'customUrl' : 'tmdb';
  }

  return SUPPORTED_PREVIEW_POSTER_PROVIDERS.has(provider) ? provider : 'tmdb';
}

export const CatalogEditor = memo(function CatalogEditor() {
  const isMobileSize = useIsMobile(1800);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);

  const state = useCatalogEditor();
  const handlers = useCatalogEditorHandlers(state);

  const {
    catalog,
    preferences,
    localCatalog,
    previewData,
    previewLoading,
    previewError,
    previewPosterProvider,
    setPreviewPosterProvider,
    tvNetworkOptions,
    expandedSections,
    safeGenres,
    safeOriginalLanguages,
    safeCountries,
    safeCertifications,
    sortOptions,
    originalLanguages,
    countries,
    releaseTypes,
    tvStatuses,
    tvTypes,
    monetizationTypes,
    watchRegions,
    watchProviders,
    genresLoading,
    refreshGenres,
    imdbGenres,
    imdbKeywords,
    imdbAwards,
    imdbSortOptions,
    imdbTitleTypes,
    imdbEnabled,
    imdbCertificateRatings,
    imdbRankedLists,
    imdbWithDataOptions,
    searchPerson,
    searchCompany,
    searchKeyword,
    searchCollection,
    getCompanyById,
    getCollectionById,
    searchImdbPeople,
    searchImdbCompanies,
    searchCities,
    // Anime reference data
    anilistGenres,
    anilistTags,
    anilistSortOptions,
    anilistFormatOptions,
    anilistStatusOptions,
    anilistSeasonOptions,
    anilistSourceOptions,
    anilistCountryOptions,
    malGenres,
    malRankingTypes,
    malSortOptions,
    malOrderByOptions,
    malMediaTypes,
    malStatuses,
    malRatings,
    simklGenres,
    simklSortOptions,
    simklListTypes,
    simklTrendingPeriods,
    simklBestFilters,
    simklAnimeTypes,
    // Trakt reference data
    traktGenres,
    traktListTypes,
    traktPeriods,
    traktCalendarTypes,

    traktShowStatuses,
    traktCertificationsMovie,
    traktCertificationsSeries,
    traktCommunityMetrics,
    traktNetworks,
    traktHasKey,
    selectedPeople,
    setSelectedPeople,
    selectedCompanies,
    setSelectedCompanies,
    selectedKeywords,
    setSelectedKeywords,
    excludeKeywords,
    setExcludeKeywords,
    excludeCompanies,
    setExcludeCompanies,
    selectedNetworks,
    selectedImdbPeople,
    setSelectedImdbPeople,
    selectedImdbCompanies,
    setSelectedImdbCompanies,
    selectedImdbExcludeCompanies,
    setSelectedImdbExcludeCompanies,
    selectedCollection,
    setSelectedCollection,
    selectedStudio,
    setSelectedStudio,
    selectedCity,
    setSelectedCity,
    activeFilters,
    clearFilter,
    clearAllFilters,
  } = state;

  const globalPreviewPosterProvider = useMemo(
    () => resolveGlobalPreviewPosterProvider(preferences, localCatalog?.type),
    [preferences, localCatalog?.type]
  );

  const previewPosterProviderOptions = useMemo(() => {
    const globalLabel =
      PREVIEW_POSTER_PROVIDER_LABELS[globalPreviewPosterProvider] ||
      PREVIEW_POSTER_PROVIDER_LABELS.tmdb;
    const baseOptions = [
      { id: 'default', label: `Global default (${globalLabel})` },
      { id: 'tmdb', label: 'TMDB' },
      { id: 'imdb', label: 'IMDb' },
    ];

    if (hasTvdbPreviewAccess(preferences, localCatalog?.type)) {
      baseOptions.push(PREVIEW_POSTER_PROVIDER_OPTION_TVDB);
    }

    if (hasFanartPreviewAccess(preferences, localCatalog?.type)) {
      baseOptions.push(PREVIEW_POSTER_PROVIDER_OPTION_FANART);
    }

    baseOptions.push(
      ...PREVIEW_POSTER_PROVIDER_OVERRIDE_OPTIONS.filter(
        (o) =>
          o.id !== 'tmdb' &&
          o.id !== 'imdb' &&
          (o.id !== 'topPosters' ||
            hasProviderPreviewAccess(preferences, localCatalog?.type, 'topPosters'))
      )
    );

    if (hasCustomUrlPreviewAccess(preferences, localCatalog?.type)) {
      baseOptions.push(PREVIEW_POSTER_PROVIDER_OPTION_CUSTOM_URL);
    }

    return baseOptions.filter(
      (option) => option.id === 'default' || option.id !== globalPreviewPosterProvider
    );
  }, [preferences, localCatalog?.type, globalPreviewPosterProvider]);

  useEffect(() => {
    if (!previewPosterProviderOptions.some((option) => option.id === previewPosterProvider)) {
      setPreviewPosterProvider('default');
    }
  }, [previewPosterProvider, previewPosterProviderOptions, setPreviewPosterProvider]);

  const {
    toggleSection,
    handleFiltersChange,
    handleNameChange,
    handleTypeChange,
    handleTriStateGenreClick,
    loadPreview,
    handleTVNetworkSearch,
    handleTogglePublished,
  } = handlers;

  const handlePreviewClick = async () => {
    if (isMobileSize) {
      setIsPreviewModalOpen(true);
    }
    await loadPreview();
  };

  if (!catalog) {
    return (
      <div className="editor-panel">
        <div className="empty-state">
          <div className="empty-state-icon">
            <Sparkles size={48} />
          </div>
          <h3>Create Your First Catalog</h3>
          <p>Click "Add" in the sidebar to start building a custom catalog with TMDB filters</p>
        </div>
      </div>
    );
  }

  const catalogType = localCatalog?.type || 'movie';
  const isMovie = catalogType === 'movie';
  const isAnime = catalogType === 'anime';
  const isCollection = catalogType === 'collection';
  const currentSource = getSource(localCatalog?.source || 'tmdb');
  const supportedTypes = currentSource.supportedTypes || ['movie', 'series'];
  const isTmdbSource = localCatalog?.source === 'tmdb';

  const currentListType = localCatalog?.filters?.listType || 'discover';
  const hasPresetOrigin = Boolean(localCatalog?.filters?.presetOrigin);
  const isCollectionModeListType = currentListType === 'collection' || currentListType === 'studio';
  const isPresetCatalog =
    currentListType &&
    currentListType !== 'discover' &&
    !hasPresetOrigin &&
    !isCollectionModeListType;
  const supportsFullFilters = !isPresetCatalog && !isCollection;
  const isImdbCatalog = localCatalog?.source === 'imdb';
  const showImdbSourceDisabledNotice = isImdbCatalog && !imdbEnabled;
  const previewPosterProviderHint = getPreviewPosterProviderHint(
    previewPosterProvider,
    globalPreviewPosterProvider
  );
  const effectivePreviewPosterProvider =
    previewPosterProvider && previewPosterProvider !== 'default'
      ? previewPosterProvider
      : globalPreviewPosterProvider;

  const imdbSourceDisabledNotice = (
    <div className="empty-state">
      <div
        className="empty-state-icon"
        style={{
          color: 'var(--accent-primary)',
          opacity: 0.8,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
        }}
      >
        <AlertTriangle size={48} />
      </div>
      <h3>IMDb Source Unavailable</h3>
      <p style={{ maxWidth: '400px', margin: '0 auto', lineHeight: '1.5' }}>
        IMDb catalogs are disabled on the nightly build due to resource constraints. Please switch
        to the{' '}
        <a
          href="https://tmdb-discover-plus.elfhosted.com/"
          style={{
            color: 'var(--accent-primary)',
            fontWeight: 600,
            textDecoration: 'none',
          }}
          target="_blank"
          rel="noopener noreferrer"
        >
          stable version
        </a>{' '}
        to manage and edit IMDb catalogs.
      </p>
    </div>
  );

  if (showImdbSourceDisabledNotice) {
    return (
      <div className="editor-container">
        <div className="editor-panel">{imdbSourceDisabledNotice}</div>
      </div>
    );
  }

  const catalogSource = getSource(localCatalog?.source ?? 'tmdb');
  const SourceFilterPanel = catalogSource.FilterPanelComponent;

  const sourcePanelProps = {
    localCatalog,
    onFiltersChange: handleFiltersChange,
    sortOptions,
    originalLanguages,
    languages: safeOriginalLanguages,
    countries,
    safeCountries,
    safeCertifications,
    safeGenres,
    safeOriginalLanguages,
    releaseTypes,
    tvStatuses,
    tvTypes,
    watchRegions,
    watchProviders,
    monetizationTypes,
    tvNetworkOptions,
    selectedNetworks,
    selectedPeople,
    setSelectedPeople,
    selectedCompanies,
    setSelectedCompanies,
    selectedKeywords,
    setSelectedKeywords,
    excludeKeywords,
    setExcludeKeywords,
    excludeCompanies,
    setExcludeCompanies,
    searchPerson,
    searchCompany,
    searchKeyword,
    searchCollection,
    getCompanyById,
    getCollectionById,
    onSearchImdbPeople: searchImdbPeople,
    onSearchImdbCompanies: searchImdbCompanies,
    onSearchCities: searchCities,
    selectedImdbPeople,
    setSelectedImdbPeople,
    selectedImdbCompanies,
    setSelectedImdbCompanies,
    selectedImdbExcludeCompanies,
    setSelectedImdbExcludeCompanies,
    selectedCollection,
    setSelectedCollection,
    selectedStudio,
    setSelectedStudio,
    selectedCity,
    setSelectedCity,
    imdbGenres,
    imdbKeywords,
    imdbAwards,
    imdbSortOptions,
    imdbTitleTypes,
    imdbCertificateRatings,
    imdbRankedLists,
    imdbWithDataOptions,
    // Anime reference data
    anilistGenres,
    anilistTags,
    anilistSortOptions,
    anilistFormatOptions,
    anilistStatusOptions,
    anilistSeasonOptions,
    anilistSourceOptions,
    anilistCountryOptions,
    malGenres,
    malRankingTypes,
    malSortOptions,
    malOrderByOptions,
    malMediaTypes,
    malStatuses,
    malRatings,
    simklGenres,
    simklSortOptions,
    simklListTypes,
    simklTrendingPeriods,
    simklBestFilters,
    simklAnimeTypes,
    // Trakt reference data
    traktGenres,
    traktListTypes,
    traktPeriods,
    traktCalendarTypes,

    traktShowStatuses,
    traktCertificationsMovie,
    traktCertificationsSeries,
    traktCommunityMetrics,
    traktNetworks,
    traktHasKey,
    handleTVNetworkSearch,
    handleTriStateGenreClick,
    genresLoading,
    refreshGenres,
    expandedSections,
    onToggleSection: toggleSection,
    activeFilters,
    isPresetCatalog,
    supportsFullFilters,
    onSelectImdbPerson: setSelectedImdbPeople,
    onRemoveImdbPerson: setSelectedImdbPeople,
    onSelectImdbCompany: setSelectedImdbCompanies,
    onRemoveImdbCompany: setSelectedImdbCompanies,
    onSelectImdbExcludeCompany: setSelectedImdbExcludeCompanies,
    onRemoveImdbExcludeCompany: setSelectedImdbExcludeCompanies,
    onSelectCity: (city) => {
      setSelectedCity(city);
      handleFiltersChange('inTheatersLat', city.lat);
      handleFiltersChange('inTheatersLong', city.lon);
    },
    onClearCity: () => {
      setSelectedCity(null);
      handleFiltersChange('inTheatersLat', undefined);
      handleFiltersChange('inTheatersLong', undefined);
      handleFiltersChange('inTheatersRadius', undefined);
    },
  };

  return (
    <div className="editor-container">
      <div className="editor-panel">
        <div className="editor-header">
          <div
            className="editor-title"
            style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}
          >
            <div
              className="editor-icon-wrapper"
              style={{
                padding: '8px',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {isAnime ? (
                <Sparkles size={20} className="text-secondary" />
              ) : isMovie ? (
                <Film size={20} className="text-secondary" />
              ) : (
                <Tv size={20} className="text-secondary" />
              )}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="text"
                  className={`editor-name-input${!localCatalog?.name?.trim() ? ' field-invalid' : ''}`}
                  placeholder="Catalog Name..."
                  value={localCatalog?.name || ''}
                  onChange={(e) => handleNameChange(e.target.value)}
                  maxLength={50}
                  style={{ margin: 0, padding: 0 }}
                />
              </div>
              {!localCatalog?.name?.trim() && <span className="field-error">Name is required</span>}
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Powered by{' '}
                <a
                  href={
                    SOURCE_ATTRIBUTION[localCatalog?.source]?.url || SOURCE_ATTRIBUTION.tmdb.url
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: 'var(--accent-primary)',
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                  onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                >
                  {SOURCE_ATTRIBUTION[localCatalog?.source]?.label || SOURCE_ATTRIBUTION.tmdb.label}
                </a>
              </div>
              <button
                type="button"
                className={`catalog-visibility-toggle ${localCatalog?.published === false ? 'is-private' : 'is-public'}`}
                onClick={handleTogglePublished}
                aria-pressed={localCatalog?.published === false}
                title={
                  localCatalog?.published === false
                    ? 'Private — hidden from the marketplace. Click to make public.'
                    : 'Public — discoverable in the marketplace. Click to make private.'
                }
              >
                {localCatalog?.published === false ? <Lock size={12} /> : <Globe size={12} />}
                {localCatalog?.published === false ? 'Private' : 'Public'}
              </button>
            </div>
          </div>
          <div className="editor-actions">
            <div className="preview-provider-field">
              <span className="preview-provider-label">Preview posters</span>
              <div className="preview-provider-row">
                <div className="preview-provider-select">
                  <SearchableSelect
                    options={previewPosterProviderOptions}
                    value={previewPosterProvider}
                    onChange={(value) => setPreviewPosterProvider(value || 'default')}
                    valueKey="id"
                    labelKey="label"
                    placeholder="Select preview poster source"
                    searchPlaceholder="Search poster source..."
                    allowClear={false}
                    menuPlacement="bottom"
                    aria-label="Preview poster provider"
                  />
                </div>
                <button
                  className="btn btn-secondary preview-trigger-btn desktop-preview-btn"
                  onClick={handlePreviewClick}
                  disabled={previewLoading}
                >
                  {previewLoading ? (
                    <Loader size={16} className="animate-spin" />
                  ) : (
                    <Eye size={16} />
                  )}
                  Preview
                </button>
              </div>
              <span className="preview-provider-hint">{previewPosterProviderHint}</span>
            </div>
          </div>
        </div>

        <div className="editor-content">
          <div className="content-type-toggle">
            <button
              className={`type-btn ${isMovie ? 'active' : ''}`}
              onClick={() => handleTypeChange('movie')}
              disabled={isPresetCatalog}
              style={isPresetCatalog ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              <Film size={18} /> Movies
            </button>
            <button
              className={`type-btn ${catalogType === 'series' ? 'active' : ''}`}
              onClick={() => handleTypeChange('series')}
              disabled={isPresetCatalog}
              style={isPresetCatalog ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              <Tv size={18} /> TV Shows
            </button>
            {supportedTypes.includes('anime') && (
              <button
                className={`type-btn ${isAnime ? 'active' : ''}`}
                onClick={() => handleTypeChange('anime')}
                disabled={isPresetCatalog}
                style={isPresetCatalog ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
              >
                <Sparkles size={18} /> Anime
              </button>
            )}
            {isTmdbSource && (
              <button
                className={`type-btn ${isCollection ? 'active' : ''}`}
                onClick={() => handleTypeChange('collection')}
              >
                <Sparkles size={18} /> Collections
              </button>
            )}
          </div>

          {localCatalog?.source === 'mal' && (
            <div className="mal-jikan-warning" role="status">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>
                Some MAL results may be temporarily unavailable when Jikan cannot reach MyAnimeList.
              </span>
            </div>
          )}

          {!(isImdbCatalog && isPresetCatalog) && (
            <ActiveFiltersBar
              activeFilters={activeFilters}
              onClearFilter={clearFilter}
              onClearAll={clearAllFilters}
              onToggleSection={toggleSection}
            />
          )}

          <Suspense fallback={null}>
            <SourceFilterPanel {...sourcePanelProps} />
          </Suspense>

          <div className="mobile-preview-btn-container">
            <div className="preview-provider-field mobile-preview-provider">
              <span className="preview-provider-label">Preview posters</span>
              <div className="preview-provider-select">
                <SearchableSelect
                  options={previewPosterProviderOptions}
                  value={previewPosterProvider}
                  onChange={(value) => setPreviewPosterProvider(value || 'default')}
                  valueKey="id"
                  labelKey="label"
                  placeholder="Select preview poster source"
                  searchPlaceholder="Search poster source..."
                  allowClear={false}
                  menuPlacement="top"
                  aria-label="Preview poster provider"
                />
              </div>
              <span className="preview-provider-hint">{previewPosterProviderHint}</span>
            </div>

            <button
              className="btn btn-secondary mobile-preview-btn"
              onClick={handlePreviewClick}
              disabled={previewLoading}
            >
              {previewLoading ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
              Preview
            </button>
          </div>
        </div>
      </div>

      <CatalogPreview
        loading={previewLoading}
        error={previewError}
        data={previewData}
        previewPosterProvider={effectivePreviewPosterProvider}
        onRetry={loadPreview}
        onLoadPreview={loadPreview}
        isModal={isMobileSize}
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
      />
    </div>
  );
});
