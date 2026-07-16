import { useState, useEffect, useCallback, useRef } from 'react';
import { Store, Loader, SearchX } from 'lucide-react';
import { useMarketplace } from '../../hooks/useMarketplace';
import { useIsMobile } from '../../hooks/useIsMobile';
import { MarketplaceSearchBar } from './MarketplaceSearchBar';
import { MarketplaceFacets } from './MarketplaceFacets';
import { MarketplaceSortSelect } from './MarketplaceSortSelect';
import { MarketplaceCard } from './MarketplaceCard';
import { CatalogPreview } from '../config/catalog/CatalogPreview';

/**
 * MarketplaceBrowser — the catalog marketplace rendered inline in the builder
 * layout, replacing the CatalogEditor when marketplace mode is active.
 *
 * It reuses the editor's two-column shell (`editor-container` → `editor-panel`
 * + native `CatalogPreview`) so search/filters live where the editor normally
 * is, and previews render in the same native preview surface — a side panel on
 * desktop and a popup modal on narrow screens (driven by `useIsMobile(1800)`,
 * matching CatalogEditor).
 *
 * Props:
 *   - userId: active user id (install target)
 *   - refreshConfig: reload the user's config after a successful install
 *   - apiKey: TMDB api key forwarded to the tmdb preview path
 *
 * Requirements: 6.1 (search), 11.1 (cards), 12.1/12.2 (preview delegation), 13.x (install)
 */
export function MarketplaceBrowser({ userId = null, refreshConfig = null, apiKey = null }) {
  const isMobileSize = useIsMobile(1800);
  const {
    results,
    search,
    loadMore,
    previewEntry,
    install,
    toggleLike,
    loading,
    error,
    hasMore,
    total,
  } = useMarketplace({ userId, refreshConfig, apiKey });

  // Search / facet / sort state. Default sort is trending so the landing view is
  // populated for users who have not typed a query yet.
  const [query, setQuery] = useState('');
  const [source, setSource] = useState([]);
  const [type, setType] = useState(undefined);
  const [sort, setSort] = useState('trending');

  // Native preview surface state (mirrors CatalogEditor's preview wiring).
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const previewRequestRef = useRef(0);
  const lastPreviewEntryRef = useRef(null);
  const [installingId, setInstallingId] = useState(null);

  // Initial browse on mount (empty query => trending).
  useEffect(() => {
    search({ q: '', source, type, sort });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerSearch = useCallback(
    (overrides = {}) => {
      search({ q: query, source, type, sort, ...overrides });
    },
    [search, query, source, type, sort]
  );

  const handleQueryChange = (value) => {
    setQuery(value);
    triggerSearch({ q: value });
  };

  const handleFacetsChange = (next) => {
    setSource(Array.isArray(next.source) ? next.source : []);
    setType(next.type);
    triggerSearch({ source: Array.isArray(next.source) ? next.source : [], type: next.type });
  };

  const handleSortChange = (next) => {
    setSort(next);
    triggerSearch({ sort: next });
  };

  const runPreview = useCallback(
    async (entry) => {
      lastPreviewEntryRef.current = entry;
      const requestId = ++previewRequestRef.current;
      if (isMobileSize) setIsPreviewModalOpen(true);
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewData(null);
      try {
        const data = await previewEntry(entry);
        if (requestId !== previewRequestRef.current) return; // superseded
        setPreviewData(data);
      } catch (err) {
        if (requestId !== previewRequestRef.current) return;
        setPreviewError(err?.message || 'Preview failed');
      } finally {
        if (requestId === previewRequestRef.current) setPreviewLoading(false);
      }
    },
    [previewEntry, isMobileSize]
  );

  const handleRetryPreview = useCallback(() => {
    if (lastPreviewEntryRef.current) runPreview(lastPreviewEntryRef.current);
  }, [runPreview]);

  const handleInstall = useCallback(
    async (entry) => {
      setInstallingId(entry.marketplaceId);
      try {
        await install(entry);
      } finally {
        setInstallingId(null);
      }
    },
    [install]
  );

  const handleOpenPreferences = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('open-preferences', {
        detail: { section: 'apiKeys' },
      })
    );
  }, []);

  return (
    <div className="editor-container marketplace-browser">
      <div className="editor-panel marketplace-panel">
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
              <Store size={20} className="text-secondary" />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Catalog Marketplace</h2>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Discover, preview, and add catalogs shared by the community
              </div>
            </div>
          </div>
          <div className="editor-actions" style={{ minWidth: '180px' }}>
            <MarketplaceSortSelect value={sort} onChange={handleSortChange} />
          </div>
        </div>

        <div className="editor-content marketplace-content">
          <div className="marketplace-search-group">
            <MarketplaceSearchBar value={query} onChange={handleQueryChange} />
          </div>

          <MarketplaceFacets source={source} type={type} onChange={handleFacetsChange} />

          <div className="marketplace-results-header" style={{ margin: '16px 0 8px' }}>
            <span className="filter-label">
              {total > 0 ? `${total.toLocaleString()} catalogs` : 'Results'}
            </span>
          </div>

          {error && (
            <div
              className="preview-error"
              style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--error)' }}
            >
              {error}
            </div>
          )}

          {!error && results.length === 0 && !loading && (
            <div className="preview-empty" style={{ textAlign: 'center', padding: '32px 12px' }}>
              <SearchX size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
              <p style={{ margin: 0, fontSize: '0.875rem' }}>No catalogs found.</p>
            </div>
          )}

          <div className="marketplace-results-region">
            <div className="marketplace-list">
              {results.map((entry) => (
                <MarketplaceCard
                  key={entry.marketplaceId}
                  entry={entry}
                  onPreview={runPreview}
                  onInstall={handleInstall}
                  onToggleLike={toggleLike}
                  liked={entry.liked}
                  installing={installingId === entry.marketplaceId}
                />
              ))}
              {loading && (
                <div
                  className="marketplace-list-footer"
                  style={{ textAlign: 'center', padding: '24px 12px' }}
                >
                  <Loader
                    size={28}
                    className="animate-spin"
                    style={{ color: 'var(--accent-primary)' }}
                  />
                </div>
              )}

              {!loading && hasMore && (
                <div
                  className="marketplace-list-footer"
                  style={{ textAlign: 'center', padding: '16px 0' }}
                >
                  <button type="button" className="btn btn-secondary" onClick={loadMore}>
                    Load more
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <CatalogPreview
        loading={previewLoading}
        error={previewError}
        data={previewData}
        previewPosterProvider={undefined}
        onRetry={handleRetryPreview}
        onOpenPreferences={handleOpenPreferences}
        isModal={isMobileSize}
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
      />
    </div>
  );
}
