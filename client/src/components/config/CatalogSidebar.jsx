import {
  Plus,
  Film,
  Tv,
  TrendingUp,
  Flame,
  Calendar,
  Star,
  Play,
  Radio,
  Sparkles,
  ChevronDown,
  Trophy,
  Award,
  Settings,
  Heart,
} from 'lucide-react';
import { SocialButtons } from '../social/SocialButtons.jsx';
import { useState, useEffect, lazy, Suspense, memo } from 'react';

import { useIsMobile } from '../../hooks/useIsMobile';
import { useCatalog, useTMDBData, useAppActions } from '../../context/AppContext';
import { CatalogListSkeleton } from '../layout/Skeleton';
import { DonateModal } from '../modals/DonateModal';
import { SettingsModal } from '../modals/SettingsModal';
import { ImportSelectModal } from '../modals/ImportSelectModal';
import { ExportSelectModal } from '../modals/ExportSelectModal';

const DraggableCatalogList = lazy(() =>
  import('./DraggableCatalogList').then((m) => ({ default: m.DraggableCatalogList }))
);

const presetIcons = {
  trending_day: Flame,
  trending_week: TrendingUp,
  now_playing: Play,
  upcoming: Calendar,
  airing_today: Radio,
  on_the_air: Radio,
  top_rated: Star,
  popular: Sparkles,
};

