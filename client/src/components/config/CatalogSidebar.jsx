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
  Shuffle,
  Image,
  ExternalLink,
  Eye,
  EyeOff,
  Download,
  Upload as ArrowUpTrayIcon,
  Trophy,
  Award,
} from 'lucide-react';
import { useState, useEffect, lazy, Suspense, memo } from 'react';

import { useIsMobile } from '../../hooks/useIsMobile';
import { SearchableSelect } from '../forms/SearchableSelect';
import { CatalogListSkeleton } from '../layout/Skeleton';

const DraggableCatalogList = lazy(() =>
  import('./DraggableCatalogList').then((m) => ({ default: m.DraggableCatalogList }))
);

function GeneralSettingsSection({ preferences, onPreferencesChange, languages = [] }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const defaultLanguage = preferences?.defaultLanguage || '';

  const handleLanguageChange = (val) => {
    onPreferencesChange({
      ...preferences,
      defaultLanguage: val,
    });
  };

  return (
    <div className="sidebar-section general-settings" style={{ marginBottom: '12px' }}>
      <div
        className="sidebar-section-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 0',
        }}
      >
        <span className="sidebar-section-title" style={{ flex: 1, margin: 0 }}>
          General Settings
        </span>
        <ChevronDown
          size={14}
          className="text-muted"
          style={{
            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        />
      </div>

      {!isCollapsed && (
        <div style={{ padding: '8px 16px 16px' }}>
          <div className="input-group">
            <label
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                marginBottom: '4px',
                display: 'block',
              }}
            >
              Global Display & Trailer Language
            </label>
            <SearchableSelect
              options={languages}
              value={defaultLanguage}
              onChange={handleLanguageChange}
              placeholder="Default (Auto/English)"
              valueKey="iso_639_1"
              labelKey="english_name"
              renderOption={(opt) => `${opt.english_name} (${opt.name})`}
            />
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Overrides language for all catalogs.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

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

function PosterSettingsSection({ preferences, onPreferencesChange }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');

  const posterService = preferences?.posterService || 'none';
  const hasPosterKey = Boolean(preferences?.posterApiKeyEncrypted);

  const handleServiceChange = (e) => {
    const newService = e.target.value;
    onPreferencesChange({
      ...preferences,
      posterService: newService,
      ...(newService === 'none' && {
        posterApiKey: undefined,
        posterApiKeyEncrypted: undefined,
      }),
    });
    setApiKeyInput('');
  };

  const handleApiKeyChange = (e) => {
    const newKey = e.target.value;
    setApiKeyInput(newKey);
    if (newKey) {
      onPreferencesChange({
        ...preferences,
        posterApiKey: newKey,
      });
    }
  };

  const serviceUrl =
    posterService === 'rpdb'
      ? 'https://ratingposterdb.com'
      : posterService === 'topPosters'
        ? 'https://api.top-streaming.stream'
        : null;

  const serviceName =
    posterService === 'rpdb' ? 'RPDB' : posterService === 'topPosters' ? 'Top Posters' : null;

  return (
    <div className="sidebar-section poster-settings">
      <div
        className="sidebar-section-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 0',
        }}
      >
        <Image size={14} className="text-muted" />
        <span className="sidebar-section-title" style={{ flex: 1, margin: 0 }}>
          Poster Support
        </span>
        <ChevronDown
          size={14}
          className="text-muted"
          style={{
            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        />
      </div>

      {!isCollapsed && (
        <div style={{ padding: '8px 16px 16px' }}>
          <div className="input-group" style={{ marginBottom: '12px' }}>
            <label
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                marginBottom: '4px',
                display: 'block',
              }}
            >
              Poster Service
            </label>
            <select
              className="input"
              value={posterService}
              onChange={handleServiceChange}
              style={{ width: '100%', fontSize: '13px' }}
            >
              <option value="none">Default (TMDB)</option>
              <option value="rpdb">RPDB (Rating Posters)</option>
              <option value="topPosters">Top Posters</option>
            </select>
          </div>

          {posterService !== 'none' && (
            <div className="input-group">
              <label
                style={{
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  marginBottom: '4px',
                  display: 'block',
                }}
              >
                API Key{' '}
                {hasPosterKey && !apiKeyInput && (
                  <span style={{ color: 'var(--success)' }}>(set)</span>
                )}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  className="input"
                  placeholder={hasPosterKey ? '••••••••' : 'Enter API key'}
                  value={apiKeyInput}
                  onChange={handleApiKeyChange}
                  style={{ width: '100%', fontSize: '13px', paddingRight: '36px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    padding: '4px',
                  }}
                  title={showApiKey ? 'Hide' : 'Show'}
                >
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                Get key from{' '}
                <a
                  href={serviceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--primary)' }}
                >
                  {serviceName} <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
                </a>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const CatalogSidebar = memo(function CatalogSidebar({
  catalogs,
  activeCatalog,
  onSelectCatalog,
  onAddCatalog,
  onAddPresetCatalog,
  onDeleteCatalog,
  onDuplicateCatalog,
  onReorderCatalogs,
  presetCatalogs = { movie: [], series: [] },
  imdbPresetCatalogs = [],
  configName = '',
  onConfigNameChange,
  preferences = {},
  onPreferencesChange,
  onImportConfig,
  languages = [],
  addToast,
  globalSource = 'tmdb',
  setGlobalSource,
  imdbEnabled = false,
}) {
  const safeCatalogs = Array.isArray(catalogs) ? catalogs : [];
  const safePresetCatalogs =
    presetCatalogs && typeof presetCatalogs === 'object' && !Array.isArray(presetCatalogs)
      ? presetCatalogs
      : { movie: [], series: [] };
  const isMobile = useIsMobile();
  const [moviePresetsCollapsed, setMoviePresetsCollapsed] = useState(isMobile);
  const [tvPresetsCollapsed, setTvPresetsCollapsed] = useState(isMobile);

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
      <div className="sidebar-header" style={{ flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', width: '100%', gap: 8 }}>
          <div className="config-name-wrapper" style={{ flex: 1 }}>
            <input
              type="text"
              className="config-name-input"
              value={configName}
              onChange={(e) => onConfigNameChange && onConfigNameChange(e.target.value)}
              placeholder={getPlaceholder()}
            />
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={onAddCatalog}
            title="Add custom catalog"
            style={{ padding: '0 8px' }}
          >
            <Plus size={16} />
          </button>
        </div>

        {imdbEnabled && (
          <div className="source-tabs" style={{ width: '100%', display: 'flex' }}>
            <button
              className={`source-tab ${globalSource === 'tmdb' ? 'active tmdb' : ''}`}
              onClick={() => setGlobalSource('tmdb')}
              style={{ flex: 1 }}
            >
              <Film size={14} />
              TMDB
            </button>
            <button
              className={`source-tab ${globalSource === 'imdb' ? 'active imdb' : ''}`}
              onClick={() => setGlobalSource('imdb')}
              style={{ flex: 1 }}
            >
              <Award size={14} />
              IMDb
            </button>
          </div>
        )}
      </div>

      <div className="sidebar-controls" style={{ padding: '0 16px 12px 16px' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, justifyContent: 'center' }}
            title="Export full configuration (catalogs + preferences)"
            onClick={() => {
              const exportData = {
                configName,
                catalogs,
                preferences,
                exportedAt: new Date().toISOString(),
              };
              const dataStr = JSON.stringify(exportData, null, 2);
              const blob = new Blob([dataStr], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `${(configName || 'stremio_config').replace(/\s+/g, '_')}_full.json`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={14} />
            <span>Export</span>
          </button>

          <label
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, justifyContent: 'center', cursor: 'pointer' }}
            title="Import full configuration"
          >
            <ArrowUpTrayIcon size={14} />
            <span>Import</span>
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                  try {
                    const imported = JSON.parse(event.target.result);
                    if (onImportConfig) onImportConfig(imported);
                  } catch (err) {
                    console.error('Import failed', err);
                    if (addToast) addToast('Failed to parse JSON file', 'error');
                  }
                  e.target.value = '';
                };
                reader.readAsText(file);
              }}
            />
          </label>
        </div>

        <label
          className="sidebar-checkbox"
          title="Randomize catalog order every time Stremio loads"
        >
          <input
            type="checkbox"
            checked={!!preferences?.shuffleCatalogs}
            onChange={(e) =>
              onPreferencesChange({ ...preferences, shuffleCatalogs: e.target.checked })
            }
          />
          <Shuffle size={14} />
          <span>Shuffle Catalogs</span>
        </label>

        <label
          className="sidebar-checkbox"
          title="Disable search catalogs if you want to use other addons for search"
          style={{ marginTop: '8px' }}
        >
          <input
            type="checkbox"
            checked={!!preferences?.disableSearch}
            onChange={(e) =>
              onPreferencesChange({ ...preferences, disableSearch: e.target.checked })
            }
          />
          <EyeOff size={14} />
          <span>Disable Search</span>
        </label>
      </div>

      <GeneralSettingsSection
        preferences={preferences}
        onPreferencesChange={onPreferencesChange}
        languages={languages}
      />

      <PosterSettingsSection preferences={preferences} onPreferencesChange={onPreferencesChange} />

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

        {/* Unified Movie Presets */}
        <div className={`preset-group ${moviePresetsCollapsed ? 'collapsed' : ''}`}>
          <div
            className="preset-group-header"
            onClick={() => setMoviePresetsCollapsed(!moviePresetsCollapsed)}
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
                  c.filters?.listType === preset.value &&
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
                  c.filters?.listType === preset.value &&
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
    </aside>
  );
});