export const CatalogSidebar = memo(function CatalogSidebar() {
  const {
    catalogs,
    activeCatalog,
    setActiveCatalog: onSelectCatalog,
    globalSource,
    setGlobalSource,
    configName,
    setConfigName: onConfigNameChange,
    preferences,
    handleAddPresetCatalog: onAddPresetCatalog,
    handleDeleteCatalog: onDeleteCatalog,
    handleDuplicateCatalog: onDuplicateCatalog,
    handleImportConfig: onImportConfig,
    setCatalogs,
  } = useCatalog();
  const {
    presetCatalogs = { movie: [], series: [] },
    imdbPresetCatalogs = [],
    imdbEnabled = false,
  } = useTMDBData();
  const { addToast, setShowNewCatalogModal } = useAppActions();

  const onAddCatalog = () => setShowNewCatalogModal(true);
  const onReorderCatalogs = (nextCatalogs) => {
    setCatalogs(nextCatalogs);
  };
  const safeCatalogs = Array.isArray(catalogs) ? catalogs : [];
  const safePresetCatalogs =
    presetCatalogs && typeof presetCatalogs === 'object' && !Array.isArray(presetCatalogs)
      ? presetCatalogs
      : { movie: [], series: [] };
  const isMobile = useIsMobile();
  const [moviePresetsCollapsed, setMoviePresetsCollapsed] = useState(isMobile);
  const [tvPresetsCollapsed, setTvPresetsCollapsed] = useState(isMobile);
  const [importData, setImportData] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isDonateOpen, setIsDonateOpen] = useState(false);

  useEffect(() => {
    setMoviePresetsCollapsed(isMobile);
    setTvPresetsCollapsed(isMobile);
  }, [isMobile]);

  // Sync global source if active catalog changes
  useEffect(() => {
    if (activeCatalog?.source) {
      if (activeCatalog.source !== globalSource) {
        setGlobalSource(activeCatalog.source);
      }
    }
  }, [activeCatalog, globalSource, setGlobalSource]);

  const getCatalogKey = (catalog) => String(catalog?._id || catalog?.id || catalog?.name);

  const getPlaceholder = () => {
    if (safeCatalogs.length > 0 && safeCatalogs[0].name) {
      return safeCatalogs[0].name;
    }
    return 'Untitled Config';
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-actions">
          <div className="config-name-wrapper">
            <input
              type="text"
              className="config-name-input"
              value={configName}
              onChange={(e) => onConfigNameChange && onConfigNameChange(e.target.value)}
              placeholder={getPlaceholder()}
            />
          </div>
          <button
            className="btn btn-primary btn-sm sidebar-add-btn"
            onClick={onAddCatalog}
            title="Add custom catalog"
          >
            <Plus size={16} /> <span>New Catalog</span>
          </button>
          <button
            className="btn btn-secondary btn-sm sidebar-settings-btn"
            onClick={() => setShowSettingsModal(true)}
            aria-label="Settings"
            title="Global Preferences"
          >
            <Settings size={16} />
            <span className="settings-text">Preferences</span>
          </button>
        </div>
      </div>

      <div className="sidebar-support sidebar-support--top">
        <SocialButtons onDonateClick={() => setIsDonateOpen(true)} />
      </div>

      <div className="catalog-list">
        {safeCatalogs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Film size={32} />
            </div>
            <p>No catalogs yet</p>
            <p className="text-sm">Add a custom catalog or use presets below</p>
          </div>
        ) : (
          <Suspense fallback={<CatalogListSkeleton count={safeCatalogs.length || 3} />}>
            <DraggableCatalogList
              catalogs={safeCatalogs}
              activeCatalog={activeCatalog}
              onSelectCatalog={onSelectCatalog}
              onDeleteCatalog={onDeleteCatalog}
              onDuplicateCatalog={onDuplicateCatalog}
              onReorderCatalogs={onReorderCatalogs}
              getCatalogKey={getCatalogKey}
            />
          </Suspense>
        )}
      </div>

      <div className="sidebar-section">
        <h4 className="sidebar-section-title">Quick Add Presets</h4>

        {imdbEnabled && (
          <div className="source-tabs" style={{ marginBottom: '12px' }}>
            <button
              type="button"
              className={`source-tab ${globalSource === 'tmdb' ? 'active tmdb' : ''}`}
              onClick={() => setGlobalSource('tmdb')}
            >
              <Film size={14} /> TMDB
            </button>
            <button
              type="button"
              className={`source-tab ${globalSource === 'imdb' ? 'active imdb' : ''}`}
              onClick={() => setGlobalSource('imdb')}
            >
              <Award size={14} /> IMDb
            </button>
          </div>
        )}

        {/* Unified Movie Presets */}
        <div className={`preset-group ${moviePresetsCollapsed ? 'collapsed' : ''}`}>
          <div
            className="preset-group-header"
            onClick={() => setMoviePresetsCollapsed(!moviePresetsCollapsed)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setMoviePresetsCollapsed(!moviePresetsCollapsed);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <Film size={14} />
            <span>Movies</span>
            <ChevronDown size={14} className="chevron" />
          </div>
          <div className="preset-list">
            {(globalSource === 'tmdb'
              ? safePresetCatalogs.movie || []
              : imdbPresetCatalogs.filter((p) => p.type === 'movie')
            ).map((preset) => {
              const source = globalSource === 'tmdb' ? 'tmdb' : 'imdb';
              const type = 'movie';
              const isAdded = safeCatalogs.some(
                (c) =>
                  (source === 'imdb' ? c.source === 'imdb' : !c.source || c.source === 'tmdb') &&
                  (c.filters?.listType === preset.value ||
                    c.filters?.presetOrigin === preset.value) &&
                  c.type === type
              );
              const IconComponent =
                presetIcons[preset.value] ||
                (source === 'imdb' && preset.value === 'top250' ? Trophy : Star);

              return (
                <button
                  key={`${source}-${preset.value}`}
                  className={`preset-item ${source === 'imdb' ? 'preset-item--imdb' : ''} ${isAdded ? 'added' : ''}`}
                  onClick={() => !isAdded && onAddPresetCatalog(type, preset, source)}
                  disabled={isAdded}
                  title={isAdded ? 'Already added' : preset.description}
                >
                  <IconComponent size={14} />
                  <span>{preset.label.replace(/^[^\s]+\s/, '')}</span>
                  {!isAdded && <Plus size={14} className="preset-add-icon" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Unified TV Presets */}
        <div className={`preset-group ${tvPresetsCollapsed ? 'collapsed' : ''}`}>
          <div
            className="preset-group-header"
            onClick={() => setTvPresetsCollapsed(!tvPresetsCollapsed)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setTvPresetsCollapsed(!tvPresetsCollapsed);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <Tv size={14} />
            <span>TV Shows</span>
            <ChevronDown size={14} className="chevron" />
          </div>
          <div className="preset-list">
            {(globalSource === 'tmdb'
              ? safePresetCatalogs.series || []
              : imdbPresetCatalogs.filter((p) => p.type === 'series')
            ).map((preset) => {
              const source = globalSource === 'tmdb' ? 'tmdb' : 'imdb';
              const type = 'series';
              const isAdded = safeCatalogs.some(
                (c) =>
                  (source === 'imdb' ? c.source === 'imdb' : !c.source || c.source === 'tmdb') &&
                  (c.filters?.listType === preset.value ||
                    c.filters?.presetOrigin === preset.value) &&
                  c.type === type
              );
              const IconComponent =
                presetIcons[preset.value] ||
                (source === 'imdb' && preset.value === 'top250' ? Trophy : Star);

              return (
                <button
                  key={`${source}-${preset.value}`}
                  className={`preset-item ${source === 'imdb' ? 'preset-item--imdb' : ''} ${isAdded ? 'added' : ''}`}
                  onClick={() => !isAdded && onAddPresetCatalog(type, preset, source)}
                  disabled={isAdded}
                  title={isAdded ? 'Already added' : preset.description}
                >
                  <IconComponent size={14} />
                  <span>{preset.label.replace(/^[^\s]+\s/, '')}</span>
                  {!isAdded && <Plus size={14} className="preset-add-icon" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {showImportModal && importData && (
        <ImportSelectModal
          isOpen={showImportModal}
          data={importData}
          onClose={() => {
            setShowImportModal(false);
            setImportData(null);
          }}
          onConfirm={(selectedData) => {
            if (onImportConfig) onImportConfig(selectedData);
            setShowImportModal(false);
            setImportData(null);
          }}
        />
      )}
      {showExportModal && (
        <ExportSelectModal
          isOpen={showExportModal}
          catalogs={safeCatalogs}
          configName={configName}
          preferences={preferences}
          onClose={() => setShowExportModal(false)}
          onConfirm={(exportData) => {
            const dataStr = JSON.stringify(exportData, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${(configName || 'stremio_config').replace(/\s+/g, '_')}_export.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            setShowExportModal(false);
            if (addToast) addToast('Configuration exported successfully');
          }}
        />
      )}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        onShowExport={setShowExportModal}
        onImportData={(data) => {
          setImportData(data);
          setShowImportModal(true);
        }}
      />
      <DonateModal isOpen={isDonateOpen} onClose={() => setIsDonateOpen(false)} />
    </aside>
  );
});
